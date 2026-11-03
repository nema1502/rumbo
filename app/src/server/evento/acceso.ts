// La clave de acceso de la credencial: un secreto al azar por pase, guardado en la base, que va en el
// enlace personal (/p/<pase>?k=<clave>). No es la firma del QR: con la clave se abre la página, nada más.
//
// Usa su propia conexión a la misma base SQLite (en modo WAL varias conexiones conviven). La tabla la
// crea la migración 002, que el repo aplica al abrir la base: por eso acá se llama a getRepo() primero.
import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { bytesToBase64url } from "../../lib/qr-codec.ts";
import { dataDir, getEnv } from "../env.ts";
import { getRepo } from "../repo.ts";

const ACCESS_KEY_BYTES = 16;
/** Dieciséis bytes en base64url: veintidós letras, números, guiones y guiones bajos. */
const ACCESS_KEY_RE = /^[A-Za-z0-9_-]{22}$/;

declare global {
  // Una sola conexión por proceso, que sobrevive a las recargas en caliente de next dev.
  var __rumboAccessDb: DatabaseSync | undefined;
}

function connection(): DatabaseSync {
  if (globalThis.__rumboAccessDb) return globalThis.__rumboAccessDb;
  if (getEnv("RUMBO_REPO", "sqlite") !== "sqlite") {
    throw new Error("TODO: las claves de acceso de las credenciales solo están hechas para RUMBO_REPO=sqlite.");
  }
  getRepo();
  const sqlite = process.getBuiltinModule("node:sqlite") as unknown as typeof import("node:sqlite") | undefined;
  if (!sqlite) throw new Error("Esta versión de Node no trae node:sqlite. Hace falta Node 24 o más nuevo.");
  const db = new sqlite.DatabaseSync(path.join(dataDir(), "rumbo.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  globalThis.__rumboAccessDb = db;
  return db;
}

export function newAccessKey(): string {
  return bytesToBase64url(new Uint8Array(randomBytes(ACCESS_KEY_BYTES)));
}

/** Si el texto tiene la forma de una clave de acceso (no dice si es la correcta). */
export function isAccessKeyShaped(key: unknown): key is string {
  return typeof key === "string" && ACCESS_KEY_RE.test(key);
}

export function getAccessKey(passId: string): string | null {
  const row = connection().prepare("SELECT access_key FROM pass_access WHERE pass_id = ?").get(passId) as { access_key: string } | undefined;
  return row?.access_key ?? null;
}

/** La clave del pase; la crea si todavía no tiene. */
export function getOrCreateAccessKey(passId: string): string {
  const existing = getAccessKey(passId);
  if (existing) return existing;
  connection()
    .prepare("INSERT OR IGNORE INTO pass_access (pass_id, access_key, created_at) VALUES (?, ?, ?)")
    .run(passId, newAccessKey(), new Date().toISOString());
  const key = getAccessKey(passId);
  if (!key) throw new Error(`No pude guardar la clave de acceso del pase ${passId}`);
  return key;
}

/** Compara sin que el tiempo delate en qué letra difieren. */
export function verifyAccessKey(passId: string, key: unknown): boolean {
  if (!isAccessKeyShaped(key)) return false;
  const stored = getAccessKey(passId);
  if (!stored || stored.length !== key.length) return false;
  return timingSafeEqual(Buffer.from(stored, "utf8"), Buffer.from(key, "utf8"));
}
