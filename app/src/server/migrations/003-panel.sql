-- El panel de quien organiza (src/server/panel.ts): la clave con la que entra al panel de cada evento,
-- los códigos de puesto que reciben los voluntarios y el registro de cada contraste con la cadena.

-- Una clave por evento. Viaja en el enlace del panel (?k=) y queda en una cookie del navegador.
CREATE TABLE IF NOT EXISTS organizer_keys (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- Los códigos con los que un voluntario abre su puesto en el escáner: uno para la puerta
-- (kind = 'gate', sin beneficio) y uno por beneficio canjeable (kind = 'benefit').
CREATE TABLE IF NOT EXISTS station_codes (
  code TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('gate', 'benefit')),
  benefit_id TEXT REFERENCES benefits(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS station_codes_gate ON station_codes(event_id) WHERE kind = 'gate';
CREATE UNIQUE INDEX IF NOT EXISTS station_codes_benefit ON station_codes(event_id, benefit_id) WHERE kind = 'benefit';

-- Cada vez que el panel contrasta el espejo con la cadena: cuándo fue y qué encontró (JSON).
CREATE TABLE IF NOT EXISTS chain_syncs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  synced_at TEXT NOT NULL,
  summary TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chain_syncs_event ON chain_syncs(event_id, synced_at);
