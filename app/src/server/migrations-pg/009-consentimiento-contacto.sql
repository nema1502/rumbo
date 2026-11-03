-- Si quien se inscribe aceptó que la comunidad que organiza le escriba sobre sus próximos eventos
-- (migrations/009-consentimiento-contacto.sql): una casilla opcional y desmarcada, por pase.
ALTER TABLE passes ADD COLUMN IF NOT EXISTS contact_consent boolean NOT NULL DEFAULT false;
ALTER TABLE passes ADD COLUMN IF NOT EXISTS contact_consent_at timestamptz;
