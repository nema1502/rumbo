-- El kit listo (src/server/kit): plantillas de evento, tipos de credencial, importación de listas,
-- inscripción por equipos, stock por beneficio y restricciones de dieta.

-- De qué plantilla salió el evento (null si se armó a mano) y si ya está publicado. Un evento recién
-- salido de una plantilla es un borrador: se edita en /admin/<evento>/armar y no se ve en la página
-- pública hasta que se publica. Los eventos de antes quedan publicados.
ALTER TABLE events ADD COLUMN template TEXT;
ALTER TABLE events ADD COLUMN published INTEGER NOT NULL DEFAULT 1;
-- La hackatón se inscribe por equipos: nombre del equipo e integrantes (/e/<evento>/equipo).
ALTER TABLE events ADD COLUMN team_signup INTEGER NOT NULL DEFAULT 0;

-- Qué tipo de credencial es cada tipo de entrada: asistente, oradora u orador, mentora o mentor,
-- jurado, voluntaria o voluntario, organización o auspiciante. Solo el tipo "attendee" se ofrece en la
-- página pública; los demás se entregan por invitación (importando la lista). `template_slot` es el lugar
-- que ocupa en la plantilla, para poder editar el borrador.
ALTER TABLE ticket_types ADD COLUMN credential_kind TEXT NOT NULL DEFAULT 'attendee';
ALTER TABLE ticket_types ADD COLUMN template_slot TEXT;

-- Lo mismo para los beneficios: la clave que tienen en la plantilla, y cuántos hay (null es sin tope):
-- 150 poleras, por ejemplo. El panel cuenta cuántas quedan y avisa cuando se acaban.
ALTER TABLE benefits ADD COLUMN template_key TEXT;
ALTER TABLE benefits ADD COLUMN stock INTEGER;

-- La restricción de dieta que la persona dijo al inscribirse (vegetariana, alergias). Opcional. Aparece
-- grande en el escáner de los puestos de comida.
ALTER TABLE passes ADD COLUMN diet TEXT;

-- Los equipos de una hackatón. El nombre no se repite dentro del evento (sin importar mayúsculas).
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_event_name ON teams(event_id, lower(name));

-- A qué equipo pertenece cada credencial (una sola).
CREATE TABLE IF NOT EXISTS pass_teams (
  pass_id TEXT PRIMARY KEY REFERENCES passes(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pass_teams_team ON pass_teams(team_id);

-- Cada vez que quien organiza importa una lista (de Luma, de Bevy o de otra parte): cuándo, de dónde y el
-- resumen (JSON). Las credenciales que salen de ahí quedan pendientes hasta que se mandan en tandas.
CREATE TABLE IF NOT EXISTS import_runs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS import_runs_event ON import_runs(event_id);
ALTER TABLE passes ADD COLUMN import_run_id TEXT REFERENCES import_runs(id);
