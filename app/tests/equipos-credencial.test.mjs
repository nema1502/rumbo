import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba, mananaALas9, paseDePrueba, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { createTeamFor, joinTeamFor, leaveTeamFor, renameTeamFor, passTeamState, removeFromTeamByPanel, teamCode, shortName, TEAM_CODE_LENGTH } = await import("../src/server/evento/equipo.ts");
const { teamCodeAttempts } = await import("../src/server/limites.ts");
const { getPanelState } = await import("../src/server/panel.ts");
const { getOrCreateAccessKey } = await import("../src/server/evento/acceso.ts");
const { GET: verEquipo, POST: cambiarEquipo } = await import("../src/app/api/pase/[passId]/equipo/route.ts");

const repo = getRepo();
let n = 0;

async function hackaton({ equipos = true } = {}) {
  const event = await repo.createEvent({ slug: `hackaton-equipos-${++n}-${Date.now().toString(36)}`, name: "Hackatón de prueba", startsAt: mananaALas9(), place: "Santa Cruz", organizerName: "La comunidad", contractId: "CPRUEBA", teamSignup: equipos });
  const participante = await repo.createTicketType({ eventId: event.id, name: "Participante", priceUsdc: 0, contractId: "CPRUEBA" });
  const mentora = await repo.createTicketType({ eventId: event.id, name: "Mentora", priceUsdc: 0, contractId: "CPRUEBA", credentialKind: "mentor" });
  return { event, participante, mentora };
}

const persona = (d, name) => paseDePrueba(repo, { event: d.event, ticket: d.participante }, { name });

test("armar un equipo desde la credencial: nombre limpio, código de seis letras y quien lo armó adentro", async () => {
  const d = await hackaton();
  const ana = await persona(d, "Ana María Prueba");
  const r = await createTeamFor(repo, d.event, ana.pass, "  Las   Automatizadoras ");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.state.team.name, "Las Automatizadoras");
  assert.equal(r.state.team.code.length, TEAM_CODE_LENGTH);
  assert.match(r.state.team.code, /^[A-HJKMNP-Z2-9]+$/, "sin I, L, O, 0 ni 1");
  assert.equal(r.state.team.code, teamCode(r.state.team.id), "el código sale del id, no se guarda");
  assert.deepEqual(r.state.team.members, [{ name: "Ana P.", you: true }]);
  assert.deepEqual(await createTeamFor(repo, d.event, ana.pass, "Otro equipo"), { ok: false, error: "already" });
  assert.deepEqual(await createTeamFor(repo, d.event, (await persona(d, "Bea")).pass, "x"), { ok: false, error: "name" });
});

test("sumarse con el código, escrito como venga; un nombre que ya existe no suma a nadie a ese equipo", async () => {
  const d = await hackaton();
  const ana = await persona(d, "Ana Prueba");
  const bea = await persona(d, "Bea Prueba");
  const caro = await persona(d, "Caro Prueba");
  const { state } = await createTeamFor(repo, d.event, ana.pass, "Nodo Rosa");
  assert.deepEqual(await createTeamFor(repo, d.event, bea.pass, "nodo rosa"), { ok: false, error: "name_taken" });
  assert.equal((await passTeamState(repo, d.event, bea.pass)).team, null, "el nombre repetido no la sumó");
  const escrito = ` ${state.team.code.slice(0, 3).toLowerCase()}-${state.team.code.slice(3)} `;
  const r = await joinTeamFor(repo, d.event, bea.pass, escrito);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.state.team.members.map((m) => m.name).sort(), ["Ana P.", "Bea P."]);
  assert.deepEqual(await joinTeamFor(repo, d.event, bea.pass, state.team.code), { ok: false, error: "already" });
  // Un código de otro evento no sirve acá.
  const otro = await hackaton();
  const ajena = await createTeamFor(repo, otro.event, (await persona(otro, "Dani")).pass, "Nodo Rosa");
  assert.deepEqual(await joinTeamFor(repo, d.event, caro.pass, ajena.state.team.code), { ok: false, error: "code" });
});

test("hasta cinco por equipo, y los códigos equivocados se frenan por credencial", async () => {
  const d = await hackaton();
  const primera = await persona(d, "Uno Prueba");
  const { state } = await createTeamFor(repo, d.event, primera.pass, "Cinco");
  for (const nombre of ["Dos", "Tres", "Cuatro", "Cinco"]) assert.equal((await joinTeamFor(repo, d.event, (await persona(d, nombre)).pass, state.team.code)).ok, true);
  const sexta = await persona(d, "Seis Prueba");
  assert.deepEqual(await joinTeamFor(repo, d.event, sexta.pass, state.team.code), { ok: false, error: "full" });
  assert.equal((await passTeamState(repo, d.event, primera.pass)).team.full, true);

  await teamCodeAttempts().clear();
  const prueba = await persona(d, "Adivina Prueba");
  for (let i = 0; i < 10; i++) assert.deepEqual(await joinTeamFor(repo, d.event, prueba.pass, "ZZZZZZ"), { ok: false, error: "code" });
  assert.deepEqual(await joinTeamFor(repo, d.event, prueba.pass, state.team.code), { ok: false, error: "blocked" }, "frenada, ni el código bueno entra");
  const otra = await persona(d, "Otra Prueba");
  assert.deepEqual(await joinTeamFor(repo, d.event, otra.pass, "ZZZZZZ"), { ok: false, error: "code" }, "el freno es de esa credencial, no del wifi");
  await teamCodeAttempts().clear();
});

test("salir del equipo, y el equipo que queda vacío se borra y libera su nombre", async () => {
  const d = await hackaton();
  const ana = await persona(d, "Ana Prueba");
  const bea = await persona(d, "Bea Prueba");
  const { state } = await createTeamFor(repo, d.event, ana.pass, "Se Va");
  await joinTeamFor(repo, d.event, bea.pass, state.team.code);
  const r = await leaveTeamFor(repo, d.event, ana.pass);
  assert.equal(r.ok, true);
  assert.equal(r.state.team, null);
  assert.equal((await passTeamState(repo, d.event, bea.pass)).team.members.length, 1);
  await leaveTeamFor(repo, d.event, bea.pass);
  assert.equal((await repo.listTeams(d.event.id)).length, 0, "vacío, se borró");
  assert.equal((await createTeamFor(repo, d.event, ana.pass, "Se Va")).ok, true, "el nombre quedó libre");
  assert.deepEqual(await leaveTeamFor(repo, d.event, bea.pass), { ok: false, error: "not_in_team" });
});

test("cualquiera del equipo cambia el nombre, salvo a uno que ya tiene otro equipo", async () => {
  const d = await hackaton();
  const ana = await persona(d, "Ana Prueba");
  const bea = await persona(d, "Bea Prueba");
  const { state } = await createTeamFor(repo, d.event, ana.pass, "Primero");
  await joinTeamFor(repo, d.event, bea.pass, state.team.code);
  await createTeamFor(repo, d.event, (await persona(d, "Caro Prueba")).pass, "Ocupado");
  const r = await renameTeamFor(repo, d.event, bea.pass, "Segundo Nombre");
  assert.equal(r.ok, true);
  assert.equal(r.state.team.name, "Segundo Nombre");
  assert.equal(r.state.team.code, state.team.code, "el código no cambia con el nombre");
  assert.deepEqual(await renameTeamFor(repo, d.event, ana.pass, "OCUPADO"), { ok: false, error: "name_taken" });
  assert.equal((await renameTeamFor(repo, d.event, ana.pass, "segundo nombre")).ok, true, "su propio nombre con otras mayúsculas");
});

test("solo arman equipo las credenciales de participante activas, en un evento con equipos", async () => {
  const d = await hackaton();
  const mentora = await paseDePrueba(repo, { event: d.event, ticket: d.mentora }, { name: "Mentora Prueba" });
  assert.deepEqual(await passTeamState(repo, d.event, mentora.pass), { allowed: false, team: null });
  assert.deepEqual(await createTeamFor(repo, d.event, mentora.pass, "Mentoras"), { ok: false, error: "not_allowed" });
  const pendiente = await repo.createPass({ eventId: d.event.id, personId: (await repo.upsertPerson({ name: "Pendiente", email: `pendiente-${n}@example.com` })).id, ticketTypeId: d.participante.id, status: "pending" });
  assert.deepEqual(await createTeamFor(repo, d.event, pendiente, "Pendientes"), { ok: false, error: "not_allowed" });
  const sinEquipos = await hackaton({ equipos: false });
  assert.deepEqual(await passTeamState(repo, sinEquipos.event, (await persona(sinEquipos, "Eva")).pass), { allowed: false, team: null });
  assert.equal(shortName("  maría  josé de la peña "), "maría P.");
});

test("por la ruta de la credencial: con su clave se arma y se suma, sin la clave contesta 404", async () => {
  const d = await hackaton();
  const ana = await persona(d, "Ana Prueba");
  const bea = await persona(d, "Bea Prueba");
  const ruta = (passId) => ({ params: Promise.resolve({ passId }) });
  const url = async (pass, conClave = true) => `http://localhost/api/pase/${pass.id}/equipo${conClave ? `?k=${await getOrCreateAccessKey(pass.id)}` : ""}`;
  const sinClave = await cambiarEquipo(await pedido(await url(ana.pass, false), { body: { action: "create", name: "Por la Ruta" } }), ruta(ana.pass.id));
  assert.equal(sinClave.status, 404);
  const clavesCruzadas = await cambiarEquipo(await pedido(`http://localhost/api/pase/${ana.pass.id}/equipo?k=${await getOrCreateAccessKey(bea.pass.id)}`, { body: { action: "create", name: "Ajeno" } }), ruta(ana.pass.id));
  assert.equal(clavesCruzadas.status, 404, "la clave de otra credencial no sirve");
  const armado = await cambiarEquipo(await pedido(await url(ana.pass), { body: { action: "create", name: "Por la Ruta" } }), ruta(ana.pass.id));
  assert.equal(armado.status, 200);
  const { state } = await armado.json();
  const repetido = await cambiarEquipo(await pedido(await url(bea.pass), { body: { action: "create", name: "por la ruta" } }), ruta(bea.pass.id));
  assert.equal(repetido.status, 409);
  assert.deepEqual(await repetido.json(), { error: "name_taken" });
  const sumada = await cambiarEquipo(await pedido(await url(bea.pass), { body: { action: "join", code: state.team.code } }), ruta(bea.pass.id));
  assert.equal(sumada.status, 200);
  const visto = await verEquipo(await pedido(await url(ana.pass), { method: "GET" }), ruta(ana.pass.id));
  assert.equal((await visto.json()).state.team.members.length, 2);
  assert.equal((await cambiarEquipo(await pedido(await url(ana.pass), { body: { action: "otra" } }), ruta(ana.pass.id))).status, 400);
});

test("el panel junta los equipos con sus dinámicas: solo los canjes que sumó quien organiza, sin dobles, de más a menos", async () => {
  const d = await hackaton();
  const polera = await repo.createBenefit({ eventId: d.event.id, name: "Polera Nodo Cero", kind: "merch", station: "Seguir en Instagram", stock: 50 });
  const desayuno = await repo.createBenefit({ eventId: d.event.id, name: "Desayuno", kind: "other", station: "Mesa del desayuno", templateKey: "breakfast-1" });
  await repo.linkBenefit(d.participante.id, desayuno.id, 0);
  await repo.linkBenefit(d.participante.id, polera.id, 1);
  const [a1, a2, b1, sola] = [await persona(d, "Ana Uno"), await persona(d, "Ana Dos"), await persona(d, "Bea Uno"), await persona(d, "Sin Equipo")];
  const { state: equipoA } = await createTeamFor(repo, d.event, a1.pass, "Equipo A");
  await joinTeamFor(repo, d.event, a2.pass, equipoA.team.code);
  await createTeamFor(repo, d.event, b1.pass, "Equipo B");
  let k = 0;
  const canje = (pass, benefit) => repo.recordRedemption({ clientId: `eq-${n}-${++k}`, eventId: d.event.id, passId: pass.id, benefitId: benefit.id, scannerId: "mesa", scannedAt: new Date().toISOString() });
  await canje(a1.pass, polera);
  await canje(a2.pass, polera);
  await canje(a1.pass, desayuno);
  await canje(b1.pass, polera);
  await canje(b1.pass, polera); // doble: no suma
  await canje(sola.pass, polera); // sin equipo: no está en ningún equipo
  const panel = await getPanelState(d.event, repo);
  assert.deepEqual(panel.dynamics, [{ id: polera.id, name: "Polera Nodo Cero" }], "el desayuno de la plantilla no es una dinámica");
  assert.deepEqual(panel.teams.map((t) => [t.name, t.dynamicsWon, t.byDynamic[polera.id] ?? 0, t.members.length]), [
    ["Equipo A", 2, 2, 2],
    ["Equipo B", 1, 1, 1],
  ]);
  assert.equal(panel.teams[0].code, teamCode(panel.teams[0].id));
  assert.equal(await removeFromTeamByPanel(repo, d.event, a2.pass.id), true);
  assert.equal(await removeFromTeamByPanel(repo, d.event, sola.pass.id), false, "quien no tiene equipo");
  const despues = await getPanelState(d.event, repo);
  assert.deepEqual(despues.teams.map((t) => [t.name, t.dynamicsWon]), [["Equipo A", 1], ["Equipo B", 1]]);
});
