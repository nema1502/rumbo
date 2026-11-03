-- El QR de la credencial se firma con una llave pública (Ed25519) en vez de una llave compartida con el escáner
-- (migrations/006-llaves-ed25519.sql). Una fila por evento, que se crea la primera vez que hace falta.
--
-- La llave privada y la raíz de las credenciales van cifradas con RUMBO_DATA_KEY (AES-256-GCM, con el evento y
-- la columna como dato asociado): quien lea la base no puede firmar credenciales. La clave pública va en claro,
-- porque es lo único que recibe el escáner.
CREATE TABLE IF NOT EXISTS event_qr_keys (
  event_id text PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  -- La clave pública (32 bytes).
  public_key bytea NOT NULL,
  -- La semilla de la llave privada, cifrada: firma las credenciales impresas y los certificados.
  private_key bytea NOT NULL,
  -- La raíz de la que se derivan las llaves de cada credencial, cifrada.
  credential_root bytea NOT NULL,
  created_at timestamptz NOT NULL
);

-- La llave compartida de antes se borra: los QR viejos dejan de valer.
ALTER TABLE events DROP COLUMN IF EXISTS qr_key;
