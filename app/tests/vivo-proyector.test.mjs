// El enlace del proyector: una clave propia por evento que abre solo la pantalla en vivo (la página en modo
// proyector y su JSON), nunca el sorteo, su CSV ni el panel; quien organiza la cambia y la anterior deja de servir.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { getOrCreateScreenKey, regenerateScreenKey, verifyScreenKey } = await import("../src/server/vivo.ts");
const { getOrCreateOrganizerKey, verifyOrganizerKey } = await import("../src/server/panel.ts");
const { SCREEN_KEY_QUERY } = await import("../src/lib/pantalla.ts");
const vivo = await import("../src/app/api/vivo/[slug]/route.ts");
const sorteo = await import("../src/app/api/vivo/[slug]/sorteo/route.ts");
const adminStands = await import("../src/app/api/admin/[slug]/stands/route.ts");
const entrar = await import("../src/app/api/admin/[slug]/entrar/route.ts");

const repo = getRepo();
const ctx = (slug) => ({ params: Promise.resolve({ slug }) });

test("la clave del proyector es propia del evento, estable, distinta de la del panel y se compara sin importar mayúsculas", async () => {
  const d = await eventoDePrueba(repo);
  const otro = await eventoDePrueba(repo);
  const clave = await getOrCreateScreenKey(d.event.id);
  assert.match(clave, /^[A-Z2-7]{24}$/);
  assert.equal(await getOrCreateScreenKey(d.event.id), clave);
  assert.notEqual(await getOrCreateScreenKey(otro.event.id), clave);
  assert.notEqual(await getOrCreateOrganizerKey(d.event.id), clave);
  assert.equal(await verifyScreenKey(d.event.id, clave), true);
  assert.equal(await verifyScreenKey(d.event.id, ` ${clave.toLowerCase()} `), true);
  assert.equal(await verifyScreenKey(otro.event.id, clave), false);
  assert.equal(await verifyScreenKey(d.event.id, await getOrCreateOrganizerKey(d.event.id)), false, "la clave del panel no es la del proyector");
  assert.equal(await verifyOrganizerKey(d.event.id, clave), false, "ni la del proyector abre el panel");
  for (const mala of [null, undefined, "", "AAAAAAAAAAAAAAAAAAAAAAAA", clave.slice(0, -1)]) assert.equal(await verifyScreenKey(d.event.id, mala), false);
});

test("con el enlace del proyector se lee la pantalla en vivo y nada más: ni el sorteo, ni el CSV, ni el panel, ni entrar", async () => {
  const d = await eventoDePrueba(repo);
  const { pass } = await paseDePrueba(repo, d, { name: "Ana Quiroga", email: "ana@example.com" });
  await repo.updatePass(pass.id, { status: "checked_in" });
  const clave = await getOrCreateScreenKey(d.event.id);
  const k = await getOrCreateOrganizerKey(d.event.id);
  const get = async (fn, q) => fn(await pedido(`http://localhost/x${q}`, { method: "GET" }), ctx(d.event.slug));

  const ok = await get(vivo.GET, `?${SCREEN_KEY_QUERY}=${clave}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  const estado = await ok.json();
  assert.equal(estado.entered, 1);
  assert.ok(!JSON.stringify(estado).includes(clave) && !JSON.stringify(estado).includes(k), "la pantalla no devuelve ninguna clave");
  assert.ok(!/Quiroga|@example\.com/.test(JSON.stringify(estado)));
  // con la del panel sigue andando; sin nada o con una inventada, 401; en un evento que no existe, 404
  assert.equal((await get(vivo.GET, `?k=${k}`)).status, 200);
  assert.equal((await get(vivo.GET, "")).status, 401);
  assert.equal((await get(vivo.GET, `?${SCREEN_KEY_QUERY}=AAAAAAAAAAAAAAAAAAAAAAAA`)).status, 401);
  assert.equal((await vivo.GET(await pedido(`http://localhost/x?${SCREEN_KEY_QUERY}=${clave}`, { method: "GET" }), ctx("no-existe"))).status, 404);

  // el enlace del proyector no abre el sorteo, su CSV ni las rutas del panel
  assert.equal((await get(sorteo.GET, `?${SCREEN_KEY_QUERY}=${clave}`)).status, 401);
  assert.equal((await get(sorteo.GET, `?${SCREEN_KEY_QUERY}=${clave}&formato=csv`)).status, 401);
  assert.equal((await sorteo.POST(await pedido(`http://localhost/x?${SCREEN_KEY_QUERY}=${clave}`, { body: { action: "freeze" } }), ctx(d.event.slug))).status, 401);
  assert.equal((await get(adminStands.GET, `?${SCREEN_KEY_QUERY}=${clave}`)).status, 401);
  assert.equal((await get(adminStands.GET, `?k=${clave}`)).status, 401, "ni haciéndose pasar por la clave del panel");
  // ni deja entrar al panel con una cookie
  const entrada = await entrar.GET(await pedido(`http://localhost/api/admin/${d.event.slug}/entrar?k=${clave}&next=vivo`, { method: "GET" }), ctx(d.event.slug));
  assert.equal(entrada.status, 303);
  assert.match(entrada.headers.get("location"), /error=clave/);
  assert.equal(entrada.headers.get("set-cookie"), null);
  // y no cambia el enlace del proyector
  assert.equal((await vivo.POST(await pedido(`http://localhost/x?${SCREEN_KEY_QUERY}=${clave}`, { body: { action: "screen-link" } }), ctx(d.event.slug))).status, 401);
  assert.equal(await getOrCreateScreenKey(d.event.id), clave);
});

test("quien organiza cambia el enlace del proyector: el nuevo abre y el viejo deja de abrir en el acto", async () => {
  const d = await eventoDePrueba(repo);
  const vieja = await getOrCreateScreenKey(d.event.id);
  const k = await getOrCreateOrganizerKey(d.event.id);
  const post = async (body, key = k) => vivo.POST(await pedido(`http://localhost/x?k=${key}`, { body }), ctx(d.event.slug));
  for (const cuerpo of [null, [], "texto", { action: "otra" }, {}]) assert.equal((await post(cuerpo)).status, 400, JSON.stringify(cuerpo));
  assert.equal((await post({ action: "screen-link" }, "NOESLACLAVE")).status, 401);
  const res = await post({ action: "screen-link" });
  assert.equal(res.status, 200);
  const { screenKey: nueva } = await res.json();
  assert.match(nueva, /^[A-Z2-7]{24}$/);
  assert.notEqual(nueva, vieja);
  assert.equal(await getOrCreateScreenKey(d.event.id), nueva);
  const get = async (q) => vivo.GET(await pedido(`http://localhost/x${q}`, { method: "GET" }), ctx(d.event.slug));
  assert.equal((await get(`?${SCREEN_KEY_QUERY}=${vieja}`)).status, 401);
  assert.equal((await get(`?${SCREEN_KEY_QUERY}=${nueva}`)).status, 200);
  assert.notEqual(await regenerateScreenKey(d.event.id), nueva);
});
