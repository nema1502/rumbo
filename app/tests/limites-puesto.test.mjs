// El código de puesto no se adivina a la fuerza: cambiar x-forwarded-for en cada pedido no esquiva el
// freno, la espera crece con cada freno, la alarma global frena a quien prueba desde muchas IP sin dejar
// afuera a quien escribe bien su código, y los códigos son de doce letras.
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { APP_DIR, entornoDePrueba, eventoDePrueba, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo, SqliteRepo } = await import("../src/server/repo.ts");
const { AttemptLimiter, clientKey, stationCodeAttempts } = await import("../src/server/limites.ts");
const { ensureStationCodes } = await import("../src/server/panel.ts");
const { formatStationCode, isValidStationCode, normalizeStationCode } = await import("../src/lib/station-code.ts");
const { POST: abrir } = await import("../src/app/api/scan/open/route.ts");

const repo = getRepo();
const datos = await eventoDePrueba(repo);
const codigos = await ensureStationCodes(datos.event, repo);
const puerta = codigos.find((c) => c.kind === "gate").code;

beforeEach(() => {
  stationCodeAttempts().clear();
  delete process.env.RUMBO_TRUSTED_IP_HEADER;
  delete process.env.VERCEL;
});

const abrirCon = async (code, { ip, headers } = {}) => (await abrir(await pedido("http://localhost/api/scan/open", { body: { code }, ip, headers }))).status;
const otroCodigo = (n) => `ZZZZ-ZZZZ-${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + (Math.floor(n / 26) % 26))}ZZ`;

test("los códigos nuevos tienen doce letras, sesenta bits, y se dictan en tres grupos", () => {
  for (const c of codigos) {
    assert.equal(c.code.length, 12);
    assert.ok(isValidStationCode(c.code), c.code);
  }
  assert.match(formatStationCode(puerta), /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  assert.equal(normalizeStationCode(` ${formatStationCode(puerta).toLowerCase()} `), puerta);
  assert.ok(!isValidStationCode("ABCDEFGH"), "un código de ocho letras ya no vale");
});

test("cambiar x-forwarded-for en cada pedido no esquiva el freno", async () => {
  for (let i = 0; i < 8; i++) {
    assert.equal(await abrirCon(otroCodigo(i), { headers: { "x-forwarded-for": `10.0.0.${i}` } }), 401);
  }
  // el noveno, con otra IP inventada y hasta con el código bueno: frenado
  assert.equal(await abrirCon(otroCodigo(9), { headers: { "x-forwarded-for": "10.0.0.99" } }), 429);
  assert.equal(await abrirCon(puerta, { headers: { "x-forwarded-for": "10.0.0.100" } }), 429);
});

test("sin plataforma ni proxy configurado, ningún encabezado es de fiar", () => {
  const h = new Headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" });
  assert.equal(clientKey(h), "local");
  process.env.VERCEL = "1";
  assert.equal(clientKey(h), "5.6.7.8", "en Vercel vale x-real-ip, que pone la plataforma");
  delete process.env.VERCEL;
  process.env.RUMBO_TRUSTED_IP_HEADER = "x-forwarded-for";
  assert.equal(clientKey(new Headers({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" })), "9.9.9.9", "detrás de un proxy que agrega al final, vale la última");
});

test("con la IP de la plataforma, el freno es por IP: la de al lado sigue abriendo su puesto", async () => {
  process.env.RUMBO_TRUSTED_IP_HEADER = "x-real-ip";
  for (let i = 0; i < 8; i++) assert.equal(await abrirCon(otroCodigo(i), { ip: "200.1.1.1" }), 401);
  assert.equal(await abrirCon(puerta, { ip: "200.1.1.1" }), 429);
  assert.equal(await abrirCon(puerta, { ip: "200.1.1.2" }), 200);
});

test("la alarma global: desde muchas IP, a cada una le queda un intento, y quien escribe bien entra", async () => {
  process.env.RUMBO_TRUSTED_IP_HEADER = "x-real-ip";
  for (let i = 0; i < 50; i++) assert.equal(await abrirCon(otroCodigo(i), { ip: `190.0.${Math.floor(i / 250)}.${i % 250}` }), 401);
  // una IP que ya falló, ahora frenada aunque falló una sola vez
  assert.equal(await abrirCon(otroCodigo(1), { ip: "190.0.0.1" }), 429);
  // una IP nueva puede probar una vez, y después queda frenada
  assert.equal(await abrirCon(otroCodigo(77), { ip: "181.0.0.1" }), 401);
  assert.equal(await abrirCon(otroCodigo(78), { ip: "181.0.0.1" }), 429);
  // el voluntario que escribe bien su código, desde una IP que no falló, abre su puesto
  assert.equal(await abrirCon(formatStationCode(puerta).toLowerCase(), { ip: "181.0.0.2" }), 200);
});

test("cada freno siguiente dura el doble, hasta un día", () => {
  let reloj = 0;
  const minuto = 60_000;
  const freno = new AttemptLimiter({ windowMs: 10 * minuto, perKey: 3, global: 1_000, lockMs: 10 * minuto, maxLockMs: 24 * 60 * minuto, forgetMs: 24 * 60 * minuto }, () => reloj);
  const frenar = () => {
    for (let i = 0; i < 3; i++) freno.note("ip");
    return freno.blockedFor("ip");
  };
  assert.equal(frenar(), 10 * minuto);
  reloj += 10 * minuto;
  assert.equal(freno.blockedFor("ip"), 0);
  assert.equal(frenar(), 20 * minuto);
  reloj += 20 * minuto;
  assert.equal(frenar(), 40 * minuto);
  for (let i = 0; i < 10; i++) {
    reloj += freno.blockedFor("ip");
    frenar();
  }
  assert.equal(freno.blockedFor("ip"), 24 * 60 * minuto);
  // un día entero sin intentos borra la historia
  reloj += 48 * 60 * minuto;
  assert.equal(frenar(), 10 * minuto);
});

test("la migración borra los códigos de ocho letras, y el panel crea los de doce", async () => {
  // una base con las migraciones de antes de los códigos largos, y un código viejo adentro
  const viejas = mkdtempSync(join(tmpdir(), "rumbo-migraciones-"));
  const todas = readdirSync(join(APP_DIR, "src", "server", "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const f of todas.filter((f) => f < "005")) copyFileSync(join(APP_DIR, "src", "server", "migrations", f), join(viejas, f));
  const archivo = join(mkdtempSync(join(tmpdir(), "rumbo-base-")), "rumbo.db");
  process.env.RUMBO_MIGRATIONS_DIR = viejas;
  const antes = new SqliteRepo(archivo);
  const evento = await antes.createEvent({ slug: "viejo", name: "Viejo", startsAt: "2026-11-22T09:00:00-04:00", place: "Santa Cruz", organizerName: "La comunidad" });
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(archivo);
  db.prepare("INSERT INTO station_codes (code, event_id, kind, benefit_id, created_at) VALUES (?, ?, 'gate', NULL, ?)").run("ABCDEFGH", evento.id, new Date().toISOString());
  // ahora con todas las migraciones
  delete process.env.RUMBO_MIGRATIONS_DIR;
  new SqliteRepo(archivo);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM station_codes").get().n, 0);
  db.close();
});
