// La firma del QR de la credencial, en el servidor. El QR lleva "<passId>.<firma>", donde la firma son
// los primeros 10 bytes del HMAC-SHA256 del id del pase con la llave del evento, en base32.
// La llave es una por evento, vive en la base y nunca llega al navegador de quien asiste: solo al
// escáner del voluntario, cuando abre el evento con red (ver src/lib/qr-verify.ts).
import { createHmac, randomBytes } from "node:crypto";
import {
  PASS_ID_BYTES,
  QR_SIG_BYTES,
  base32Encode,
  constantTimeEqual,
  isValidPassId,
  joinQrPayload,
  splitQrPayload,
  type QrVerification,
} from "../lib/qr-codec.ts";

export type { QrVerification } from "../lib/qr-codec.ts";
export { bytesToBase64url, base64urlToBytes } from "../lib/qr-codec.ts";

export const QR_KEY_BYTES = 32;

/** La llave de un evento nuevo. */
export function newEventQrKey(): Uint8Array {
  return new Uint8Array(randomBytes(QR_KEY_BYTES));
}

/** Un id de pase nuevo: ocho letras y números, al azar. */
export function newPassId(): string {
  return base32Encode(new Uint8Array(randomBytes(PASS_ID_BYTES)));
}

/** La firma corta de un id de pase con la llave del evento. */
export function signPassId(passId: string, key: Uint8Array): string {
  const mac = createHmac("sha256", key).update(passId, "utf8").digest();
  return base32Encode(new Uint8Array(mac.subarray(0, QR_SIG_BYTES)));
}

/** Lo que va dentro del QR de la credencial. */
export function buildQrPayload(passId: string, key: Uint8Array): string {
  if (!isValidPassId(passId)) throw new Error(`El id de pase ${passId} no tiene la forma esperada`);
  return joinQrPayload(passId, signPassId(passId, key));
}

/** Devuelve el id del pase si la firma es válida, o por qué no lo es. */
export function verifyQrPayload(payload: string, key: Uint8Array): QrVerification {
  const parts = splitQrPayload(payload);
  if (!parts) return { ok: false, reason: "malformed" };
  const expected = signPassId(parts.passId, key);
  return constantTimeEqual(expected, parts.signature) ? { ok: true, passId: parts.passId } : { ok: false, reason: "bad_signature" };
}
