// Prepara el entorno de desarrollo en la red de prueba de Stellar:
//   1. genera en .env.local las llaves que falten (servidor, puerta, emisor del USDC de prueba, quien organiza, Rumbo),
//   2. fondea cada cuenta con friendbot,
//   3. despliega el USDC de prueba como contrato de activo (SAC) con stellar-cli, si no está,
//   4. deja con línea de confianza a quien organiza y a Rumbo, para que puedan recibir el pago.
// Se puede correr las veces que haga falta: solo hace lo que falta. Nunca toca otra red que la de prueba.
// Si el despliegue del contrato (contracts/rumbo-pass/deploy/testnet.json) ya existe, usa su activo y sus cuentas.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { APP_DIR, loadEnv, upsertEnv } from "./lib/env.mjs";

process.chdir(APP_DIR);
loadEnv();

if ((process.env.STELLAR_NETWORK || "testnet") !== "testnet") {
  console.error(`Este script solo trabaja con la red de prueba (STELLAR_NETWORK=${process.env.STELLAR_NETWORK}).`);
  process.exit(1);
}

const { Asset, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder, rpc, xdr } = await import("@stellar/stellar-sdk");
const stellar = await import("../src/server/stellar.ts");

const STELLAR_CLI = process.env.STELLAR_CLI || "C:\\Users\\ASUS\\AppData\\Local\\Programs\\stellar-cli\\stellar.exe";
const deploy = stellar.readDeployInfo();

const KEYS = [
  ["STELLAR_SPONSOR_SECRET", "El servidor (paga las comisiones de red)", "sponsor"],
  ["STELLAR_GATE_SECRET", "La puerta (firma check-ins y canjes)", "gate"],
  ["STELLAR_ISSUER_SECRET", "El emisor del USDC de prueba", null],
  ["STELLAR_ORGANIZER_SECRET", "Quien organiza el evento de muestra", "organizer"],
  ["STELLAR_TREASURY_SECRET", "Rumbo (recibe la comisión)", "treasury"],
];

// 1. Las llaves que falten
const generated = {};
for (const [name] of KEYS) {
  if (!process.env[name]) generated[name] = Keypair.random().secret();
}
if (Object.keys(generated).length > 0) {
  upsertEnv(generated);
  console.log(`Generé ${Object.keys(generated).join(", ")} en .env.local`);
}
const keypairs = Object.fromEntries(KEYS.map(([name]) => [name, Keypair.fromSecret(process.env[name])]));

// Si el contrato ya se desplegó con otras cuentas, conviene saberlo: la app firma con las de .env.local.
for (const [name, description, deployKey] of KEYS) {
  const expected = deployKey ? deploy?.accounts?.[deployKey] : deploy?.asset?.issuer;
  if (expected && expected !== keypairs[name].publicKey()) {
    console.warn(`Ojo: ${description} en .env.local es ${keypairs[name].publicKey()} y el despliegue del contrato usa ${expected}.`);
  }
}

// 2. Fondear con friendbot
for (const [name, description] of KEYS) {
  const keypair = keypairs[name];
  const funded = await stellar.fundWithFriendbot(keypair.publicKey());
  console.log(`${funded ? "Fondeada  " : "Ya existía"}  ${description}: ${keypair.publicKey()}`);
}

// 3. El USDC de prueba como contrato de activo
const code = deploy?.asset?.code || process.env.STELLAR_ASSET_CODE || "USDC";
const issuer = keypairs.STELLAR_ISSUER_SECRET;
const asset = new Asset(code, issuer.publicKey());
const sacId = asset.contractId(Networks.TESTNET);
upsertEnv({ STELLAR_ASSET_CODE: code, STELLAR_ASSET_ISSUER: issuer.publicKey(), STELLAR_ASSET_CONTRACT: sacId });

async function sacExists() {
  try {
    await stellar.getRpc().getContractData(sacId, xdr.ScVal.scvLedgerKeyContractInstance(), rpc.Durability.Persistent);
    return true;
  } catch {
    return false;
  }
}

function deploySacWithCli() {
  if (!existsSync(STELLAR_CLI)) return false;
  const result = spawnSync(
    STELLAR_CLI,
    ["contract", "asset", "deploy", "--asset", `${code}:${issuer.publicKey()}`, "--source-account", process.env.STELLAR_SPONSOR_SECRET, "--network", "testnet"],
    { encoding: "utf8" },
  );
  if (result.status === 0) return true;
  if (/already|exist/i.test(result.stderr || "")) return true;
  console.warn(`stellar-cli no pudo desplegar el activo: ${(result.stderr || "").trim().slice(0, 300)}`);
  return false;
}

async function deploySacWithSdk() {
  const server = stellar.getRpc();
  const sponsor = stellar.getSponsor();
  const account = await server.getAccount(sponsor.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.createStellarAssetContract({ asset }))
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(sponsor);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(`La red no aceptó el despliegue del activo: ${sent.errorResult?.result.type}`);
  const final = await server.pollTransaction(sent.hash, { attempts: 40 });
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`El despliegue del activo no se confirmó (${final.status})`);
}

if (await sacExists()) {
  console.log(`Ya existía  El contrato del USDC de prueba: ${sacId}`);
} else {
  if (!deploySacWithCli()) await deploySacWithSdk();
  console.log(`Desplegado  El contrato del USDC de prueba: ${sacId}`);
}

// 4. Líneas de confianza de quien recibe pagos
const receivers = [keypairs.STELLAR_ORGANIZER_SECRET, keypairs.STELLAR_TREASURY_SECRET];
const withoutTrustline = [];
for (const keypair of receivers) {
  if (!(await stellar.hasTrustline(keypair.publicKey(), asset))) withoutTrustline.push(keypair);
}
if (withoutTrustline.length > 0) {
  await stellar.submitClassic(
    withoutTrustline.map((keypair) => Operation.changeTrust({ asset, source: keypair.publicKey() })),
    withoutTrustline,
  );
  console.log(`Agregada    La línea de confianza al ${code} de prueba para ${withoutTrustline.length} cuenta(s)`);
} else {
  console.log(`Ya tenían   La línea de confianza al ${code} de prueba: quien organiza y Rumbo`);
}

// Resumen
const events = Object.entries(deploy?.events ?? {});
console.log(`
Listo. Lo que hay en .env.local (las llaves secretas no salen de ahí):

  Servidor (sponsor):         ${keypairs.STELLAR_SPONSOR_SECRET.publicKey()}
  Puerta (gate):              ${keypairs.STELLAR_GATE_SECRET.publicKey()}
  Quien organiza (organizer): ${keypairs.STELLAR_ORGANIZER_SECRET.publicKey()}
  Rumbo (treasury):           ${keypairs.STELLAR_TREASURY_SECRET.publicKey()}
  USDC de prueba:             ${code}:${issuer.publicKey()}
  Su contrato (SAC):          ${sacId}
  Contratos rumbo-pass:       ${events.length ? events.map(([name, e]) => `${name} ${e.contract}`).join("\n                              ") : "todavía no (contracts/rumbo-pass/deploy/testnet.json)"}

Después: pnpm seed (el evento de muestra) y pnpm dev.
`);
