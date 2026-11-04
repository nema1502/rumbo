// La cuenta de organizador, sin red: entrar con la prueba de la cuenta (el desafío SEP-53 firmado por una llave
// local que hace de Pollar) por la ruta real, la sesión en la cookie (guardada como huella, nunca la ficha),
// "Mis eventos", crear sin la clave de la casa con el tope por día, el panel que entra por sesión solo si el
// evento es de esa cuenta, la sesión vencida, salir, el desafío que no sirve dos veces, y Pollar apagado.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { beforeEach, test } from "node:test";
import { entornoDePrueba, eventoDePrueba, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
process.env.RUMBO_TRUSTED_IP_HEADER = "x-real-ip";
process.env.RUMBO_ACCOUNTS = "pollar";
process.env.NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY = "pk_prueba";
const { Keypair } = await import("@stellar/stellar-sdk");
const { getRepo } = await import("../src/server/repo.ts");
const propia = await import("../src/server/cuenta-propia.ts");
const org = await import("../src/server/organizador.ts");
const { organizerLoginAttempts, walletChallengeAttempts, stationCodeAttempts } = await import("../src/server/limites.ts");
const { authorizePanelRequest } = await import("../src/server/panel-sesion.ts");
const { getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { POST: pedirDesafio } = await import("../src/app/api/cuenta/desafio/route.ts");
const { POST: entrar } = await import("../src/app/api/organizador/entrar/route.ts");
const { POST: salir } = await import("../src/app/api/organizador/salir/route.ts");
const { GET: panelJson } = await import("../src/app/api/admin/[slug]/route.ts");

const repo = getRepo();
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const enRuta = (slug) => ({ params: Promise.resolve({ slug }) });

beforeEach(async () => {
  await organizerLoginAttempts().clear();
  await walletChallengeAttempts().clear();
  await stationCodeAttempts().clear();
  delete process.env.RUMBO_EVENTS_PER_DAY;
});

/** Lo que hace el navegador con Pollar: pide el desafío y lo firma (SEP-53) con la cuenta. */
async function probar(llave, { firmaCon = llave } = {}) {
  const res = await pedirDesafio(await pedido("http://localhost/api/cuenta/desafio", { ip: "190.0.0.1", body: { publicKey: llave.publicKey(), lang: "es" } }));
  const d = await res.json();
  assert.equal(res.status, 201, JSON.stringify(d));
  return { provider: "pollar", publicKey: llave.publicKey(), challengeId: d.challengeId, signature: b64(firmaCon.sign(propia.sep53Digest(d.message))) };
}

/** Entra por la ruta real y devuelve la respuesta, el cuerpo y la cookie de la sesión (si la hubo). */
async function entrarCon(llave, { name, ip = "190.0.0.1", firmaCon } = {}) {
  const res = await entrar(await pedido("http://localhost/api/organizador/entrar", { ip, body: { wallet: await probar(llave, { firmaCon }), name, lang: "es" } }));
  const cookie = res.cookies.get(org.ORGANIZER_COOKIE);
  return { status: res.status, cuerpo: await res.json(), token: cookie?.value || null, cookie };
}

const conCookie = (token) => ({ cookie: `${org.ORGANIZER_COOKIE}=${token}` });
const plantilla = { template: "meetup", lang: "es", name: "Meetup de prueba", startsAtLocal: "2026-12-05T19:00", place: "Santa Cruz", organizerName: "La comunidad" };

test("entrar por la ruta: la prueba firmada abre una sesión; en la base queda la cuenta sin correo y la huella de la ficha, nunca la ficha", async () => {
  const llave = Keypair.random();
  const r = await entrarCon(llave, { name: "Ana Organiza" });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
  assert.ok(r.token && r.token.length >= 20, "la cookie trae la ficha");
  assert.equal(r.cookie.httpOnly, true);
  assert.equal(r.cookie.sameSite?.toLowerCase(), "lax");
  assert.equal(r.cookie.path, "/");

  const organizador = await repo.getOrganizerByAccount(llave.publicKey());
  assert.deepEqual([organizador.provider, organizador.name], ["pollar", "Ana Organiza"]);
  assert.equal(r.cuerpo.organizer.id, organizador.id);
  assert.ok(!JSON.stringify(organizador).includes("@"), "nada de correos");
  assert.equal(await repo.getOrganizerSession(r.token), null, "la ficha no está en la base");
  const huella = createHash("sha256").update(r.token).digest("hex");
  assert.equal((await repo.getOrganizerSession(huella))?.organizerId, organizador.id, "está su huella");

  // La cookie identifica a la cuenta en un pedido, y "Mis eventos" empieza vacío.
  const quien = await org.organizerFromRequest(await pedido("http://localhost/admin", { method: "GET", headers: conCookie(r.token) }));
  assert.equal(quien?.id, organizador.id);
  assert.deepEqual(await repo.listEventsByOrganizer(organizador.id), []);

  // Entrar otra vez con la misma cuenta no crea otra: actualiza la última entrada y conserva el nombre si no viene.
  const otraVez = await entrarCon(llave);
  assert.equal(otraVez.status, 200);
  const mismo = await repo.getOrganizerByAccount(llave.publicKey());
  assert.deepEqual([mismo.id, mismo.name], [organizador.id, "Ana Organiza"]);
  assert.ok(Date.parse(mismo.lastLoginAt) >= Date.parse(organizador.lastLoginAt));
});

test("crear con la cuenta no pide la clave de la casa, deja el evento con su dueño y Mis eventos lo lista", async () => {
  process.env.RUMBO_CREATE_KEY = "la-clave-de-la-casa";
  try {
    const llave = Keypair.random();
    const r = await entrarCon(llave);
    const organizador = await repo.getOrganizerByAccount(llave.publicKey());
    const creado = await org.createEventWithAccount(repo, organizador, plantilla);
    assert.equal(creado.ok, true);
    assert.equal(creado.event.organizerId, organizador.id);
    assert.equal(creado.event.published, false, "nace como borrador");
    const mios = await repo.listEventsByOrganizer(organizador.id);
    assert.deepEqual(mios.map((e) => e.id), [creado.event.id]);
    assert.ok(r.token);
  } finally {
    delete process.env.RUMBO_CREATE_KEY;
  }
});

test("el panel del evento propio entra con la cookie de sesión y sin clave; el de otra cuenta, no; la clave del evento sigue abriendo", async () => {
  const dueña = Keypair.random();
  const ajena = Keypair.random();
  const sesionDueña = (await entrarCon(dueña)).token;
  const sesionAjena = (await entrarCon(ajena)).token;
  const creado = await org.createEventWithAccount(repo, await repo.getOrganizerByAccount(dueña.publicKey()), plantilla);
  const slug = creado.event.slug;
  const url = `http://localhost/api/admin/${slug}`;

  const propio = await authorizePanelRequest(await pedido(url, { method: "GET", headers: conCookie(sesionDueña) }), slug);
  assert.equal(propio.event?.id, creado.event.id);
  assert.equal(propio.via, "organizer");

  const otro = await authorizePanelRequest(await pedido(url, { method: "GET", headers: conCookie(sesionAjena) }), slug);
  assert.equal(otro.response?.status, 401);
  const sinNada = await authorizePanelRequest(await pedido(url, { method: "GET" }), slug);
  assert.equal(sinNada.response?.status, 401);

  // La clave del evento sigue valiendo (para quien coorganiza y para el MCP), y la ruta real contesta con ella o con la sesión.
  const clave = await getOrCreateOrganizerKey(creado.event.id);
  const conClave = await authorizePanelRequest(await pedido(`${url}?k=${clave}`, { method: "GET" }), slug);
  assert.equal(conClave.via, "key");
  // Un evento sin dueño (el de muestra) no se abre con ninguna sesión.
  const muestra = await eventoDePrueba(repo);
  const sinDueño = await authorizePanelRequest(await pedido(`http://localhost/api/admin/${muestra.event.slug}`, { method: "GET", headers: conCookie(sesionDueña) }), muestra.event.slug);
  assert.equal(sinDueño.response?.status, 401);
  // Y por la ruta del panel, con la sesión, el JSON del evento propio (es un borrador: el panel lo pide igual).
  const json = await panelJson(await pedido(url, { method: "GET", headers: conCookie(sesionDueña) }), enRuta(slug));
  assert.equal(json.status, 200);
  assert.equal((await json.json()).event.slug, slug);
});

test("una sesión vencida no entra, y la viva anota que se usó como mucho una vez por hora", async () => {
  const llave = Keypair.random();
  const organizador = await repo.upsertOrganizer({ publicKey: llave.publicKey(), provider: "pollar", name: "Vencida" });
  const ficha = "ficha-de-prueba-vencida";
  await repo.createOrganizerSession({ id: org.sessionIdOf(ficha), organizerId: organizador.id, expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await org.resolveOrganizerSession(repo, ficha), null);
  assert.equal(await org.organizerFromRequest(await pedido("http://localhost/admin", { method: "GET", headers: conCookie(ficha) })), null);

  const ahora = Date.now();
  const viva = await org.loginOrganizer(repo, await probar(llave), undefined, ahora);
  assert.equal(viva.ok, true);
  const primera = await org.resolveOrganizerSession(repo, viva.token, ahora + 60_000);
  const vista = primera.session.lastSeenAt;
  const segunda = await org.resolveOrganizerSession(repo, viva.token, ahora + 30 * 60_000);
  assert.equal(segunda.session.lastSeenAt, vista, "a la media hora no se vuelve a escribir");
  const tercera = await org.resolveOrganizerSession(repo, viva.token, ahora + 2 * 3600_000);
  assert.ok(Date.parse(tercera.session.lastSeenAt) > Date.parse(vista), "a las dos horas sí");
  assert.equal(await org.resolveOrganizerSession(repo, viva.token, ahora + org.SESSION_TTL_MS + 1), null, "a los treinta días venció");
  assert.equal(await org.resolveOrganizerSession(repo, `${viva.token}x`), null, "otra ficha no es nada");
});

test("el tope por día: con RUMBO_EVENTS_PER_DAY=2 el tercero no se crea y se dice cuál es el tope", async () => {
  process.env.RUMBO_EVENTS_PER_DAY = "2";
  const llave = Keypair.random();
  const organizador = await repo.upsertOrganizer({ publicKey: llave.publicKey(), provider: "pollar" });
  assert.equal((await org.createEventWithAccount(repo, organizador, plantilla)).ok, true);
  assert.equal((await org.createEventWithAccount(repo, organizador, plantilla)).ok, true);
  assert.deepEqual(await org.createEventWithAccount(repo, organizador, plantilla), { ok: false, reason: "quota", limit: 2 });
  assert.equal((await repo.listEventsByOrganizer(organizador.id)).length, 2);
  // Mañana puede de nuevo; y otra cuenta no está frenada por esta.
  assert.equal((await org.createEventWithAccount(repo, organizador, plantilla, Date.now() + 25 * 3600_000)).ok, true);
  const otra = await repo.upsertOrganizer({ publicKey: Keypair.random().publicKey(), provider: "pollar" });
  assert.equal((await org.createEventWithAccount(repo, otra, plantilla)).ok, true);
  // Sin la variable, el tope es tres; con una que no sirve, también.
  delete process.env.RUMBO_EVENTS_PER_DAY;
  assert.equal(org.eventsPerDay(), 3);
  process.env.RUMBO_EVENTS_PER_DAY = "muchos";
  assert.equal(org.eventsPerDay(), 3);
});

test("salir borra la sesión y la cookie, y vuelve a /admin", async () => {
  const llave = Keypair.random();
  const { token } = await entrarCon(llave);
  const res = await salir(await pedido("http://localhost/api/organizador/salir", { headers: conCookie(token) }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/admin");
  assert.equal(res.cookies.get(org.ORGANIZER_COOKIE)?.value, "");
  assert.equal(await repo.getOrganizerSession(org.sessionIdOf(token)), null);
  assert.equal(await org.organizerFromRequest(await pedido("http://localhost/admin", { method: "GET", headers: conCookie(token) })), null);
  // Salir sin sesión no falla.
  assert.equal((await salir(await pedido("http://localhost/api/organizador/salir"))).status, 303);
});

test("una prueba que no vale no entra: el desafío usado dos veces, la firma de otra cuenta, un cuerpo sin cuenta; y a los diez intentos la IP queda frenada", async () => {
  const llave = Keypair.random();
  const prueba = await probar(llave);
  const r1 = await entrar(await pedido("http://localhost/api/organizador/entrar", { ip: "10.9.9.9", body: { wallet: prueba } }));
  assert.equal(r1.status, 200);
  const r2 = await entrar(await pedido("http://localhost/api/organizador/entrar", { ip: "10.9.9.9", body: { wallet: prueba } }));
  assert.deepEqual([r2.status, await r2.json()], [401, { error: "wallet" }], "el mismo desafío otra vez");
  assert.equal(r2.cookies.get(org.ORGANIZER_COOKIE), undefined, "sin cookie");

  const ajena = await entrarCon(llave, { ip: "10.9.9.9", firmaCon: Keypair.random() });
  assert.deepEqual([ajena.status, ajena.cuerpo, ajena.token], [401, { error: "wallet" }, null]);
  const sinCuenta = await entrar(await pedido("http://localhost/api/organizador/entrar", { ip: "10.9.9.9", body: { name: "Nadie" } }));
  assert.equal(sinCuenta.status, 401);
  for (const cuerpo of [null, [], "texto"]) {
    const res = await entrar(await pedido("http://localhost/api/organizador/entrar", { ip: "10.9.9.9", body: cuerpo }));
    assert.deepEqual([res.status, await res.json()], [400, { error: "invalid_json" }]);
  }
  for (let i = 0; i < 7; i++) assert.equal((await entrarCon(llave, { ip: "10.9.9.9", firmaCon: Keypair.random() })).status, 401);
  const frenada = await entrarCon(llave, { ip: "10.9.9.9" });
  assert.deepEqual([frenada.status, frenada.cuerpo], [429, { error: "too_many" }], "frenada: ni la prueba buena entra");
  assert.equal((await entrarCon(llave, { ip: "10.9.9.10" })).status, 200, "otra IP sigue");
});

test("con Pollar apagado, entrar como organizador contesta 503 y lo dice; el panel sigue con la clave de cada evento", async () => {
  const antes = process.env.RUMBO_ACCOUNTS;
  try {
    delete process.env.RUMBO_ACCOUNTS;
    const res = await entrar(await pedido("http://localhost/api/organizador/entrar", { ip: "190.0.0.1", body: { wallet: await probar(Keypair.random()) } }));
    assert.deepEqual([res.status, await res.json()], [503, { error: "pollar_off" }]);
    const muestra = await eventoDePrueba(repo);
    const clave = await getOrCreateOrganizerKey(muestra.event.id);
    const conClave = await authorizePanelRequest(await pedido(`http://localhost/api/admin/${muestra.event.slug}?k=${clave}`, { method: "GET" }), muestra.event.slug);
    assert.equal(conClave.via, "key");
  } finally {
    process.env.RUMBO_ACCOUNTS = antes;
  }
});
