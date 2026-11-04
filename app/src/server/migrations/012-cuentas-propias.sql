-- Las cuentas de Stellar que son de la persona: entró con Google o con su correo por Pollar, y Pollar custodia la
-- llave. El servidor nunca la tiene: lo que el contrato le pide a la persona (register, buy) lo firma su
-- dispositivo. Una cuenta es de una sola persona y una persona tiene una sola cuenta propia, porque el contrato da
-- un pase por cuenta. Las cuentas de prueba que guarda el servidor siguen en dev_accounts.
CREATE TABLE IF NOT EXISTS wallet_links (
  person_id TEXT PRIMARY KEY REFERENCES persons(id),
  provider TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  linked_at TEXT NOT NULL
);

-- Los desafíos para probar que una cuenta es de quien dice (SEP-53): el servidor da un mensaje, el navegador lo
-- firma con la cuenta y el servidor verifica la firma. Cada uno sirve una sola vez y vence a los cinco minutos.
CREATE TABLE IF NOT EXISTS wallet_challenges (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS wallet_challenges_expires ON wallet_challenges(expires_at);

-- Lo que el contrato le pide autorizar a una cuenta propia, mientras el navegador lo firma: la autorización sin
-- firmar tal como salió de la simulación (con su nonce), el contrato, la función y hasta qué ledger vale la firma.
-- Se usa una sola vez: con la firma, el servidor arma la transacción, paga la comisión y la manda.
CREATE TABLE IF NOT EXISTS wallet_auth_requests (
  id TEXT PRIMARY KEY,
  pass_id TEXT NOT NULL REFERENCES passes(id),
  public_key TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  fn TEXT NOT NULL,
  entry_xdr TEXT NOT NULL,
  valid_until_ledger INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS wallet_auth_requests_pass ON wallet_auth_requests(pass_id);
