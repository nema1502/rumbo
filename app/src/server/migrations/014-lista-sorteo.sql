-- La lista del sorteo congelada (src/server/vivo.ts): los códigos de credencial de quienes participaban en el
-- momento en que quien organiza la congeló, con su hora y su huella SHA-256. Así la lista que se proyecta es
-- la misma que se sortea, aunque alguien entre después. Solo códigos: nada personal.
CREATE TABLE IF NOT EXISTS raffle_lists (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  frozen_at TEXT NOT NULL,
  -- Quiénes entraron en la lista: solo asistentes, o todas las credenciales que entraron.
  scope TEXT NOT NULL CHECK (scope IN ('attendees', 'all')),
  total INTEGER NOT NULL,
  -- Los códigos, como JSON, en el orden de la huella.
  participants TEXT NOT NULL,
  sha256 TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS raffle_lists_event ON raffle_lists(event_id, frozen_at);
