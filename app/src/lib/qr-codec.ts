// Lo que comparten el servidor y el navegador sobre el QR de la credencial: su forma y el base32.
// El QR lleva "<passId>.<firma>": ocho letras y números del pase, un punto, y dieciséis de la firma
// (los primeros 10 bytes del HMAC-SHA256 del id con la llave del evento, en base32).
// Todo en mayúsculas y dígitos para que el QR use el modo alfanumérico y salga chico.

export const QR_SIG_BYTES = 10;
export const PASS_ID_BYTES = 5;
export const PASS_ID_LENGTH = 8;
export const QR_SIG_LENGTH = 16;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PASS_ID_RE = /^[A-Z2-7]{8}$/;
const SIG_RE = /^[A-Z2-7]{16}$/;

/** Base32 (RFC 4648) sin relleno. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function isValidPassId(id: string): boolean {
  return PASS_ID_RE.test(id);
}

export function joinQrPayload(passId: string, signature: string): string {
  return `${passId}.${signature}`;
}

/** Separa el contenido del QR. Devuelve null si no tiene la forma esperada. */
export function splitQrPayload(payload: string): { passId: string; signature: string } | null {
  const text = payload.trim().toUpperCase();
  const dot = text.indexOf(".");
  if (dot < 0) return null;
  const passId = text.slice(0, dot);
  const signature = text.slice(dot + 1);
  if (!PASS_ID_RE.test(passId) || !SIG_RE.test(signature)) return null;
  return { passId, signature };
}

/** Compara dos textos sin que el tiempo delate en qué letra difieren. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type QrVerification = { ok: true; passId: string } | { ok: false; reason: "malformed" | "bad_signature" };

/** La llave del evento viaja al escáner en base64url. */
export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlToBytes(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
