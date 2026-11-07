-- Dos cosas de publicar rápido (src/server/kit/direccion.ts y src/server/kit/publicar.ts).

-- Las direcciones que tuvo un borrador antes de cambiarla: /admin/<vieja> (y el enlace para compartir el panel que
-- se pasó con ella) lleva a la nueva, y ningún otro evento puede tomarla. Una dirección es de un solo evento.
CREATE TABLE IF NOT EXISTS event_slug_aliases (
  slug TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_slug_aliases_event ON event_slug_aliases(event_id);

-- Cada contrato que se creó para un evento, se haya usado o no: un borrador que cambia el precio o los canjes de
-- una credencial ya preparada deja el suyo sin usar, y este registro pone el tope (y sirve para sacar de la política
-- de Pollar los que quedaron sin usar). ticket_type_id sin referencia: el tipo se puede borrar y la fila queda.
CREATE TABLE IF NOT EXISTS event_contracts (
  contract_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_type_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_contracts_event ON event_contracts(event_id);
