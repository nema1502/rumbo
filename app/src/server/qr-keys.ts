// Las llaves con las que se firman los QR de cada evento (tabla event_qr_keys, migración 006). La privada
// y la raíz de las credenciales no salen de acá: ni al navegador de quien asiste ni al escáner. Con Postgres
// se guardan cifradas con RUMBO_DATA_KEY (src/server/base/cifrado.ts), cada una atada a su evento y su columna.
import { getDb } from "./base/index.ts";
import { newEventQrKeys, type EventQrKeys } from "./qr.ts";

const context = (eventId: string, column: "private_key" | "credential_root") => `event_qr_keys.${column}:${eventId}`;

async function readKeys(eventId: string): Promise<EventQrKeys | null> {
  const db = getDb();
  const row = await db.one("SELECT public_key, private_key, credential_root FROM event_qr_keys WHERE event_id = ?", [eventId]);
  if (!row) return null;
  return {
    publicKey: new Uint8Array(row.public_key as Uint8Array),
    privateKey: db.secrets.openBytes(row.private_key, context(eventId, "private_key")),
    credentialRoot: db.secrets.openBytes(row.credential_root, context(eventId, "credential_root")),
  };
}

/**
 * Las llaves del evento si ya las tiene; null si no. No crea nada: es para lo que llega de afuera con un id de
 * evento que nadie comprobó (una ficha de sesión), que no tiene que generar llaves ni chocar con la clave
 * foránea de un evento que no existe.
 */
export async function findEventQrKeys(eventId: string): Promise<EventQrKeys | null> {
  return readKeys(eventId);
}

/** Las llaves del evento. Las crea la primera vez que hacen falta: solo para un evento que existe. */
export async function getEventQrKeys(eventId: string): Promise<EventQrKeys> {
  const found = await readKeys(eventId);
  if (found) return found;
  // Si dos pedidos llegan a la vez, gana el primero y el otro lee las llaves que quedaron.
  const db = getDb();
  const fresh = newEventQrKeys();
  await db.run("INSERT INTO event_qr_keys (event_id, public_key, private_key, credential_root, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING", [
    eventId,
    fresh.publicKey,
    db.secrets.sealBytes(fresh.privateKey, context(eventId, "private_key")),
    db.secrets.sealBytes(fresh.credentialRoot, context(eventId, "credential_root")),
    new Date().toISOString(),
  ]);
  return (await readKeys(eventId)) as EventQrKeys;
}

/** La clave pública del evento: lo único que recibe el escáner del voluntario. */
export async function getEventPublicKey(eventId: string): Promise<Uint8Array> {
  return (await getEventQrKeys(eventId)).publicKey;
}
