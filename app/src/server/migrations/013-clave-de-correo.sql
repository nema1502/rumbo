-- Una persona por buzón. Dos correos que llegan al mismo lugar (en Gmail, con o sin puntos en el local y con o
-- sin lo que sigue a un "+") son la misma persona. email guarda el correo como lo escribió (en minúsculas);
-- email_key es la clave con la que se busca y se evita el duplicado (src/server/repo.ts, emailKey). A las
-- personas de antes les queda como clave su propio correo: el repo las busca también por el correo tal cual.
ALTER TABLE persons ADD COLUMN email_key TEXT;
UPDATE persons SET email_key = email WHERE email_key IS NULL;
-- "persons_email_key" es el nombre que Postgres le pone solo a la restricción UNIQUE de persons.email (001): con ese
-- nombre, IF NOT EXISTS no creaba el índice y la clave de correo quedaba sin unicidad en Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS persons_email_key_unica ON persons(email_key);
