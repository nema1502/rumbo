-- El QR de la credencial se firma con una llave pública (Ed25519) en vez de una llave compartida con el
-- escáner: el celular de un voluntario solo recibe la clave pública del evento y no puede fabricar
-- credenciales (src/server/qr-keys.ts, src/server/qr.ts).
--
-- Una fila por evento, que se crea la primera vez que hace falta. SOLO RED DE PRUEBA: en producción la
-- llave privada va en un almacén de secretos, no en la base.
CREATE TABLE IF NOT EXISTS event_qr_keys (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  -- La clave pública (32 bytes): la recibe el escáner al abrir un puesto.
  public_key BLOB NOT NULL,
  -- La semilla de la llave privada (32 bytes): firma las credenciales impresas y los certificados.
  private_key BLOB NOT NULL,
  -- La raíz de la que se derivan las llaves de cada credencial (32 bytes).
  credential_root BLOB NOT NULL,
  created_at TEXT NOT NULL
);

-- La llave compartida de antes (HMAC) se borra: los QR viejos dejan de valer.
ALTER TABLE events DROP COLUMN qr_key;
