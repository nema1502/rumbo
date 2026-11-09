-- Las direcciones viejas de un borrador y el registro de cada contrato creado para un evento
-- (migrations/020-direcciones-y-contratos.sql). Con el acceso por fila prendido, como toda tabla nueva.
CREATE TABLE IF NOT EXISTS event_slug_aliases (
  slug text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS event_slug_aliases_event ON event_slug_aliases(event_id);

CREATE TABLE IF NOT EXISTS event_contracts (
  contract_id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_type_id text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS event_contracts_event ON event_contracts(event_id);

ALTER TABLE event_slug_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_contracts ENABLE ROW LEVEL SECURITY;
