-- La cuenta de organizador, sus sesiones (el id es el SHA-256 de la ficha de la cookie, nunca la ficha) y de
-- quién es cada evento (migrations/018-organizadores.sql). Sin correos. Como toda tabla nueva, con el acceso
-- por fila prendido (011-acceso-por-fila.sql): por la API de Supabase nadie las lee ni las escribe.
CREATE TABLE IF NOT EXISTS organizers (
  id text PRIMARY KEY,
  public_key text NOT NULL UNIQUE,
  provider text NOT NULL,
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  last_login_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS organizer_sessions (
  id text PRIMARY KEY,
  organizer_id text NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS organizer_sessions_organizer ON organizer_sessions(organizer_id);

ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_id text REFERENCES organizers(id);
CREATE INDEX IF NOT EXISTS events_organizer ON events(organizer_id, created_at);

ALTER TABLE organizers ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizer_sessions ENABLE ROW LEVEL SECURITY;
