-- Coorganizar (src/server/coorganizar.ts): la dueña de un evento suma a otras cuentas de organizador a su equipo,
-- que entran con su propia cuenta y pueden todo lo del panel y el borrador salvo sumar o sacar a otras personas.
-- Ningún correo y ninguna llave: las cuentas de organizador son las de organizers, y de las invitaciones se guarda
-- solo la huella del enlace.

-- Quién coorganiza cada evento: una fila por evento y cuenta, con quién la sumó y cuándo.
CREATE TABLE IF NOT EXISTS event_coorganizers (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organizer_id TEXT NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  added_by TEXT REFERENCES organizers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, organizer_id)
);
CREATE INDEX IF NOT EXISTS event_coorganizers_organizer ON event_coorganizers(organizer_id);

-- Las invitaciones: un enlace de un solo uso que vence a los siete días. token_hash es el SHA-256 (en hex) de la
-- ficha que va en el enlace, nunca la ficha: quien lea la base no tiene con qué sumarse. used_by es la cuenta que la
-- usó; revoked_at, cuándo la anuló la dueña.
CREATE TABLE IF NOT EXISTS event_invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES organizers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by TEXT REFERENCES organizers(id) ON DELETE SET NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS event_invites_event ON event_invites(event_id, created_at);

-- La autorización por cuenta: la dueña pega la cuenta de Stellar (G...) de otra persona, y quien entra como
-- organizador con esa cuenta queda como coorganizador la primera vez (la fila pasa a event_coorganizers).
CREATE TABLE IF NOT EXISTS event_account_grants (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  granted_by TEXT REFERENCES organizers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, public_key)
);
CREATE INDEX IF NOT EXISTS event_account_grants_account ON event_account_grants(public_key);
