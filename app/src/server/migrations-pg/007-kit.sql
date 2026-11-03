-- El kit listo (migrations/007-kit.sql): plantillas de evento, tipos de credencial, importación de listas,
-- inscripción por equipos, stock por beneficio y restricciones de dieta.

-- De qué plantilla salió el evento y si ya está publicado (un borrador no se ve en la página pública). Los
-- eventos de antes quedan publicados. La hackatón se inscribe por equipos.
ALTER TABLE events ADD COLUMN IF NOT EXISTS template text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true;
ALTER TABLE events ADD COLUMN IF NOT EXISTS team_signup boolean NOT NULL DEFAULT false;

-- Qué tipo de credencial es cada tipo de entrada, y el lugar que ocupa en la plantilla.
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS credential_kind text NOT NULL DEFAULT 'attendee';
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS template_slot text;

-- La clave del beneficio en la plantilla, y cuántos hay (null es sin tope).
ALTER TABLE benefits ADD COLUMN IF NOT EXISTS template_key text;
ALTER TABLE benefits ADD COLUMN IF NOT EXISTS stock integer;

-- La restricción de dieta que la persona dijo al inscribirse. Opcional.
ALTER TABLE passes ADD COLUMN IF NOT EXISTS diet text;

-- Los equipos de una hackatón. El nombre no se repite dentro del evento, sin importar mayúsculas.
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_event_name ON teams(event_id, lower(name));

-- A qué equipo pertenece cada credencial (una sola).
CREATE TABLE IF NOT EXISTS pass_teams (
  pass_id text PRIMARY KEY REFERENCES passes(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pass_teams_team ON pass_teams(team_id);

-- Cada importación de una lista (de Luma, de Bevy o de otra parte): cuándo, de dónde y el resumen.
CREATE TABLE IF NOT EXISTS import_runs (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source text NOT NULL,
  summary jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS import_runs_event ON import_runs(event_id);
ALTER TABLE passes ADD COLUMN IF NOT EXISTS import_run_id text REFERENCES import_runs(id);
CREATE INDEX IF NOT EXISTS passes_import_run ON passes(import_run_id);
