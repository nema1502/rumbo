// Lo que la revisión de datos encontró en el escáner, y no vuelve: dos mesas sin red que entregan más poleras de
// las que había quedan avisadas (el escáner lo ve y el panel dice por cuántas se pasó), una hora de lectura
// imposible no entra al espejo, un NUL en un id se descarta, y cuando la base falla el voluntario recibe un texto
// genérico y no el mensaje de la base. Sin red: la cadena es de mentira.
import assert from "node:assert/strict";
import { test } from "node:test";
import { capturarConsola, entornoDePrueba, eventoDePrueba, paseDePrueba, qrImpreso } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { processScanItems, buildSnapshot, stationOf, parseScanItems, isRealIsoDate, isScannedAtInRange, SCANNED_AT_FUTURE_MS } = await import("../src/server/escaner.ts");
const { ensureStationCodes, resolveStationCode, getPanelState } = await import("../src/server/panel.ts");
const { GATE_STATION, STOCK_EXCEEDED } = await import("../src/lib/escaner-api.ts");

const repo = getRepo();
const red = {
  redeem: async (_contract, _account, _benefit, hooks) => {
    await hooks?.onSubmitted?.("tx");
    return { hash: "tx" };
  },
  checkIn: async (_contract, _account, hooks) => {
    await hooks?.onSubmitted?.("tx1");
    return { hash: "tx1" };
  },
  outcome: async () => "success",
};
const ahora = () => new Date().toISOString();
const item = (extra) => ({ clientId: `c-${Math.random().toString(36).slice(2, 8)}`, action: "checkin", benefitId: null, scannedAt: ahora(), scannerId: "p1", ...extra });
/** Lo mismo, con el QR del pase: así la lectura llega hasta el espejo. */
const lectura = async (pass, extra) => item({ passId: pass.id, qr: await qrImpreso(pass.eventId, pass.id), ...extra });

test("dos mesas sin red que entregan de más: el servidor lo detecta, el escáner lo ve y el panel dice por cuántas se pasó", async () => {
  const d = await eventoDePrueba(repo, { beneficio: false });
  const polera = await repo.createBenefit({ eventId: d.event.id, name: "Polera", kind: "merch", station: "Mesa de poleras", stock: 3 });
  await repo.linkBenefit(d.ticket.id, polera.id, 0);
  const pases = [];
  for (let i = 0; i < 6; i++) pases.push((await paseDePrueba(repo, d, { name: `Persona ${i}` })).pass);
  const codigos = await ensureStationCodes(d.event, repo);
  const access = await resolveStationCode(codigos.find((c) => c.benefitId === polera.id).code, repo);
  const station = stationOf(access);
  // Dos celulares abren la mesa con red: los dos ven "quedan 3", y cada uno entrega sus tres sin red.
  assert.deepEqual((await buildSnapshot(repo, access)).stock, { total: 3, left: 3, over: 0 });
  const mesa = (letra, gente) => Promise.all(gente.map(async (p, i) => ({ clientId: `${letra}-${i}`, action: "redeem", passId: p.id, benefitId: polera.id, scannedAt: ahora(), scannerId: `mesa-${letra}`, qr: await qrImpreso(d.event.id, p.id) })));
  const rA = await processScanItems(repo, d.event, station, await mesa("A", pases.slice(0, 3)), red);
  const rB = await processScanItems(repo, d.event, station, await mesa("B", pases.slice(3, 6)), red);
  assert.deepEqual(rA.map((r) => [r.status, r.error]), [["synced", null], ["synced", null], ["synced", null]]);
  // Las de B también entraron (la polera ya se dio), pero cada una avisa que con ella se pasó el tope.
  assert.deepEqual(rB.map((r) => [r.status, r.error]), [["synced", STOCK_EXCEEDED], ["synced", STOCK_EXCEEDED], ["synced", STOCK_EXCEEDED]]);
  const fila = (await getPanelState(d.event, repo)).benefits.find((b) => b.id === polera.id);
  assert.deepEqual([fila.redeemed, fila.remaining, fila.exceeded, fila.duplicates], [6, 0, 3, 0]);
  assert.deepEqual((await buildSnapshot(repo, access)).stock, { total: 3, left: 0, over: 3 });
  // Repetir una lectura ya subida no cambia la cuenta.
  const otraVez = await processScanItems(repo, d.event, station, await mesa("A", pases.slice(0, 1)), red);
  assert.equal(otraVez[0].status, "synced");
  assert.equal((await getPanelState(d.event, repo)).benefits.find((b) => b.id === polera.id).exceeded, 3);
});

test("una hora de lectura imposible no entra: la forma se rechaza al leer el pedido, y una fecha de otro año queda rechazada por registro", async () => {
  assert.equal(isRealIsoDate("2026-11-22T10:00:00Z"), true);
  assert.equal(isRealIsoDate("2026-11-22T10:00:00.123-04:00"), true);
  for (const texto of ["2026-02-30T10:00:00Z", "2026-13-01T10:00:00Z", "2026-11-22T25:00:00Z", "2026-11-22T10:00:00+99:00", "0000-01-01T00:00:00Z", "2026-11-22 10:00:00Z", "ayer"]) {
    assert.equal(isRealIsoDate(texto), false, texto);
  }
  const d = await eventoDePrueba(repo);
  const { pass } = await paseDePrueba(repo, d);
  assert.equal(parseScanItems([item({ passId: pass.id, scannedAt: "2026-02-30T10:00:00Z" })]), null, "un 30 de febrero no tiene forma de fecha");
  const leidos = parseScanItems([item({ passId: pass.id, scannedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() }), item({ passId: pass.id, scannedAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() })]);
  assert.equal(leidos.length, 2, "la forma está bien");
  const [viejo, futuro] = await processScanItems(repo, d.event, GATE_STATION, leidos, red);
  assert.deepEqual([viejo.status, viejo.error], ["rejected", "hora de la lectura fuera de rango"]);
  assert.deepEqual([futuro.status, futuro.error], ["rejected", "hora de la lectura fuera de rango"]);
  assert.equal((await repo.listCheckInsForPass(pass.id)).length, 0, "nada en el espejo");
  // Lo que un escáner sin red guardó desde la víspera, o con el reloj un poco adelantado, vale.
  assert.equal(isScannedAtInRange(new Date(Date.now() - 23 * 3600 * 1000).toISOString(), d.event), true);
  assert.equal(isScannedAtInRange(new Date(Date.now() + SCANNED_AT_FUTURE_MS - 1000).toISOString(), d.event), true);
  const [ayer] = await processScanItems(repo, d.event, GATE_STATION, [await lectura(pass, { scannedAt: new Date(Date.now() - 23 * 3600 * 1000).toISOString() })], red);
  assert.equal(ayer.status, "synced");
});

test("un NUL en el id de la cola o en el nombre del escáner se descarta al leer el pedido", async () => {
  const d = await eventoDePrueba(repo);
  const { pass } = await paseDePrueba(repo, d);
  const [leido] = parseScanItems([item({ clientId: "c\u0000-1", scannerId: "p\u0000uerta", passId: pass.id })]);
  assert.deepEqual([leido.clientId, leido.scannerId], ["c-1", "puerta"]);
});

test("si la base falla a mitad de un registro, el escáner recibe un texto genérico y el detalle queda en el registro del servidor", async () => {
  const d = await eventoDePrueba(repo);
  const { pass } = await paseDePrueba(repo, d);
  const roto = Object.create(repo);
  roto.recordCheckIn = async () => {
    throw new Error("invalid byte sequence for encoding UTF8: 0x00");
  };
  const lecturaDeAna = await lectura(pass);
  const { resultado, lineas } = await capturarConsola(() => processScanItems(roto, d.event, GATE_STATION, [lecturaDeAna], red));
  const [r] = resultado;
  assert.deepEqual([r.status, r.error], ["retry", "no se pudo registrar en el servidor, se reintenta"]);
  assert.ok(lineas.some((l) => l.includes("invalid byte sequence")), "el detalle va al registro del servidor");
});
