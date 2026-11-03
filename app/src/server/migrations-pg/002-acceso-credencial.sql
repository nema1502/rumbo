-- La clave de acceso de cada credencial (migrations/002-acceso-credencial.sql): el secreto al azar que va en
-- el enlace personal (/p/<pase>?k=<clave>). No sirve para entrar ni para canjear: solo abre la página.
CREATE TABLE IF NOT EXISTS pass_access (
  pass_id text PRIMARY KEY REFERENCES passes(id) ON DELETE CASCADE,
  access_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);
