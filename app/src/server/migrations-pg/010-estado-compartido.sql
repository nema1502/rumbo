-- Solo en Postgres. Lo que en SQLite vive en la memoria del proceso y que con varias instancias (Vercel) tiene
-- que ser uno solo para todas: los turnos y los frenos contra quien prueba a la fuerza.

-- Un turno: un nombre que una sola instancia tiene a la vez (src/server/compartido.ts). Lo usan la cuenta
-- patrocinadora ("sponsor": una transacción a la vez, porque comparten el número de secuencia), cada registro
-- del escáner mientras va a la cadena ("scan:<clientId>") y cada importación mientras manda su tanda
-- ("import:<id>"). Quien lo tiene lo renueva mientras trabaja; si la instancia se cae, vence solo y otra lo toma.
CREATE TABLE IF NOT EXISTS leases (
  name text PRIMARY KEY,
  holder text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Los frenos (src/server/limites.ts): una fila por freno y por quién pide, con la ventana, el freno creciente y
-- el último intento. La fila con la clave vacía lleva el total del freno, para la alarma global.
CREATE TABLE IF NOT EXISTS attempt_limits (
  limiter text NOT NULL,
  key text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL,
  locked_until timestamptz NOT NULL,
  lockouts integer NOT NULL DEFAULT 0,
  last_at timestamptz NOT NULL,
  PRIMARY KEY (limiter, key)
);
CREATE INDEX IF NOT EXISTS attempt_limits_last ON attempt_limits(limiter, last_at);
