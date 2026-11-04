// La cuenta propia de cada persona: una cuenta de Stellar cuya llave tiene ella (con Pollar, que la custodia
// cuando entra con Google o con su correo), nunca el servidor. Acá vive lo que el servidor hace con esas cuentas
// sin hablar con la red:
//   1. probar que la cuenta es de quien la trae (SEP-53): el servidor da un desafío de un solo uso, el navegador
//      lo firma con client.stellar.sep53.signMessage y el servidor verifica la firma ed25519 sobre
//      SHA-256("Stellar Signed Message:\n" + mensaje) con esa clave pública;
//   2. revisar la autorización que firmó el dispositivo (client.signAuthEntry) antes de mandarla: que sea la
//      misma que se le dio a firmar, de esa cuenta, y con una firma que valga.
// La red de prueba y el contrato los toca src/server/evento/inscripcion.ts, con los helpers de stellar.ts.
import { createHash, randomBytes } from "node:crypto";
import { Keypair, StrKey, buildAuthorizationEntryPreimage, hash, inspectAuthEntry, xdr } from "@stellar/stellar-sdk";
import { baseUrl } from "./env.ts";
import type { Lang } from "../i18n/types.ts";
import type { Repo, WalletAuthRequest, WalletProvider } from "./repo.ts";

/** El prefijo de SEP-53: lo que se firma es SHA-256 de esto más el mensaje, nunca el mensaje solo. */
export const SEP53_PREFIX = "Stellar Signed Message:\n";
/** Cuánto vale un desafío: lo firma el navegador enseguida. */
export const CHALLENGE_TTL_MS = 5 * 60_000;
/** Cuánto espera el servidor la autorización firmada: lo mismo que vale la firma (EXTERNAL_AUTH_VALID_LEDGERS). */
export const AUTH_REQUEST_TTL_MS = 5 * 60_000;

export const WALLET_PROVIDERS: readonly WalletProvider[] = ["pollar"];
export function isWalletProvider(value: unknown): value is WalletProvider {
  return typeof value === "string" && (WALLET_PROVIDERS as readonly string[]).includes(value);
}

/** Un id que no se adivina: 128 bits al azar. Sirve para los desafíos y para las autorizaciones por firmar. */
export function newOpaqueId(): string {
  return randomBytes(16).toString("base64url");
}

export function isAccountKey(value: unknown): value is string {
  return typeof value === "string" && StrKey.isValidEd25519PublicKey(value);
}

/** SHA-256("Stellar Signed Message:\n" + mensaje), en UTF-8: lo que firma la cuenta según SEP-53. */
export function sep53Digest(message: string): Buffer {
  return createHash("sha256").update(Buffer.from(SEP53_PREFIX + message, "utf8")).digest();
}

/** Si `signature` (ed25519 en base64) es la firma SEP-53 de `message` con la llave de `publicKey`. */
export function verifySep53(publicKey: string, message: string, signature: string): boolean {
  if (!isAccountKey(publicKey) || typeof signature !== "string") return false;
  const bytes = Buffer.from(signature, "base64");
  if (bytes.length !== 64) return false;
  try {
    return Keypair.fromPublicKey(publicKey).verify(sep53Digest(message), bytes);
  } catch {
    return false;
  }
}

/** El texto del desafío. Dice dónde se firma, para quién lo lea en una billetera que lo muestra. */
export function challengeMessage(publicKey: string, nonce: string, expiresAt: string, lang: Lang): string {
  const host = new URL(baseUrl()).host;
  return lang === "en"
    ? `Rumbo (${host}): I confirm the Stellar account ${publicKey} is mine.\nCode: ${nonce}\nValid until: ${expiresAt}`
    : `Rumbo (${host}): confirmo que la cuenta de Stellar ${publicKey} es mía.\nCódigo: ${nonce}\nVale hasta: ${expiresAt}`;
}

export interface IssuedChallenge {
  challengeId: string;
  message: string;
  expiresAt: string;
}

/** Da un desafío nuevo para esa cuenta. El mensaje lleva un código al azar y cuándo vence. */
export async function issueChallenge(repo: Repo, publicKey: string, lang: Lang, now: number = Date.now()): Promise<IssuedChallenge> {
  if (!isAccountKey(publicKey)) throw new Error("La cuenta no es una clave pública de Stellar (G...)");
  const expiresAt = new Date(now + CHALLENGE_TTL_MS).toISOString();
  const id = newOpaqueId();
  const message = challengeMessage(publicKey, newOpaqueId(), expiresAt, lang);
  await repo.createWalletChallenge({ id, publicKey, message, expiresAt });
  return { challengeId: id, message, expiresAt };
}

/** La prueba que trae el navegador: el desafío que le dio el servidor, firmado con la cuenta. */
export interface WalletProof {
  provider: WalletProvider;
  publicKey: string;
  challengeId: string;
  /** La firma SEP-53 del mensaje del desafío, en base64. */
  signature: string;
}

export type ProofCheck = { ok: true; publicKey: string; provider: WalletProvider } | { ok: false; why: "challenge" | "signature" | "malformed" };

/**
 * Verifica la prueba y gasta el desafío, salga bien o mal: con una firma equivocada el desafío ya no sirve, y
 * hay que pedir otro. Un desafío de otra cuenta, vencido o ya usado no vale.
 */
export async function verifyWalletProof(repo: Repo, proof: WalletProof): Promise<ProofCheck> {
  if (!isWalletProvider(proof.provider) || !isAccountKey(proof.publicKey) || typeof proof.challengeId !== "string" || typeof proof.signature !== "string") {
    return { ok: false, why: "malformed" };
  }
  const challenge = await repo.useWalletChallenge(proof.challengeId, proof.publicKey);
  if (!challenge) return { ok: false, why: "challenge" };
  if (!verifySep53(proof.publicKey, challenge.message, proof.signature)) return { ok: false, why: "signature" };
  return { ok: true, publicKey: proof.publicKey, provider: proof.provider };
}

/** Lee la prueba del cuerpo de un pedido ({ provider, publicKey, challengeId, signature }), o null si no vino. */
export function readWalletProof(raw: unknown): WalletProof | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return { provider: (text(r.provider) || "pollar") as WalletProvider, publicKey: text(r.publicKey), challengeId: text(r.challengeId), signature: text(r.signature) };
}

export type SignedEntryProblem = "malformed" | "changed" | "unsigned" | "other_account" | "bad_signature";
export type SignedEntryCheck = { ok: true; entry: xdr.SorobanAuthorizationEntry } | { ok: false; problem: SignedEntryProblem };

/**
 * Revisa la autorización que firmó el dispositivo contra la que se le dio a firmar: la misma cuenta, el mismo
 * nonce y la misma invocación (contrato, función, argumentos y lo que cuelga, como el cobro de buy), con una
 * sola firma, de la llave de esa cuenta, que valga para lo firmado. Lo demás (que no haya vencido, que alcance
 * para el contrato) lo dice la simulación al mandarla.
 */
export function checkSignedAuthEntry(signedXdr: string, request: Pick<WalletAuthRequest, "entryXdr" | "publicKey">, networkPassphrase: string): SignedEntryCheck {
  let signed: xdr.SorobanAuthorizationEntry;
  let expected: xdr.SorobanAuthorizationEntry;
  try {
    signed = xdr.SorobanAuthorizationEntry.fromXdr(signedXdr, "base64");
    expected = xdr.SorobanAuthorizationEntry.fromXdr(request.entryXdr, "base64");
  } catch {
    return { ok: false, problem: "malformed" };
  }
  let got: ReturnType<typeof inspectAuthEntry>;
  let want: ReturnType<typeof inspectAuthEntry>;
  try {
    got = inspectAuthEntry(signed);
    want = inspectAuthEntry(expected);
  } catch {
    return { ok: false, problem: "malformed" };
  }
  if (got.address !== request.publicKey) return { ok: false, problem: "other_account" };
  if (
    got.credentialType !== want.credentialType ||
    got.nonce !== want.nonce ||
    got.signers.length !== 1 ||
    signed.rootInvocation.toXdr("base64") !== expected.rootInvocation.toXdr("base64")
  ) {
    return { ok: false, problem: "changed" };
  }
  const signatures = got.signers[0]!.signatures;
  if (!got.signed || !signatures || signatures.length === 0) return { ok: false, problem: "unsigned" };
  if (signatures.length !== 1 || signatures[0]!.publicKey !== request.publicKey) return { ok: false, problem: "other_account" };
  const payload = hash(Buffer.from(buildAuthorizationEntryPreimage(signed, got.signatureExpirationLedger ?? 0, networkPassphrase).toXdr()));
  if (!Keypair.fromPublicKey(request.publicKey).verify(payload, signatures[0]!.signature)) return { ok: false, problem: "bad_signature" };
  return { ok: true, entry: signed };
}
