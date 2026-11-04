-- La cuenta de organizador (src/server/organizador.ts): quien organiza entra con Google o con su correo por
-- Pollar, igual que quien se inscribe, y prueba que la cuenta de Stellar es suya (SEP-53). Acá no hay correos:
-- solo la clave pública de la cuenta, quién la custodia y el nombre que dio Pollar.
CREATE TABLE IF NOT EXISTS organizers (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

-- Las sesiones: el id es el SHA-256 (en hex) de la ficha que viaja en la cookie, nunca la ficha. Quien lea la
-- base no tiene con qué entrar. Vencen a los treinta días; last_seen_at se escribe como mucho una vez por hora.
CREATE TABLE IF NOT EXISTS organizer_sessions (
  id TEXT PRIMARY KEY,
  organizer_id TEXT NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS organizer_sessions_organizer ON organizer_sessions(organizer_id);

-- De quién es cada evento. Los de muestra y los que crea el servidor MCP quedan sin dueño y siguen con su
-- clave; los que crea alguien con su cuenta se abren también con la sesión. El índice sirve para contar
-- cuántos creó cada cuenta en las últimas veinticuatro horas (el tope de creación).
ALTER TABLE events ADD COLUMN organizer_id TEXT REFERENCES organizers(id);
CREATE INDEX IF NOT EXISTS events_organizer ON events(organizer_id, created_at);
