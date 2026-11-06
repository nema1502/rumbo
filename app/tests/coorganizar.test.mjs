// Coorganizar: la dueña de un evento suma a otras cuentas de organizador a su equipo, con un enlace de invitación de
// un solo uso (en la base, solo su huella) o autorizando la cuenta (G...). Quien coorganiza entra al panel con su
// sesión y puede todo, salvo sumar o sacar personas. Sin red, en los tres motores.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { beforeEach, test } from "node:test";
import { entornoDePrueba, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
process.env.RUMBO_TRUSTED_IP_HEADER = "x-real-ip";
process.env.RUMBO_ACCOUNTS = "pollar";
process.env.NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY = "pk_prueba";
const { Keypair } = await import("@stellar/stellar-sdk");
const { getRepo } = await import("../src/server/repo.ts");
const { getDb } = await import("../src/server/base/index.ts");
const propia = await import("../src/server/cuenta-propia.ts");
const org = await import("../src/server/organizador.ts");
const co = await import("../src/server/coorganizar.ts");
const { organizerLoginAttempts, organizerSessionAttempts, walletChallengeAttempts, eventCreateAttempts } = await import("../src/server/limites.ts");
const { authorizePanelRequest } = await import("../src/server/panel-sesion.ts");
const { getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { POST: pedirDesafio } = await import("../src/app/api/cuenta/desafio/route.ts");
const { POST: entrar } = await import("../src/app/api/organizador/entrar/route.ts");
const { GET: equipoGet, POST: equipoPost } = await import("../src/app/api/admin/[slug]/equipo/route.ts");
const { POST: compartir } = await import("../src/app/api/admin/[slug]/compartir/route.ts");
const { POST: aceptarRuta } = await import("../src/app/api/organizador/invitacion/route.ts");
const { panelCookieName } = await import("../src/server/panel-sesion.ts");

const repo = getRepo();
const enRuta = (slug) => ({ params: Promise.resolve({ slug }) });
const conCookie = (token) => ({ cookie: `${org.ORGANIZER_COOKIE}=${token}` });

beforeEach(async () => {
  await organizerLoginAttempts().clear();
  await organizerSessionAttempts().clear();
  await walletChallengeAttempts().clear();
  await eventCreateAttempts().clear();
});

/** Una cuenta de organizador con su sesión, sin pasar por la prueba de la cuenta (eso lo cubre organizador.test). */
async function cuenta(nombre) {
  const llave = Keypair.random();
  const organizer = await repo.upsertOrganizer({ publicKey: llave.publicKey(), provider: "pollar", name: nombre });
  const token = randomBytes(16).toString("base64url");
  await repo.createOrganizerSession({ id: org.sessionIdOf(token), organizerId: organizer.id, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  return { llave, organizer, token };
}

let n = 0;
async function eventoDe(dueña) {
  const r = await org.createEventWithAccount(repo, dueña.organizer, { template: "meetup", lang: "es", name: `Meetup del equipo ${++n}`, startsAtLocal: "2026-12-05T19:00", place: "Santa Cruz", organizerName: "La comunidad" });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.event;
}

const tokenDe = (path) => decodeURIComponent(path.split("/").pop());

/** Llama a la ruta del equipo como la dueña (o quien sea) desde la propia app. */
async function equipo(event, quien, body, extra = {}) {
  const res = await equipoPost(await pedido(`http://localhost/api/admin/${event.slug}/equipo`, { body, headers: { ...conCookie(quien.token), ...extra } }), enRuta(event.slug));
  return { status: res.status, cuerpo: await res.json() };
}

/** Lo que hace el formulario de la invitación: POST con la ficha, desde la IP dada. */
async function aceptar(token, quien, ip = "190.0.0.5") {
  const res = await aceptarRuta(await pedido("http://localhost/api/organizador/invitacion", { ip, body: { token }, headers: quien ? conCookie(quien.token) : {} }));
  return { status: res.status, location: res.headers.get("location") };
}

test("la invitación: la dueña la crea, en la base queda solo la huella, y quien la acepta entra al panel con su sesión", async () => {
  const dueña = await cuenta("Dueña Prueba");
  const ana = await cuenta("Ana Prueba");
  const event = await eventoDe(dueña);

  const creada = await equipo(event, dueña, { accion: "invitar" });
  assert.equal(creada.status, 201, JSON.stringify(creada.cuerpo));
  assert.match(creada.cuerpo.path, /^\/admin\/invitacion\/[A-Za-z0-9_-]{20,}$/);
  const token = tokenDe(creada.cuerpo.path);
  const filas = await getDb().all("SELECT * FROM event_invites WHERE event_id = ?", [event.id]);
  assert.equal(filas.length, 1);
  assert.ok(!JSON.stringify(filas).includes(token), "la ficha no está en la base");
  assert.equal(filas[0].token_hash, createHash("sha256").update(token).digest("hex"));
  assert.equal(Date.parse(filas[0].expires_at) - Date.parse(filas[0].created_at), co.INVITE_TTL_MS, "vence a los siete días");
  assert.equal(creada.cuerpo.team.invites.length, 1);

  // Antes de aceptar, Ana no entra al panel.
  const url = `http://localhost/api/admin/${event.slug}`;
  assert.equal((await authorizePanelRequest(await pedido(url, { method: "GET", headers: conCookie(ana.token) }), event.slug)).response?.status, 401);
  assert.equal((await co.lookupInvite(token)).state, "open");

  const r = await aceptar(token, ana);
  assert.equal(r.status, 303);
  assert.equal(r.location, `/admin/${event.slug}/armar?equipo=1`, "un borrador lleva a armarlo");
  const dentro = await authorizePanelRequest(await pedido(url, { method: "GET", headers: conCookie(ana.token) }), event.slug);
  assert.deepEqual([dentro.event?.id, dentro.via, dentro.role], [event.id, "organizer", "coorganizer"]);
  assert.equal(await org.canManageEvent(ana.organizer, event), true);
  assert.equal((await co.lookupInvite(token)).state, "used");
  const usada = await getDb().one("SELECT used_by, used_at FROM event_invites WHERE event_id = ?", [event.id]);
  assert.equal(usada.used_by, ana.organizer.id);

  // En el equipo de la dueña aparece Ana, y la invitación ya no está abierta.
  const visto = await equipoGet(await pedido(`http://localhost/api/admin/${event.slug}/equipo`, { method: "GET", headers: conCookie(dueña.token) }), enRuta(event.slug));
  const { team } = await visto.json();
  assert.deepEqual(team.members.map((m) => [m.organizerId, m.name]), [[ana.organizer.id, "Ana Prueba"]]);
  assert.deepEqual(team.invites, []);
});

test("una invitación sirve una sola vez, vence a los siete días y la dueña la puede anular", async () => {
  const dueña = await cuenta("Dueña Prueba");
  const ana = await cuenta("Ana Prueba");
  const beto = await cuenta("Beto Prueba");
  const event = await eventoDe(dueña);

  // Un solo uso: Beto no entra con la de Ana.
  const primera = await co.createInvite(event, dueña.organizer);
  assert.equal((await aceptar(primera.token, ana)).status, 303);
  const segunda = await aceptar(primera.token, beto);
  assert.match(segunda.location, /\?error=used$/);
  assert.equal(await org.canManageEvent(beto.organizer, event), false);
  // Quien ya está en el equipo y la vuelve a abrir no la gasta ni falla.
  const otra = await co.createInvite(event, dueña.organizer);
  assert.deepEqual(await co.acceptInvite(otra.token, ana.organizer, event), { ok: true, eventId: event.id, already: true });
  assert.equal((await co.lookupInvite(otra.token)).state, "open", "queda para quien era");

  // Vencida.
  const vieja = await co.createInvite(event, dueña.organizer, Date.now() - co.INVITE_TTL_MS - 1000);
  assert.equal((await co.lookupInvite(vieja.token)).state, "expired");
  assert.match((await aceptar(vieja.token, beto)).location, /\?error=expired$/);
  assert.equal(await org.canManageEvent(beto.organizer, event), false);

  // Anulada.
  const anulada = await equipo(event, dueña, { accion: "invitar" });
  const ficha = tokenDe(anulada.cuerpo.path);
  const anular = await equipo(event, dueña, { accion: "anular", invitacion: anulada.cuerpo.invite.id });
  assert.equal(anular.status, 200);
  assert.ok(!anular.cuerpo.team.invites.some((i) => i.id === anulada.cuerpo.invite.id));
  assert.match((await aceptar(ficha, beto)).location, /\?error=revoked$/);
  assert.equal((await equipo(event, dueña, { accion: "anular", invitacion: anulada.cuerpo.invite.id })).status, 404, "dos veces no");
  assert.equal(await org.canManageEvent(beto.organizer, event), false);

  // Una ficha que no existe, o de otra forma.
  assert.match((await aceptar("x".repeat(24), beto)).location, /\?error=missing$/);
  assert.equal((await co.lookupInvite("no/es/una/ficha")).state, "missing");
});

test("la dueña no se invita a sí misma, y sin sesión aceptar lleva a entrar y vuelve a la invitación", async () => {
  const dueña = await cuenta("Dueña Prueba");
  const event = await eventoDe(dueña);
  const inv = await co.createInvite(event, dueña.organizer);
  assert.deepEqual(await co.acceptInvite(inv.token, dueña.organizer, event), { ok: false, reason: "owner" });
  assert.match((await aceptar(inv.token, dueña)).location, /\?error=owner$/);
  assert.equal((await co.lookupInvite(inv.token)).state, "open", "no se gastó");

  const sinSesion = await aceptar(inv.token, null);
  assert.equal(sinSesion.location, `/admin?volver=${encodeURIComponent(co.invitePath(inv.token))}`);
  // Desde otro sitio, nada.
  const ajeno = await aceptarRuta(await pedido("http://localhost/api/organizador/invitacion", { body: { token: inv.token }, headers: { ...conCookie(dueña.token), origin: "https://otro-sitio.example.com" } }));
  assert.equal(ajeno.status, 403);
});

test("aceptar fichas que no existen frena a esa IP como las entradas fallidas", async () => {
  const dueña = await cuenta("Dueña Prueba");
  const ana = await cuenta("Ana Prueba");
  const event = await eventoDe(dueña);
  for (let i = 0; i < 12; i++) await aceptar(randomBytes(18).toString("base64url"), ana, "190.0.0.77");
  const buena = await co.createInvite(event, dueña.organizer);
  assert.match((await aceptar(buena.token, ana, "190.0.0.77")).location, /\?error=demasiados$/, "frenada");
  assert.equal(await org.canManageEvent(ana.organizer, event), false);
  // Desde otra IP, entra.
  assert.equal((await aceptar(buena.token, ana, "190.0.0.78")).location, `/admin/${event.slug}/armar?equipo=1`);
});

test("autorizar una cuenta: quien entra como organizador con ella queda en el equipo la primera vez, y se queda", async () => {
  const dueña = await cuenta("Dueña Prueba");
  const event = await eventoDe(dueña);
  const llave = Keypair.random();

  assert.deepEqual((await equipo(event, dueña, { accion: "autorizar", cuenta: "GNOESUNACUENTA" })).cuerpo, { error: "invalid" });
  assert.deepEqual((await equipo(event, dueña, { accion: "autorizar", cuenta: dueña.llave.publicKey() })).cuerpo, { error: "self" });
  // La cuenta llega con espacios o en minúsculas al pegarla: se limpia.
  const ok = await equipo(event, dueña, { accion: "autorizar", cuenta: ` ${llave.publicKey().toLowerCase()} ` });
  assert.equal(ok.status, 201, JSON.stringify(ok.cuerpo));
  assert.deepEqual(ok.cuerpo.team.grants.map((g) => g.publicKey), [llave.publicKey()]);
  assert.deepEqual((await equipo(event, dueña, { accion: "autorizar", cuenta: llave.publicKey() })).cuerpo, { error: "already" });
  const fila = await getDb().one("SELECT * FROM event_account_grants WHERE event_id = ?", [event.id]);
  assert.deepEqual(Object.keys(fila).sort(), ["created_at", "event_id", "granted_by", "public_key"], "solo la cuenta pública: ni correo ni llave");

  // Entra por la ruta real, con la prueba de la cuenta firmada.
  const des = await pedirDesafio(await pedido("http://localhost/api/cuenta/desafio", { ip: "190.0.0.1", body: { publicKey: llave.publicKey(), lang: "es" } }));
  const d = await des.json();
  const wallet = { provider: "pollar", publicKey: llave.publicKey(), challengeId: d.challengeId, signature: Buffer.from(llave.sign(propia.sep53Digest(d.message))).toString("base64") };
  const res = await entrar(await pedido("http://localhost/api/organizador/entrar", { ip: "190.0.0.1", body: { wallet, name: "Cami Prueba", lang: "es" } }));
  assert.equal(res.status, 200);
  const token = res.cookies.get(org.ORGANIZER_COOKIE)?.value;
  const cami = await repo.getOrganizerByAccount(llave.publicKey());

  assert.deepEqual(await co.listCoorganizedEventIds(cami.id), [event.id], "quedó en el equipo al entrar");
  assert.equal((await getDb().one("SELECT COUNT(*) AS n FROM event_account_grants WHERE event_id = ?", [event.id])).n, 0, "la autorización pasó a coorganizar");
  const dentro = await authorizePanelRequest(await pedido(`http://localhost/api/admin/${event.slug}`, { method: "GET", headers: conCookie(token) }), event.slug);
  assert.equal(dentro.role, "coorganizer");
  // Y se queda: otra entrada no cambia nada.
  assert.equal(await co.claimAccountGrants(cami), 0);
  assert.equal(await org.canManageEvent(cami, event), true);

  // Anular una cuenta autorizada que todavía no entró.
  const otra = Keypair.random().publicKey();
  await equipo(event, dueña, { accion: "autorizar", cuenta: otra });
  const anulada = await equipo(event, dueña, { accion: "anular", cuenta: otra });
  assert.deepEqual(anulada.cuerpo.team.grants, []);
});

test("la autorización también vale si quien la recibe ya tenía sesión: al abrir el panel o Mis eventos queda", async () => {
  const dueña = await cuenta("Dueña Prueba");
  const event = await eventoDe(dueña);
  const beto = await cuenta("Beto Prueba");
  await co.authorizeAccount(event, dueña.organizer, beto.organizer.publicKey);
  assert.equal((await co.eventRole(beto.organizer, event)), "coorganizer");
  assert.deepEqual(await co.listCoorganizedEventIds(beto.organizer.id), [event.id]);
});

test("sacar a alguien: deja de entrar en el acto; y quien coorganiza no puede invitar, autorizar, sacar ni pedir el enlace con la clave", async () => {
  const dueña = await cuenta("Dueña Prueba");
  const ana = await cuenta("Ana Prueba");
  const beto = await cuenta("Beto Prueba");
  const event = await eventoDe(dueña);
  for (const quien of [ana, beto]) assert.equal((await co.acceptInvite((await co.createInvite(event, dueña.organizer)).token, quien.organizer, event)).ok, true);

  for (const body of [{ accion: "invitar" }, { accion: "autorizar", cuenta: Keypair.random().publicKey() }, { accion: "sacar", organizador: beto.organizer.id }]) {
    const r = await equipo(event, ana, body);
    assert.deepEqual([r.status, r.cuerpo], [403, { error: "owner_only" }], body.accion);
  }
  const ver = await equipoGet(await pedido(`http://localhost/api/admin/${event.slug}/equipo`, { method: "GET", headers: conCookie(ana.token) }), enRuta(event.slug));
  assert.equal(ver.status, 403);
  const clave = await compartir(await pedido(`http://localhost/api/admin/${event.slug}/compartir`, { headers: conCookie(ana.token) }), enRuta(event.slug));
  assert.equal(clave.status, 403);
  // Con la clave del evento tampoco se suma a nadie.
  const key = await getOrCreateOrganizerKey(event.id);
  const conClave = await equipoPost(await pedido(`http://localhost/api/admin/${event.slug}/equipo`, { body: { accion: "invitar" }, headers: { cookie: `${panelCookieName(event.slug)}=${key}` } }), enRuta(event.slug));
  assert.equal(conClave.status, 403);
  // Desde otro sitio, ni la dueña.
  assert.equal((await equipo(event, dueña, { accion: "invitar" }, { origin: "https://otro-sitio.example.com" })).status, 403);

  const sacar = await equipo(event, dueña, { accion: "sacar", organizador: beto.organizer.id });
  assert.equal(sacar.status, 200);
  assert.deepEqual(sacar.cuerpo.team.members.map((m) => m.organizerId), [ana.organizer.id]);
  assert.equal((await authorizePanelRequest(await pedido(`http://localhost/api/admin/${event.slug}`, { method: "GET", headers: conCookie(beto.token) }), event.slug)).response?.status, 401);
  assert.equal((await equipo(event, dueña, { accion: "sacar", organizador: beto.organizer.id })).status, 404);
});

test("el tope: veinte invitaciones y cuentas autorizadas abiertas por evento", async () => {
  const dueña = await cuenta("Dueña Prueba");
  const event = await eventoDe(dueña);
  for (let i = 0; i < 15; i++) assert.equal((await co.createInvite(event, dueña.organizer)).ok, true);
  for (let i = 0; i < 5; i++) assert.equal((await co.authorizeAccount(event, dueña.organizer, Keypair.random().publicKey())).ok, true);
  assert.deepEqual((await equipo(event, dueña, { accion: "invitar" })).cuerpo, { error: "limit" });
  assert.deepEqual((await equipo(event, dueña, { accion: "autorizar", cuenta: Keypair.random().publicKey() })).cuerpo, { error: "limit" });
  // Anular una libera un lugar.
  const { team } = await co.listTeam(event).then((t) => ({ team: t }));
  await co.revokeInvite(event, team.invites[0].id);
  assert.equal((await equipo(event, dueña, { accion: "invitar" })).status, 201);
});

test("Mis eventos: los propios y los que coorganizás, cada uno con lo suyo", async () => {
  const dueña = await cuenta("Dueña Prueba");
  const ana = await cuenta("Ana Prueba");
  const deAna = await eventoDe(ana);
  const deLaDueña = await eventoDe(dueña);
  await co.acceptInvite((await co.createInvite(deLaDueña, dueña.organizer)).token, ana.organizer, deLaDueña);

  assert.deepEqual((await repo.listEventsByOrganizer(ana.organizer.id)).map((e) => e.id), [deAna.id], "los suyos");
  assert.deepEqual(await co.listCoorganizedEventIds(ana.organizer.id), [deLaDueña.id], "los que coorganiza, aparte");
  assert.equal(await co.eventRole(ana.organizer, deAna), "owner");
  assert.equal(await co.eventRole(ana.organizer, deLaDueña), "coorganizer");
  assert.equal(await co.eventRole(dueña.organizer, deAna), null);
  assert.equal(co.shortAccount(ana.organizer.publicKey), `${ana.organizer.publicKey.slice(0, 4)}...${ana.organizer.publicKey.slice(-4)}`);
});
