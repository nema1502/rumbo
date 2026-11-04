-- Cada lectura que llega al servidor guarda, además de la hora de la lectura (scanned_at, la pone el escáner),
-- cuándo llegó al servidor (received_at, la pone el servidor: la constancia de asistencia muestra la menor de las
-- dos) y cómo se leyó la credencial (via): el QR del celular ("live"), el QR fijo de la credencial impresa
-- ("printed") o marcada a mano en la puerta ("manual"). Lo que trajo el contraste con la cadena y lo de antes de
-- esta migración quedan sin via; received_at se completa con la hora de creación de la fila, que es la misma cosa.
ALTER TABLE checkins ADD COLUMN received_at TEXT;
ALTER TABLE checkins ADD COLUMN via TEXT CHECK (via IN ('live', 'printed', 'manual'));
UPDATE checkins SET received_at = created_at WHERE received_at IS NULL;

ALTER TABLE redemptions ADD COLUMN received_at TEXT;
ALTER TABLE redemptions ADD COLUMN via TEXT CHECK (via IN ('live', 'printed', 'manual'));
UPDATE redemptions SET received_at = created_at WHERE received_at IS NULL;

ALTER TABLE stand_visits ADD COLUMN received_at TEXT;
ALTER TABLE stand_visits ADD COLUMN via TEXT CHECK (via IN ('live', 'printed', 'manual'));
UPDATE stand_visits SET received_at = created_at WHERE received_at IS NULL;
