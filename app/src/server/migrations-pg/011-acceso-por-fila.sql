-- Solo en Postgres. Supabase publica el esquema public por su API con las llaves anon y authenticated, y la
-- llave anon es pública. Rumbo no usa esa API: el servidor entra por el pooler como dueño de las tablas, y al
-- dueño no lo alcanzan estas reglas. Con el acceso por fila prendido y ninguna política, por la API nadie lee ni
-- escribe nada: ni nombres, ni correos, ni llaves. Una tabla nueva tiene que prenderlo en su propia migración.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  -- Los roles de la API existen solo en Supabase (PGlite y un Postgres cualquiera no los tienen).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
  END IF;
END $$;
