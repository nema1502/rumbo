// Lo que comparten el servidor y el navegador sobre el QR de la credencial: su forma, los mensajes que
// se firman y el base32. Las firmas son Ed25519 (src/lib/ed25519.ts) y todo viaja en mayúsculas, dígitos
// y puntos, para que el QR use el modo alfanumérico y salga chico.
//
// Hay dos QR, y el escáner los distingue por cuántos pedazos trae:
//
//   Impresa (fija):  <pase>.<firma>
//     Ocho letras y números del pase y la firma del evento (103 letras) sobre el id. Es la que lleva la
//     credencial que se descarga para imprimir. Vale siempre, y el escáner la muestra como "impresa".
//
//   En el celular (rota cada 20 segundos):  <pase>.<ventana>.<certificado>.<firma>
//     La ventana de tiempo (seis letras), el certificado de la credencial (154 letras: su clave pública
//     y la firma del evento que la liga a este pase) y la firma de la ventana con la clave de la
//     credencial. El escáner solo tiene la clave pública del evento: con ella comprueba el certificado
//     y, con la clave que el certificado trae, la firma de la ventana. La clave privada de cada
//     credencial la deriva el servidor y la recibe la persona al abrir su credencial con conexión;
//     nadie puede armar el QR de otro pase porque no tiene el certificado de ese pase.

export const PASS_ID_BYTES = 5;
export const PASS_ID_LENGTH = 8;
export const ED25519_KEY_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;
/** El certificado de una credencial: su clave pública y la firma del evento sobre ella. */
export const CERTIFICATE_BYTES = ED25519_KEY_BYTES + ED25519_SIGNATURE_BYTES;

/** Cada cuántos segundos cambia el QR del celular. */
export const WINDOW_SECONDS = 20;
/** La ventana en base32: treinta bits, seis letras. */
export const WINDOW_LENGTH = 6;
const WINDOW_LIMIT = 2 ** 30;
/**
 * Cuántas ventanas se aceptan además de la actual: una atrás (el celular de la persona va atrasado, o el
 * escáner leyó justo al cambiar) y una adelante (al revés). La de adelante no deja usar una captura vieja:
 * una captura solo puede ser de una ventana que ya empezó.
 */
export const WINDOWS_BEHIND = 1;
export const WINDOWS_AHEAD = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PASS_ID_RE = /^[A-Z2-7]{8}$/;

const encoder = new TextEncoder();

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

/** Base32 sin relleno, estricto: null si hay una letra que no es del alfabeto o sobran bits distintos de cero. */
export function base32Decode(text: string, expectedBytes: number): Uint8Array | null {
  if (text.length !== Math.ceil((expectedBytes * 8) / 5)) return null;
  const out = new Uint8Array(expectedBytes);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of text) {
    const digit = BASE32_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      out[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return value === 0 ? out : null;
}

export function isValidPassId(id: string): boolean {
  return PASS_ID_RE.test(id);
}

export const SIGNATURE_LENGTH = Math.ceil((ED25519_SIGNATURE_BYTES * 8) / 5);
export const CERTIFICATE_LENGTH = Math.ceil((CERTIFICATE_BYTES * 8) / 5);

// ---------- La ventana de tiempo ----------

/** La ventana en la que cae un instante (milisegundos desde 1970). */
export function windowOf(ms: number): number {
  return Math.floor(ms / 1000 / WINDOW_SECONDS);
}

/** Cuántos milisegundos faltan para que cambie el QR. */
export function msUntilNextWindow(ms: number): number {
  const length = WINDOW_SECONDS * 1000;
  return length - (ms % length);
}

export function windowToBase32(window: number): string {
  if (!Number.isInteger(window) || window < 0 || window >= WINDOW_LIMIT) throw new Error(`La ventana ${window} no entra en el QR`);
  let out = "";
  for (let shift = (WINDOW_LENGTH - 1) * 5; shift >= 0; shift -= 5) out += BASE32_ALPHABET[Math.floor(window / 2 ** shift) % 32];
  return out;
}

function windowFromBase32(text: string): number | null {
  if (text.length !== WINDOW_LENGTH) return null;
  let value = 0;
  for (const char of text) {
    const digit = BASE32_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    value = value * 32 + digit;
  }
  return value;
}

// ---------- Lo que se firma ----------
// Cada firma lleva su propio rótulo adelante: la firma de una cosa no sirve como la de otra.

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Lo que firma el evento para la credencial impresa. */
export function printedMessage(passId: string): Uint8Array {
  return encoder.encode(`rumbo.qr.impresa.${passId}`);
}

/** Lo que firma el evento para ligar la clave de una credencial a su pase. */
export function certificateMessage(passId: string, credentialKey: Uint8Array): Uint8Array {
  return concat(encoder.encode(`rumbo.qr.certificado.${passId}.`), credentialKey);
}

/** Lo que firma la credencial en cada ventana. */
export function windowMessage(passId: string, window: number): Uint8Array {
  return encoder.encode(`rumbo.qr.ventana.${passId}.${window}`);
}

// ---------- Armar y separar el QR ----------

export function joinPrintedPayload(passId: string, signature: Uint8Array): string {
  return `${passId}.${base32Encode(signature)}`;
}

export function joinLivePayload(passId: string, window: number, certificate: string, signature: Uint8Array): string {
  return `${passId}.${windowToBase32(window)}.${certificate}.${base32Encode(signature)}`;
}

export type ParsedQr =
  | { via: "printed"; passId: string; signature: Uint8Array }
  | { via: "live"; passId: string; window: number; credentialKey: Uint8Array; certificateSignature: Uint8Array; signature: Uint8Array };

/** Separa el contenido del QR. Devuelve null si no tiene la forma esperada. */
export function parseQrPayload(payload: string): ParsedQr | null {
  const parts = payload.trim().toUpperCase().split(".");
  const passId = parts[0] ?? "";
  if (!PASS_ID_RE.test(passId)) return null;
  if (parts.length === 2) {
    const signature = base32Decode(parts[1] ?? "", ED25519_SIGNATURE_BYTES);
    return signature ? { via: "printed", passId, signature } : null;
  }
  if (parts.length === 4) {
    const window = windowFromBase32(parts[1] ?? "");
    const certificate = base32Decode(parts[2] ?? "", CERTIFICATE_BYTES);
    const signature = base32Decode(parts[3] ?? "", ED25519_SIGNATURE_BYTES);
    if (window === null || !certificate || !signature) return null;
    return { via: "live", passId, window, credentialKey: certificate.slice(0, ED25519_KEY_BYTES), certificateSignature: certificate.slice(ED25519_KEY_BYTES), signature };
  }
  return null;
}

/**
 * Cómo salió la verificación de un QR. Un QR que venció (la firma es buena pero la ventana ya pasó, por
 * ejemplo una captura de pantalla) trae igual el pase, para poder decir de quién es.
 */
export type QrVerification =
  | { ok: true; passId: string; via: "printed" | "live" }
  | { ok: false; reason: "malformed" | "bad_signature" }
  | { ok: false; reason: "expired"; passId: string };

/** Compara dos textos sin que el tiempo delate en qué letra difieren. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** La clave pública del evento y la semilla de cada credencial viajan en base64url. */
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
