-- Rumbo en Postgres (Supabase): la traducción de migrations/001-inicial.sql. Los nombres y los correos viven
-- acá, nunca en la cadena. Las fechas son timestamptz; los booleanos, boolean; las llaves, bytea; los ids,
-- texto (los pases tienen ocho letras, el resto son UUID que arma el servidor).

CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'America/La_Paz',
  place text NOT NULL,
  venue text,
  organizer_name text NOT NULL,
  -- La cuenta de Stellar de quien organiza (clave pública): a donde va el pago de las entradas.
  organizer_account text,
  -- El contrato rumbo-pass del evento, para los tipos de entrada que no tienen el suyo.
  contract_id text,
  capacity integer,
  -- La llave compartida de los QR de antes. La migración 006 la saca.
  qr_key bytea NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_types (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- El precio en USDC de prueba, con los siete decimales del activo. 0 es inscripción gratis.
  price_usdc numeric(20, 7) NOT NULL DEFAULT 0,
  -- El contrato rumbo-pass con ese precio (register si es gratis, buy si es pago).
  contract_id text,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ticket_types_event ON ticket_types(event_id);

-- El catálogo de beneficios del evento: el almuerzo, la polera, el premio.
CREATE TABLE IF NOT EXISTS benefits (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('lunch', 'merch', 'prize', 'other')),
  -- El puesto donde se canjea ("Mesa del almuerzo"): el escáner avisa si el voluntario está en otro.
  station text,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS benefits_event ON benefits(event_id);

-- Qué beneficios trae cada tipo de entrada, y con qué número se canjean en su contrato.
CREATE TABLE IF NOT EXISTS ticket_type_benefits (
  ticket_type_id text NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,
  benefit_id text NOT NULL REFERENCES benefits(id) ON DELETE CASCADE,
  chain_index integer NOT NULL,
  PRIMARY KEY (ticket_type_id, benefit_id),
  UNIQUE (ticket_type_id, chain_index)
);
CREATE INDEX IF NOT EXISTS ticket_type_benefits_benefit ON ticket_type_benefits(benefit_id);

CREATE TABLE IF NOT EXISTS persons (
  id text PRIMARY KEY,
  name text NOT NULL,
  -- Siempre en minúsculas y sin espacios (normalizeEmail): una persona por correo.
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS passes (
  -- Ocho letras y números (base32): lo que va en el QR junto con la firma.
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES persons(id),
  ticket_type_id text NOT NULL REFERENCES ticket_types(id),
  -- La cuenta de Stellar de la persona (clave pública): lo único que une el pase con la cadena.
  account text,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'checked_in')),
  -- La transacción de register o buy, y el número de pase que devolvió el contrato (un u32).
  tx_hash text,
  chain_number bigint,
  created_at timestamptz NOT NULL,
  activated_at timestamptz,
  checked_in_at timestamptz,
  UNIQUE (event_id, person_id)
);
CREATE INDEX IF NOT EXISTS passes_event ON passes(event_id);
CREATE INDEX IF NOT EXISTS passes_person ON passes(person_id);
CREATE INDEX IF NOT EXISTS passes_ticket_type ON passes(ticket_type_id);

-- Los beneficios de cada pase: los de su entrada, los ganados en el sorteo y los dados a mano. Uno por pase y beneficio.
CREATE TABLE IF NOT EXISTS pass_benefits (
  pass_id text NOT NULL REFERENCES passes(id) ON DELETE CASCADE,
  benefit_id text NOT NULL REFERENCES benefits(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('ticket', 'raffle', 'manual')),
  granted_at timestamptz NOT NULL,
  PRIMARY KEY (pass_id, benefit_id)
);
CREATE INDEX IF NOT EXISTS pass_benefits_benefit ON pass_benefits(benefit_id);

-- El espejo de la cadena: lo que el escáner registró, con marca de si ya se sincronizó y de si resultó doble.
CREATE TABLE IF NOT EXISTS checkins (
  id text PRIMARY KEY,
  -- El id que le puso el escáner en su cola local: si reintenta, no se duplica.
  client_id text UNIQUE,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  pass_id text NOT NULL REFERENCES passes(id),
  scanner_id text,
  scanned_at timestamptz NOT NULL,
  synced boolean NOT NULL DEFAULT false,
  duplicate boolean NOT NULL DEFAULT false,
  tx_hash text,
  error text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS checkins_event ON checkins(event_id);
CREATE INDEX IF NOT EXISTS checkins_pass ON checkins(pass_id);

CREATE TABLE IF NOT EXISTS redemptions (
  id text PRIMARY KEY,
  client_id text UNIQUE,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  pass_id text NOT NULL REFERENCES passes(id),
  benefit_id text NOT NULL REFERENCES benefits(id),
  scanner_id text,
  scanned_at timestamptz NOT NULL,
  synced boolean NOT NULL DEFAULT false,
  duplicate boolean NOT NULL DEFAULT false,
  tx_hash text,
  error text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS redemptions_event ON redemptions(event_id);
CREATE INDEX IF NOT EXISTS redemptions_pass ON redemptions(pass_id, benefit_id);
CREATE INDEX IF NOT EXISTS redemptions_benefit ON redemptions(benefit_id);

-- SOLO RED DE PRUEBA. Las cuentas que el servidor crea y guarda por cada persona. La llave secreta va cifrada
-- con RUMBO_DATA_KEY (AES-256-GCM, src/server/base/cifrado.ts): en la base nunca está en claro.
CREATE TABLE IF NOT EXISTS dev_accounts (
  person_id text PRIMARY KEY REFERENCES persons(id),
  public_key text NOT NULL UNIQUE,
  secret_key bytea NOT NULL,
  funded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
