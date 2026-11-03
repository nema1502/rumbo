-- La clave de acceso de cada credencial: el secreto al azar que va en el enlace personal
-- (/p/<pase>?k=<clave>). No es la firma del QR y no sirve para entrar ni para canjear: solo abre la página.
CREATE TABLE IF NOT EXISTS pass_access (
  pass_id TEXT PRIMARY KEY REFERENCES passes(id) ON DELETE CASCADE,
  access_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
