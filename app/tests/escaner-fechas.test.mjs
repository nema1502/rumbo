// Una hora de lectura envenenada no tumba el evento: la forma se rechaza al leer el pedido y otra vez en la capa de
// datos (defensa en profundidad), una fila que igual quedó con una hora ilegible no rompe ninguna lectura (la
// foto del escáner, el panel, la búsqueda de la puerta, la credencial, la verificación del certificado ni la
// ruta de stands), y el saneo la lista y la borra. Corre en los tres motores (pnpm test y pnpm test:pg).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import { APP_DIR, MOTOR, entornoDePrueba, eventoDePrueba, paseDePrueba } from "./lib/entorno.mjs";

const DATOS = entornoDePrueba();
const { getRepo, InvalidScannedAt } = await import("../src/server/repo.ts");
const { getDb } = await import("../src/server/base/index.ts");
const { normalizePgRow } = await import("../src/server/base/comun.ts");
const { processScanItems, buildSnapshot, stationOf, parseScanItems, isScannedAtInRange } = await import("../src/server/escaner.ts");
const { ensureStationCodes, resolveStationCode, getPanelState } = await import("../src/server/panel.ts");
const { searchDoor } = await import("../src/server/puerta.ts");
const { verifyAttendance, certificateCode, listCertificateAttendees } = await import("../src/server/verificacion.ts");
const { getEventQrKeys } = await import("../src/server/qr-keys.ts");
const { loadCredentialUnchecked } = await import("../src/server/evento/credencial.ts");
const stands = await import("../src/server/stands.ts");
const { listBadScannedAt, deleteBadScannedAt, listBadCheckedInAt, clearBadCheckedInAt } = await import("../src/server/sanear-fechas.ts");
const { formatDate } = await import("../src/i18n/index.ts");
const { isRealIsoDate } = await import("../src/lib/fecha-iso.ts");

const repo = getRepo();
const db = getDb();
const chain = { checkIn: async () => ({ hash: "hx" }), redeem: async () => ({ hash: "hy" }), outcome: async () => "success" };
const ahora = () => new Date().toISOString();

/** Las tres horas del revisor: un año que el driver de Postgres no sabe leer, un día que no existe y un mes que no existe. */
const VENENO = ["0001-01-01T00:00:00Z", "2026-02-30T10:00:00Z", "2026-13-45T25:61:61Z"];
const item = (clientId, passId, scannedAt, extra = {}) => ({ clientId, action: "checkin", passId, benefitId: null, scannedAt, scannerId: "celu", ...extra });

test("la hora de cada lectura se valida al leer el pedido: un año de antes del 2000, un 30 de febrero o un mes 13 no entran", async () => {
  const d = await eventoDePrueba(repo);
  const { pass } = await paseDePrueba(repo, d);
  for (const scannedAt of VENENO) {
    assert.equal(isRealIsoDate(scannedAt), false, scannedAt);
    assert.equal(parseScanItems([item(`v-${scannedAt}`, pass.id, scannedAt)]), null, scannedAt);
    // Y si alguien se saltea la lectura del pedido, el registro queda rechazado, nunca a medias ni reintentando.
    const [r] = await processScanItems(repo, d.event, { id: "gate", kind: "gate", name: "", place: null }, [item(`p-${scannedAt}`, pass.id, scannedAt)], chain);
    assert.deepEqual([r.status, r.error], ["rejected", "hora de la lectura fuera de rango"], scannedAt);
  }
  assert.equal((await repo.listCheckInsForPass(pass.id)).length, 0, "nada en el espejo");
  assert.equal(isRealIsoDate("1999-12-31T23:59:59Z"), false, "antes del 2000, no");
  assert.equal(isRealIsoDate("2000-01-01T00:00:00Z"), true);
});

test("la hora de una lectura vale desde un día antes del inicio del evento (o de hoy, si todavía no empezó) hasta diez minutos adelante", () => {
  const event = { startsAt: "2026-11-22T09:00:00-04:00" };
  const h = 3_600_000;
  const antes = Date.parse("2026-11-04T12:00:00Z");
  const iso = (ms) => new Date(ms).toISOString();
  assert.equal(isScannedAtInRange(iso(antes - 23 * h), event, antes), true, "ayer, probando el escáner antes del evento");
  assert.equal(isScannedAtInRange(iso(antes - 25 * h), event, antes), false, "hace más de un día");
  assert.equal(isScannedAtInRange(iso(antes + 9 * 60_000), event, antes), true, "un reloj apenas adelantado");
  assert.equal(isScannedAtInRange(iso(antes + 11 * 60_000), event, antes), false, "más de diez minutos adelante");
  const despues = Date.parse("2026-11-23T12:00:00Z");
  assert.equal(isScannedAtInRange("2026-11-22T10:00:00Z", event, despues), true, "durante el evento, subida al día siguiente");
  assert.equal(isScannedAtInRange("2026-11-21T13:00:00Z", event, despues), true, "la víspera");
  assert.equal(isScannedAtInRange("2026-11-21T12:59:00Z", event, despues), false, "antes de la víspera: una constancia inventada");
  assert.equal(isScannedAtInRange("2026-13-45T25:61:61Z", event, despues), false);
});

test("la capa de datos vuelve a mirar la hora: las tres rutas de inserción rechazan una que no existe", async () => {
  const d = await eventoDePrueba(repo);
  const stand = await stands.createStand(d.event, { name: "Acme" }, repo);
  const { pass } = await paseDePrueba(repo, d);
  for (const scannedAt of VENENO) {
    await assert.rejects(repo.recordCheckIn({ clientId: `c-${randomUUID()}`, eventId: d.event.id, passId: pass.id, scannerId: "x", scannedAt }), InvalidScannedAt, scannedAt);
    await assert.rejects(repo.recordRedemption({ clientId: `r-${randomUUID()}`, eventId: d.event.id, passId: pass.id, benefitId: d.lunch.id, scannerId: "x", scannedAt }), InvalidScannedAt, scannedAt);
    await assert.rejects(stands.recordVisit({ standId: stand.id, passId: pass.id, clientId: `s-${randomUUID()}`, scannerId: "x", scannedAt }, repo), InvalidScannedAt, scannedAt);
  }
  assert.equal((await repo.listCheckInsForPass(pass.id)).length, 0);
  assert.equal((await repo.listRedemptionsForPass(pass.id)).length, 0);
  assert.equal((await stands.getStandReport(stand.id, repo)).visits, 0);
  // Sin hora, la de ahora; con una buena, esa.
  const ok = await repo.recordCheckIn({ clientId: `c-${randomUUID()}`, eventId: d.event.id, passId: pass.id, scannerId: "x" });
  assert.ok(Number.isFinite(Date.parse(ok.scannedAt)));
});

test("una fecha que el driver de Postgres no supo leer vuelve como null en vez de reventar la fila entera", () => {
  const fila = normalizePgRow({ id: "a", scanned_at: new Date(NaN), created_at: new Date("2026-11-22T13:00:00Z"), n: 2n });
  assert.deepEqual(fila, { id: "a", scanned_at: null, created_at: "2026-11-22T13:00:00.000Z", n: 2 });
});

test("una fila que igual quedó con una hora ilegible no rompe la foto del escáner, el panel, la puerta, la credencial, el certificado ni la ruta; el saneo la lista y la borra", async () => {
  const d = await eventoDePrueba(repo);
  const stand = await stands.createStand(d.event, { name: "Acme" }, repo);
  const codigos = await ensureStationCodes(d.event, repo);
  const sana = await paseDePrueba(repo, d, { name: "Persona Sana", email: `sana-${randomUUID()}@example.com` });
  const victima = await paseDePrueba(repo, d, { name: "Victima Prueba", email: `victima-${randomUUID()}@example.com` });
  // Lo que un servidor de antes de validar dejó en la base: el año 1 lo guardan los tres motores; el mes 13, solo SQLite.
  const malas = MOTOR === "sqlite" ? ["0001-01-01T00:00:00Z", "2026-13-45T25:61:61Z"] : ["0001-01-01T00:00:00Z"];
  for (const [i, scannedAt] of malas.entries()) {
    await db.run("INSERT INTO checkins (id, client_id, event_id, pass_id, scanner_id, scanned_at, synced, created_at) VALUES (?, ?, ?, ?, 'celu', ?, TRUE, ?)", [randomUUID(), `veneno-c-${i}`, d.event.id, victima.pass.id, scannedAt, ahora()]);
    await db.run("INSERT INTO redemptions (id, client_id, event_id, pass_id, benefit_id, scanner_id, scanned_at, synced, created_at) VALUES (?, ?, ?, ?, ?, 'mesa', ?, TRUE, ?)", [randomUUID(), `veneno-r-${i}`, d.event.id, victima.pass.id, d.lunch.id, scannedAt, ahora()]);
  }
  await db.run("INSERT INTO stand_visits (id, client_id, stand_id, event_id, pass_id, scanner_id, scanned_at, created_at) VALUES (?, ?, ?, ?, ?, 'stand', ?, ?)", [randomUUID(), "veneno-v", stand.id, d.event.id, victima.pass.id, malas[0], ahora()]);
  await db.run("UPDATE passes SET status = 'checked_in', checked_in_at = ? WHERE id = ?", [malas[0], victima.pass.id]);

  const legible = (iso) => Number.isFinite(Date.parse(iso));
  const filas = await repo.listCheckIns(d.event.id);
  assert.equal(filas.length, malas.length);
  assert.ok(filas.every((f) => legible(f.scannedAt)), "la hora que se lee siempre se puede mostrar");
  for (const kind of ["gate", "benefit", "stand"]) {
    const foto = await buildSnapshot(repo, await resolveStationCode(codigos.find((c) => c.kind === kind).code, repo));
    for (const p of foto.passes) {
      if (p.checkedInAt) assert.ok(legible(p.checkedInAt), kind);
      for (const at of Object.values(p.redeemed ?? {})) assert.ok(legible(at), kind);
      for (const at of Object.values(p.visited ?? {})) assert.ok(legible(at), kind);
    }
  }
  // La hora de entrada envenenada de la credencial se lee como otra (la de activación) o como ninguna (el driver
  // de Postgres no la supo leer): nunca como algo que la pantalla no pueda mostrar.
  const panel = await getPanelState(d.event, repo);
  const enPanel = panel.passes.find((p) => p.id === victima.pass.id);
  assert.equal(enPanel.status, "checked_in");
  assert.ok(enPanel.checkedInAt === null || legible(enPanel.checkedInAt), "la hora de entrada del panel se puede mostrar");
  if (enPanel.checkedInAt) assert.doesNotThrow(() => formatDate("es", enPanel.checkedInAt, d.event.timezone));
  assert.ok((await searchDoor(repo, d.event, "sana")).length === 1);
  const enPuerta = (await searchDoor(repo, d.event, "victima"))[0];
  assert.ok(enPuerta.checkedInAt && legible(enPuerta.checkedInAt), "la puerta la muestra como que entró, con una hora que se puede leer");
  assert.ok(await loadCredentialUnchecked(sana.pass.id));
  const credencial = await loadCredentialUnchecked(victima.pass.id);
  assert.equal(credencial.checkedIn, true);
  const keys = await getEventQrKeys(d.event.id);
  const v = await verifyAttendance(victima.pass.id, certificateCode(victima.pass.id, keys.credentialRoot), repo);
  assert.ok(v.found && v.checkedIn && legible(v.checkedInAt), "la verificación del certificado dice una hora que se puede leer");
  assert.doesNotThrow(() => formatDate("es", v.checkedInAt, d.event.timezone, { hour: "2-digit", minute: "2-digit" }));
  assert.ok((await listCertificateAttendees(d.event, repo)).every((a) => a.checkedInAt === null || legible(a.checkedInAt)));
  const ruta = await stands.getPassRoute(victima.pass.id, repo);
  assert.ok(ruta.stands.every((s) => s.visitedAt === null || legible(s.visitedAt)));
  assert.ok((await stands.standScanVisits(stand.id)).every((x) => legible(x.at)));
  assert.doesNotThrow(() => stands.getStandPanel(stand.id, repo));

  // El saneo: lista exactamente las filas envenenadas y, al borrar, no toca las sanas.
  const buena = await repo.recordCheckIn({ clientId: `buena-${randomUUID()}`, eventId: d.event.id, passId: sana.pass.id, scannerId: "celu", scannedAt: ahora() });
  assert.deepEqual((await listBadScannedAt(db, "checkins")).map((r) => r.clientId).sort(), malas.map((_, i) => `veneno-c-${i}`));
  assert.equal((await listBadScannedAt(db, "redemptions")).length, malas.length);
  assert.deepEqual((await listBadScannedAt(db, "stand_visits")).map((r) => r.clientId), ["veneno-v"]);
  assert.deepEqual((await listBadCheckedInAt(db)).map((r) => r.id), [victima.pass.id]);
  assert.equal(await deleteBadScannedAt(db, "checkins"), malas.length);
  assert.equal(await deleteBadScannedAt(db, "redemptions"), malas.length);
  assert.equal(await deleteBadScannedAt(db, "stand_visits"), 1);
  assert.equal(await clearBadCheckedInAt(db), 1);
  assert.deepEqual((await repo.listCheckIns(d.event.id)).map((c) => c.id), [buena.id], "la sana queda");
  assert.equal((await repo.getPass(victima.pass.id)).checkedInAt, null);
  assert.equal((await listBadScannedAt(db, "checkins")).length, 0);

  // El script, de punta a punta, sobre la misma base (solo con SQLite: la de PGlite en memoria es de este proceso).
  if (MOTOR === "sqlite") {
    const corrida = spawnSync(process.execPath, [join(APP_DIR, "scripts", "sanear-fechas.mjs")], { cwd: APP_DIR, env: { ...process.env, RUMBO_DATA_DIR: DATOS, RUMBO_REPO: "sqlite" }, encoding: "utf8" });
    assert.equal(corrida.status, 0, corrida.stderr);
    assert.match(corrida.stdout, /Nada que sanear/);
  }
});
