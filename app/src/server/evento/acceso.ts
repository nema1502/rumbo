// La clave de acceso de la credencial: un secreto al azar por pase, guardado en la base, que va en el
// enlace personal (/p/<pase>?k=<clave>). No es la firma del QR: con la clave se abre la página, nada más.
// La tabla la crea la migración 002, en la base de siempre (src/server/base).
import { randomBytes, timingSafeEqual } from "node:crypto";
import { bytesToBase64url } from "../../lib/qr-codec.ts";
import { getDb } from "../base/index.ts";

const ACCESS_KEY_BYTES = 16;
/** Dieciséis bytes en base64url: veintidós letras, números, guiones y guiones bajos. */
const ACCESS_KEY_RE = /^[A-Za-z0-9_-]{22}$/;

export function newAccessKey(): string {
  return bytesToBase64url(new Uint8Array(randomBytes(ACCESS_KEY_BYTES)));
}

/** Si el texto tiene la forma de una clave de acceso (no dice si es la correcta). */
export function isAccessKeyShaped(key: unknown): key is string {
  return typeof key === "string" && ACCESS_KEY_RE.test(key);
}

export async function getAccessKey(passId: string): Promise<string | null> {
  const row = await getDb().one("SELECT access_key FROM pass_access WHERE pass_id = ?", [passId]);
  return row ? String(row.access_key) : null;
}

/** La clave del pase; la crea si todavía no tiene. */
export async function getOrCreateAccessKey(passId: string): Promise<string> {
  const existing = await getAccessKey(passId);
  if (existing) return existing;
  await getDb().run("INSERT INTO pass_access (pass_id, access_key, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", [passId, newAccessKey(), new Date().toISOString()]);
  const key = await getAccessKey(passId);
  if (!key) throw new Error(`No pude guardar la clave de acceso del pase ${passId}`);
  return key;
}

/** Compara sin que el tiempo delate en qué letra difieren. */
export async function verifyAccessKey(passId: string, key: unknown): Promise<boolean> {
  if (!isAccessKeyShaped(key)) return false;
  const stored = await getAccessKey(passId);
  if (!stored || stored.length !== key.length) return false;
  return timingSafeEqual(Buffer.from(stored, "utf8"), Buffer.from(key, "utf8"));
}
