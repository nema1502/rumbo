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
const { organizerLoginAttempts, organizerSessionAttempts, eventCreateAttempts, walletChallengeAttempts, stationCodeAttempts } = await import("../src/server/limites.ts");
const { authorizePanelRequest } = await import("../src/server/panel-sesion.ts");
const { getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { POST: pedirDesafio } = await import("../src/app/api/cuenta/desafio/route.ts");
const { POST: entrar } = await import("../src/app/api/organizador/entrar/route.ts");
const { POST: salir } = await import("../src/app/api/organizador/salir/route.ts");
const { GET: panelJson } = await import("../src/app/api/admin/[slug]/route.ts");
const { GET: vivoJson } = await import("../src/app/api/vivo/[slug]/route.ts");
const { getOrCreateScreenKey } = await import("../src/server/vivo.ts");

const repo = getRepo();
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const enRuta = (slug) => ({ params: Promise.resolve({ slug }) });

beforeEach(async () => {
  await organizerLoginAttempts().clear();
  await walletChallengeAttempts().clear();
  await stationCodeAttempts().clear();
  await organizerSessionAttempts().clear();
  await eventCreateAttempts().clear();
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

  // La pantalla en vivo (que el navegador pide cada tres segundos) entra con la sesión, con la clave del evento y
  // con el enlace del proyector; con la sesión de otra cuenta o sin nada, no.
  const vivoUrl = `http://localhost/api/vivo/${slug}`;
  const enVivo = async (q, headers) => (await vivoJson(await pedido(`${vivoUrl}${q}`, { method: "GET", headers }), enRuta(slug))).status;
  assert.equal(await enVivo("", conCookie(sesionDueña)), 200, "la sesión de la dueña abre la pantalla en vivo");
  assert.equal(await enVivo("", conCookie(sesionAjena)), 401);
  assert.equal(await enVivo("", {}), 401);
  assert.equal(await enVivo(`?k=${clave}`, {}), 200);
  assert.equal(await enVivo(`?pantalla=${await getOrCreateScreenKey(creado.event.id)}`, {}), 200);
  assert.equal((await vivoJson(await pedido("http://localhost/api/vivo/no-existe", { method: "GET", headers: conCookie(sesionDueña) }), enRuta("no-existe"))).status, 404);
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
  assert.equal((await org.createEventWithAccount(repo, organizador, plantilla, { now: Date.now() + 25 * 3600_000 })).ok, true);
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

test("entrar y salir desde otro sitio no tocan la sesión: un formulario ajeno contesta 403 y no pone ni borra la cookie", async () => {
  const llave = Keypair.random();
  const wallet = await probar(llave);
  // Lo que manda un <form method=post enctype=text/plain> de otro sitio con un solo campo (nombre, "=", valor): un JSON válido.
  const cuerpo = `${JSON.stringify({ wallet, name: "Nicolás", x: "=" })}\r\n`;
  const { NextRequest } = await import("next/server");
  const ajeno = (url, headers, body) => new NextRequest(url, { method: "POST", headers: new Headers({ "x-real-ip": "190.0.0.7", ...headers }), body });
  const formAjeno = await entrar(ajeno("https://rum.bo/api/organizador/entrar", { "content-type": "text/plain", origin: "https://otro-sitio.example", "sec-fetch-site": "cross-site" }, cuerpo));
  assert.equal(formAjeno.status, 403);
  assert.equal(formAjeno.cookies.get(org.ORGANIZER_COOKIE), undefined, "sin cookie");
  // Sin Origin pero con Sec-Fetch-Site de otro sitio, tampoco; un Origin que no se entiende, tampoco.
  assert.equal((await entrar(ajeno("https://rum.bo/api/organizador/entrar", { "content-type": "application/json", "sec-fetch-site": "cross-site" }, JSON.stringify({ wallet })))).status, 403);
  assert.equal((await entrar(ajeno("https://rum.bo/api/organizador/entrar", { "content-type": "application/json", origin: "null" }, JSON.stringify({ wallet })))).status, 403);
  // El mismo desafío sigue sin usar: desde la app (Origin propio, o el del host que puso la plataforma) entra.
  const propio = await entrar(ajeno("https://rum.bo/api/organizador/entrar", { "content-type": "application/json", origin: "https://rum.bo", "sec-fetch-site": "same-origin" }, JSON.stringify({ wallet })));
  assert.equal(propio.status, 200);
  const token = propio.cookies.get(org.ORGANIZER_COOKIE)?.value;
  assert.ok(token);
  const detrasDelProxy = await entrar(
    ajeno("http://10.0.0.5:3000/api/organizador/entrar", { "content-type": "application/json", origin: "https://rum.bo", host: "rum.bo", "x-forwarded-proto": "https" }, JSON.stringify({ wallet: await probar(llave) })),
  );
  assert.equal(detrasDelProxy.status, 200, "el host que puso la plataforma cuenta como propio");

  // Salir desde otro sitio: 403, sin borrar la cookie ni la sesión.
  const salirAjeno = await salir(ajeno("https://rum.bo/api/organizador/salir", { origin: "https://otro-sitio.example", cookie: `${org.ORGANIZER_COOKIE}=${token}` }));
  assert.equal(salirAjeno.status, 403);
  assert.equal(salirAjeno.cookies.get(org.ORGANIZER_COOKIE), undefined);
  assert.ok(await repo.getOrganizerSession(org.sessionIdOf(token)), "la sesión sigue");
  const salirPropio = await salir(ajeno("https://rum.bo/api/organizador/salir", { origin: "https://rum.bo", cookie: `${org.ORGANIZER_COOKIE}=${token}` }));
  assert.equal(salirPropio.status, 303);
  assert.equal(await repo.getOrganizerSession(org.sessionIdOf(token)), null);
});

test("el tope en una ráfaga: diez pedidos a la vez con tope 2 no pasan de dos, y el resto contesta ocupado o tope, nunca un error", async () => {
  process.env.RUMBO_EVENTS_PER_DAY = "2";
  const organizador = await repo.upsertOrganizer({ publicKey: Keypair.random().publicKey(), provider: "pollar" });
  const rafaga = async () => Promise.all(Array.from({ length: 10 }, (_, i) => org.createEventWithAccount(repo, organizador, { ...plantilla, name: `Ráfaga ${i} de prueba` })));
  const primera = await rafaga();
  const creados = primera.filter((r) => r.ok).length;
  assert.ok(creados >= 1 && creados <= 2, `crearon ${creados}`);
  assert.ok(primera.every((r) => r.ok || r.reason === "busy" || r.reason === "quota"), JSON.stringify(primera.filter((r) => !r.ok)));
  // Hasta llenar el tope, de a uno; después, otra ráfaga entera no crea nada.
  while ((await repo.listEventsByOrganizer(organizador.id)).length < 2) assert.equal((await org.createEventWithAccount(repo, organizador, plantilla)).ok, true);
  const segunda = await rafaga();
  assert.equal(segunda.filter((r) => r.ok).length, 0);
  assert.equal((await repo.listEventsByOrganizer(organizador.id)).length, 2, "en la base, exactamente el tope");
  // El turno se suelta: la cuenta sigue frenada por el tope, no por el turno.
  assert.deepEqual(await org.createQuota(repo, organizador, undefined).then((q) => [q.ok, q.reason, q.limit]), [false, "quota", 2]);
});

test("dos creaciones a la vez con el mismo nombre no chocan: cada una se lleva su propia dirección", async () => {
  const cuentas = await Promise.all(Array.from({ length: 4 }, () => repo.upsertOrganizer({ publicKey: Keypair.random().publicKey(), provider: "pollar" })));
  const mismo = { ...plantilla, name: "Mismo nombre a la vez" };
  const resultados = await Promise.all(cuentas.map((cuenta) => org.createEventWithAccount(repo, cuenta, mismo)));
  assert.ok(resultados.every((r) => r.ok), JSON.stringify(resultados));
  const slugs = resultados.map((r) => r.event.slug);
  assert.equal(new Set(slugs).size, 4, slugs.join(", "));
  assert.ok(slugs.every((slug) => slug.startsWith("mismo-nombre-a-la-vez")), slugs.join(", "));
  // Con la clave de la casa (sin cuenta) pasa lo mismo.
  const { createEventFromTemplate } = await import("../src/server/kit/plantillas.ts");
  const sinCuenta = await Promise.all(Array.from({ length: 3 }, () => createEventFromTemplate(repo, { ...plantilla, name: "Sin cuenta a la vez" })));
  assert.equal(new Set(sinCuenta.map((e) => e.slug)).size, 3);
});

test("el tope por IP: las cuentas nuevas desde una misma conexión no pasan de RUMBO_EVENTS_PER_IP_PER_DAY eventos (diez)", async () => {
  const resultados = [];
  for (let i = 0; i < 4; i++) {
    const cuenta = await repo.upsertOrganizer({ publicKey: Keypair.random().publicKey(), provider: "pollar" });
    for (let j = 0; j < 3; j++) resultados.push(await org.createEventWithAccount(repo, cuenta, plantilla, { requester: "190.0.0.50" }));
  }
  assert.equal(resultados.filter((r) => r.ok).length, 10, "diez creados con cuatro cuentas de tres");
  const frenados = resultados.filter((r) => !r.ok);
  assert.equal(frenados.length, 2);
  assert.ok(frenados.every((r) => r.reason === "ip" && r.waitMs > 20 * 3600_000), JSON.stringify(frenados));
  // La pantalla lo sabe antes de mostrar el formulario; otra IP sigue.
  const nueva = await repo.upsertOrganizer({ publicKey: Keypair.random().publicKey(), provider: "pollar" });
  assert.equal((await org.createQuota(repo, nueva, "190.0.0.50")).reason, "ip");
  assert.equal((await org.createQuota(repo, nueva, "190.0.0.51")).ok, true);
  assert.equal((await org.createEventWithAccount(repo, nueva, plantilla, { requester: "190.0.0.51" })).ok, true);
  // Un dato mal escrito no gasta nada del tope.
  await assert.rejects(org.createEventWithAccount(repo, nueva, { ...plantilla, place: "" }, { requester: "190.0.0.52" }), { name: "TemplateInputError" });
  assert.equal(await eventCreateAttempts().blockedFor("190.0.0.52"), 0);
});

test("la pantalla de crear sabe cuándo se libera el tope de la cuenta", async () => {
  process.env.RUMBO_EVENTS_PER_DAY = "1";
  const cuenta = await repo.upsertOrganizer({ publicKey: Keypair.random().publicKey(), provider: "pollar" });
  assert.deepEqual(await org.createQuota(repo, cuenta, undefined), { ok: true, limit: 1, left: 1 });
  const creado = await org.createEventWithAccount(repo, cuenta, plantilla);
  const cuota = await org.createQuota(repo, cuenta, undefined, Date.parse(creado.event.createdAt) + 5 * 3600_000);
  assert.deepEqual([cuota.ok, cuota.reason, cuota.limit, Math.round(cuota.freesInMs / 3600_000)], [false, "quota", 1, 19]);
});

test("entrar como organizador también tiene su freno por IP, aunque las pruebas salgan bien: cuentas nuevas en serie no", async () => {
  for (let i = 0; i < 20; i++) assert.equal((await entrarCon(Keypair.random(), { ip: "190.0.0.60" })).status, 200, `entrada ${i + 1}`);
  const frenada = await entrarCon(Keypair.random(), { ip: "190.0.0.60" });
  assert.deepEqual([frenada.status, frenada.cuerpo, frenada.token], [429, { error: "too_many" }, null]);
  assert.equal((await entrarCon(Keypair.random(), { ip: "190.0.0.61" })).status, 200, "otra IP sigue");
});

test("el nombre que manda el navegador se limpia: sin caracteres de control ni NUL, hasta ochenta, y nunca un correo", async () => {
  assert.equal(org.cleanOrganizerName("  Ana\u0000 Organiza\u0007\u202E  "), "Ana Organiza");
  assert.equal(org.cleanOrganizerName("ana@ejemplo.com"), "", "un correo no se guarda");
  assert.equal(org.cleanOrganizerName(42), "");
  const largo = "😀".repeat(100);
  assert.equal(Array.from(org.cleanOrganizerName(largo)).length, 80);
  assert.ok(!org.cleanOrganizerName(`${"a".repeat(79)}😀😀`).includes("\uFFFD"), "no parte un carácter");

  // Por la ruta: el NUL no llega a la base (en Postgres tiraría), el correo tampoco, y el proveedor es el que se guardó.
  const llave = Keypair.random();
  assert.equal((await entrarCon(llave, { name: "Bea\u0000 Correa" })).status, 200);
  assert.equal((await repo.getOrganizerByAccount(llave.publicKey())).name, "Bea Correa");
  const conCorreo = Keypair.random();
  assert.equal((await entrarCon(conCorreo, { name: "bea@ejemplo.com" })).status, 200);
  const guardado = await repo.getOrganizerByAccount(conCorreo.publicKey());
  assert.deepEqual([guardado.name, guardado.provider], ["", "pollar"]);
  assert.equal((await entrarCon(conCorreo, { name: { no: "texto" } })).status, 200, "un nombre que no es texto no rompe nada");
});

test("compartir el panel: con la sesión se pide el enlace con la clave, recién ahí se arma, y abre el panel sin cuenta", async () => {
  const { POST: compartir } = await import("../src/app/api/admin/[slug]/compartir/route.ts");
  const { verifyOrganizerKey } = await import("../src/server/panel.ts");
  const dueña = Keypair.random();
  const sesion = (await entrarCon(dueña)).token;
  const ajena = (await entrarCon(Keypair.random())).token;
  const creado = await org.createEventWithAccount(repo, await repo.getOrganizerByAccount(dueña.publicKey()), plantilla);
  const slug = creado.event.slug;
  const url = `http://localhost/api/admin/${slug}/compartir`;
  const { getDb } = await import("../src/server/base/index.ts");
  const claves = async () => (await getDb().all("SELECT key FROM organizer_keys WHERE event_id = ?", [creado.event.id])).length;
  assert.equal(await claves(), 0, "crear con la cuenta no arma ninguna clave");

  const res = await compartir(await pedido(url, { headers: conCookie(sesion) }), enRuta(slug));
  assert.equal(res.status, 200);
  const { path } = await res.json();
  const clave = new URL(path, "http://localhost").searchParams.get("k");
  assert.ok(path.startsWith(`/admin/${slug}?k=`), path);
  assert.equal(await verifyOrganizerKey(creado.event.id, clave), true, "la clave abre el panel");
  assert.equal(await claves(), 1);
  const otraVez = await (await compartir(await pedido(url, { headers: conCookie(sesion) }), enRuta(slug))).json();
  assert.equal(otraVez.path, path, "la misma clave, no una nueva cada vez");

  assert.equal((await compartir(await pedido(url, { headers: conCookie(ajena) }), enRuta(slug))).status, 401);
  assert.equal((await compartir(await pedido(url), enRuta(slug))).status, 401);
  assert.equal((await compartir(await pedido(url, { headers: { ...conCookie(sesion), origin: "https://otro-sitio.example" } }), enRuta(slug))).status, 403);
});

test("a dónde vuelve /admin después de entrar: solo a una ruta propia del panel", async () => {
  const { safeReturnPath } = await import("../src/server/panel-sesion.ts");
  assert.equal(safeReturnPath("/admin/mi-evento"), "/admin/mi-evento");
  assert.equal(safeReturnPath("/admin/mi-evento/armar"), "/admin/mi-evento/armar");
  assert.equal(safeReturnPath("/admin/nuevo"), "/admin/nuevo");
  for (const malo of ["/admin", "/", "https://otro.example/admin/x", "//otro.example/admin/x", "/admin/../e/x", "/admin/%2e%2e/e", "/admin/\\otro", "/admin/x\nSet-Cookie", "admin/x", undefined, ["/admin/x"], 42]) {
    const vuelta = safeReturnPath(malo);
    assert.ok(vuelta === null || vuelta.startsWith("/admin/"), `${JSON.stringify(malo)} -> ${vuelta}`);
    if (typeof malo === "string" && !malo.startsWith("/admin/")) assert.equal(vuelta, null, JSON.stringify(malo));
  }
  assert.equal(safeReturnPath("/admin/../e/x"), null, "lo que al resolverse sale de /admin/");
  assert.equal(safeReturnPath("/admin/\\otro"), null, "una barra invertida, que el navegador lee como /");
  assert.equal(safeReturnPath("/admin/x\nSet-Cookie"), null);
});

test("cerrar sesión desde la propia app llega con Origin null (las páginas van con no-referrer) y cierra; con Origin null desde otro sitio, no", async () => {
  const llave = Keypair.random();
  const { token } = await entrarCon(llave);
  const { NextRequest } = await import("next/server");
  const pedir = (headers) => new NextRequest("https://rum.bo/api/organizador/salir", { method: "POST", headers: new Headers({ "x-real-ip": "190.0.0.8", cookie: `${org.ORGANIZER_COOKIE}=${token}`, ...headers }) });
  assert.equal((await salir(pedir({ origin: "null", "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await salir(pedir({ origin: "null" }))).status, 403, "sin Sec-Fetch-Site, un Origin null no alcanza");
  assert.ok(await repo.getOrganizerSession(org.sessionIdOf(token)), "la sesión sigue");
  assert.equal((await salir(pedir({ origin: "null", "sec-fetch-site": "same-origin" }))).status, 303);
  assert.equal(await repo.getOrganizerSession(org.sessionIdOf(token)), null);
});

test("la dueña que abrió su propio enlace con la clave sigue entrando con la cuenta: la sesión gana sobre la cookie de la clave", async () => {
  const llave = Keypair.random();
  const { token } = await entrarCon(llave);
  const creado = await org.createEventWithAccount(repo, await repo.getOrganizerByAccount(llave.publicKey()), plantilla);
  const slug = creado.event.slug;
  const clave = await getOrCreateOrganizerKey(creado.event.id);
  const ambas = { cookie: `${org.ORGANIZER_COOKIE}=${token}; rumbo.panel.${slug}=${clave}` };
  const acceso = await authorizePanelRequest(await pedido(`http://localhost/api/admin/${slug}`, { method: "GET", headers: ambas }), slug);
  assert.equal(acceso.via, "organizer");
  // Quien coorganiza, solo con la clave, sigue entrando por la clave.
  const soloClave = await authorizePanelRequest(await pedido(`http://localhost/api/admin/${slug}`, { method: "GET", headers: { cookie: `rumbo.panel.${slug}=${clave}` } }), slug);
  assert.equal(soloClave.via, "key");
});

test("los frenos cuentan una IPv6 por su /64; una IPv4 queda entera", async () => {
  const { networkOf, clientKey } = await import("../src/server/limites.ts");
  assert.equal(networkOf("2001:db8:85a3:12:1:2:3:4"), "2001:db8:85a3:12::/64");
  assert.equal(networkOf("2001:db8:85a3:12::99"), "2001:db8:85a3:12::/64");
  assert.equal(networkOf("2001:0DB8:0000:0001::1%eth0"), "2001:db8:0:1::/64");
  assert.equal(networkOf("::1"), "0:0:0:0::/64");
  assert.equal(networkOf("::ffff:190.0.0.1"), "190.0.0.1");
  assert.equal(networkOf("190.0.0.1"), "190.0.0.1");
  assert.equal(networkOf("no:es:una:ip:::"), "no:es:una:ip:::");
  const headers = (ip) => ({ get: (name) => (name === "x-real-ip" ? ip : null) });
  assert.equal(clientKey(headers("2001:db8:1:2:aaaa::1")), clientKey(headers("2001:db8:1:2:bbbb::2")), "dos direcciones del mismo /64 son la misma conexión");
  assert.notEqual(clientKey(headers("2001:db8:1:2::1")), clientKey(headers("2001:db8:1:3::1")));
});

test("el techo de todo Rumbo: con RUMBO_EVENTS_GLOBAL_PER_DAY=2, la tercera cuenta no crea y la pantalla lo sabe", async () => {
  const antes = (await repo.listAccountEventTimesSince(new Date(Date.now() - 24 * 3600_000).toISOString())).length;
  process.env.RUMBO_EVENTS_GLOBAL_PER_DAY = String(antes + 2);
  try {
    const cuentas = [];
    for (let i = 0; i < 3; i++) {
      const llave = Keypair.random();
      await entrarCon(llave, { ip: `190.0.1.${i + 1}` });
      cuentas.push(await repo.getOrganizerByAccount(llave.publicKey()));
    }
    assert.equal((await org.createEventWithAccount(repo, cuentas[0], plantilla)).ok, true);
    assert.equal((await org.createEventWithAccount(repo, cuentas[1], plantilla)).ok, true);
    const tercera = await org.createEventWithAccount(repo, cuentas[2], plantilla);
    assert.deepEqual(tercera, { ok: false, reason: "global" });
    const cupo = await org.createQuota(repo, cuentas[2], undefined);
    assert.equal(cupo.ok, false);
    assert.equal(cupo.reason, "global");
    assert.ok(cupo.freesInMs > 0 && cupo.freesInMs <= 24 * 3600_000);
  } finally {
    delete process.env.RUMBO_EVENTS_GLOBAL_PER_DAY;
  }
});
