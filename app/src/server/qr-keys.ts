// Las llaves con las que se firman los QR de cada evento (tabla event_qr_keys, migración 006). La privada
// y la raíz de las credenciales no salen de acá: ni al navegador de quien asiste ni al escáner. Una segunda
// conexión a la misma base SQLite, como la del panel (src/server/panel.ts).
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { dataDir, getEnv } from "./env.ts";
import { newEventQrKeys, type EventQrKeys } from "./qr.ts";
import { getRepo } from "./repo.ts";

declare global {
  var __rumboQrKeysDb: DatabaseSync | undefined;
}

function keysDb(): DatabaseSync {
  if (globalThis.__rumboQrKeysDb) return globalThis.__rumboQrKeysDb;
  if (getEnv("RUMBO_REPO", "sqlite") !== "sqlite") {
    throw new Error("TODO: las llaves de los QR solo están hechas para RUMBO_REPO=sqlite. En producción van en un almacén de secretos.");
  }
  getRepo(); // abre la base y aplica las migraciones
  const sqlite = process.getBuiltinModule("node:sqlite") as unknown as typeof import("node:sqlite") | undefined;
  if (!sqlite) throw new Error("Esta versión de Node no trae node:sqlite. Hace falta Node 24 o más nuevo.");
  const db = new sqlite.DatabaseSync(path.join(dataDir(), "rumbo.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  globalThis.__rumboQrKeysDb = db;
  return db;
}

interface KeysRow {
  public_key: Uint8Array;
  private_key: Uint8Array;
  credential_root: Uint8Array;
}

const toKeys = (row: KeysRow): EventQrKeys => ({
  publicKey: new Uint8Array(row.public_key),
  privateKey: new Uint8Array(row.private_key),
  credentialRoot: new Uint8Array(row.credential_root),
});

/** Las llaves del evento. Las crea la primera vez que hacen falta. */
export function getEventQrKeys(eventId: string): EventQrKeys {
  const db = keysDb();
  const select = db.prepare("SELECT public_key, private_key, credential_root FROM event_qr_keys WHERE event_id = ?");
  const row = select.get(eventId) as unknown as KeysRow | undefined;
  if (row) return toKeys(row);
  // Si dos pedidos llegan a la vez, gana el primero y el otro lee las llaves que quedaron.
  const fresh = newEventQrKeys();
  db.prepare("INSERT OR IGNORE INTO event_qr_keys (event_id, public_key, private_key, credential_root, created_at) VALUES (?, ?, ?, ?, ?)").run(
    eventId,
    fresh.publicKey,
    fresh.privateKey,
    fresh.credentialRoot,
    new Date().toISOString(),
  );
  return toKeys(select.get(eventId) as unknown as KeysRow);
}

/** La clave pública del evento: lo único que recibe el escáner del voluntario. */
export function getEventPublicKey(eventId: string): Uint8Array {
  return getEventQrKeys(eventId).publicKey;
}
