// Hablar con la red de prueba de Stellar: RPC y Horizon, la cuenta patrocinadora que paga las
// comisiones de todo, y los helpers del contrato rumbo-pass (contracts/rumbo-pass). Nada de acá
// corre en el navegador.
//
// Cómo se paga una operación del contrato: la transacción la arma y la firma el servidor (la cuenta
// patrocinadora es la fuente y paga la comisión); lo que el contrato le pide a la persona
// (register, buy) se firma como autorización aparte, con su cuenta. Así ninguna cuenta de persona
// necesita XLM. check_in y redeem los firma la cuenta de puerta (gate).
//
// Cada evento tiene su propio contrato, con el precio fijo: por eso los helpers reciben el id del
// contrato (viene del tipo de entrada, o del evento). El despliegue de muestra deja dos, uno gratis
// y uno pago, en contracts/rumbo-pass/deploy/testnet.json.
import fs from "node:fs";
import path from "node:path";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  inspectAuthEntry,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import { serialized } from "./compartido.ts";
import { assertTestnet, friendbotUrl, getEnv, horizonUrl, repoRoot, requireEnv, rpcUrl } from "./env.ts";

export const NETWORK_PASSPHRASE = Networks.TESTNET;

/** Los nombres de las funciones del contrato, en un solo lugar. */
export const CONTRACT_FN = {
  register: "register",
  buy: "buy",
  checkIn: "check_in",
  redeem: "redeem",
  extendTtl: "extend_ttl",
  status: "status",
  attendees: "attendees",
  info: "info",
} as const;
export type ContractFn = (typeof CONTRACT_FN)[keyof typeof CONTRACT_FN];

/** Los errores del contrato. Los códigos son parte de la interfaz y no se renumeran. */
export const CONTRACT_ERRORS = {
  1: "NoPass",
  2: "AlreadyHasPass",
  3: "SoldOut",
  4: "AlreadyCheckedIn",
  5: "NotCheckedIn",
  6: "AlreadyRedeemed",
  7: "NoSuchBenefit",
  8: "NotAuthorized",
  9: "NotFree",
  10: "NotPaid",
  11: "InvalidPrice",
  12: "InvalidFee",
  13: "InvalidCapacity",
  14: "InvalidBenefits",
  15: "NotConfigured",
} as const;
export type ContractErrorCode = keyof typeof CONTRACT_ERRORS;
export type ContractErrorName = (typeof CONTRACT_ERRORS)[ContractErrorCode];

/**
 * Los errores del contrato con los que no tiene sentido volver a intentar un registro del escáner: el pase
 * no existe en la cadena, el beneficio no está, la puerta no es la del evento o el contrato no se configuró.
 * Un registro del espejo con uno de estos errores quedó rechazado, no pendiente de sincronizar.
 */
export const PERMANENT_CONTRACT_ERRORS: ReadonlySet<string> = new Set<ContractErrorName>(["NoPass", "NoSuchBenefit", "NotAuthorized", "NotConfigured"]);

export function isPermanentContractError(error: string | null | undefined): boolean {
  return Boolean(error && PERMANENT_CONTRACT_ERRORS.has(error));
}

/** Lo que devuelve status(who). */
export interface PassStatusOnChain {
  has_pass: boolean;
  number: number;
  checked_in: boolean;
  /** Los beneficios canjeados, en el orden en que se canjearon. */
  redeemed: number[];
}

/** Lo que devuelve info(). El precio está en la unidad mínima del activo (siete decimales en USDC). */
export interface EventInfoOnChain {
  organizer: string;
  treasury: string;
  gate: string;
  asset: string;
  price: bigint;
  fee_bps: number;
  capacity: number;
  benefits: number;
  issued: number;
  checked_in: number;
}

/** USDC tiene siete decimales en Stellar: 10 USDC son 100000000. */
export const ASSET_DECIMALS = 7;
export function toStroops(amount: number | string): bigint {
  const [whole = "0", fraction = ""] = String(amount).split(".");
  return BigInt(whole) * 10n ** BigInt(ASSET_DECIMALS) + BigInt(fraction.padEnd(ASSET_DECIMALS, "0").slice(0, ASSET_DECIMALS));
}
export function fromStroops(stroops: bigint | number | string): number {
  return Number(BigInt(stroops)) / 10 ** ASSET_DECIMALS;
}

// ---------- Clientes y cuentas del servidor ----------

declare global {
  var __rumboRpc: rpc.Server | undefined;
  var __rumboHorizon: Horizon.Server | undefined;
  var __rumboSponsorQueue: Promise<unknown> | undefined;
}

export function getRpc(): rpc.Server {
  assertTestnet();
  globalThis.__rumboRpc ??= new rpc.Server(rpcUrl(), { allowHttp: rpcUrl().startsWith("http://") });
  return globalThis.__rumboRpc;
}

export function getHorizon(): Horizon.Server {
  assertTestnet();
  globalThis.__rumboHorizon ??= new Horizon.Server(horizonUrl(), { allowHttp: horizonUrl().startsWith("http://") });
  return globalThis.__rumboHorizon;
}

/** La cuenta del servidor: paga las comisiones de red y es la fuente de todas las transacciones. */
export function getSponsor(): Keypair {
  assertTestnet();
  return Keypair.fromSecret(requireEnv("STELLAR_SPONSOR_SECRET"));
}

/** La puerta: firma check_in y redeem. Si no hay STELLAR_GATE_SECRET, es la misma patrocinadora. */
export function getGate(): Keypair {
  const secret = getEnv("STELLAR_GATE_SECRET");
  return secret ? Keypair.fromSecret(secret) : getSponsor();
}

/** El emisor del USDC de prueba, si tenemos su llave (para darle saldo a las cuentas nuevas). */
export function getIssuer(): Keypair | null {
  const secret = getEnv("STELLAR_ISSUER_SECRET");
  return secret ? Keypair.fromSecret(secret) : null;
}

/**
 * El turno de la patrocinadora en la base, para cuando hay varias instancias (Postgres). Una transacción tarda
 * hasta un minuto en armarse, mandarse y confirmarse: el turno vence a los treinta segundos si nadie lo renueva,
 * se renueva cada diez y quien espera se rinde a los dos minutos (el escáner lo deja para el próximo intento).
 */
const SPONSOR_TURN = { ttlMs: 30_000, renewMs: 10_000, waitMs: 120_000 };

/**
 * Una sola transacción de la patrocinadora a la vez: comparte el número de secuencia, y dos
 * pedidos a la vez lo pisarían (tx_bad_seq). Todo lo que construye y manda con ella pasa por acá.
 * En el proceso van en fila, como siempre; entre instancias, además, cada una espera el turno "sponsor"
 * de la base (src/server/compartido.ts). Con SQLite hay un solo proceso y alcanza con la fila.
 */
export function withSponsorLock<T>(fn: () => Promise<T>): Promise<T> {
  const turn = () => serialized("sponsor", fn, SPONSOR_TURN);
  const previous = globalThis.__rumboSponsorQueue ?? Promise.resolve();
  const run = previous.then(turn, turn);
  globalThis.__rumboSponsorQueue = run.catch(() => undefined);
  return run;
}

export async function accountExists(publicKey: string): Promise<boolean> {
  try {
    await getRpc().getAccount(publicKey);
    return true;
  } catch {
    return false;
  }
}

/** Fondea una cuenta de la red de prueba. Devuelve false si ya existía. */
export async function fundWithFriendbot(publicKey: string): Promise<boolean> {
  assertTestnet();
  if (await accountExists(publicKey)) return false;
  const response = await fetch(`${friendbotUrl()}?addr=${encodeURIComponent(publicKey)}`);
  if (!response.ok) {
    const text = await response.text();
    if (/createAccountAlreadyExist|already/i.test(text)) return false;
    throw new Error(`Friendbot no pudo fondear ${publicKey}: ${response.status} ${text.slice(0, 200)}`);
  }
  return true;
}

// ---------- El despliegue del contrato y el activo de prueba ----------

export interface DeployedEvent {
  contract: string;
  /** En la unidad mínima del activo. "0" es gratis. */
  price: string;
  feeBps: number;
  capacity: number;
  /** Cuántos beneficios canjeables tiene (de 0 a benefits - 1). */
  benefits: number;
}

export interface DeployInfo {
  asset: { code: string; issuer: string; contract: string | null } | null;
  accounts: Partial<Record<"organizer" | "treasury" | "gate" | "sponsor", string>>;
  /** Los contratos desplegados, por nombre ("free", "paid"). */
  events: Record<string, DeployedEvent>;
  raw: Record<string, unknown>;
}

/** Dónde deja el agente del contrato lo público de lo que desplegó. */
export function deployInfoPath(): string {
  return getEnv("RUMBO_DEPLOY_JSON") ?? path.join(repoRoot(), "contracts", "rumbo-pass", "deploy", "testnet.json");
}

/** Lee contracts/rumbo-pass/deploy/testnet.json si existe. */
export function readDeployInfo(): DeployInfo | null {
  const file = deployInfoPath();
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

  let asset: DeployInfo["asset"] = null;
  const rawAsset = raw.asset;
  if (rawAsset && typeof rawAsset === "object") {
    const a = rawAsset as Record<string, unknown>;
    const code = text(a.code);
    const issuer = text(a.issuer);
    if (code && issuer) asset = { code, issuer, contract: text(a.contract) ?? text(a.contractId) ?? text(a.sac) };
  }

  const accounts: DeployInfo["accounts"] = {};
  if (raw.accounts && typeof raw.accounts === "object") {
    for (const [key, value] of Object.entries(raw.accounts as Record<string, unknown>)) {
      const v = text(value);
      if (v && (key === "organizer" || key === "treasury" || key === "gate" || key === "sponsor")) accounts[key] = v;
    }
  }

  const events: DeployInfo["events"] = {};
  if (raw.events && typeof raw.events === "object") {
    for (const [name, value] of Object.entries(raw.events as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const e = value as Record<string, unknown>;
      const contract = text(e.contract) ?? text(e.contractId);
      if (!contract) continue;
      events[name] = {
        contract,
        price: String(e.price ?? "0"),
        feeBps: Number(e.feeBps ?? e.fee_bps ?? 0),
        capacity: Number(e.capacity ?? 0),
        benefits: Number(e.benefits ?? 0),
      };
    }
  }
  // La forma vieja, con un solo contrato arriba de todo.
  const single = text(raw.contractId) ?? text(raw.contract_id);
  if (single && Object.keys(events).length === 0) events.default = { contract: single, price: "0", feeBps: 0, capacity: 0, benefits: 0 };

  return { asset, accounts, events, raw };
}

export interface TestAsset {
  code: string;
  issuer: string;
  /** El contrato de activo (SAC) con el que cobra el contrato rumbo-pass. */
  contract: string;
  asset: Asset;
}

/**
 * El USDC de prueba: lo que dice el despliegue del contrato; si falta, lo que dice app/.env.local
 * (STELLAR_ASSET_CODE, STELLAR_ASSET_ISSUER, STELLAR_ASSET_CONTRACT) o la llave del emisor.
 */
export function getTestAsset(): TestAsset {
  const deploy = readDeployInfo();
  const code = deploy?.asset?.code ?? getEnv("STELLAR_ASSET_CODE", "USDC");
  const issuer = deploy?.asset?.issuer ?? getEnv("STELLAR_ASSET_ISSUER") ?? getIssuer()?.publicKey() ?? null;
  if (!issuer) throw new Error("Falta el emisor del USDC de prueba: STELLAR_ISSUER_SECRET en app/.env.local, o el despliegue del contrato. Corré: pnpm setup:dev");
  const asset = new Asset(code, issuer);
  const contract = deploy?.asset?.contract ?? getEnv("STELLAR_ASSET_CONTRACT") ?? asset.contractId(NETWORK_PASSPHRASE);
  return { code, issuer, contract, asset };
}

/**
 * El contrato de un evento desplegado: "free" o "paid" en el despliegue de muestra. Primero
 * RUMBO_CONTRACT_ID (si se pide "default" o no hay despliegue), después el despliegue.
 */
export function resolveContractId(name: "free" | "paid" | "default" = "default"): string | null {
  const deploy = readDeployInfo();
  if (name !== "default") return deploy?.events[name]?.contract ?? null;
  return getEnv("RUMBO_CONTRACT_ID") ?? deploy?.events.free?.contract ?? deploy?.events.default?.contract ?? Object.values(deploy?.events ?? {})[0]?.contract ?? null;
}

export function requireContractId(contractId: string | null | undefined): string {
  if (!contractId) {
    throw new Error("Este evento no tiene contrato en la red de prueba: desplegalo (contracts/rumbo-pass) y guardá su id en el tipo de entrada o en el evento.");
  }
  return contractId;
}

// ---------- Firmar y mandar ----------

/** Quien firma, por una cuenta, las autorizaciones que pide el contrato. */
export interface AuthSigner {
  readonly address: string;
  signAuthEntry(entry: xdr.SorobanAuthorizationEntry, validUntilLedger: number): Promise<xdr.SorobanAuthorizationEntry>;
}

export function keypairSigner(keypair: Keypair): AuthSigner {
  return {
    address: keypair.publicKey(),
    signAuthEntry: (entry, validUntilLedger) => authorizeEntry(entry, keypair, validUntilLedger, NETWORK_PASSPHRASE),
  };
}

export interface TxResult {
  hash: string;
  ledger: number;
  /** Lo que devolvió la función del contrato, ya convertido (scValToNative). */
  returnValue: unknown;
}

/** Un error del contrato o de la red, con el código del contrato si lo hubo ("Error(Contract, #6)"). */
export class ContractError extends Error {
  readonly code: ContractErrorCode | null;
  readonly errorName: ContractErrorName | null;
  readonly detail: string | null;

  constructor(message: string, code: number | null, detail: string | null = null) {
    const known = code !== null && code in CONTRACT_ERRORS ? (code as ContractErrorCode) : null;
    super(known ? `${message} [${CONTRACT_ERRORS[known]}]` : message);
    this.name = "ContractError";
    this.code = known;
    this.errorName = known ? CONTRACT_ERRORS[known] : null;
    this.detail = detail;
  }

  is(name: ContractErrorName): boolean {
    return this.errorName === name;
  }
}

export function isContractError(error: unknown, name?: ContractErrorName): error is ContractError {
  return error instanceof ContractError && (name === undefined || error.errorName === name);
}

/** Si el contrato dijo que eso ya estaba hecho: la marca de "doble" del espejo. */
export function isAlreadyDone(error: unknown): boolean {
  return isContractError(error) && (error.errorName === "AlreadyCheckedIn" || error.errorName === "AlreadyRedeemed" || error.errorName === "AlreadyHasPass");
}

function parseContractCode(text: string): number | null {
  const match = /Error\(Contract, #(\d+)\)/.exec(text);
  return match ? Number(match[1]) : null;
}

function describeEvents(events: xdr.DiagnosticEvent[] | undefined): string | null {
  const parts = (events ?? [])
    .map((event) => {
      try {
        const body = event.event.body;
        if (body.type !== "v0") return "";
        return JSON.stringify(scValToNative(body.v0.data), (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  return parts.length ? parts.join(" | ") : null;
}

function errorFromSimulation(sim: rpc.Api.SimulateTransactionErrorResponse): ContractError {
  const detail = describeEvents(sim.events);
  return new ContractError(`El contrato rechazó la operación: ${sim.error}`, parseContractCode(sim.error) ?? parseContractCode(detail ?? ""), detail);
}

/** El ledger hasta el que valen las autorizaciones firmadas: unos diez minutos. */
const AUTH_VALID_LEDGERS = 120;
/** Un margen sobre la comisión mínima que calcula la simulación. Lo que sobra se devuelve. */
const RESOURCE_FEE_MARGIN = 1.2;

/** Lo que quien manda una operación quiere saber en el camino. */
export interface SubmitHooks {
  /**
   * El hash de la transacción ya firmada, justo antes de mandarla. Si después la confirmación no llega a
   * tiempo (o se corta la respuesta), con ese hash se puede preguntar cómo terminó antes de mandar otra.
   */
  onSubmitted?: (hash: string) => void | Promise<void>;
  /**
   * El nodo contestó que está ocupado y no tomó la transacción, ni después de reintentar (TRY_AGAIN_LATER): esa
   * transacción no entró ni va a entrar, y su hash se puede olvidar.
   */
  onRejected?: () => void | Promise<void>;
}

/** Cuánto vale una transacción armada: después de esto la red ya no la incluye. */
export const TX_TIMEOUT_SECONDS = 60;

/**
 * Simula, firma las autorizaciones de cada cuenta con su firmante, arma la transacción con la
 * comisión de la simulación, la firma con la patrocinadora, la manda y espera el resultado.
 * La transacción tiene que tener a la patrocinadora como fuente y una sola operación de contrato.
 * Quien la construyó ya consumió un número de secuencia: construir y mandar van dentro de withSponsorLock.
 *
 * Con `presigned`, las autorizaciones ya vienen firmadas desde otro dispositivo (la cuenta propia de la
 * persona, con Pollar): van en la operación desde la simulación, que entonces las verifica (enforce), y
 * nadie más firma nada salvo la patrocinadora el sobre.
 */
export async function submitSponsored(
  tx: Transaction,
  signers: AuthSigner[] = [],
  hooks: SubmitHooks = {},
  presigned: xdr.SorobanAuthorizationEntry[] = [],
): Promise<TxResult> {
  const server = getRpc();
  const sponsor = getSponsor();
  const op = tx.operations[0];
  if (!op || op.type !== "invokeHostFunction" || tx.operations.length !== 1) {
    throw new Error("submitSponsored espera una transacción con una sola operación de contrato");
  }
  if (presigned.length > 0) {
    // El mismo número de secuencia: cloneFrom lo copia.
    tx = TransactionBuilder.cloneFrom(tx).clearOperations().addOperation(Operation.invokeHostFunction({ source: op.source, func: op.func, auth: presigned })).build();
  }

  const sim = await server.simulateTransaction(tx, undefined, presigned.length > 0 ? "enforce" : undefined);
  if (rpc.Api.isSimulationError(sim)) throw errorFromSimulation(sim);
  if (rpc.Api.isSimulationRestore(sim)) {
    throw new ContractError("El contrato tiene estado archivado: hay que restaurarlo (restoreFootprint) antes de usarlo.", null);
  }

  const validUntil = sim.latestLedger + AUTH_VALID_LEDGERS;
  const auth =
    presigned.length > 0
      ? presigned
      : await Promise.all(
          (sim.result?.auth ?? []).map(async (entry) => {
            const address = inspectAuthEntry(entry).address;
            if (!address) return entry; // la cuenta fuente: la firma del sobre alcanza
            const signer = signers.find((s) => s.address === address);
            if (!signer) throw new Error(`Falta quien firme la autorización de ${address}`);
            return signer.signAuthEntry(entry, validUntil);
          }),
        );

  const resourceFee = Math.ceil(Number(sim.minResourceFee) * RESOURCE_FEE_MARGIN);
  sim.transactionData.setResourceFee(resourceFee);
  sim.minResourceFee = String(resourceFee);

  const built = rpc
    .assembleTransaction(tx, sim)
    .clearOperations()
    .addOperation(Operation.invokeHostFunction({ source: op.source, func: op.func, auth }))
    .build();
  built.sign(sponsor);
  await hooks.onSubmitted?.(Buffer.from(built.hash()).toString("hex"));

  return sendAndWait(server, built, hooks);
}

/** Lo que sendAndWait necesita de la conexión con la red (las pruebas pasan una de mentira). */
export interface TxSender {
  sendTransaction(tx: Transaction): Promise<rpc.Api.SendTransactionResponse>;
  pollTransaction(hash: string, options?: { attempts?: number }): Promise<rpc.Api.GetTransactionResponse>;
}

/**
 * Las esperas entre un intento de mandar y el siguiente cuando el nodo contesta TRY_AGAIN_LATER (tiene la
 * cola llena): en total unos veintitrés segundos, menos de lo que vale la transacción (TX_TIMEOUT_SECONDS).
 */
export const SEND_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 8000];

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Manda una transacción ya firmada y espera cómo termina. El nodo puede contestar:
 *  - PENDING: la aceptó, se espera el resultado por su hash.
 *  - DUPLICATE: ya la tenía (un intento anterior llegó, aunque su respuesta se perdió): "ya está en camino",
 *    se sigue esperando el resultado por su hash, igual que con PENDING.
 *  - TRY_AGAIN_LATER: está ocupado y no la tomó. No es un error de la transacción: se vuelve a mandar la
 *    misma, con espera creciente. Si sigue ocupado, queda como "reintentá después" (un error sin código de
 *    contrato, que el escáner deja pendiente) y avisa con onRejected, porque esa transacción no entró ni va a entrar.
 *  - ERROR: la rechazó.
 */
export async function sendAndWait(
  server: TxSender,
  built: Transaction,
  hooks: SubmitHooks = {},
  options: { delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {},
): Promise<TxResult> {
  const delays = options.delaysMs ?? SEND_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? sleepMs;
  let sent = await server.sendTransaction(built);
  for (const delay of delays) {
    if (sent.status !== "TRY_AGAIN_LATER") break;
    await sleep(delay);
    sent = await server.sendTransaction(built);
  }
  if (sent.status === "TRY_AGAIN_LATER") {
    await hooks.onRejected?.();
    throw new ContractError("La red está ocupada y no tomó la transacción: reintentá más tarde", null);
  }
  if (sent.status === "ERROR") {
    const result = sent.errorResult ? sent.errorResult.result.type : sent.status;
    throw new ContractError(`La red no aceptó la transacción (${result})`, null, describeEvents(sent.diagnosticEvents));
  }

  const hash = sent.hash || Buffer.from(built.hash()).toString("hex");
  const final = await server.pollTransaction(hash, { attempts: 40 });
  if (final.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    return { hash, ledger: final.ledger, returnValue: final.returnValue ? scValToNative(final.returnValue) : undefined };
  }
  if (final.status === rpc.Api.GetTransactionStatus.FAILED) {
    const detail = describeEvents(final.diagnosticEventsXdr);
    throw new ContractError(`La transacción falló en la red (${final.resultXdr.result.type})`, parseContractCode(detail ?? ""), detail);
  }
  throw new ContractError(`La transacción ${hash} no se confirmó a tiempo`, null);
}

/** Cómo terminó una transacción mandada: entró bien, entró y falló, o la red no la conoce (todavía, o nunca). */
export type TxOutcome = "success" | "failed" | "missing";

export async function transactionOutcome(hash: string): Promise<TxOutcome> {
  const tx = await getRpc().getTransaction(hash);
  if (tx.status === rpc.Api.GetTransactionStatus.SUCCESS) return "success";
  if (tx.status === rpc.Api.GetTransactionStatus.FAILED) return "failed";
  return "missing";
}

/** Construye una transacción de contrato con la patrocinadora como fuente. Consume un número de secuencia. */
export async function buildInvoke(contractId: string, fn: ContractFn, args: xdr.ScVal[]): Promise<Transaction> {
  const sponsor = getSponsor();
  const account = await getRpc().getAccount(sponsor.publicKey());
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(requireContractId(contractId)).call(fn, ...args))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
}

/** Construye, firma y manda una operación del contrato, en orden con las demás de la patrocinadora. */
export function invoke(contractId: string, fn: ContractFn, args: xdr.ScVal[], signers: AuthSigner[] = [], hooks: SubmitHooks = {}): Promise<TxResult> {
  return withSponsorLock(async () => submitSponsored(await buildInvoke(contractId, fn, args), signers, hooks));
}

/**
 * Cuánto vale la firma que da otro dispositivo (la cuenta propia, con Pollar): unos cinco minutos. Pollar
 * rechaza las autorizaciones que vencen demasiado lejos, y la persona firma enseguida.
 */
export const EXTERNAL_AUTH_VALID_LEDGERS = 60;

/** Lo que una cuenta propia tiene que firmar en su dispositivo: la autorización sin firmar y hasta qué ledger vale. */
export interface PreparedAuth {
  /** La autorización (SorobanAuthorizationEntry) en XDR base64, sin firmar. */
  entryXdr: string;
  validUntilLedger: number;
  latestLedger: number;
}

/**
 * Simula la operación para saber qué le va a pedir el contrato a `address`, sin firmar ni mandar nada (no
 * gasta el número de secuencia de la patrocinadora: va fuera del turno). Pide las credenciales de antes de
 * CAP-71 (useUpgradedAuth false), las que entiende cualquier billetera; la red acepta las dos. La operación
 * tiene que pedirle autorización a esa cuenta y a ninguna otra.
 */
export async function prepareExternalAuth(contractId: string, fn: ContractFn, args: xdr.ScVal[], address: string): Promise<PreparedAuth> {
  const tx = await buildInvoke(contractId, fn, args);
  const sim = await getRpc().simulateTransaction(tx, undefined, "record", false);
  if (rpc.Api.isSimulationError(sim)) throw errorFromSimulation(sim);
  if (rpc.Api.isSimulationRestore(sim)) {
    throw new ContractError("El contrato tiene estado archivado: hay que restaurarlo (restoreFootprint) antes de usarlo.", null);
  }
  const withAddress = (sim.result?.auth ?? []).filter((entry) => inspectAuthEntry(entry).address !== null);
  if (withAddress.length !== 1 || inspectAuthEntry(withAddress[0]!).address !== address) {
    throw new Error(`${fn} pide ${withAddress.length} autorizaciones de cuenta; se esperaba una sola, de ${address}`);
  }
  return { entryXdr: withAddress[0]!.toXdr("base64"), validUntilLedger: sim.latestLedger + EXTERNAL_AUTH_VALID_LEDGERS, latestLedger: sim.latestLedger };
}

/** Manda una operación del contrato con autorizaciones ya firmadas por otro dispositivo, en orden con las demás. */
export function invokePresigned(contractId: string, fn: ContractFn, args: xdr.ScVal[], presigned: xdr.SorobanAuthorizationEntry[], hooks: SubmitHooks = {}): Promise<TxResult> {
  return withSponsorLock(async () => submitSponsored(await buildInvoke(contractId, fn, args), [], hooks, presigned));
}

/** Lee del contrato sin mandar nada: simula y devuelve el valor convertido. */
export async function readContract(contractId: string, fn: ContractFn, args: xdr.ScVal[] = []): Promise<unknown> {
  const source = getEnv("STELLAR_SPONSOR_SECRET") ? getSponsor().publicKey() : "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const tx = new TransactionBuilder(new Account(source, "0"), { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(requireContractId(contractId)).call(fn, ...args))
    .setTimeout(60)
    .build();
  const sim = await getRpc().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw errorFromSimulation(sim);
  return sim.result?.retval ? scValToNative(sim.result.retval) : undefined;
}

/**
 * Manda operaciones clásicas (líneas de confianza, pagos) con la patrocinadora como fuente, que paga
 * la comisión. Cada operación con otra `source` necesita la firma de esa cuenta: van en `signers`.
 */
export function submitClassic(operations: xdr.Operation[], signers: Keypair[] = []): Promise<{ hash: string }> {
  return withSponsorLock(async () => {
    const sponsor = getSponsor();
    const account = await getRpc().getAccount(sponsor.publicKey());
    const builder = new TransactionBuilder(account, { fee: "1000", networkPassphrase: NETWORK_PASSPHRASE }).setTimeout(60);
    for (const op of operations) builder.addOperation(op);
    const tx = builder.build();
    const extra = signers.filter((k) => k.publicKey() !== sponsor.publicKey());
    tx.sign(sponsor, ...extra);
    try {
      const result = await getHorizon().submitTransaction(tx);
      return { hash: result.hash };
    } catch (error) {
      throw new Error(`La red rechazó la operación: ${describeHorizonError(error)}`);
    }
  });
}

function describeHorizonError(error: unknown): string {
  const data = (error as { response?: { data?: { extras?: { result_codes?: unknown }; detail?: string } } })?.response?.data;
  if (data?.extras?.result_codes) return JSON.stringify(data.extras.result_codes);
  if (data?.detail) return data.detail;
  return error instanceof Error ? error.message : String(error);
}

/** Si la cuenta ya tiene línea de confianza con el activo. */
export async function hasTrustline(publicKey: string, asset: Asset): Promise<boolean> {
  try {
    const account = await getHorizon().loadAccount(publicKey);
    return account.balances.some((b) => "asset_code" in b && b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer());
  } catch {
    return false;
  }
}

/** El saldo de un activo en una cuenta, como texto ("100.0000000"), o null sin línea de confianza. */
export async function getBalance(publicKey: string, asset: Asset): Promise<string | null> {
  const account = await getHorizon().loadAccount(publicKey);
  const balance = account.balances.find((b) => "asset_code" in b && b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer());
  return balance ? balance.balance : null;
}

/**
 * Con qué XLM arranca la cuenta propia que crea la patrocinadora cuando Pollar todavía no la creó: la reserva
 * de la cuenta (1) y la de una línea de confianza (0,5), con algo de sobra. La firma del contrato no gasta XLM
 * de la persona: la comisión la paga siempre la patrocinadora.
 */
export const NEW_ACCOUNT_XLM = "2";

/**
 * Lo que necesita una cuenta propia (la de Pollar) antes de inscribirse. Es un objeto para que las pruebas sin
 * red lo reemplacen, como rumboPass.
 */
export const walletChain = {
  /**
   * Que la cuenta exista en la red. Pollar la crea al entrar; si todavía no llegó (o falló), la crea la
   * patrocinadora. Devuelve true si la creó acá.
   */
  async ensureAccount(address: string): Promise<boolean> {
    if (await accountExists(address)) return false;
    try {
      await submitClassic([Operation.createAccount({ destination: address, startingBalance: NEW_ACCOUNT_XLM })]);
      return true;
    } catch (error) {
      // Pollar la creó entre la pregunta y el pedido: está, que es lo que importa.
      if (await accountExists(address)) return false;
      throw error;
    }
  },
  /** Si la cuenta ya acepta el USDC de prueba. La línea de confianza la agrega la persona (con Pollar, setTrustline). */
  hasTestTrustline(address: string): Promise<boolean> {
    return hasTrustline(address, getTestAsset().asset);
  },
  /**
   * SOLO RED DE PRUEBA, como el saldo inicial del modo de prueba: si a la cuenta no le alcanza para la
   * entrada, el emisor le manda USDC de prueba (RUMBO_INITIAL_TEST_USDC, o lo que falte si es más). Sin la
   * llave del emisor no hace nada, y el contrato después dice que no se pudo cobrar.
   */
  async topUpTestUsdc(address: string, minimum: number): Promise<void> {
    assertTestnet();
    const test = getTestAsset();
    const balance = Number((await getBalance(address, test.asset)) ?? 0);
    if (balance >= minimum) return;
    const issuer = getIssuer();
    if (!issuer || issuer.publicKey() !== test.issuer) {
      console.warn(`[cuentas] La cuenta ${address} no tiene saldo para la entrada y no tengo la llave del emisor ${test.issuer} (STELLAR_ISSUER_SECRET).`);
      return;
    }
    const amount = Math.max(Number(getEnv("RUMBO_INITIAL_TEST_USDC", "100")), minimum - balance);
    await submitClassic([Operation.payment({ destination: address, asset: test.asset, amount: amount.toFixed(ASSET_DECIMALS), source: issuer.publicKey() })], [issuer]);
  },
};

// ---------- El contrato rumbo-pass ----------

const addressArg = (address: string): xdr.ScVal => new Address(address).toScVal();
const u32Arg = (value: number): xdr.ScVal => nativeToScVal(value, { type: "u32" });

function gateSigners(): AuthSigner[] {
  const gate = getGate();
  return gate.publicKey() === getSponsor().publicKey() ? [] : [keypairSigner(gate)];
}

/**
 * Las funciones del contrato, con la firma que les corresponde. El primer argumento es siempre el
 * contrato del evento (el del tipo de entrada, o el del evento). Devuelven lo que devuelve el contrato.
 */
export const rumboPass = {
  /** Inscripción gratis. Firma la persona. Devuelve el número de pase. */
  async register(contractId: string, attendee: string, signer: AuthSigner): Promise<TxResult & { number: number }> {
    const result = await invoke(contractId, CONTRACT_FN.register, [addressArg(attendee)], [signer]);
    return { ...result, number: Number(result.returnValue) };
  },
  /** Entrada paga: cobra en USDC de prueba y reparte en la misma operación. Firma quien compra. Devuelve el número de pase. */
  async buy(contractId: string, buyer: string, signer: AuthSigner): Promise<TxResult & { number: number }> {
    const result = await invoke(contractId, CONTRACT_FN.buy, [addressArg(buyer)], [signer]);
    return { ...result, number: Number(result.returnValue) };
  },
  /**
   * register o buy de una cuenta propia, paso 1: lo que la persona tiene que autorizar en su dispositivo, sin
   * firmar. Si el contrato no lo va a aceptar (sin lugares, ya tiene pase, sin saldo), falla acá, como register.
   */
  prepare(contractId: string, fn: "register" | "buy", account: string): Promise<PreparedAuth> {
    return prepareExternalAuth(contractId, CONTRACT_FN[fn], [addressArg(account)], account);
  },
  /** Paso 2: con la autorización ya firmada por la persona, la patrocinadora arma, paga y manda. Devuelve el número de pase. */
  async submitSigned(contractId: string, fn: "register" | "buy", account: string, entry: xdr.SorobanAuthorizationEntry): Promise<TxResult & { number: number }> {
    const result = await invokePresigned(contractId, CONTRACT_FN[fn], [addressArg(account)], [entry]);
    return { ...result, number: Number(result.returnValue) };
  },
  /** La entrada, una sola vez. La marca la puerta. Devuelve en qué lugar entró (el primero es 1). */
  async checkIn(contractId: string, attendee: string, hooks: SubmitHooks = {}): Promise<TxResult & { arrival: number }> {
    const result = await invoke(contractId, CONTRACT_FN.checkIn, [addressArg(attendee), addressArg(getGate().publicKey())], gateSigners(), hooks);
    return { ...result, arrival: Number(result.returnValue) };
  },
  /** Un canje, una sola vez por pase y beneficio. Firma la puerta. Hay que haber entrado antes. */
  redeem(contractId: string, attendee: string, benefit: number, hooks: SubmitHooks = {}): Promise<TxResult> {
    return invoke(contractId, CONTRACT_FN.redeem, [addressArg(attendee), u32Arg(benefit)], gateSigners(), hooks);
  },
  /**
   * Mantiene vivo el evento: la instancia, la lista de quienes entraron y el pase de cada cuenta de
   * `holders` quedan con 120 días de vida. No pide firma; la paga la patrocinadora. Hace falta antes
   * de un evento que abrió la inscripción con más de 120 días de anticipación. Devuelve cuántos pases extendió.
   */
  async extendTtl(contractId: string, holders: string[]): Promise<TxResult & { extended: number }> {
    const result = await invoke(contractId, CONTRACT_FN.extendTtl, [xdr.ScVal.scvVec(holders.map(addressArg))]);
    return { ...result, extended: Number(result.returnValue) };
  },
  async status(contractId: string, who: string): Promise<PassStatusOnChain> {
    const value = (await readContract(contractId, CONTRACT_FN.status, [addressArg(who)])) as Partial<PassStatusOnChain> | undefined;
    return {
      has_pass: Boolean(value?.has_pass),
      number: Number(value?.number ?? 0),
      checked_in: Boolean(value?.checked_in),
      redeemed: (value?.redeemed ?? []).map(Number),
    };
  },
  /** Quienes entraron, en orden de llegada: la lista que se sortea. */
  async attendees(contractId: string): Promise<string[]> {
    return ((await readContract(contractId, CONTRACT_FN.attendees)) ?? []) as string[];
  },
  async info(contractId: string): Promise<EventInfoOnChain> {
    const value = (await readContract(contractId, CONTRACT_FN.info)) as Record<string, unknown>;
    return {
      organizer: String(value.organizer),
      treasury: String(value.treasury),
      gate: String(value.gate),
      asset: String(value.asset),
      price: BigInt((value.price as bigint | number | string) ?? 0),
      fee_bps: Number(value.fee_bps ?? 0),
      capacity: Number(value.capacity ?? 0),
      benefits: Number(value.benefits ?? 0),
      issued: Number(value.issued ?? 0),
      checked_in: Number(value.checked_in ?? 0),
    };
  },
};
