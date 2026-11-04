-- Cada lectura guarda cuándo llegó al servidor (received_at, la pone el servidor; scanned_at la pone el escáner) y
-- cómo se leyó la credencial (via: el QR del celular, el impreso o a mano en la puerta). Ver migrations/017.
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS received_at timestamptz;
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS via text CHECK (via IN ('live', 'printed', 'manual'));
UPDATE checkins SET received_at = created_at WHERE received_at IS NULL;

ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS received_at timestamptz;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS via text CHECK (via IN ('live', 'printed', 'manual'));
UPDATE redemptions SET received_at = created_at WHERE received_at IS NULL;

ALTER TABLE stand_visits ADD COLUMN IF NOT EXISTS received_at timestamptz;
ALTER TABLE stand_visits ADD COLUMN IF NOT EXISTS via text CHECK (via IN ('live', 'printed', 'manual'));
UPDATE stand_visits SET received_at = created_at WHERE received_at IS NULL;
