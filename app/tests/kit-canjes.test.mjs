import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { createEventFromTemplate } = await import("../src/server/kit/plantillas.ts");
const { publishStep } = await import("../src/server/kit/publicar.ts");
const { NAME_MAX } = await import("../src/server/kit/borrador.ts");
const { ensureStationCodes, getOrCreateOrganizerKey, getPanelState, resolveStationCode } = await import("../src/server/panel.ts");
const { buildSnapshot } = await import("../src/server/escaner.ts");
const { POST: canjes } = await import("../src/app/api/admin/[slug]/canjes/route.ts");

const repo = getRepo();
const enRuta = (slug) => ({ params: Promise.resolve({ slug }) });

globalThis.__rumboAccounts = {
  kind: "dev",
  getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
  authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
};
globalThis.__rumboMailer = { kind: "dev", send: async () => ({ id: "1" }) };
let contratos = 0;
const desplegador = { deploy: async () => `CCANJE${++contratos}`, allow: async () => ({ ok: true }) };
globalThis.__rumboProvisioner = desplegador;

let n = 0;
async function eventoPublicado() {
  const borrador = await createEventFromTemplate(repo, { template: "meetup", lang: "es", name: `Meetup de canjes ${++n}`, startsAtLocal: "2026-12-05T19:00", place: "Santa Cruz", organizerName: "La comunidad" });
  for (let i = 0; i < 20; i++) {
    const paso = await publishStep(repo, borrador, desplegador);
    assert.equal(paso.ok, true, JSON.stringify(paso));
    if (paso.published && paso.done === paso.total) break;
  }
  const event = await repo.getEventById(borrador.id);
  assert.equal(event.published, true);
  return event;
}

async function editar(event, body, { conClave = true } = {}) {
  const clave = await getOrCreateOrganizerKey(event.id);
  const url = `http://localhost/api/admin/${event.slug}/canjes${conClave ? `?k=${clave}` : ""}`;
  const res = await canjes(await pedido(url, { body }), enRuta(event.slug));
  return { status: res.status, cuerpo: await res.json() };
}

async function asistenteYCanje(event) {
  const tipo = (await repo.listTicketTypes(event.id)).find((t) => t.priceUsdc === 0 && t.credentialKind === "attendee");
  const [benefit] = await repo.listTicketTypeBenefits(tipo.id);
  assert.ok(benefit, "el asistente del meetup trae algún canje");
  return { tipo, benefit };
}

test("con el evento publicado, cambiar nombre, mesa y tope de un canje llega al escáner y al panel", async () => {
  const event = await eventoPublicado();
  const { tipo, benefit } = await asistenteYCanje(event);
  const person = await repo.upsertPerson({ name: "Ana Prueba", email: `ana.canjes.${n}@example.com` });
  const pass = await repo.createPass({ eventId: event.id, personId: person.id, ticketTypeId: tipo.id, status: "active" });
  await repo.grantTicketBenefits(pass.id);
  const canje = await repo.recordRedemption({ clientId: `canje-${n}`, eventId: event.id, passId: pass.id, benefitId: benefit.id, scannerId: "mesa", scannedAt: new Date().toISOString() });
  await repo.markRedemption(canje.id, { synced: true });

  const r = await editar(event, { action: "edit", benefitId: benefit.id, name: "  Almuerzo   del sábado ", station: "Patio de atrás", stock: 130 });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
  const fila = r.cuerpo.state.benefits.find((b) => b.id === benefit.id);
  assert.deepEqual([fila.name, fila.station, fila.stock, fila.remaining], ["Almuerzo del sábado", "Patio de atrás", 130, 129]);
  assert.equal((await getPanelState(event, repo)).benefits.find((b) => b.id === benefit.id).remaining, 129);

  const codigo = (await ensureStationCodes(event, repo)).find((c) => c.benefitId === benefit.id).code;
  const foto = await buildSnapshot(repo, await resolveStationCode(codigo, repo));
  assert.deepEqual([foto.station.name, foto.station.place], ["Almuerzo del sábado", "Patio de atrás"]);
  assert.deepEqual(foto.stock, { total: 130, left: 129, over: 0 });

  const sinTope = await editar(event, { action: "edit", benefitId: benefit.id, name: "", station: "", stock: null });
  assert.equal(sinTope.status, 200);
  const sinTopeFila = sinTope.cuerpo.state.benefits.find((b) => b.id === benefit.id);
  assert.deepEqual([sinTopeFila.name, sinTopeFila.station, sinTopeFila.stock, sinTopeFila.remaining], ["Almuerzo del sábado", "Patio de atrás", null, null]);
});

test("el nombre y la mesa se cortan como en el borrador, y un tope fuera de 1 a 100.000 se rechaza", async () => {
  const event = await eventoPublicado();
  const { benefit } = await asistenteYCanje(event);
  const largo = await editar(event, { action: "edit", benefitId: benefit.id, name: "x".repeat(NAME_MAX + 20), stock: null });
  assert.equal(largo.status, 200);
  assert.equal((await repo.getBenefit(benefit.id)).name.length, NAME_MAX);
  for (const stock of [0, -3, 2.5, 100_001]) {
    const r = await editar(event, { action: "edit", benefitId: benefit.id, stock });
    assert.deepEqual([r.status, r.cuerpo.error], [400, "stock"], String(stock));
  }
  for (const body of [null, [], { action: "otra", benefitId: benefit.id, stock: null }, { action: "edit", benefitId: 3, stock: null }, { action: "edit", benefitId: benefit.id, stock: "10" }]) {
    assert.equal((await editar(event, body)).status, 400, JSON.stringify(body));
  }
});

test("sin acceso al panel contesta 401, y un canje de otro evento contesta 404 sin tocarlo", async () => {
  const event = await eventoPublicado();
  const { benefit } = await asistenteYCanje(event);
  const sinAcceso = await editar(event, { action: "edit", benefitId: benefit.id, name: "Otro", stock: 5 }, { conClave: false });
  assert.equal(sinAcceso.status, 401);
  assert.equal((await repo.getBenefit(benefit.id)).stock, null);

  const otro = await eventoDePrueba(repo);
  const ajeno = await editar(event, { action: "edit", benefitId: otro.lunch.id, name: "Robado", stock: 1 });
  assert.equal(ajeno.status, 404);
  const intacto = await repo.getBenefit(otro.lunch.id);
  assert.deepEqual([intacto.name, intacto.stock], ["Almuerzo", null]);
  assert.equal((await editar(event, { action: "edit", benefitId: "no-existe", stock: null })).status, 404);
});
