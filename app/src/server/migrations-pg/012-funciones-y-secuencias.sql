-- Solo en Postgres. La 011 cerró las tablas por la API de Supabase (la llave anon es pública); esta cierra las
-- funciones y las secuencias, las de hoy y las que agregue una migración futura: Supabase le da a anon y a
-- authenticated permiso sobre todo lo que se cree en public de ahora en más, y una función SECURITY DEFINER o
-- una secuencia nuevas quedarían abiertas sin que nadie lo decida. La app entra como dueña de todo y no la
-- alcanza; service_role (la llave de servicio, que nunca sale del servidor) conserva lo suyo.
--
-- Las funciones nacen ejecutables por PUBLIC (cualquier rol), y ese permiso viene de los privilegios por omisión
-- globales del rol que las crea: los que se fijan "IN SCHEMA public" se suman a los globales, no los reemplazan,
-- así que el de PUBLIC se quita sin IN SCHEMA. Desde acá, una función que cree este rol en cualquier esquema
-- solo la ejecuta quien reciba el permiso expresamente.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DO $$
BEGIN
  -- Los roles de la API existen solo en Supabase (PGlite y un Postgres cualquiera no los tienen).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES REVOKE ALL ON FUNCTIONS FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES REVOKE ALL ON FUNCTIONS FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated';
  END IF;
END $$;
