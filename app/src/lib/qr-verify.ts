// Verificar el QR de una credencial en el navegador, sin red, con WebCrypto.
// El escáner del voluntario recibe la llave del evento al abrirlo con conexión y la guarda
// en su cola local; con eso comprueba que cada QR es auténtico aunque el wifi se caiga.
import {
  QR_SIG_BYTES,
  base32Encode,
  base64urlToBytes,
  constantTimeEqual,
  splitQrPayload,
  type QrVerification,
} from "./qr-codec.ts";

export type { QrVerification } from "./qr-codec.ts";

/** Prepara la llave del evento (bytes, o el texto en base64url que manda el servidor). */
export async function importQrKey(key: Uint8Array | string): Promise<CryptoKey> {
  const bytes = typeof key === "string" ? base64urlToBytes(key) : key;
  const buffer = new Uint8Array(bytes).buffer;
  return crypto.subtle.importKey("raw", buffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function signPassIdInBrowser(passId: string, key: CryptoKey): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(passId));
  return base32Encode(new Uint8Array(mac).subarray(0, QR_SIG_BYTES));
}

/** Devuelve el id del pase si la firma es válida, o por qué no lo es. */
export async function verifyQrPayloadInBrowser(payload: string, key: CryptoKey): Promise<QrVerification> {
  const parts = splitQrPayload(payload);
  if (!parts) return { ok: false, reason: "malformed" };
  const expected = await signPassIdInBrowser(parts.passId, key);
  return constantTimeEqual(expected, parts.signature) ? { ok: true, passId: parts.passId } : { ok: false, reason: "bad_signature" };
}
