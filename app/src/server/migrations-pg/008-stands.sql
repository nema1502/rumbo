-- Los stands de quienes auspician y la ruta de visitas (migrations/008-stands.sql). Todo vive fuera de la
-- cadena: nombres y correos nunca van al contrato.

-- Un stand por auspiciante, con el beneficio opcional que regala y se canjea en su mesa.
CREATE TABLE IF NOT EXISTS stands (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  logo_url text,
  benefit_id text REFERENCES benefits(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS stands_event ON stands(event_id);

-- La meta de la ruta ("visitá 4 de 6 stands") y el beneficio que se otorga al completarla.
CREATE TABLE IF NOT EXISTS route_goals (
  event_id text PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  target integer NOT NULL CHECK (target >= 1),
  prize_benefit_id text REFERENCES benefits(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL
);

-- Un sello por persona y stand, con el permiso para compartir el contacto (empieza sin responder) y la
-- calificación y la nota de quien atiende el stand.
CREATE TABLE IF NOT EXISTS stand_visits (
  id text PRIMARY KEY,
  client_id text UNIQUE,
  stand_id text NOT NULL REFERENCES stands(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  pass_id text NOT NULL REFERENCES passes(id) ON DELETE CASCADE,
  scanner_id text,
  scanned_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  consent text NOT NULL DEFAULT 'pending' CHECK (consent IN ('pending', 'granted', 'declined')),
  consent_at timestamptz,
  rating integer CHECK (rating BETWEEN 1 AND 5),
  note text,
  UNIQUE (stand_id, pass_id)
);
CREATE INDEX IF NOT EXISTS stand_visits_pass ON stand_visits(pass_id);
CREATE INDEX IF NOT EXISTS stand_visits_event ON stand_visits(event_id);

-- Cómo aparece una persona en la pantalla del evento: un alias que ella elige, o nada (anónimo).
CREATE TABLE IF NOT EXISTS route_display (
  pass_id text PRIMARY KEY REFERENCES passes(id) ON DELETE CASCADE,
  alias text,
  hidden boolean NOT NULL DEFAULT false
);

-- Los códigos de puesto suman el tipo "stand", con el stand que abren. En Postgres la restricción se cambia
-- en el lugar (SQLite tenía que rehacer la tabla).
ALTER TABLE station_codes DROP CONSTRAINT IF EXISTS station_codes_kind_check;
ALTER TABLE station_codes ADD CONSTRAINT station_codes_kind_check CHECK (kind IN ('gate', 'benefit', 'stand'));
ALTER TABLE station_codes ADD COLUMN IF NOT EXISTS stand_id text REFERENCES stands(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS station_codes_stand ON station_codes(stand_id) WHERE kind = 'stand';
