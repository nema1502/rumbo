// Crea el evento de muestra, "Hackatón de la comunidad", con sus dos entradas (inscripción gratis y
// "Con almuerzo" a 10 USDC de prueba) y sus tres beneficios, apuntando a los contratos del despliegue
// (contracts/rumbo-pass/deploy/testnet.json: el gratis y el pago). Se puede correr las veces que haga falta.
//   --demo               agrega a una persona de ejemplo con su pase, su cuenta de prueba y su inscripción en el contrato
//   --refresh            vuelve a apuntar las entradas a los contratos del despliegue actual (si se volvió a desplegar)
//   --contratos-propios  despliega contratos nuevos solo para este evento, en vez de usar los compartidos del
//                        despliegue: así cada base (la de quien evalúa, la de producción) tiene los suyos
//   --contratos-nuevos   lo mismo (el nombre que usa el e2e)
import { APP_DIR, loadEnv } from "./lib/env.mjs";

process.chdir(APP_DIR);
loadEnv();

const { Keypair } = await import("@stellar/stellar-sdk");
const { getRepo } = await import("../src/server/repo.ts");
const { readDeployInfo } = await import("../src/server/stellar.ts");

const repo = getRepo();
const deploy = readDeployInfo();
const freeContract = deploy?.events.free?.contract ?? process.env.RUMBO_CONTRACT_ID ?? null;
const paidContract = deploy?.events.paid?.contract ?? null;
const organizerAccount = deploy?.accounts.organizer ?? (process.env.STELLAR_ORGANIZER_SECRET ? Keypair.fromSecret(process.env.STELLAR_ORGANIZER_SECRET).publicKey() : null);
const refresh = process.argv.includes("--refresh");
const SLUG = "hackaton-comunidad";

let event = await repo.getEventBySlug(SLUG);
if (!event) {
  event = await repo.createEvent({
    slug: SLUG,
    name: "Hackatón de la comunidad",
    description: "Un día entero para construir en equipo. Inscribite gratis, o sumá el almuerzo.",
    startsAt: "2026-11-22T09:00:00-04:00",
    endsAt: "2026-11-22T19:00:00-04:00",
    timezone: "America/La_Paz",
    place: "Santa Cruz de la Sierra",
    venue: null,
    organizerName: "La comunidad",
    organizerAccount,
    contractId: freeContract,
    capacity: 200,
  });
  console.log(`Evento creado: ${event.name} (/e/${event.slug})`);
} else {
  const patch = {};
  if ((!event.contractId || refresh) && freeContract && event.contractId !== freeContract) patch.contractId = freeContract;
  if (!event.organizerAccount && organizerAccount) patch.organizerAccount = organizerAccount;
  if (Object.keys(patch).length > 0) event = await repo.updateEvent(event.id, patch);
  console.log(`El evento ya existía: ${event.name} (/e/${event.slug})`);
}

let tickets = await repo.listTicketTypes(event.id);
if (tickets.length === 0) {
  await repo.createTicketType({ eventId: event.id, name: "Inscripción", priceUsdc: 0, contractId: freeContract, sortOrder: 0 });
  await repo.createTicketType({ eventId: event.id, name: "Con almuerzo", priceUsdc: 10, contractId: paidContract, sortOrder: 1 });
  tickets = await repo.listTicketTypes(event.id);
  console.log("Entradas: Inscripción (gratis) y Con almuerzo (10 USDC de prueba)");
}
const freeTicket = tickets.find((t) => t.priceUsdc === 0) ?? tickets[0];
const paidTicket = tickets.find((t) => t.priceUsdc > 0) ?? null;
for (const [ticket, contract] of [[freeTicket, freeContract], [paidTicket, paidContract]]) {
  if (ticket && contract && (!ticket.contractId || refresh) && ticket.contractId !== contract) {
    await repo.updateTicketType(ticket.id, { contractId: contract });
    console.log(`La entrada "${ticket.name}" apunta ahora al contrato ${contract}`);
  }
}

let benefits = await repo.listBenefits(event.id);
if (benefits.length === 0) {
  // El almuerzo sin día (el evento es un domingo); la polera con tope, así el panel muestra "Quedan N".
  await repo.createBenefit({ eventId: event.id, name: "Almuerzo", kind: "lunch", station: "Mesa del almuerzo", sortOrder: 0 });
  await repo.createBenefit({ eventId: event.id, name: "Polera talle M", kind: "merch", station: "Stand de la comunidad", sortOrder: 1, stock: 25 });
  await repo.createBenefit({ eventId: event.id, name: "Premio del sorteo", kind: "prize", station: "Escenario", sortOrder: 2 });
  benefits = await repo.listBenefits(event.id);
  const lunch = benefits.find((b) => b.kind === "lunch");
  const shirt = benefits.find((b) => b.kind === "merch");
  // Los números con que se canjea cada beneficio en su contrato. En el despliegue de muestra el evento
  // pago tiene dos beneficios (0 el almuerzo, 1 la polera) y el gratis uno (0 la polera).
  if (paidTicket) {
    await repo.linkBenefit(paidTicket.id, lunch.id, 0);
    await repo.linkBenefit(paidTicket.id, shirt.id, 1);
  }
  await repo.linkBenefit(freeTicket.id, shirt.id, 0);
  console.log("Beneficios: almuerzo (con la entrada paga), polera talle M (todos, 25 en total), premio del sorteo (se otorga después)");
}

// Contratos propios: los crea networkProvisioner (el mismo camino que usa el kit al publicar un evento), con el
// WASM del despliegue de muestra y el cupo del evento. Se despliegan una sola vez: si una entrada ya apunta a un
// contrato que no es de los compartidos, se deja; con --refresh además, se renuevan. Son dos transacciones.
if (process.argv.includes("--contratos-propios") || process.argv.includes("--contratos-nuevos")) {
  const { networkProvisioner } = await import("../src/server/kit/publicar.ts");
  const shared = new Set([freeContract, paidContract].filter(Boolean));
  for (const ticket of [freeTicket, paidTicket]) {
    if (!ticket) continue;
    if (ticket.contractId && !shared.has(ticket.contractId) && !refresh) {
      console.log(`La entrada "${ticket.name}" ya tiene su propio contrato: ${ticket.contractId}`);
      continue;
    }
    // Cuántos canjes tiene el contrato: los beneficios enlazados a la entrada (0 el almuerzo, 1 la polera).
    const benefitsCount = (await repo.listTicketTypeBenefits(ticket.id)).length;
    console.log(`Desplegando el contrato propio de "${ticket.name}" en la red de prueba...`);
    const contractId = await networkProvisioner.deploy({ price: ticket.priceUsdc, capacity: event.capacity ?? 200, benefits: benefitsCount, organizerAccount: event.organizerAccount });
    await repo.updateTicketType(ticket.id, { contractId });
    if (ticket.priceUsdc === 0) event = await repo.updateEvent(event.id, { contractId });
    console.log(`La entrada "${ticket.name}" apunta ahora a su propio contrato ${contractId}`);
  }
  tickets = await repo.listTicketTypes(event.id);
}

if (process.argv.includes("--demo")) {
  const { getAccountProvider } = await import("../src/server/accounts.ts");
  const { buildPrintedPayload } = await import("../src/server/qr.ts");
  const { getEventQrKeys } = await import("../src/server/qr-keys.ts");
  const { rumboPass, isContractError } = await import("../src/server/stellar.ts");

  const person = await repo.upsertPerson({ name: "Ana Quiroga", email: "ana@example.com" });
  let pass = await repo.findPass(event.id, person.id);
  if (!pass) {
    pass = await repo.createPass({ eventId: event.id, personId: person.id, ticketTypeId: freeTicket.id, status: "pending" });
    await repo.grantTicketBenefits(pass.id);
  }
  const accounts = getAccountProvider(repo);
  console.log("Creando la cuenta de prueba de la persona de ejemplo (friendbot, línea de confianza y saldo)...");
  const account = await accounts.getOrCreateForPerson(person.id);
  if (pass.status === "pending") {
    const contract = freeTicket.contractId ?? event.contractId;
    let txHash = null;
    let chainNumber = null;
    if (contract) {
      try {
        const result = await rumboPass.register(contract, account, await accounts.authSigner(person.id));
        txHash = result.hash;
        chainNumber = result.number;
        console.log(`Inscripta en el contrato: pase número ${chainNumber}, transacción ${txHash}`);
      } catch (error) {
        if (isContractError(error, "AlreadyHasPass")) console.log("La cuenta ya tenía su pase en el contrato.");
        else throw error;
      }
    } else {
      console.log("Sin contrato desplegado: el pase queda activo solo en la base.");
    }
    pass = await repo.updatePass(pass.id, { account, status: "active", txHash, chainNumber });
  }
  const qr = buildPrintedPayload(pass.id, await getEventQrKeys(event.id));
  console.log(`Persona de ejemplo: ${person.name} <${person.email}>\n  Pase: ${pass.id}  Cuenta: ${account}\n  QR de la credencial impresa: ${qr}`);
}

const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
console.log(`
Listo. Con pnpm dev:
  El evento:    ${base}/e/${event.slug}
  El panel:     ${base}/admin/${event.slug}
  El escáner:   ${base}/scan
`);

// Con Postgres el pool deja las conexiones abiertas un rato: se cierra, así el script termina enseguida.
const { closeDb } = await import("../src/server/base/index.ts");
await closeDb();
