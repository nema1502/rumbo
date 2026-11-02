// Pases de prueba para ver el panel con gente: doce personas con su pase (inscripción gratis o con
// almuerzo), varias que ya entraron, almuerzos y poleras canjeados, un premio del sorteo entregado y
// dos dobles. Solo toca el espejo en la base, no la red, y se puede correr las veces que haga falta
// (no duplica nada).
//   --cadena   además hace entrar y canjear en el contrato a la persona de ejemplo del seed (--demo),
//              sin tocar el espejo: así "Actualizar desde la cadena" tiene algo que traer. Tarda unos
//              segundos y necesita las llaves del servidor en .env.local.
// Uso: node scripts/panel-pases-prueba.mjs [slug] [--cadena]
import { APP_DIR, loadEnv } from "./lib/env.mjs";

process.chdir(APP_DIR);
loadEnv();

const { getRepo } = await import("../src/server/repo.ts");

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--")) ?? "hackaton-comunidad";
const repo = getRepo();
const event = await repo.getEventBySlug(slug);
if (!event) {
  console.error(`No hay ningún evento con slug "${slug}". Para crear el de muestra: pnpm seed`);
  process.exit(1);
}

const tickets = await repo.listTicketTypes(event.id);
const freeTicket = tickets.find((t) => t.priceUsdc === 0) ?? tickets[0];
const paidTicket = tickets.find((t) => t.priceUsdc > 0) ?? freeTicket;
const benefits = await repo.listBenefits(event.id);
const lunch = benefits.find((b) => b.kind === "lunch") ?? null;
const merch = benefits.find((b) => b.kind === "merch") ?? null;
const prize = benefits.find((b) => b.kind === "prize") ?? null;

// Doce personas de prueba. El correo es lo que las identifica entre corridas.
const PEOPLE = [
  "Bruno Vaca", "Carla Rojas", "Diego Suárez", "Elena Paz", "Fabián Torrico", "Gabriela Mendoza",
  "Hugo Flores", "Inés Camacho", "Julián Ortiz", "Karina Soto", "Lucas Arancibia", "Marta Gutiérrez",
].map((name, i) => ({ name, email: `prueba${String(i + 1).padStart(2, "0")}@example.com` }));

const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
let created = 0;

for (const [i, who] of PEOPLE.entries()) {
  const person = await repo.upsertPerson(who);
  let pass = await repo.findPass(event.id, person.id);
  if (!pass) {
    // Una de cada tres con almuerzo; las dos últimas quedaron a mitad del pago.
    const ticket = i % 3 === 0 ? paidTicket : freeTicket;
    const pending = i >= 10;
    pass = await repo.createPass({ eventId: event.id, personId: person.id, ticketTypeId: ticket.id, status: pending ? "pending" : "active" });
    if (!pending) await repo.grantTicketBenefits(pass.id);
    created++;
  }
  if (pass.status === "pending") continue;

  const scannedAt = minutesAgo(90 - i * 5);
  const entered = [0, 1, 2, 3, 4, 6].includes(i);
  if (entered) {
    // La entrada, ya sincronizada con el contrato (el clientId fijo hace que repetir no duplique).
    const checkIn = await repo.recordCheckIn({ clientId: `prueba:${who.email}:entrada`, eventId: event.id, passId: pass.id, scannerId: "puerta-1", scannedAt });
    await repo.markCheckIn(checkIn.id, { synced: true });
    if (pass.status !== "checked_in") pass = await repo.updatePass(pass.id, { status: "checked_in", checkedInAt: scannedAt });
  }
  if (i === 1) {
    // Carla pasó dos veces por la puerta: el segundo escaneo es un doble.
    const twice = await repo.recordCheckIn({ clientId: `prueba:${who.email}:entrada-doble`, eventId: event.id, passId: pass.id, scannerId: "puerta-2", scannedAt: minutesAgo(80) });
    await repo.markCheckIn(twice.id, { duplicate: true, synced: true });
  }

  const granted = await repo.listPassBenefits(pass.id);
  const has = (benefit) => benefit && granted.some((g) => g.id === benefit.id);
  const redeem = async (benefit, suffix, mark, when) => {
    const r = await repo.recordRedemption({ clientId: `prueba:${who.email}:${suffix}`, eventId: event.id, passId: pass.id, benefitId: benefit.id, scannerId: "almuerzo-1", scannedAt: when });
    await repo.markRedemption(r.id, mark);
  };
  if (entered && has(lunch) && [0, 3, 6].includes(i)) await redeem(lunch, "almuerzo", { synced: true }, minutesAgo(40 - i));
  if (i === 0 && lunch) await redeem(lunch, "almuerzo-doble", { duplicate: true, synced: true }, minutesAgo(30));
  if (entered && has(merch) && [2, 4].includes(i)) await redeem(merch, "polera", { synced: true }, minutesAgo(35 - i));
  // Un canje que el escáner registró sin red y todavía no mandó al contrato.
  if (i === 6 && has(merch)) await redeem(merch, "polera-pendiente", { synced: false }, minutesAgo(3));

  if (prize && [1, 4].includes(i)) {
    await repo.grantBenefit(pass.id, prize.id, "raffle");
    if (i === 1) await redeem(prize, "premio", { synced: true }, minutesAgo(10));
  }
}

console.log(`${PEOPLE.length} personas de prueba en "${event.name}" (${created} pases nuevos).`);

if (args.includes("--cadena")) {
  const { rumboPass, isContractError } = await import("../src/server/stellar.ts");
  const ana = await repo.getPersonByEmail("ana@example.com");
  const pass = ana ? await repo.findPass(event.id, ana.id) : null;
  if (!pass?.account) {
    console.log("Sin persona de ejemplo con cuenta: corré antes pnpm seed -- --demo");
  } else {
    const ticket = tickets.find((t) => t.id === pass.ticketTypeId);
    const contract = ticket?.contractId ?? event.contractId;
    const tolerate = async (label, fn) => {
      try {
        const result = await fn();
        console.log(`  ${label}: hecho (${result.hash})`);
      } catch (error) {
        if (isContractError(error) && (error.is("AlreadyCheckedIn") || error.is("AlreadyRedeemed"))) console.log(`  ${label}: ya estaba hecho en la cadena`);
        else throw error;
      }
    };
    console.log(`En la cadena, sin tocar el espejo (${ana.name}, pase ${pass.id}):`);
    await tolerate("entrada por la puerta", () => rumboPass.checkIn(contract, pass.account));
    await tolerate("canje del beneficio 0", () => rumboPass.redeem(contract, pass.account, 0));
    console.log('Ahora "Actualizar desde la cadena" en el panel tiene que traer esa entrada y ese canje.');
  }
}
