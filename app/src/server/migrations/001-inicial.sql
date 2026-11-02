-- Rumbo: la base local de desarrollo (SQLite). Los nombres y los correos viven acá, nunca en la cadena.
-- Las fechas son ISO 8601 en texto; los booleanos, 0 o 1; los ids, texto.

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/La_Paz',
  place TEXT NOT NULL,
  venue TEXT,
  organizer_name TEXT NOT NULL,
  -- La cuenta de Stellar de quien organiza (clave pública): a donde va el pago de las entradas.
  organizer_account TEXT,
  -- El contrato rumbo-pass del evento. Cada tipo de entrada puede tener el suyo (el precio es fijo
  -- por contrato); este es el que se usa cuando el tipo de entrada no tiene uno.
  contract_id TEXT,
  capacity INTEGER,
  -- La llave con la que se firman los QR de las credenciales. Nunca sale del servidor,
  -- salvo al escáner del voluntario cuando abre el evento con red.
  qr_key BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_types (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- El precio en USDC de prueba. 0 es inscripción gratis.
  price_usdc REAL NOT NULL DEFAULT 0,
  -- El contrato rumbo-pass con ese precio (register si es gratis, buy si es pago).
  contract_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ticket_types_event ON ticket_types(event_id);

-- El catálogo de beneficios del evento: el almuerzo, la polera, el premio.
CREATE TABLE IF NOT EXISTS benefits (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('lunch', 'merch', 'prize', 'other')),
  -- El puesto donde se canjea ("Mesa del almuerzo"): el escáner avisa si el voluntario está en otro.
  station TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS benefits_event ON benefits(event_id);

-- Qué beneficios trae cada tipo de entrada, y con qué número se canjean en su contrato
-- (redeem(attendee, benefit)). Un beneficio sin fila acá no viene con la entrada: se otorga
-- después, a mano o por el sorteo.
CREATE TABLE IF NOT EXISTS ticket_type_benefits (
  ticket_type_id TEXT NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,
  benefit_id TEXT NOT NULL REFERENCES benefits(id) ON DELETE CASCADE,
  chain_index INTEGER NOT NULL,
  PRIMARY KEY (ticket_type_id, benefit_id),
  UNIQUE (ticket_type_id, chain_index)
);

CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS passes (
  -- Ocho letras y números (base32): lo que va en el QR junto con la firma.
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES persons(id),
  ticket_type_id TEXT NOT NULL REFERENCES ticket_types(id),
  -- La cuenta de Stellar de la persona (clave pública): lo único que une el pase con la cadena.
  account TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'checked_in')),
  -- La transacción de register o buy, y el número de pase que devolvió el contrato.
  tx_hash TEXT,
  chain_number INTEGER,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  checked_in_at TEXT,
  UNIQUE (event_id, person_id)
);
CREATE INDEX IF NOT EXISTS passes_event ON passes(event_id);

-- Los beneficios de cada pase: los de su entrada, los ganados en el sorteo y los dados a mano.
CREATE TABLE IF NOT EXISTS pass_benefits (
  pass_id TEXT NOT NULL REFERENCES passes(id) ON DELETE CASCADE,
  benefit_id TEXT NOT NULL REFERENCES benefits(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('ticket', 'raffle', 'manual')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (pass_id, benefit_id)
);

-- El espejo de la cadena: lo que el escáner registró, con marca de si ya se sincronizó
-- y de si resultó doble (el contrato lo rechazó porque ya estaba hecho).
CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  -- El id que le puso el escáner en su cola local: si reintenta, no se duplica.
  client_id TEXT UNIQUE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  pass_id TEXT NOT NULL REFERENCES passes(id),
  scanner_id TEXT,
  scanned_at TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  duplicate INTEGER NOT NULL DEFAULT 0,
  tx_hash TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS checkins_event ON checkins(event_id);
CREATE INDEX IF NOT EXISTS checkins_pass ON checkins(pass_id);

CREATE TABLE IF NOT EXISTS redemptions (
  id TEXT PRIMARY KEY,
  client_id TEXT UNIQUE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  pass_id TEXT NOT NULL REFERENCES passes(id),
  benefit_id TEXT NOT NULL REFERENCES benefits(id),
  scanner_id TEXT,
  scanned_at TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  duplicate INTEGER NOT NULL DEFAULT 0,
  tx_hash TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS redemptions_event ON redemptions(event_id);
CREATE INDEX IF NOT EXISTS redemptions_pass ON redemptions(pass_id, benefit_id);

-- SOLO RED DE PRUEBA. Las cuentas que el servidor crea y guarda por cada persona, con su llave secreta.
-- En producción esta tabla no existe: la cuenta es de la persona (Google o passkey) y el servidor no firma por ella.
CREATE TABLE IF NOT EXISTS dev_accounts (
  person_id TEXT PRIMARY KEY REFERENCES persons(id),
  public_key TEXT NOT NULL UNIQUE,
  secret_key TEXT NOT NULL,
  funded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
