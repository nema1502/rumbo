-- Cuándo se mandó la transacción de un registro del escáner (migrations/004-transaccion-enviada.sql): con el
-- hash guardado apenas se manda, el próximo intento le pregunta a la red cómo terminó antes de mandar otra.
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS tx_sent_at timestamptz;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS tx_sent_at timestamptz;
