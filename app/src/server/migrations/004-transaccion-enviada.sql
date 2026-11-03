-- Cuándo se mandó la transacción de un registro del escáner. El hash (tx_hash) queda guardado apenas se
-- manda, antes de saber si entró: si la confirmación no llega a tiempo o se corta la respuesta, el próximo
-- intento le pregunta a la red cómo terminó esa transacción antes de mandar otra, y así una entrada que
-- llegó tarde no queda como "doble". Pasado el tiempo de validez de la transacción, si la red no la
-- conoce, ya no va a entrar y se puede mandar otra.
ALTER TABLE checkins ADD COLUMN tx_sent_at TEXT;
ALTER TABLE redemptions ADD COLUMN tx_sent_at TEXT;
