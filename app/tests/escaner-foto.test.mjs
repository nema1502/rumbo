// La foto que baja cada puesto trae de cada pase solo lo que ese puesto necesita para decidir: la puerta, si entró;
// una mesa, si trae su beneficio y si ya lo canjeó. Ni los demás beneficios (quién ganó un sorteo), ni los demás
// canjes con su hora, ni la dieta de quien no come en esa mesa viajan a un celular que no los necesita. Sin red.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { buildSnapshot } = await import("../src/server/escaner.ts");
const { ensureStationCodes, resolveStationCode } = await import("../src/server/panel.ts");

const repo = getRepo();

test("la mesa baja solo su beneficio, su canje y la dieta de quien come ahí; la puerta, nada de eso", async () => {
  const d = await eventoDePrueba(repo);
  const polera = await repo.createBenefit({ eventId: d.event.id, name: "Polera", kind: "merch", station: "Mesa de poleras", stock: 3 });
  const premio = await repo.createBenefit({ eventId: d.event.id, name: "Premio mayor", kind: "prize", station: null });
  const soloPolera = await repo.createTicketType({ eventId: d.event.id, name: "Solo polera", priceUsdc: 0, contractId: "CPRUEBA" });
  await repo.linkBenefit(d.ticket.id, polera.id, 1);
  await repo.linkBenefit(soloPolera.id, polera.id, 0);
  const ana = await paseDePrueba(repo, d, { name: "Ana Rojas" });
  const beto = await paseDePrueba(repo, { event: d.event, ticket: soloPolera }, { name: "Beto Quispe" });
  const carla = await paseDePrueba(repo, d, { name: "Carla Mamani" });
  await repo.updatePass(ana.pass.id, { diet: "vegana, alergia al maní" });
  await repo.updatePass(beto.pass.id, { diet: "celíaco" });
  await repo.grantBenefit(carla.pass.id, premio.id, "raffle");
  // Ana ya entró y ya canjeó la polera; el almuerzo todavía no.
  await repo.recordCheckIn({ clientId: "f-e", eventId: d.event.id, passId: ana.pass.id, scannerId: "p", scannedAt: "2026-11-22T09:05:00-04:00" });
  await repo.recordRedemption({ clientId: "f-p", eventId: d.event.id, passId: ana.pass.id, benefitId: polera.id, scannerId: "m", scannedAt: "2026-11-22T10:00:00-04:00" });

  const codigos = await ensureStationCodes(d.event, repo);
  const foto = async (pred) => buildSnapshot(repo, await resolveStationCode(codigos.find(pred).code, repo));
  const de = (snap, pass) => snap.passes.find((p) => p.id === pass.id);

  const almuerzo = await foto((c) => c.kind === "benefit" && c.benefitId === d.lunch.id);
  assert.deepEqual([de(almuerzo, ana.pass).benefits, de(almuerzo, ana.pass).redeemed, de(almuerzo, ana.pass).diet], [[d.lunch.id], {}, "vegana, alergia al maní"], "Ana come acá: su beneficio, sin su canje de la polera, con su dieta");
  assert.deepEqual([de(almuerzo, beto.pass).benefits, de(almuerzo, beto.pass).redeemed, de(almuerzo, beto.pass).diet], [[], {}, null], "Beto no come acá: sin dieta, y el escáner sabe que su entrada no incluye el almuerzo");
  assert.deepEqual(de(almuerzo, carla.pass).benefits, [d.lunch.id], "el premio que ganó Carla no viaja a la mesa del almuerzo");
  const pasesDe = (snap) => JSON.stringify(snap.passes);
  assert.ok(!pasesDe(almuerzo).includes(polera.id) && !pasesDe(almuerzo).includes(premio.id) && !pasesDe(almuerzo).includes("celíaco"));
  assert.equal(de(almuerzo, ana.pass).checkedInAt !== null, true, "si entró sí viaja: sin pasar por la puerta no se canjea");

  const mesaPolera = await foto((c) => c.kind === "benefit" && c.benefitId === polera.id);
  assert.deepEqual([de(mesaPolera, ana.pass).benefits, Object.keys(de(mesaPolera, ana.pass).redeemed), de(mesaPolera, ana.pass).diet], [[polera.id], [polera.id], null], "la mesa de la polera ve su canje y ninguna dieta");
  assert.deepEqual([de(mesaPolera, beto.pass).benefits, de(mesaPolera, beto.pass).diet], [[polera.id], null]);
  assert.ok(!pasesDe(mesaPolera).includes("vegana") && !pasesDe(mesaPolera).includes(d.lunch.id));
  assert.deepEqual(mesaPolera.stock, { total: 3, left: 2, over: 0 });

  const puerta = await foto((c) => c.kind === "gate");
  for (const p of puerta.passes) assert.deepEqual([p.benefits, p.redeemed, p.diet ?? null], [[], {}, null], "la puerta no necesita beneficios, canjes ni dietas");
  assert.equal(de(puerta, ana.pass).checkedInAt !== null, true);
  assert.deepEqual([de(puerta, ana.pass).credential, de(puerta, ana.pass).team], ["attendee", null], "quién es, sí: el veredicto lo muestra");
  const texto = pasesDe(puerta);
  assert.ok(!texto.includes(premio.id) && !texto.includes(polera.id) && !texto.includes("vegana") && !texto.includes("celíaco"));
});
