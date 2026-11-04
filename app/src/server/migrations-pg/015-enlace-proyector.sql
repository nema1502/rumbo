-- El enlace del proyector (migrations/013-enlace-proyector.sql): una clave por evento, distinta de la del panel,
-- que abre solo la pantalla en vivo en modo proyector y su JSON, sin el sorteo ni el panel.
CREATE TABLE IF NOT EXISTS screen_keys (
  event_id text PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);
-- Como todas las tablas (011-acceso-por-fila.sql): por la API de Supabase no se lee nada.
ALTER TABLE screen_keys ENABLE ROW LEVEL SECURITY;
