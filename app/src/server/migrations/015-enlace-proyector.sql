-- El enlace del proyector (src/server/vivo.ts): una clave por evento, distinta de la del panel, que abre solo la
-- pantalla en vivo en modo proyector y su JSON (/api/vivo/<evento>), sin el sorteo ni el panel. Así la
-- computadora del proyector, que queda a la vista de toda la sala, nunca tiene la clave de organizador.
CREATE TABLE IF NOT EXISTS screen_keys (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
