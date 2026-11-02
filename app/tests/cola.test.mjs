// La cola del escáner manda cada registro con el código del puesto en que se hizo: si el voluntario cierra
// la puerta con entradas pendientes y abre la mesa del almuerzo, esas entradas no viajan con el código de
// la mesa (el servidor las rechazaría para siempre) sino con el de la puerta.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { abrirCola, agruparParaSincronizar, nuevaEntrada } = await import("../src/lib/cola.ts");
const { getRepo } = await import("../src/server/repo.ts");
const stellar = await import("../src/server/stellar.ts");
const { authorizeScanRequest, processScanItems, stationOf } = await import("../src/server/escaner.ts");
const { ensureStationCodes } = await import("../src/server/panel.ts");
const { formatStationCode } = await import("../src/lib/station-code.ts");

const entrada = (eventId, stationId, code, passId) =>
  nuevaEntrada({ eventId, stationId, code, action: stationId === "gate" ? "checkin" : "redeem", passId, benefitId: stationId === "gate" ? null : stationId, scannerId: "celu-1" });

test("lo pendiente se agrupa por el código de su puesto, y el puesto abierto va primero", () => {
  const puerta = entrada("ev", "gate", "PUERTAPUERTA", "AAAAAAAA");
  const mesa = entrada("ev", "almuerzo", "MESAMESAMESA", "BBBBBBBB");
  const mesa2 = entrada("ev", "almuerzo", "mesa-mesa-mesa", "CCCCCCCC");
  const grupos = agruparParaSincronizar([puerta, mesa, mesa2], { code: "MESA-MESA-MESA", eventId: "ev", stationId: "almuerzo" });
  assert.deepEqual(
    grupos.map((g) => [g.code, g.actual, g.entries.map((e) => e.passId)]),
    [
      ["MESAMESAMESA", true, ["BBBBBBBB", "CCCCCCCC"]],
      ["PUERTAPUERTA", false, ["AAAAAAAA"]],
    ],
  );
});

test("un registro viejo sin código va con la sesión solo si es de su mismo puesto; si no, espera", () => {
  const { code: _sinCodigo, ...vieja } = entrada("ev", "gate", "X", "AAAAAAAA");
  const viejaDeOtroPuesto = { ...vieja, clientId: "otro", stationId: "almuerzo", action: "redeem", benefitId: "almuerzo" };
  const enLaPuerta = agruparParaSincronizar([vieja, viejaDeOtroPuesto], { code: "PUERTAPUERTA", eventId: "ev", stationId: "gate" });
  assert.deepEqual(enLaPuerta.map((g) => [g.code, g.entries.length]), [["PUERTAPUERTA", 1]]);
  const enLaMesa = agruparParaSincronizar([vieja], { code: "MESAMESAMESA", eventId: "ev", stationId: "almuerzo" });
  assert.deepEqual(enLaMesa, []);
});

test("la cola en memoria lista lo pendiente de todos los puestos y eventos", async () => {
  const cola = await abrirCola();
  assert.equal(cola.persistent, false, "en Node no hay IndexedDB: la cola es en memoria");
  const a = entrada("ev-1", "gate", "PUERTAPUERTA", "AAAAAAAA");
  const b = entrada("ev-2", "gate", "OTRAPUERTAXX", "BBBBBBBB");
  const c = entrada("ev-1", "gate", "PUERTAPUERTA", "CCCCCCCC");
  for (const e of [a, b, c]) await cola.add(e);
  await cola.update(c.clientId, { status: "synced" });
  assert.deepEqual((await cola.listPendingAll()).map((e) => e.passId).sort(), ["AAAAAAAA", "BBBBBBBB"]);
});

test("de punta a punta en el servidor: la entrada de la puerta con el código de la puerta entra; con el de la mesa se rechazaba", async () => {
  const repo = getRepo();
  const datos = await eventoDePrueba(repo);
  const { pass } = await paseDePrueba(repo, datos);
  const codigos = await ensureStationCodes(datos.event, repo);
  const puerta = codigos.find((c) => c.kind === "gate").code;
  const mesa = codigos.find((c) => c.kind === "benefit").code;
  stellar.rumboPass.checkIn = async () => ({ hash: "h-puerta", ledger: 1, returnValue: 1, arrival: 1 });

  // la puerta registró una entrada sin conexión, y el voluntario cerró la puerta y abrió la mesa
  const pendiente = entrada(datos.event.id, "gate", puerta, pass.id);
  const [grupo] = agruparParaSincronizar([pendiente], { code: formatStationCode(mesa), eventId: datos.event.id, stationId: datos.lunch.id });
  assert.equal(grupo.code, puerta);
  assert.equal(grupo.actual, false);

  const sync = async (code) => {
    const auth = await authorizeScanRequest(repo, new Request("http://localhost/api/scan/sync", { method: "POST", body: JSON.stringify({ code }) }));
    assert.ok(auth.ok);
    return processScanItems(repo, datos.event, stationOf(auth.access), [pendiente]);
  };
  // lo que pasaba antes: con el código de la mesa, rechazada para siempre
  assert.equal((await sync(mesa))[0].status, "rejected");
  // con el código de su puesto, entra
  assert.equal((await sync(grupo.code))[0].status, "synced");
});
