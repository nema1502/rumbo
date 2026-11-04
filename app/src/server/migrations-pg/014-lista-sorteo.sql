-- La lista del sorteo congelada (migrations/012-lista-sorteo.sql): los códigos de credencial de quienes
-- participaban cuando quien organiza la congeló, con su hora y su huella. Solo códigos: nada personal.
CREATE TABLE IF NOT EXISTS raffle_lists (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  frozen_at timestamptz NOT NULL,
  scope text NOT NULL CHECK (scope IN ('attendees', 'all')),
  total integer NOT NULL,
  participants jsonb NOT NULL,
  sha256 text NOT NULL
);
CREATE INDEX IF NOT EXISTS raffle_lists_event ON raffle_lists(event_id, frozen_at);
-- Como todas las tablas (011-acceso-por-fila.sql): por la API de Supabase no se lee nada.
ALTER TABLE raffle_lists ENABLE ROW LEVEL SECURITY;
