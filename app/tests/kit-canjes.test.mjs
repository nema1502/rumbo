import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba, pedido, qrImpreso } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { createEventFromTemplate } = await import("../src/server/kit/plantillas.ts");
const { publishStep } = await import("../src/server/kit/publicar.ts");
const { NAME_MAX } = await import("../src/server/kit/borrador.ts");
const { ensureStationCodes, getOrCreateOrganizerKey, getPanelState, resolveStationCode } = await import("../src/server/panel.ts");
const { buildSnapshot, processScanItems, stationOf } = await import("../src/server/escaner.ts");
const { addBenefit } = await import("../src/server/kit/canjes.ts");
const { CONTRACT_BENEFIT_SLOTS } = await import("../src/server/kit/publicar.ts");
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

const sinRed = async () => CONTRACT_BENEFIT_SLOTS;

test("sumar un canje con el evento publicado: número siguiente, credenciales de antes y de después, puesto, tope y el número que va al contrato", async () => {
  const event = await eventoPublicado();
  const tipos = (await repo.listTicketTypes(event.id)).filter((t) => t.credentialKind === "attendee");
  const otros = (await repo.listTicketTypes(event.id)).filter((t) => t.credentialKind !== "attendee");
  const gratis = tipos.find((t) => t.priceUsdc === 0);
  const antes = await paseDePrueba(repo, { event, ticket: gratis }, { name: "Llegó Antes" });
  const otroTipo = await paseDePrueba(repo, { event, ticket: otros[0] }, { name: "De Otro Tipo" });
  const mayorAntes = new Map();
  for (const t of tipos) mayorAntes.set(t.id, Math.max(-1, ...(await repo.listTicketTypeBenefits(t.id)).map((b) => b.chainIndex)));

  const r = await addBenefit(repo, event, { name: "Foto profesional", station: "Estudio", stock: 50, ticketTypeIds: tipos.map((t) => t.id) }, sinRed);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.benefit.kind, "other");
  for (const t of tipos) {
    const enlazado = (await repo.listTicketTypeBenefits(t.id)).find((b) => b.id === r.benefit.id);
    assert.equal(enlazado.chainIndex, mayorAntes.get(t.id) + 1, t.name);
  }
  assert.ok((await repo.listPassBenefits(antes.pass.id)).some((b) => b.id === r.benefit.id), "quien ya tenía credencial lo tiene");
  assert.ok(!(await repo.listPassBenefits(otroTipo.pass.id)).some((b) => b.id === r.benefit.id), "otro tipo no lo recibe");
  const despues = await paseDePrueba(repo, { event, ticket: gratis }, { name: "Llegó Después" });
  assert.ok((await repo.listPassBenefits(despues.pass.id)).some((b) => b.id === r.benefit.id), "quien se inscribe después también");

  const codigo = (await ensureStationCodes(event, repo)).find((c) => c.benefitId === r.benefit.id);
  assert.ok(codigo, "tiene su código de puesto");
  const access = await resolveStationCode(codigo.code, repo);
  const foto = await buildSnapshot(repo, access);
  assert.deepEqual([foto.station.name, foto.station.place, foto.stock?.total], ["Foto profesional", "Estudio", 50]);

  const pedidos = [];
  const red = {
    redeem: async (contractId, account, benefit, hooks) => (pedidos.push({ contractId, account, benefit }), await hooks?.onSubmitted?.("tx"), { hash: "tx" }),
    checkIn: async (_c, _a, hooks) => (await hooks?.onSubmitted?.("tx1"), { hash: "tx1" }),
    outcome: async () => "success",
  };
  const item = { clientId: `foto-${n}`, action: "redeem", passId: antes.pass.id, benefitId: r.benefit.id, scannedAt: new Date().toISOString(), scannerId: "estudio", qr: await qrImpreso(event.id, antes.pass.id) };
  const [resultado] = await processScanItems(repo, event, stationOf(access), [item], red);
  assert.equal(resultado.status, "synced", JSON.stringify(resultado));
  assert.deepEqual(pedidos, [{ contractId: gratis.contractId, account: antes.pass.account, benefit: mayorAntes.get(gratis.id) + 1 }]);
  assert.equal((await getPanelState(event, repo)).benefits.find((b) => b.id === r.benefit.id).remaining, 49);
});

test("sumar un canje se niega si el contrato de un tipo no tiene lugar, sin crear ni enlazar nada", async () => {
  const event = await eventoPublicado();
  const tipos = (await repo.listTicketTypes(event.id)).filter((t) => t.credentialKind === "attendee");
  const pago = tipos.find((t) => t.priceUsdc > 0) ?? tipos[0];
  const ocupados = (await repo.listTicketTypeBenefits(pago.id)).length;
  const antes = (await repo.listBenefits(event.id)).length;
  const lleno = async (contractId) => (contractId === pago.contractId ? ocupados : CONTRACT_BENEFIT_SLOTS);
  const r = await addBenefit(repo, event, { name: "Cupón por publicar tu flujo", stock: 50, ticketTypeIds: tipos.map((t) => t.id) }, lleno);
  assert.deepEqual(r, { ok: false, error: "full", ticketTypeName: pago.name });
  assert.equal((await repo.listBenefits(event.id)).length, antes);
  assert.equal((await repo.listTicketTypeBenefits(pago.id)).length, ocupados);
});

test("sumar un canje pide nombre, al menos un tipo del evento y un tope válido; por la ruta, sin acceso 401", async () => {
  const event = await eventoPublicado();
  const tipo = (await repo.listTicketTypes(event.id))[0];
  const otro = await eventoDePrueba(repo);
  assert.deepEqual(await addBenefit(repo, event, { name: "  ", stock: null, ticketTypeIds: [tipo.id] }, sinRed), { ok: false, error: "name" });
  assert.deepEqual(await addBenefit(repo, event, { name: "Foto", stock: 0, ticketTypeIds: [tipo.id] }, sinRed), { ok: false, error: "stock" });
  assert.deepEqual(await addBenefit(repo, event, { name: "Foto", stock: null, ticketTypeIds: [] }, sinRed), { ok: false, error: "types" });
  assert.deepEqual(await addBenefit(repo, event, { name: "Foto", stock: null, ticketTypeIds: [otro.ticket.id] }, sinRed), { ok: false, error: "not_found" });
  const sinAcceso = await editar(event, { action: "add", name: "Foto", stock: null, ticketTypeIds: [tipo.id] }, { conClave: false });
  assert.equal(sinAcceso.status, 401);
  assert.equal((await editar(event, { action: "add", name: "Foto", stock: null, ticketTypeIds: "todos" })).status, 400);
  assert.equal((await editar(event, { action: "add", name: "Foto", stock: null, ticketTypeIds: [otro.ticket.id] })).status, 404);
});
