// Toda lectura lleva el QR que se leyó y el servidor lo vuelve a comprobar, en la puerta, en las mesas y en los
// stands: sin él no se registra nada, y de él sale cómo se leyó la credencial (el QR del celular o el impreso),
// que queda en el espejo junto con la hora en que llegó al servidor. El panel lo dice en los dobles, el veredicto
// de un stand marca la impresa, y la constancia de asistencia muestra la menor entre la hora de la lectura y la
// de llegada: un escáner con el reloj adelantado no corre la constancia. Sin red: la cadena es de mentira.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba, qrImpreso } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { processScanItems, stationOf, UNVERIFIED_READ } = await import("../src/server/escaner.ts");
const { ensureStationCodes, resolveStationCode, getPanelState } = await import("../src/server/panel.ts");
const { verifyAttendance, certificateCode, listCertificateAttendees } = await import("../src/server/verificacion.ts");
const { getEventQrKeys } = await import("../src/server/qr-keys.ts");
const { buildLiveGrant } = await import("../src/server/qr.ts");
const { buildLivePayload } = await import("../src/lib/qr-live.ts");
const { verifyQrPayloadInBrowser } = await import("../src/lib/qr-verify.ts");
const { decideVerdict, GATE_STATION } = await import("../src/lib/escaner-api.ts");
const stands = await import("../src/server/stands.ts");
const { ContractError } = await import("../src/server/stellar.ts");

const repo = getRepo();
const ahora = () => new Date().toISOString();
let n = 0;
// La cadena de mentira, con las reglas del contrato: una entrada por cuenta y un canje por beneficio.
const hecho = new Set();
const unaVez = (clave, codigo, hash) => {
  if (hecho.has(clave)) throw new ContractError("El contrato rechazó la operación", codigo);
  hecho.add(clave);
  return { hash };
};
const chain = {
  checkIn: async (contractId, account) => unaVez(`e:${account}`, 4, `hc${++n}`),
  redeem: async (contractId, account, benefit) => unaVez(`c:${account}:${benefit}`, 6, `hr${++n}`),
  outcome: async () => "success",
};
const item = (action, passId, extra = {}) => ({ clientId: `v-${++n}`, action, passId, benefitId: null, scannedAt: ahora(), scannerId: "celu-1", ...extra });

/** Un evento con su puerta, su mesa del almuerzo y un stand, cada uno resuelto por su código. */
async function armar() {
  const d = await eventoDePrueba(repo);
  const stand = await stands.createStand(d.event, { name: "Acme" }, repo);
  const codigos = await ensureStationCodes(d.event, repo);
  const puesto = async (pred) => stationOf(await resolveStationCode(codigos.find(pred).code, repo));
  return { ...d, stand, puerta: await puesto((c) => c.kind === "gate"), mesa: await puesto((c) => c.kind === "benefit"), standPuesto: await puesto((c) => c.kind === "stand") };
}

test("en la puerta y en la mesa, una lectura sin QR, con un QR que no cierra o con el QR de otro pase no registra nada", async () => {
  const d = await armar();
  const ana = await paseDePrueba(repo, d, { name: "Ana Quiroga" });
  const beto = await paseDePrueba(repo, d, { name: "Beto Soria" });
  const qrBeto = await qrImpreso(d.event.id, beto.pass.id);
  const qrAna = await qrImpreso(d.event.id, ana.pass.id);
  const malas = [
    ["sin qr", item("checkin", ana.pass.id)],
    ["qr de otro pase", item("checkin", ana.pass.id, { qr: qrBeto })],
    ["qr tocado", item("checkin", ana.pass.id, { qr: qrAna.slice(0, -1) + (qrAna.endsWith("A") ? "B" : "A") })],
    ["qr mal formado", item("checkin", ana.pass.id, { qr: `${ana.pass.id}.AAAA` })],
  ];
  for (const [nombre, lectura] of malas) {
    const [r] = await processScanItems(repo, d.event, d.puerta, [lectura], chain);
    assert.deepEqual([r.status, r.error], ["rejected", UNVERIFIED_READ], nombre);
  }
  assert.equal((await repo.listCheckInsForPass(ana.pass.id)).length, 0);
  // Con el QR del pase entra, y el canje de la mesa igual: con el suyo sí, con el de otro no.
  const [entra] = await processScanItems(repo, d.event, d.puerta, [item("checkin", ana.pass.id, { qr: qrAna })], chain);
  assert.equal(entra.status, "synced");
  const [ajeno] = await processScanItems(repo, d.event, d.mesa, [item("redeem", ana.pass.id, { benefitId: d.lunch.id, qr: qrBeto })], chain);
  assert.deepEqual([ajeno.status, ajeno.error], ["rejected", UNVERIFIED_READ]);
  const [propio] = await processScanItems(repo, d.event, d.mesa, [item("redeem", ana.pass.id, { benefitId: d.lunch.id, qr: qrAna })], chain);
  assert.equal(propio.status, "synced");
  assert.equal((await repo.listRedemptionsForPass(ana.pass.id)).length, 1);
});

test("cómo se leyó la credencial queda en el espejo con la hora en que llegó, y el panel lo dice en los dobles", async () => {
  const d = await armar();
  const ana = await paseDePrueba(repo, d, { name: "Ana Quiroga" });
  const keys = await getEventQrKeys(d.event.id);
  const impreso = await qrImpreso(d.event.id, ana.pass.id);
  // El del celular, de hace una hora: la cola subió tarde, y la firma sigue valiendo.
  const vivo = await buildLivePayload(buildLiveGrant(ana.pass.id, keys), Date.now() - 3_600_000);
  const antes = Date.now();
  const [uno] = await processScanItems(repo, d.event, d.puerta, [item("checkin", ana.pass.id, { qr: vivo })], chain);
  const [dos] = await processScanItems(repo, d.event, d.puerta, [item("checkin", ana.pass.id, { qr: impreso, scannerId: "celu-2" })], chain);
  assert.deepEqual([uno.status, dos.status], ["synced", "duplicate"]);
  const filas = await repo.listCheckInsForPass(ana.pass.id);
  assert.deepEqual(filas.map((f) => f.via), ["live", "printed"]);
  for (const f of filas) assert.ok(Date.parse(f.receivedAt) >= antes - 1000 && Date.parse(f.receivedAt) <= Date.now() + 1000, "la hora de llegada la pone el servidor");

  await processScanItems(repo, d.event, d.mesa, [item("redeem", ana.pass.id, { benefitId: d.lunch.id, qr: impreso })], chain);
  await processScanItems(repo, d.event, d.mesa, [item("redeem", ana.pass.id, { benefitId: d.lunch.id, qr: impreso, scannerId: "celu-3" })], chain);
  await processScanItems(repo, d.event, d.standPuesto, [item("visit", ana.pass.id, { qr: vivo })], chain);
  assert.deepEqual((await repo.listRedemptionsForPass(ana.pass.id)).map((r) => r.via), ["printed", "printed"]);
  const [visita] = await stands.standScanVisits(d.stand.id);
  assert.equal(visita.passId, ana.pass.id);
  const panel = await getPanelState(d.event, repo);
  assert.deepEqual(
    panel.duplicates.map((x) => [x.kind, x.via]).sort(),
    [
      ["checkin", "printed"],
      ["redemption", "printed"],
    ],
  );
  // Lo que trajo el contraste con la cadena, y lo de antes, no dicen cómo se leyó.
  const cadena = await repo.recordCheckIn({ clientId: `chain:${ana.pass.id}:checkin`, eventId: d.event.id, passId: ana.pass.id, scannerId: "cadena" });
  assert.equal(cadena.via, null);
});

test("el veredicto de un stand marca la credencial impresa, como la puerta y las mesas", async () => {
  const d = await armar();
  const ana = await paseDePrueba(repo, d, { name: "Ana Quiroga" });
  const keys = await getEventQrKeys(d.event.id);
  const impresa = await verifyQrPayloadInBrowser(await qrImpreso(d.event.id, ana.pass.id), keys.publicKey, Date.now());
  const viva = await verifyQrPayloadInBrowser(await buildLivePayload(buildLiveGrant(ana.pass.id, keys), Date.now()), keys.publicKey, Date.now());
  const pase = { id: ana.pass.id, name: "Ana Quiroga", benefits: [], checkedInAt: null, redeemed: {} };
  assert.equal(decideVerdict(impresa, d.standPuesto, pase, undefined).via, "printed");
  assert.equal(decideVerdict(viva, d.standPuesto, pase, undefined).via, undefined);
  assert.equal(decideVerdict(impresa, GATE_STATION, pase, undefined).via, "printed");
  const yaVisito = decideVerdict(impresa, d.standPuesto, { ...pase, visited: { [d.stand.id]: ahora() } }, undefined);
  assert.deepEqual([yaVisito.kind, yaVisito.via], ["already", "printed"]);
});

test("la constancia de asistencia muestra la menor entre la hora de la lectura y la de llegada al servidor", async () => {
  const d = await armar();
  const temprano = await paseDePrueba(repo, d, { name: "Temprano Prueba" });
  const adelantado = await paseDePrueba(repo, d, { name: "Adelantado Prueba" });
  const keys = await getEventQrKeys(d.event.id);
  // Una cola que subió media hora después: vale la hora de la lectura.
  const hace = new Date(Date.now() - 30 * 60_000).toISOString();
  await processScanItems(repo, d.event, d.puerta, [item("checkin", temprano.pass.id, { qr: await qrImpreso(d.event.id, temprano.pass.id), scannedAt: hace })], chain);
  const v1 = await verifyAttendance(temprano.pass.id, certificateCode(temprano.pass.id, keys.credentialRoot), repo);
  assert.equal(Date.parse(v1.checkedInAt), Date.parse(hace));
  // Un escáner con el reloj cinco minutos adelantado: vale la hora en que llegó al servidor, no la de adelante.
  const adelante = new Date(Date.now() + 5 * 60_000).toISOString();
  const antes = Date.now();
  await processScanItems(repo, d.event, d.puerta, [item("checkin", adelantado.pass.id, { qr: await qrImpreso(d.event.id, adelantado.pass.id), scannedAt: adelante })], chain);
  const v2 = await verifyAttendance(adelantado.pass.id, certificateCode(adelantado.pass.id, keys.credentialRoot), repo);
  assert.ok(Date.parse(v2.checkedInAt) >= antes - 1000 && Date.parse(v2.checkedInAt) < Date.parse(adelante), `muestra ${v2.checkedInAt}`);
  assert.equal((await repo.getPass(adelantado.pass.id)).checkedInAt !== adelante, true, "la credencial tampoco queda con la hora de adelante");
  const certificados = await listCertificateAttendees(d.event, repo);
  assert.ok(Date.parse(certificados.find((c) => c.passId === adelantado.pass.id).checkedInAt) < Date.parse(adelante));
});
