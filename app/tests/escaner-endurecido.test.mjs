// Endurecimientos del escáner: un escáner no ocupa los ids que reserva el contraste con la cadena (y si una base
// vieja los tiene ocupados, el contraste no se cae); un código de mesa sin su beneficio no cae a la puerta; el texto
// crudo del nodo o de la base no llega al escáner ni al espejo (ni correos ni enlaces al registro); un QR del
// celular sin una hora que valga no se acepta; y la hora del servidor se mide con el viaje de ida y vuelta y se
// nota cuando el reloj salta. Sin red.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { capturarConsola, entornoDePrueba, eventoDePrueba, paseDePrueba, qrImpreso } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { getDb } = await import("../src/server/base/index.ts");
const stellar = await import("../src/server/stellar.ts");
const { processScanItems, parseScanItems, stationOf } = await import("../src/server/escaner.ts");
const { ensureStationCodes, resolveStationCode, refreshFromChain } = await import("../src/server/panel.ts");
const { GATE_STATION } = await import("../src/lib/escaner-api.ts");
const qr = await import("../src/server/qr.ts");
const { buildLivePayload, clockOffset } = await import("../src/lib/qr-live.ts");
const { verifyQrPayloadInBrowser } = await import("../src/lib/qr-verify.ts");
const { measureClockOffset, clockJumpSince } = await import("../src/lib/reloj.ts");

const repo = getRepo();
const ahora = () => new Date().toISOString();
const item = (extra) => ({ clientId: `c-${randomUUID()}`, action: "checkin", benefitId: null, scannedAt: ahora(), scannerId: "celu", ...extra });

test("un escáner no ocupa los ids reservados del contraste con la cadena, y si una base vieja los tiene ocupados el contraste sigue", async () => {
  const d = await eventoDePrueba(repo);
  const gana = await paseDePrueba(repo, d, { name: "Gana En Cadena" });
  const otra = await paseDePrueba(repo, d, { name: "Otra Persona" });
  assert.equal(parseScanItems([item({ clientId: `chain:${gana.pass.id}:checkin`, passId: otra.pass.id, qr: await qrImpreso(d.event.id, otra.pass.id) })]), null);
  assert.equal(parseScanItems([item({ clientId: `CHAIN:${gana.pass.id}:checkin`, passId: otra.pass.id })]), null);
  assert.ok(parseScanItems([item({ clientId: "mi-chain:1", passId: otra.pass.id })]), "solo el prefijo está reservado");
  // Una base de antes: el id reservado quedó ocupado con el pase de otra persona.
  await repo.recordCheckIn({ clientId: `chain:${gana.pass.id}:checkin`, eventId: d.event.id, passId: otra.pass.id, scannerId: "celu" });
  const original = { info: stellar.rumboPass.info, attendees: stellar.rumboPass.attendees, status: stellar.rumboPass.status };
  stellar.rumboPass.info = async () => ({ issued: 2, checked_in: 1 });
  stellar.rumboPass.attendees = async () => [gana.pass.account];
  stellar.rumboPass.status = async (c, account) => ({ has_pass: true, number: 1, checked_in: account === gana.pass.account, redeemed: [] });
  try {
    const resumen = await refreshFromChain(d.event, repo);
    assert.equal(resumen.checkInsAdded, 0);
    assert.deepEqual(resumen.errors, [`${gana.pass.id}: unavailable`], "se anota y no se cae");
    assert.equal(resumen.passesChecked, 2);
  } finally {
    Object.assign(stellar.rumboPass, original);
  }
});

test("un código de mesa cuyo beneficio no está no cae a la puerta: no abre, y stationOf falla cerrado", async () => {
  const d = await eventoDePrueba(repo);
  const otro = await eventoDePrueba(repo);
  const codigos = await ensureStationCodes(d.event, repo);
  const mesa = codigos.find((c) => c.kind === "benefit");
  // La fila del código apunta al beneficio de otro evento (una base tocada a mano): no es de ninguna mesa de este evento.
  await getDb().run("UPDATE station_codes SET benefit_id = ? WHERE code = ?", [otro.lunch.id, mesa.code]);
  assert.equal(await resolveStationCode(mesa.code, repo), null);
  const puerta = await resolveStationCode(codigos.find((c) => c.kind === "gate").code, repo);
  assert.throws(() => stationOf({ ...puerta, kind: "benefit", benefit: null }), /beneficio ya no existe/);
  assert.throws(() => stationOf({ ...puerta, kind: "stand", stand: null }), /stand que ya no existe/);
  assert.equal(stationOf(puerta).kind, "gate");
});

test("el texto crudo del nodo o de la base no llega al escáner ni al espejo, y al registro va sin correos ni enlaces", async () => {
  const d = await eventoDePrueba(repo);
  const { pass } = await paseDePrueba(repo, d);
  const lectura = item({ passId: pass.id, qr: await qrImpreso(d.event.id, pass.id) });
  const crudo = "simulateTransaction failed: https://rpc-interno.example/v1/LLAVE-DEL-PROVEEDOR/ responded 502 (ana@example.com)";
  const casos = [
    ["un error cualquiera", new Error(crudo), "no se pudo registrar en el servidor, se reintenta"],
    ["un error del contrato sin nombre", new stellar.ContractError(`La red no aceptó la transacción ${crudo}`, null), "la red no confirmó el registro, se reintenta"],
  ];
  for (const [nombre, error, esperado] of casos) {
    const chain = { checkIn: async () => { throw error; }, redeem: async () => ({ hash: "x" }), outcome: async () => "missing" };
    const { resultado, lineas } = await capturarConsola(() => processScanItems(repo, d.event, GATE_STATION, [lectura], chain));
    assert.deepEqual([resultado[0].status, resultado[0].error], ["retry", esperado], nombre);
    const [fila] = await repo.listCheckInsForPass(pass.id);
    assert.equal(fila.error, esperado, `${nombre}: el espejo`);
    const registro = lineas.join("\n");
    assert.ok(registro.includes("[escaner]") && !registro.includes("ana@example.com") && !registro.includes("rpc-interno.example") && !registro.includes("LLAVE-DEL-PROVEEDOR"), `${nombre}: el registro va sin correos ni enlaces`);
  }
  // Un error del contrato con nombre sigue siendo parte de la interfaz.
  const noEntro = { checkIn: async () => { throw new stellar.ContractError("El contrato rechazó la operación", 5); }, redeem: async () => ({ hash: "x" }), outcome: async () => "missing" };
  const [r] = await processScanItems(repo, d.event, GATE_STATION, [lectura], noEntro);
  assert.equal(r.error, "NotCheckedIn");
});

test("un QR del celular sin una hora que valga no se acepta: comparar con una ventana de NaN aceptaba cualquier captura", async () => {
  const keys = qr.newEventQrKeys();
  const pass = qr.newPassId();
  const viejo = await buildLivePayload(qr.buildLiveGrant(pass, keys), Date.now() - 3 * 24 * 3_600_000);
  for (const now of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(await verifyQrPayloadInBrowser(viejo, keys.publicKey, now), { ok: false, reason: "expired", passId: pass }, String(now));
  }
  assert.equal((await verifyQrPayloadInBrowser(viejo, keys.publicKey, undefined)).ok, false, "sin hora, vale la de ahora: la captura es vieja");
  assert.equal((await verifyQrPayloadInBrowser(await buildLivePayload(qr.buildLiveGrant(pass, keys), Date.now()), keys.publicKey)).ok, true);
  // La impresa no depende de la hora.
  assert.equal((await verifyQrPayloadInBrowser(qr.buildPrintedPayload(pass, keys), keys.publicKey, NaN)).ok, true);
  assert.equal(clockOffset(NaN, Date.now()), 0, "una medida que no vale no corrige nada");
});

test("la hora del servidor se mide con el viaje de ida y vuelta, y un salto del reloj de pared se nota", async () => {
  let reloj = 1_000_000;
  const now = () => reloj;
  // El servidor va diez segundos adelante y el viaje tarda 200 ms: la hora del servidor vale para la mitad del viaje.
  const servidor = async () => {
    reloj += 100;
    const enElServidor = reloj + 10_000;
    const respuesta = { ok: true, json: async () => ({ now: enElServidor }) };
    reloj += 100;
    return respuesta;
  };
  assert.equal(await measureClockOffset(servidor, now), 10_000);
  // Un desfase chico no se corrige; una respuesta rota o sin red no corrige nada.
  assert.equal(await measureClockOffset(async () => ({ ok: true, json: async () => ({ now: reloj + 1000 }) }), now), 0);
  assert.equal(await measureClockOffset(async () => ({ ok: false, json: async () => ({}) }), now), 0);
  assert.equal(await measureClockOffset(async () => ({ ok: true, json: async () => ({ now: "ayer" }) }), now), 0);
  assert.equal(await measureClockOffset(async () => { throw new Error("sin red"); }, now), 0);
  // El reloj de pared avanzó cinco minutos más que el monotónico: saltó.
  assert.equal(clockJumpSince({ wall: 0, mono: 0 }, { wall: 300_000 + 1000, mono: 1000 }), 300_000);
  assert.equal(clockJumpSince({ wall: 0, mono: 0 }, { wall: 1200, mono: 1000 }), 0, "doscientos milisegundos no son un salto");
});
