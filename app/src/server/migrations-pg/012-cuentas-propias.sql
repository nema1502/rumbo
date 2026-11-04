-- Las cuentas propias de cada persona (Pollar), los desafíos SEP-53 y las autorizaciones que firma el navegador
-- (migrations/012-cuentas-propias.sql). Como toda tabla nueva, con el acceso por fila prendido
-- (011-acceso-por-fila.sql): por la API de Supabase nadie las lee ni las escribe.
CREATE TABLE IF NOT EXISTS wallet_links (
  person_id text PRIMARY KEY REFERENCES persons(id),
  provider text NOT NULL,
  public_key text NOT NULL UNIQUE,
  linked_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_challenges (
  id text PRIMARY KEY,
  public_key text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS wallet_challenges_expires ON wallet_challenges(expires_at);

CREATE TABLE IF NOT EXISTS wallet_auth_requests (
  id text PRIMARY KEY,
  pass_id text NOT NULL REFERENCES passes(id),
  public_key text NOT NULL,
  contract_id text NOT NULL,
  fn text NOT NULL,
  entry_xdr text NOT NULL,
  valid_until_ledger integer NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS wallet_auth_requests_pass ON wallet_auth_requests(pass_id);

ALTER TABLE wallet_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_auth_requests ENABLE ROW LEVEL SECURITY;
