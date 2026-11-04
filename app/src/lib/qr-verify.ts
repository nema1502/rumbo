// Verificar el QR de una credencial en el navegador, sin red.
// El escáner del voluntario recibe la clave pública del evento al abrir el puesto con conexión y la guarda
// con su sesión; con eso comprueba que cada QR es auténtico aunque el wifi se caiga. La clave privada no
// sale nunca del servidor: un celular de voluntario perdido no sirve para fabricar credenciales.
import { ed25519Verify } from "./ed25519.ts";
import {
  ED25519_KEY_BYTES,
  WINDOWS_AHEAD,
  WINDOWS_BEHIND,
  base64urlToBytes,
  certificateMessage,
  parseQrPayload,
  printedMessage,
  windowMessage,
  windowOf,
  type QrVerification,
} from "./qr-codec.ts";

export type { QrVerification } from "./qr-codec.ts";

/** Prepara la clave pública del evento (bytes, o el texto en base64url que manda el servidor). */
export function importEventKey(key: Uint8Array | string): Uint8Array {
  const bytes = typeof key === "string" ? base64urlToBytes(key) : key;
  if (bytes.length !== ED25519_KEY_BYTES) throw new Error("La clave del evento no tiene la forma esperada");
  return bytes;
}

/** Lo que dicen las firmas de un QR, sin mirar la ventana de tiempo: de qué pase es y cómo se leyó, o por qué no vale. */
export type QrSignatureVerification =
  | { ok: true; passId: string; via: "printed" | "live"; window: number | null }
  | { ok: false; reason: "malformed" | "bad_signature" };

/**
 * Comprueba solo las firmas del QR: que lo firmó el evento (la impresa, o el certificado de la del celular) y,
 * en la del celular, que la ventana la firmó la clave de esa credencial. No mira si la ventana ya pasó: eso lo
 * decide quien llama. El servidor lo usa con lo que la cola del escáner sube tarde (una visita a un stand de
 * hace una hora): la ventana venció, pero la credencial era auténtica y de ese pase.
 */
export async function verifyQrSignature(payload: string, eventKey: Uint8Array): Promise<QrSignatureVerification> {
  const parsed = parseQrPayload(payload);
  if (!parsed) return { ok: false, reason: "malformed" };

  if (parsed.via === "printed") {
    const valid = await ed25519Verify(eventKey, printedMessage(parsed.passId), parsed.signature);
    return valid ? { ok: true, passId: parsed.passId, via: "printed", window: null } : { ok: false, reason: "bad_signature" };
  }

  // El certificado liga la clave de la credencial a este pase; la firma de la ventana la hizo esa clave.
  const certified = await ed25519Verify(eventKey, certificateMessage(parsed.passId, parsed.credentialKey), parsed.certificateSignature);
  if (!certified) return { ok: false, reason: "bad_signature" };
  const signed = await ed25519Verify(parsed.credentialKey, windowMessage(parsed.passId, parsed.window), parsed.signature);
  if (!signed) return { ok: false, reason: "bad_signature" };
  return { ok: true, passId: parsed.passId, via: "live", window: parsed.window };
}

/**
 * Devuelve el pase si el QR es auténtico, o por qué no lo es. `nowMs` es la hora del escáner (corregida con
 * la del servidor, si la sabe). El QR impreso vale siempre; el del celular, solo en su ventana de tiempo,
 * la anterior y la siguiente.
 */
export async function verifyQrPayloadInBrowser(payload: string, eventKey: Uint8Array, nowMs: number = Date.now()): Promise<QrVerification> {
  const signed = await verifyQrSignature(payload, eventKey);
  if (!signed.ok) return signed;
  if (signed.window !== null) {
    const current = windowOf(nowMs);
    if (signed.window < current - WINDOWS_BEHIND || signed.window > current + WINDOWS_AHEAD) return { ok: false, reason: "expired", passId: signed.passId };
  }
  return { ok: true, passId: signed.passId, via: signed.via };
}
