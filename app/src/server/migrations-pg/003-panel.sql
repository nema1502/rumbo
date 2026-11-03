-- El panel de quien organiza (migrations/003-panel.sql): la clave de cada evento, los códigos de puesto de los
-- voluntarios y el registro de cada contraste con la cadena.

-- Una clave por evento. Viaja en el enlace del panel (?k=) y queda en una cookie del navegador.
CREATE TABLE IF NOT EXISTS organizer_keys (
  event_id text PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

-- Los códigos con los que un voluntario abre su puesto: uno para la puerta (kind = 'gate') y uno por
-- beneficio canjeable (kind = 'benefit'). La restricción lleva nombre para que la 008 la pueda cambiar.
CREATE TABLE IF NOT EXISTS station_codes (
  code text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind text NOT NULL CONSTRAINT station_codes_kind_check CHECK (kind IN ('gate', 'benefit')),
  benefit_id text REFERENCES benefits(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS station_codes_event ON station_codes(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS station_codes_gate ON station_codes(event_id) WHERE kind = 'gate';
CREATE UNIQUE INDEX IF NOT EXISTS station_codes_benefit ON station_codes(event_id, benefit_id) WHERE kind = 'benefit';

-- Cada vez que el panel contrasta el espejo con la cadena: cuándo fue y qué encontró.
CREATE TABLE IF NOT EXISTS chain_syncs (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  synced_at timestamptz NOT NULL,
  summary jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS chain_syncs_event ON chain_syncs(event_id, synced_at);
