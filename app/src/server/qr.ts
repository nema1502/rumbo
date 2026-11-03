// La firma del QR de la credencial, en el servidor. Cada evento tiene un par de llaves Ed25519: la privada
// vive en la base (src/server/qr-keys.ts) y nunca sale del servidor; la pública va al escáner del
// voluntario cuando abre su puesto con red. El formato del QR y cómo se verifica están en
// src/lib/qr-codec.ts y src/lib/qr-verify.ts.
//
//   - La credencial impresa lleva la firma del evento sobre el id del pase: vale siempre.
//   - La del celular rota cada 20 segundos. La firma de cada ventana la hace una llave propia de cada
//     credencial, derivada acá con HMAC de una raíz secreta del evento y el id del pase. El evento firma
//     un certificado que liga esa llave al pase. La persona recibe la semilla y el certificado de SU
//     credencial al abrirla (buildLiveGrant) y arma sola el QR de cada ventana; no puede armar el de otro pase.
import { createHmac, createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
import {
  PASS_ID_BYTES,
  base32Encode,
  bytesToBase64url,
  certificateMessage,
  isValidPassId,
  joinPrintedPayload,
  printedMessage,
} from "../lib/qr-codec.ts";
import type { LiveGrant } from "../lib/qr-live.ts";
import { verifyQrPayloadInBrowser } from "../lib/qr-verify.ts";

export type { QrVerification } from "../lib/qr-codec.ts";
export type { LiveGrant } from "../lib/qr-live.ts";
export { bytesToBase64url, base64urlToBytes } from "../lib/qr-codec.ts";

/** Las llaves de un evento. */
export interface EventQrKeys {
  /** La clave pública (32 bytes): la recibe el escáner. */
  publicKey: Uint8Array;
  /** La semilla de la clave privada (32 bytes): solo el servidor. */
  privateKey: Uint8Array;
  /** Con esto se derivan las llaves de las credenciales (32 bytes): solo el servidor. */
  credentialRoot: Uint8Array;
}

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function privateKeyObject(seed: Uint8Array) {
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
}

/** La clave pública de una semilla Ed25519. */
export function publicKeyFromSeed(seed: Uint8Array): Uint8Array {
  const spki = createPublicKey(privateKeyObject(seed)).export({ format: "der", type: "spki" });
  return new Uint8Array(spki.subarray(spki.length - 32));
}

/** Firma con una semilla Ed25519. */
export function signWithSeed(seed: Uint8Array, message: Uint8Array): Uint8Array {
  return new Uint8Array(sign(null, message, privateKeyObject(seed)));
}

/** Las llaves de un evento nuevo. */
export function newEventQrKeys(): EventQrKeys {
  const privateKey = new Uint8Array(randomBytes(32));
  return { publicKey: publicKeyFromSeed(privateKey), privateKey, credentialRoot: new Uint8Array(randomBytes(32)) };
}

/** Un id de pase nuevo: ocho letras y números, al azar. */
export function newPassId(): string {
  return base32Encode(new Uint8Array(randomBytes(PASS_ID_BYTES)));
}

function assertPassId(passId: string): void {
  if (!isValidPassId(passId)) throw new Error(`El id de pase ${passId} no tiene la forma esperada`);
}

/** Lo que va dentro del QR de la credencial impresa: el pase y la firma del evento sobre él. */
export function buildPrintedPayload(passId: string, keys: EventQrKeys): string {
  assertPassId(passId);
  return joinPrintedPayload(passId, signWithSeed(keys.privateKey, printedMessage(passId)));
}

/** La semilla de la llave de una credencial: nadie que no tenga la raíz del evento puede calcularla. */
export function credentialSeed(passId: string, keys: EventQrKeys): Uint8Array {
  assertPassId(passId);
  return new Uint8Array(createHmac("sha256", keys.credentialRoot).update(`rumbo.credencial.${passId}`, "utf8").digest());
}

/** Lo que recibe la persona al abrir su credencial para armar el QR que rota. */
export function buildLiveGrant(passId: string, keys: EventQrKeys): LiveGrant {
  const seed = credentialSeed(passId, keys);
  const credentialKey = publicKeyFromSeed(seed);
  const certificateSignature = signWithSeed(keys.privateKey, certificateMessage(passId, credentialKey));
  const certificate = new Uint8Array(credentialKey.length + certificateSignature.length);
  certificate.set(credentialKey);
  certificate.set(certificateSignature, credentialKey.length);
  return { passId, seed: bytesToBase64url(seed), certificate: base32Encode(certificate) };
}

/** Devuelve el pase si el QR es auténtico (impreso, o del celular y de esta ventana), o por qué no lo es. */
export function verifyQrPayload(payload: string, eventPublicKey: Uint8Array, nowMs: number = Date.now()) {
  return verifyQrPayloadInBrowser(payload, eventPublicKey, nowMs);
}
