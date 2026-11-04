// Una entrada o un canje cuya confirmación llegó tarde no queda como "doble": el hash de la transacción se
// guarda apenas se manda, el reintento le pregunta a la red cómo terminó antes de mandar otra, y si el
// contrato dice "ya estaba hecho" se mira primero si lo hecho era lo propio.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba, qrImpreso } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { ContractError } = await import("../src/server/stellar.ts");
const { processScanItems, TX_SETTLE_MS } = await import("../src/server/escaner.ts");
const { GATE_STATION } = await import("../src/lib/escaner-api.ts");

const repo = getRepo();

/**
 * La red de mentira. Cada cuenta entra una vez y canjea cada beneficio una vez, como en el contrato.
 * `plan` dice qué hace cada envío: "ok" (entra y confirma), "tarde" (se manda, no confirma a tiempo, y
 * entra cuando la prueba llama a aterrizar) o "perdida" (se manda y nunca entra).
 */
function redDeMentira() {
  const red = {
    plan: [],
    enviados: [],
    entraron: new Set(),
    adentro: new Set(),
    canjes: new Set(),
    pendientes: new Map(),
    /** Respuestas forzadas de outcome(hash), en orden, antes de mirar lo que de verdad pasó. */
    respuestas: new Map(),
    aterrizar(hash) {
      const efecto = red.pendientes.get(hash);
      if (!efecto) throw new Error(`no hay nada pendiente con ${hash}`);
      red.pendientes.delete(hash);
      efecto();
      red.entraron.add(hash);
    },
    async enviar(hooks, yaHecho, efecto, codigoDoble) {
      if (yaHecho()) throw new ContractError("El contrato rechazó la operación", codigoDoble);
      const hash = `tx-${red.enviados.length + 1}`;
      red.enviados.push(hash);
      await hooks.onSubmitted?.(hash);
      const paso = red.plan.shift() ?? "ok";
      if (paso === "ok") {
        efecto();
        red.entraron.add(hash);
        return { hash };
      }
      if (paso === "tarde") red.pendientes.set(hash, efecto);
      throw new ContractError(`La transacción ${hash} no se confirmó a tiempo`, null);
    },
    chain: {
      checkIn: (contractId, account, hooks) =>
        red.enviar(hooks, () => red.adentro.has(account), () => red.adentro.add(account), 4),
      redeem: (contractId, account, benefit, hooks) =>
        red.enviar(hooks, () => red.canjes.has(`${account}:${benefit}`), () => red.canjes.add(`${account}:${benefit}`), 6),
      outcome: async (hash) => {
        const forzadas = red.respuestas.get(hash);
        if (forzadas?.length) return forzadas.shift();
        return red.entraron.has(hash) ? "success" : "missing";
      },
    },
  };
  return red;
}

const ahora = () => new Date().toISOString();
// Cada lectura viaja con el QR de su pase (el impreso de la prueba): el servidor lo vuelve a comprobar antes de registrar.
let qr = "";
const entrada = (clientId, passId) => ({ clientId, action: "checkin", passId, benefitId: null, scannedAt: ahora(), scannerId: "puerta-1", qr });
const canje = (clientId, passId, benefitId) => ({ clientId, action: "redeem", passId, benefitId, scannedAt: ahora(), scannerId: "mesa-1", qr });
const hace = (ms) => new Date(Date.now() - ms).toISOString();

async function preparar() {
  const datos = await eventoDePrueba(repo);
  const { pass } = await paseDePrueba(repo, datos);
  qr = await qrImpreso(datos.event.id, pass.id);
  return { ...datos, pass };
}

test("una entrada que se confirmó tarde se da por sincronizada con su propia transacción, no como doble", async () => {
  const { event, pass } = await preparar();
  const red = redDeMentira();
  red.plan = ["tarde"];

  const [primero] = await processScanItems(repo, event, GATE_STATION, [entrada("e-1", pass.id)], red.chain);
  assert.equal(primero.status, "retry");
  const [fila] = await repo.listCheckInsForPass(pass.id);
  assert.equal(fila.txHash, "tx-1", "el hash queda guardado apenas se manda");
  assert.ok(fila.txSentAt);
  assert.ok(!fila.synced && !fila.duplicate);

  red.aterrizar("tx-1");
  const [segundo] = await processScanItems(repo, event, GATE_STATION, [entrada("e-1", pass.id)], red.chain);
  assert.deepEqual([segundo.status, segundo.txHash], ["synced", "tx-1"]);
  assert.equal(red.enviados.length, 1, "no se manda otra transacción");
  const [despues] = await repo.listCheckInsForPass(pass.id);
  assert.ok(despues.synced && !despues.duplicate);
  assert.equal((await repo.getPass(pass.id)).status, "checked_in");
});

test("si la transacción anterior todavía puede entrar, se espera en vez de mandar otra", async () => {
  const { event, pass } = await preparar();
  const red = redDeMentira();
  red.plan = ["perdida"];
  await processScanItems(repo, event, GATE_STATION, [entrada("e-2", pass.id)], red.chain);
  const [otra] = await processScanItems(repo, event, GATE_STATION, [entrada("e-2", pass.id)], red.chain);
  assert.deepEqual([otra.status, otra.error], ["retry", "en curso"]);
  assert.equal(red.enviados.length, 1);
});

test("pasado su tiempo, una transacción que no entró se vuelve a mandar", async () => {
  const { event, pass } = await preparar();
  const red = redDeMentira();
  red.plan = ["perdida", "ok"];
  await processScanItems(repo, event, GATE_STATION, [entrada("e-3", pass.id)], red.chain);
  const [fila] = await repo.listCheckInsForPass(pass.id);
  await repo.markCheckIn(fila.id, { txSentAt: hace(TX_SETTLE_MS + 1000) });

  const [otra] = await processScanItems(repo, event, GATE_STATION, [entrada("e-3", pass.id)], red.chain);
  assert.deepEqual([otra.status, otra.txHash], ["synced", "tx-2"]);
  assert.equal(red.enviados.length, 2);
  const [despues] = await repo.listCheckInsForPass(pass.id);
  assert.ok(despues.synced && !despues.duplicate && despues.txHash === "tx-2");
});

test("si la anterior entra justo mientras se manda otra, el 'ya entró' del contrato es lo propio, no un doble", async () => {
  const { event, pass } = await preparar();
  const red = redDeMentira();
  red.plan = ["tarde"];
  await processScanItems(repo, event, GATE_STATION, [entrada("e-4", pass.id)], red.chain);
  const [fila] = await repo.listCheckInsForPass(pass.id);
  await repo.markCheckIn(fila.id, { txSentAt: hace(TX_SETTLE_MS + 1000) });
  // la red todavía no la conoce cuando se pregunta, pero entra antes de que llegue la segunda
  red.respuestas.set("tx-1", ["missing"]);
  red.aterrizar("tx-1");

  const [otra] = await processScanItems(repo, event, GATE_STATION, [entrada("e-4", pass.id)], red.chain);
  assert.deepEqual([otra.status, otra.txHash], ["synced", "tx-1"]);
  const [despues] = await repo.listCheckInsForPass(pass.id);
  assert.ok(despues.synced && !despues.duplicate);
});

test("la misma entrada desde otro puesto sí es doble, como antes", async () => {
  const { event, pass } = await preparar();
  const red = redDeMentira();
  await processScanItems(repo, event, GATE_STATION, [entrada("e-5", pass.id)], red.chain);
  const [otroPuesto] = await processScanItems(repo, event, GATE_STATION, [entrada("e-5-otro", pass.id)], red.chain);
  assert.equal(otroPuesto.status, "duplicate");
  const filas = await repo.listCheckInsForPass(pass.id);
  assert.equal(filas.filter((f) => f.duplicate).length, 1);
  assert.equal(filas.filter((f) => f.synced).length, 1);
});

test("un canje que se confirmó tarde tampoco queda como doble", async () => {
  const { event, pass, lunch } = await preparar();
  const red = redDeMentira();
  const mesa = { id: lunch.id, kind: "benefit", name: lunch.name, place: lunch.station };
  await processScanItems(repo, event, GATE_STATION, [entrada("e-6", pass.id)], red.chain);
  red.plan = ["tarde"];
  const [primero] = await processScanItems(repo, event, mesa, [canje("c-6", pass.id, lunch.id)], red.chain);
  assert.equal(primero.status, "retry");
  red.aterrizar("tx-2");
  const [segundo] = await processScanItems(repo, event, mesa, [canje("c-6", pass.id, lunch.id)], red.chain);
  assert.deepEqual([segundo.status, segundo.txHash], ["synced", "tx-2"]);
  const [fila] = await repo.listRedemptionsForPass(pass.id);
  assert.ok(fila.synced && !fila.duplicate && fila.txHash === "tx-2");
  // y el mismo canje desde otra mesa, que no lo sabía, sí es doble
  const [otraMesa] = await processScanItems(repo, event, mesa, [canje("c-6-otra", pass.id, lunch.id)], red.chain);
  assert.equal(otraMesa.status, "duplicate");
});
