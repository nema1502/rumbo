-- Coorganizar: quién coorganiza cada evento, las invitaciones de un solo uso (solo la huella SHA-256 del enlace,
-- nunca el enlace) y las cuentas autorizadas que todavía no entraron (migrations/020-coorganizadores.sql). Sin
-- correos ni llaves. Como toda tabla nueva, con el acceso por fila prendido (011-acceso-por-fila.sql): por la API
-- de Supabase nadie las lee ni las escribe.
CREATE TABLE IF NOT EXISTS event_coorganizers (
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organizer_id text NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  added_by text REFERENCES organizers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (event_id, organizer_id)
);
CREATE INDEX IF NOT EXISTS event_coorganizers_organizer ON event_coorganizers(organizer_id);

CREATE TABLE IF NOT EXISTS event_invites (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by text REFERENCES organizers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by text REFERENCES organizers(id) ON DELETE SET NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS event_invites_event ON event_invites(event_id, created_at);

CREATE TABLE IF NOT EXISTS event_account_grants (
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  public_key text NOT NULL,
  granted_by text REFERENCES organizers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (event_id, public_key)
);
CREATE INDEX IF NOT EXISTS event_account_grants_account ON event_account_grants(public_key);

ALTER TABLE event_coorganizers ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_account_grants ENABLE ROW LEVEL SECURITY;
