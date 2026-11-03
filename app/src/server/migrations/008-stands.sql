-- Los stands de quienes auspician y la ruta de visitas (src/server/stands.ts). Todo vive fuera de la cadena,
-- solo en la base: nombres y correos nunca van al contrato.

-- Un stand por auspiciante. El beneficio es opcional: lo que el auspiciante regala y se canjea en su mesa
-- (una polera, una taza), para que el informe sume sus canjes.
CREATE TABLE IF NOT EXISTS stands (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_url TEXT,
  benefit_id TEXT REFERENCES benefits(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stands_event ON stands(event_id);

-- La meta de la ruta ("visitá 4 de 6 stands") y el beneficio que se otorga al completarla.
CREATE TABLE IF NOT EXISTS route_goals (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  target INTEGER NOT NULL CHECK (target >= 1),
  prize_benefit_id TEXT REFERENCES benefits(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

-- Un sello por persona y stand. El permiso para compartir el contacto vive en la misma fila: empieza en
-- "pending" (sin responder, no se comparte nada) y solo la persona lo cambia, desde su credencial. La
-- calificación y la nota las escribe quien atiende el stand, y solo existen mientras el permiso es "granted".
CREATE TABLE IF NOT EXISTS stand_visits (
  id TEXT PRIMARY KEY,
  -- El id que le puso el escáner en su cola local: si reintenta, no se duplica.
  client_id TEXT UNIQUE,
  stand_id TEXT NOT NULL REFERENCES stands(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  pass_id TEXT NOT NULL REFERENCES passes(id) ON DELETE CASCADE,
  scanner_id TEXT,
  scanned_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consent TEXT NOT NULL DEFAULT 'pending' CHECK (consent IN ('pending', 'granted', 'declined')),
  consent_at TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  note TEXT,
  UNIQUE (stand_id, pass_id)
);
CREATE INDEX IF NOT EXISTS stand_visits_pass ON stand_visits(pass_id);
CREATE INDEX IF NOT EXISTS stand_visits_event ON stand_visits(event_id);

-- Cómo aparece una persona en la pantalla del evento: un alias que ella elige, o nada (anónimo).
-- Sin fila, aparece con su nombre de pila. Nunca el correo.
CREATE TABLE IF NOT EXISTS route_display (
  pass_id TEXT PRIMARY KEY REFERENCES passes(id) ON DELETE CASCADE,
  alias TEXT,
  hidden INTEGER NOT NULL DEFAULT 0
);

-- Los códigos de puesto suman el tipo "stand": cada stand tiene el suyo, con el que su gente abre el escáner
-- y su panel. SQLite no cambia una restricción CHECK: se rehace la tabla con los mismos datos.
CREATE TABLE station_codes_nueva (
  code TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('gate', 'benefit', 'stand')),
  benefit_id TEXT REFERENCES benefits(id) ON DELETE CASCADE,
  stand_id TEXT REFERENCES stands(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
INSERT INTO station_codes_nueva (code, event_id, kind, benefit_id, created_at)
  SELECT code, event_id, kind, benefit_id, created_at FROM station_codes;
DROP TABLE station_codes;
ALTER TABLE station_codes_nueva RENAME TO station_codes;
CREATE UNIQUE INDEX station_codes_gate ON station_codes(event_id) WHERE kind = 'gate';
CREATE UNIQUE INDEX station_codes_benefit ON station_codes(event_id, benefit_id) WHERE kind = 'benefit';
CREATE UNIQUE INDEX station_codes_stand ON station_codes(stand_id) WHERE kind = 'stand';
