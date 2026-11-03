// Cada clientId vale para su pase, su evento y su beneficio: quien manda un clientId ya usado por otro
// registro no recibe "synced" ni "duplicate" ajenos, y lo que pidió no queda como si se hubiera hecho.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const stellar = await import("../src/server/stellar.ts");
const { processScanItems } = await import("../src/server/escaner.ts");
const { GATE_STATION } = await import("../src/lib/escaner-api.ts");

const repo = getRepo();
let llamadas;
beforeEach(() => {
  llamadas = [];
  // la red de mentira: anota cada llamada y contesta con un hash nuevo
  stellar.rumboPass.checkIn = async (contractId, account) => {
    llamadas.push(["checkIn", account]);
    return { hash: `h-${llamadas.length}`, ledger: 1, returnValue: 1, arrival: 1 };
  };
  stellar.rumboPass.redeem = async (contractId, account, benefit) => {
    llamadas.push(["redeem", account, benefit]);
    return { hash: `h-${llamadas.length}`, ledger: 1, returnValue: undefined };
  };
});

const ahora = () => new Date().toISOString();
const entrada = (clientId, passId) => ({ clientId, action: "checkin", passId, benefitId: null, scannedAt: ahora(), scannerId: "prueba" });
const canje = (clientId, passId, benefitId) => ({ clientId, action: "redeem", passId, benefitId, scannedAt: ahora(), scannerId: "prueba" });

test("una entrada con el clientId de otro pase se rechaza y no le da el registro ajeno", async () => {
  const datos = await eventoDePrueba(repo);
  const ana = await paseDePrueba(repo, datos, { name: "Ana" });
  const beto = await paseDePrueba(repo, datos, { name: "Beto" });
  const [primera] = await processScanItems(repo, datos.event, GATE_STATION, [entrada("id-1", ana.pass.id)]);
  assert.equal(primera.status, "synced");

  const [ajena] = await processScanItems(repo, datos.event, GATE_STATION, [entrada("id-1", beto.pass.id)]);
  assert.equal(ajena.status, "rejected");
  assert.equal(ajena.txHash, null);
  assert.equal(llamadas.length, 1, "no se manda nada al contrato por el pedido ajeno");
  assert.equal((await repo.listCheckInsForPass(beto.pass.id)).length, 0);
  assert.equal((await repo.getPass(beto.pass.id)).status, "active");
  const deAna = await repo.listCheckInsForPass(ana.pass.id);
  assert.equal(deAna.length, 1);
  assert.ok(deAna[0].synced && deAna[0].txHash === primera.txHash);
});

test("el mismo clientId con el mismo pase sigue siendo un reintento que no duplica", async () => {
  const datos = await eventoDePrueba(repo);
  const ana = await paseDePrueba(repo, datos);
  const [primera] = await processScanItems(repo, datos.event, GATE_STATION, [entrada("id-2", ana.pass.id)]);
  const [otra] = await processScanItems(repo, datos.event, GATE_STATION, [entrada("id-2", ana.pass.id)]);
  assert.equal(otra.status, "synced");
  assert.equal(otra.txHash, primera.txHash);
  assert.equal(llamadas.length, 1);
});

test("un clientId usado en otro evento se rechaza", async () => {
  const uno = await eventoDePrueba(repo);
  const dos = await eventoDePrueba(repo);
  const ana = await paseDePrueba(repo, uno);
  const caro = await paseDePrueba(repo, dos);
  await processScanItems(repo, uno.event, GATE_STATION, [entrada("id-3", ana.pass.id)]);
  const [ajena] = await processScanItems(repo, dos.event, GATE_STATION, [entrada("id-3", caro.pass.id)]);
  assert.equal(ajena.status, "rejected");
  assert.equal(llamadas.length, 1);
  assert.equal((await repo.listCheckIns(dos.event.id)).length, 0);
});

test("un canje con el clientId de otro pase o de otro beneficio se rechaza", async () => {
  const datos = await eventoDePrueba(repo);
  const polera = await repo.createBenefit({ eventId: datos.event.id, name: "Polera", kind: "merch", station: "Stand" });
  await repo.linkBenefit(datos.ticket.id, polera.id, 1);
  const ana = await paseDePrueba(repo, datos, { name: "Ana" });
  const beto = await paseDePrueba(repo, datos, { name: "Beto" });
  const mesa = { id: datos.lunch.id, kind: "benefit", name: "Almuerzo", place: null };
  const stand = { id: polera.id, kind: "benefit", name: "Polera", place: null };
  await processScanItems(repo, datos.event, GATE_STATION, [entrada("e-ana", ana.pass.id), entrada("e-beto", beto.pass.id)]);

  const [almuerzo] = await processScanItems(repo, datos.event, mesa, [canje("c-1", ana.pass.id, datos.lunch.id)]);
  assert.equal(almuerzo.status, "synced");
  const [otroPase] = await processScanItems(repo, datos.event, mesa, [canje("c-1", beto.pass.id, datos.lunch.id)]);
  assert.equal(otroPase.status, "rejected");
  const [otroBeneficio] = await processScanItems(repo, datos.event, stand, [canje("c-1", ana.pass.id, polera.id)]);
  assert.equal(otroBeneficio.status, "rejected");
  assert.equal(llamadas.filter((l) => l[0] === "redeem").length, 1);
  assert.equal((await repo.listRedemptionsForPass(beto.pass.id)).length, 0);
  assert.equal((await repo.listRedemptionsForPass(ana.pass.id)).length, 1);
});
