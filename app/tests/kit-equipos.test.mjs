// La inscripción por equipos de la hackatón: un nombre y sus integrantes, cada uno con su credencial. Sin red:
// las cuentas, el contrato y el correo son de mentira (como en la prueba de los frenos de la inscripción).
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const stellar = await import("../src/server/stellar.ts");
const { createEventFromTemplate } = await import("../src/server/kit/plantillas.ts");
const { publishEvent } = await import("../src/server/kit/publicar.ts");
const { registerTeam } = await import("../src/server/kit/equipos.ts");
const { registrationAttempts, linkResendAttempts } = await import("../src/server/limites.ts");
const { getPanelState } = await import("../src/server/panel.ts");
const { loadCredentialUnchecked } = await import("../src/server/evento/credencial.ts");

const repo = getRepo();

// Sin red.
let numero = 0;
let caida = new Set();
globalThis.__rumboAccounts = {
  kind: "dev",
  getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
  authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
};
stellar.rumboPass.register = async (contractId, account) => {
  if (caida.has(account)) throw new Error("la red no contesta");
  numero++;
  return { hash: `h-${numero}`, ledger: 1, returnValue: numero, number: numero };
};
stellar.rumboPass.status = async () => ({ has_pass: true, number: 1, checked_in: false, redeemed: [] });
const correos = [];
globalThis.__rumboMailer = {
  kind: "dev",
  send: async (mail) => {
    correos.push(mail.to);
    return { id: String(correos.length) };
  },
};

beforeEach(async () => {
  await registrationAttempts().clear();
  await linkResendAttempts().clear();
  correos.length = 0;
  caida = new Set();
});

let contratos = 0;
async function hackaton(nombre, { publicar = true } = {}) {
  const base = await createEventFromTemplate(repo, { template: "hackaton", lang: "es", name: nombre, startsAtLocal: "2026-12-05T09:00", place: "Santa Cruz", organizerName: "GDG" });
  if (publicar) await publishEvent(repo, base, { deploy: async () => `CEQUIPO${++contratos}` });
  return repo.getEventById(base.id);
}

const equipo = (event, teamName, members, extra = {}) => registerTeam({ slug: event.slug, teamName, members, lang: "es", origin: "http://localhost:3000", ...extra }, repo);
const miembro = (n) => ({ name: `Integrante ${n} Prueba`, email: `integrante${n}-${Math.random().toString(36).slice(2, 6)}@example.com` });

test("un equipo se inscribe con su nombre: cada integrante recibe su credencial y su correo, y queda anotado", async () => {
  const event = await hackaton("Hackatón de equipos");
  const gente = [miembro(1), miembro(2), miembro(3)];
  const resultado = await equipo(event, "Los Caimanes", [...gente, { name: "", email: "" }, { name: "  ", email: "" }]);
  assert.equal(resultado.ok, true);
  assert.deepEqual([resultado.team.name, resultado.registered, resultado.failed], ["Los Caimanes", 3, []]);
  assert.deepEqual(correos.sort(), gente.map((g) => g.email).sort(), "cada uno recibe el enlace a su credencial");

  const pases = await repo.listTeamPasses(resultado.team.id);
  assert.equal(pases.length, 3);
  assert.ok(pases.every((p) => p.status === "active" && p.account && p.chainNumber));
  const tipo = await repo.getTicketType(pases[0].ticketTypeId);
  assert.equal(tipo.name, "Participante");
  assert.equal(tipo.priceUsdc, 0, "la inscripción es gratis");

  // El equipo se ve en la credencial y en el panel.
  const credencial = await loadCredentialUnchecked(pases[0].id);
  assert.equal(credencial.team, "Los Caimanes");
  const panel = await getPanelState(event, repo);
  assert.ok(panel.passes.every((p) => p.team === "Los Caimanes" && p.kind === "attendee"));
});

test("lo que está mal se dice antes de inscribir a nadie", async () => {
  const event = await hackaton("Hackatón con errores");
  const antes = (await repo.listPasses(event.id)).length;
  const razon = async (nombre, gente) => {
    const r = await equipo(event, nombre, gente);
    return r.ok ? "ok" : [r.reason, r.row];
  };
  assert.deepEqual(await razon("A", [miembro(1)]), ["name", undefined]);
  assert.deepEqual(await razon("Equipo sin gente", [{ name: "", email: "" }]), ["no_members", undefined]);
  assert.deepEqual(await razon("Equipo con correo roto", [miembro(1), { name: "Beto", email: "beto@" }]), ["member", 1]);
  const repetido = miembro(2);
  assert.deepEqual(await razon("Equipo repetido", [repetido, { name: "Otra vez", email: repetido.email.toUpperCase() }]), ["repeated", 1]);
  assert.deepEqual(await razon("Seis en un equipo", [1, 2, 3, 4, 5, 6].map(miembro)), ["too_many_members", undefined]);
  assert.equal((await repo.listPasses(event.id)).length, antes, "no se creó nada");
  assert.equal((await repo.listTeams(event.id)).length, 0);
});

test("solo los eventos publicados que se inscriben por equipos", async () => {
  const borrador = await hackaton("Hackatón sin publicar", { publicar: false });
  assert.deepEqual(await equipo(borrador, "Equipo", [miembro(1)]), { ok: false, reason: "not_found" });
  const meetup = await createEventFromTemplate(repo, { template: "meetup", lang: "es", startsAtLocal: "2026-12-05T09:00", place: "Santa Cruz", organizerName: "GDG" });
  await publishEvent(repo, meetup, { deploy: async () => `CEQUIPO${++contratos}` });
  assert.deepEqual(await equipo(await repo.getEventById(meetup.id), "Equipo", [miembro(1)]), { ok: false, reason: "no_teams" });
});

test("un nombre de equipo en uso es de otro equipo; y nadie está en dos equipos", async () => {
  const event = await hackaton("Hackatón de nombres");
  const primeros = [miembro(1), miembro(2)];
  assert.equal((await equipo(event, "Los Pumas", primeros)).ok, true);

  // Otro equipo con el mismo nombre (aunque cambien las mayúsculas) no entra.
  const otra = await equipo(event, "los pumas", [miembro(3)]);
  assert.deepEqual([otra.ok, otra.reason], [false, "team_exists"]);

  // Alguien que ya está en un equipo no se anota en otro, y a los demás no se los inscribe.
  const personasAntes = (await repo.listPasses(event.id)).length;
  const intento = await equipo(event, "Los Jaguares", [miembro(4), primeros[0]]);
  assert.deepEqual([intento.ok, intento.reason, intento.row], [false, "other_team", 1]);
  assert.equal((await repo.listPasses(event.id)).length, personasAntes);
  assert.equal((await repo.listTeams(event.id)).length, 1);
});

test("quien ya se había inscripto solo se suma al equipo sin duplicar su credencial", async () => {
  const event = await hackaton("Hackatón de conocidos");
  const suelta = miembro(7);
  const persona = await repo.upsertPerson(suelta);
  const ticket = (await repo.listTicketTypes(event.id)).find((t) => t.templateSlot === "attendee");
  const suya = await repo.createPass({ eventId: event.id, personId: persona.id, ticketTypeId: ticket.id, status: "active", account: "GSUELTA" });

  const resultado = await equipo(event, "Los Tucanes", [suelta, miembro(8)]);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.registered, 2);
  assert.equal((await repo.getPassTeam(suya.id)).name, "Los Tucanes");
  assert.equal((await repo.listPasses(event.id)).filter((p) => p.personId === persona.id).length, 1, "una sola credencial");
});

test("si la red falla para uno, el resto queda inscripto y se reintenta con el mismo nombre", async () => {
  const event = await hackaton("Hackatón con fallas");
  const gente = [miembro(1), miembro(2), miembro(3)];
  const roto = await repo.upsertPerson({ name: "Se Cae", email: "se.cae@example.com" });
  const cuenta = await globalThis.__rumboAccounts.getOrCreateForPerson(roto.id);
  caida.add(cuenta);
  const primera = await equipo(event, "Los Zorros", [...gente.slice(0, 2), { name: "Se Cae", email: "se.cae@example.com" }]);
  assert.equal(primera.ok, true);
  assert.deepEqual([primera.registered, primera.failed], [2, [{ row: 2, reason: "network" }]]);

  caida.clear();
  const segunda = await equipo(event, "Los Zorros", [...gente.slice(0, 2), { name: "Se Cae", email: "se.cae@example.com" }]);
  assert.equal(segunda.ok, true);
  assert.deepEqual([segunda.team.id === primera.team.id, segunda.registered, segunda.failed], [true, 3, []]);
  assert.equal((await repo.listTeamPasses(primera.team.id)).length, 3);
  assert.equal((await repo.listTeams(event.id)).length, 1);
});

test("un equipo que quedó sin nadie se puede volver a intentar con el mismo nombre", async () => {
  const event = await hackaton("Hackatón sin nadie");
  const sola = await repo.upsertPerson({ name: "Sola Caida", email: "sola.caida@example.com" });
  caida.add(await globalThis.__rumboAccounts.getOrCreateForPerson(sola.id));
  const primera = await equipo(event, "Los Vacíos", [{ name: "Sola Caida", email: "sola.caida@example.com" }]);
  assert.deepEqual([primera.ok, primera.registered], [true, 0]);
  caida.clear();
  const segunda = await equipo(event, "Los Vacíos", [{ name: "Sola Caida", email: "sola.caida@example.com" }]);
  assert.deepEqual([segunda.ok, segunda.registered], [true, 1]);
});

test("sumar gente a un equipo que ya existe pide a todos sus integrantes, y el equipo nunca pasa de cinco", async () => {
  const event = await hackaton("Hackatón con tope");
  const gente = [1, 2, 3, 4, 5].map(miembro);
  assert.equal((await equipo(event, "Alfa", gente)).ok, true);
  const alfa = (await repo.listTeams(event.id))[0];

  // Quien conoce el correo de un solo integrante no mete gente: hay que escribir a todos los que ya están.
  const colado = await equipo(event, "alfa", [gente[0], miembro(6), miembro(7), miembro(8), miembro(9)]);
  assert.deepEqual([colado.ok, colado.reason], [false, "members_missing"]);
  assert.equal((await repo.listTeamPasses(alfa.id)).length, 5, "el equipo sigue con cinco");

  // Con los cinco de antes, un sexto no entra: el tope cuenta a quienes ya están (pedido de seis: el tope de la fila).
  const seis = await equipo(event, "ALFA", [...gente, miembro(10)]);
  assert.deepEqual([seis.ok, seis.reason], [false, "too_many_members"]);

  // Un equipo de tres que trae a sus tres y suma dos, entra; sumar uno más después, ya no.
  const tres = [11, 12, 13].map(miembro);
  const dos = [14, 15].map(miembro);
  assert.equal((await equipo(event, "Beta", tres)).ok, true);
  const beta = (await repo.listTeams(event.id)).find((t) => t.name === "Beta");
  const cinco = await equipo(event, "Beta", [...tres, ...dos]);
  assert.deepEqual([cinco.ok, cinco.registered], [true, 5]);
  assert.equal((await repo.listTeamPasses(beta.id)).length, 5);
  const otroMas = await equipo(event, "Beta", [...tres, ...dos, miembro(16)]);
  assert.deepEqual([otroMas.ok, otroMas.reason], [false, "too_many_members"]);
  // Y con cuatro de los cinco más uno nuevo tampoco: falta uno de los que ya están.
  const faltaUno = await equipo(event, "Beta", [...tres, dos[0], miembro(17)]);
  assert.deepEqual([faltaUno.ok, faltaUno.reason], [false, "members_missing"]);
  assert.equal((await repo.listTeamPasses(beta.id)).length, 5, "nada cambió");
});
