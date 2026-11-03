// Prueba de humo contra el contrato rumbo-pass en la red de prueba, con los helpers de src/server/stellar.ts:
// crea una cuenta de un solo uso, la inscribe en el evento gratis, la hace entrar por la puerta, canjea
// el beneficio 0, mantiene vivo el pase con extend_ttl, lee status, attendees e info, y comprueba que la
// red rechaza entrar y canjear dos veces.
// Tarda alrededor de un minuto. No toca la base de la app.
import { APP_DIR, loadEnv } from "./lib/env.mjs";

process.chdir(APP_DIR);
loadEnv();

const { Keypair } = await import("@stellar/stellar-sdk");
const stellar = await import("../src/server/stellar.ts");

const contract = process.argv[2] ?? stellar.resolveContractId("free");
if (!contract) {
  console.error("No hay contrato: pasá el id como argumento o desplegá contracts/rumbo-pass.");
  process.exit(1);
}

const paso = (texto) => console.log(`\n> ${texto}`);
const t0 = Date.now();

paso(`El contrato ${contract}`);
const info = await stellar.rumboPass.info(contract);
console.log(info);

paso("Una cuenta de un solo uso, fondeada con friendbot");
const person = Keypair.random();
await stellar.fundWithFriendbot(person.publicKey());
console.log(person.publicKey());

paso("register(attendee): la firma la persona, la paga el servidor");
const registered = await stellar.rumboPass.register(contract, person.publicKey(), stellar.keypairSigner(person));
console.log(`pase número ${registered.number}, transacción ${registered.hash}`);

paso("status(who)");
console.log(await stellar.rumboPass.status(contract, person.publicKey()));

paso("check_in(attendee, by = gate): la firma la puerta");
const checkedIn = await stellar.rumboPass.checkIn(contract, person.publicKey());
console.log(`entró en el lugar ${checkedIn.arrival}, transacción ${checkedIn.hash}`);

paso("check_in otra vez: la red tiene que decir AlreadyCheckedIn (#4)");
try {
  await stellar.rumboPass.checkIn(contract, person.publicKey());
  console.log("ESTO NO TENDRIA QUE HABER PASADO: la red lo aceptó");
} catch (error) {
  console.log(stellar.isContractError(error, "AlreadyCheckedIn") ? `rechazado como se esperaba: ${error.message}` : `otro error: ${error.message}`);
}

if (info.benefits > 0) {
  paso("redeem(attendee, 0): la firma la puerta");
  const redeemed = await stellar.rumboPass.redeem(contract, person.publicKey(), 0);
  console.log(`canjeado, transacción ${redeemed.hash}`);

  paso("redeem otra vez: la red tiene que decir AlreadyRedeemed (#6)");
  try {
    await stellar.rumboPass.redeem(contract, person.publicKey(), 0);
    console.log("ESTO NO TENDRIA QUE HABER PASADO: la red lo aceptó");
  } catch (error) {
    console.log(stellar.isContractError(error, "AlreadyRedeemed") ? `rechazado como se esperaba: ${error.message}` : `otro error: ${error.message}`);
  }
}

paso("extend_ttl([la cuenta, una sin pase]): sin firma, mantiene vivo el evento y el pase; devuelve cuántos pases extendió");
const extended = await stellar.rumboPass.extendTtl(contract, [person.publicKey(), Keypair.random().publicKey()]);
console.log(extended.extended === 1 ? `extendió 1 pase, transacción ${extended.hash}` : `ESTO NO TENDRIA QUE HABER PASADO: extendió ${extended.extended}`);

paso("status(who) al final");
console.log(await stellar.rumboPass.status(contract, person.publicKey()));

paso("attendees(): quienes entraron, en orden de llegada");
const attendees = await stellar.rumboPass.attendees(contract);
console.log(`${attendees.length} en la lista; la última es la nuestra: ${attendees.at(-1) === person.publicKey()}`);

console.log(`\nListo en ${Math.round((Date.now() - t0) / 1000)} s.`);
