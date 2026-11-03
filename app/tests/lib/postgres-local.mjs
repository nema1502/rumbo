// Antes de cada archivo de pruebas con RUMBO_TEST_ENGINE=postgres (pnpm test:pg): un Postgres local, en memoria,
// servido por la red (scripts/lib/postgres-local.mjs), con las migraciones de migrations-pg aplicadas con el mismo
// código y el mismo driver que pnpm db:migrate. Las pruebas hablan con él como la app con Supabase: por
// DATABASE_URL, con el driver postgres y prepare: false.
//
// node --test lo carga en el proceso que reparte los archivos y en el de cada archivo: solo el de cada archivo
// (NODE_TEST_CONTEXT) levanta su servidor, así cada uno tiene su base vacía.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

if (process.env.RUMBO_TEST_ENGINE === "postgres" && process.env.NODE_TEST_CONTEXT) {
  const { startLocalPostgres } = await import("../../scripts/lib/postgres-local.mjs");
  const { openPostgres } = await import("../../src/server/base/postgres.ts");
  const { plainSecrets } = await import("../../src/server/base/cifrado.ts");
  const { migratePostgres } = await import("../../src/server/base/migrar.ts");
  const local = await startLocalPostgres();
  process.env.DATABASE_URL = local.url;
  const db = openPostgres(local.url, plainSecrets);
  await migratePostgres(db, join(APP_DIR, "src", "server", "migrations-pg"));
  await db.close();
}
