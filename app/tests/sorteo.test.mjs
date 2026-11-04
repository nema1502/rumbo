// La lista del sorteo: participan por defecto solo las credenciales de asistente (con opción de incluir a todas),
// el JSON dice cómo se calcula la huella y el CSV lleva el evento, la hora y la huella en dos líneas de comentario;
// quien organiza la congela y, desde ahí, la que se proyecta y se exporta es esa aunque alguien entre después.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { buildRaffleList, freezeRaffleList, getFrozenRaffleList, getLiveState, getRaffleList, raffleListCsv, raffleSha256, thawRaffleList, RAFFLE_ALGORITHM } = await import("../src/server/vivo.ts");
const { getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const sorteo = await import("../src/app/api/vivo/[slug]/sorteo/route.ts");
const vivo = await import("../src/app/api/vivo/[slug]/route.ts");

const repo = getRepo();
const ctx = (slug) => ({ params: Promise.resolve({ slug }) });

/** Un evento con una entrada de asistente y una de orador, y gente que entró con cada una. */
async function evento() {
  const d = await eventoDePrueba(repo);
  const oradores = await repo.createTicketType({ eventId: d.event.id, name: "Oradores", priceUsdc: 0, contractId: "CPRUEBA", credentialKind: "speaker" });
  const entraron = [];
  for (const nombre of ["Zoe", "Ana", "Mia"]) {
    const { pass } = await paseDePrueba(repo, d, { name: `${nombre} Sorteo`, email: `${nombre.toLowerCase()}@example.com` });
    await repo.updatePass(pass.id, { status: "checked_in" });
    entraron.push(pass.id);
  }
  const { pass: oradora } = await paseDePrueba(repo, { event: d.event, ticket: oradores }, { name: "Ora Dora", email: "ora@example.com" });
  await repo.updatePass(oradora.id, { status: "checked_in" });
  const { pass: noEntro } = await paseDePrueba(repo, d, { name: "Nadie Sorteo" });
  return { ...d, oradores, entraron, oradora, noEntro };
}

test("participan las credenciales de asistente que entraron; con 'all', también las demás", async () => {
  const d = await evento();
  const lista = await buildRaffleList(d.event);
  assert.deepEqual([lista.scope, lista.total, lista.frozenAt], ["attendees", 3, null]);
  assert.deepEqual(lista.participants, [...d.entraron].sort());
  assert.ok(!lista.participants.includes(d.oradora.id) && !lista.participants.includes(d.noEntro.id));
  const todas = await buildRaffleList(d.event, "all");
  assert.deepEqual([todas.scope, todas.total], ["all", 4]);
  assert.ok(todas.participants.includes(d.oradora.id));
  // la huella: la regla está escrita en la lista y se recalcula con node:crypto, sin salto final
  assert.equal(lista.algorithm, RAFFLE_ALGORITHM);
  assert.equal(lista.sha256, createHash("sha256").update(lista.participants.join("\n"), "utf8").digest("hex"));
  assert.notEqual(lista.sha256, createHash("sha256").update(`${lista.participants.join("\n")}\n`, "utf8").digest("hex"));
  assert.equal(lista.sha256, raffleSha256(lista.participants));
  assert.deepEqual([...lista.participants].sort(), lista.participants, "el orden es el de sort() sin configuración regional");
  assert.ok(!/@example\.com|Sorteo|Dora/.test(JSON.stringify(lista)));
});

test("el CSV lleva el evento, la hora, la huella y su regla en dos líneas de comentario, y después n,pass_id", async () => {
  const d = await evento();
  const lista = await buildRaffleList(d.event);
  const lineas = raffleListCsv(lista).split("\r\n");
  assert.match(lineas[0], new RegExp(`^# evento ${d.event.slug}, lista viva ${lista.generatedAt}, solo asistentes, 3 participantes$`));
  assert.equal(lineas[1], `# sha256 ${lista.sha256} (${RAFFLE_ALGORITHM})`);
  assert.equal(lineas[2], "n,pass_id");
  assert.deepEqual(lineas.slice(3, 6), lista.participants.map((id, i) => `${i + 1},${id}`));
  assert.equal(lineas[6], "");
  const vacia = raffleListCsv({ ...lista, participants: [], total: 0 });
  assert.equal(vacia.split("\r\n").length, 4);
});

test("congelar la lista: desde ahí es la que se exporta y la que ve la pantalla, aunque alguien entre después; descongelar vuelve a la viva", async () => {
  const d = await evento();
  assert.equal(await getFrozenRaffleList(d.event), null);
  assert.equal((await getLiveState(d.event)).raffle.frozen, null);
  const congelada = await freezeRaffleList(d.event);
  assert.ok(congelada.frozenAt);
  assert.deepEqual([congelada.total, congelada.scope], [3, "attendees"]);

  // alguien más entra después de congelar
  const { pass: tarde } = await paseDePrueba(repo, d, { name: "Llega Tarde", email: "tarde@example.com" });
  await repo.updatePass(tarde.id, { status: "checked_in" });
  const viva = await buildRaffleList(d.event);
  assert.equal(viva.total, 4);
  const exportada = await getRaffleList(d.event);
  assert.deepEqual([exportada.total, exportada.frozenAt, exportada.sha256], [3, congelada.frozenAt, congelada.sha256]);
  assert.ok(!exportada.participants.includes(tarde.id));
  const pantalla = (await getLiveState(d.event)).raffle;
  assert.deepEqual(pantalla.frozen, { at: congelada.frozenAt, scope: "attendees", total: 3, sha256: congelada.sha256 });
  assert.equal(pantalla.eligible, 4, "la cuenta viva sigue, para saber cuántos entrarían si se congela de nuevo");

  // congelar de nuevo reemplaza; descongelar vuelve a la viva
  const otraVez = await freezeRaffleList(d.event, "all");
  assert.deepEqual([otraVez.total, otraVez.scope], [5, "all"]);
  assert.equal((await getRaffleList(d.event)).sha256, otraVez.sha256);
  await thawRaffleList(d.event);
  assert.equal(await getFrozenRaffleList(d.event), null);
  assert.equal((await getRaffleList(d.event)).frozenAt, null);
});

test("por la API: GET devuelve la congelada si la hay (JSON y CSV), POST congela o descongela, todo con la clave de organizador", async () => {
  const d = await evento();
  const k = await getOrCreateOrganizerKey(d.event.id);
  const get = async (q = "") => sorteo.GET(await pedido(`http://localhost/x${q}`, { method: "GET" }), ctx(d.event.slug));
  const post = async (body, key = k) => sorteo.POST(await pedido(`http://localhost/x?k=${key}`, { body }), ctx(d.event.slug));

  assert.equal((await get()).status, 401);
  assert.equal((await post({ action: "freeze" }, "NOESLACLAVE")).status, 401);
  const viva = await (await get(`?k=${k}`)).json();
  assert.deepEqual(Object.keys(viva).sort(), ["algorithm", "event", "frozenAt", "generatedAt", "participants", "scope", "sha256", "total"]);
  assert.deepEqual([viva.total, viva.frozenAt], [3, null]);
  assert.equal((await (await get(`?k=${k}&todos=1`)).json()).total, 4);

  for (const cuerpo of [null, [], { action: "otra" }]) assert.equal((await post(cuerpo)).status, 400, JSON.stringify(cuerpo));
  const congelada = await (await post({ action: "freeze" })).json();
  assert.ok(congelada.frozenAt);
  const { pass: tarde } = await paseDePrueba(repo, d, { name: "Llega Tarde", email: "tarde@example.com" });
  await repo.updatePass(tarde.id, { status: "checked_in" });
  const despues = await get(`?k=${k}&todos=1`);
  const json = await despues.json();
  assert.deepEqual([json.total, json.frozenAt], [3, congelada.frozenAt], "con la congelada, ni la entrada tardía ni ?todos cambian nada");
  assert.match(despues.headers.get("content-disposition"), /^attachment; filename="lista-sorteo-/);
  assert.equal(despues.headers.get("cache-control"), "no-store");
  const csv = await (await get(`?k=${k}&formato=csv`)).text();
  assert.match(csv.split("\r\n")[0], /lista congelada/);
  assert.match(csv, new RegExp(`# sha256 ${congelada.sha256}`));
  const estado = await (await vivo.GET(await pedido(`http://localhost/x?k=${k}`, { method: "GET" }), ctx(d.event.slug))).json();
  assert.equal(estado.raffle.frozen.sha256, congelada.sha256);
  assert.deepEqual(await (await post({ action: "thaw" })).json(), { frozenAt: null });
  assert.equal((await (await get(`?k=${k}`)).json()).total, 4);
});
