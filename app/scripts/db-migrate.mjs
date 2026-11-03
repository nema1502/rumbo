// pnpm db:migrate: aplica a la base Postgres de DATABASE_URL las migraciones de src/server/migrations-pg que
// falten, en orden, y anota cada una en schema_migrations. Se puede correr las veces que haga falta: lo ya
// aplicado no se toca. Con Supabase alcanza con la cadena del pooler en modo transacción (puerto 6543), la
// misma que usa la app.
//
//   DATABASE_URL=postgres://... pnpm db:migrate
//
// DATABASE_URL se lee del entorno o de app/.env.local. No imprime la cadena: solo el servidor y la base.
import { join } from "node:path";
import { APP_DIR, loadEnv } from "./lib/env.mjs";

process.chdir(APP_DIR);
loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL: la cadena del pooler de Supabase en modo transacción (puerto 6543). Ver app/README.md, \"En producción\".");
  process.exit(1);
}

let destino = "la base";
try {
  const u = new URL(url);
  destino = `${u.hostname}:${u.port || 5432}${u.pathname}`;
} catch {
  console.error("DATABASE_URL no es una cadena de conexión de Postgres (postgres://usuario:clave@servidor:puerto/base).");
  process.exit(1);
}

const { openPostgres } = await import("../src/server/base/postgres.ts");
const { plainSecrets } = await import("../src/server/base/cifrado.ts");
const { migratePostgres } = await import("../src/server/base/migrar.ts");

console.log(`Migrando ${destino}`);
const db = openPostgres(url, plainSecrets);
try {
  const { applied, skipped } = await migratePostgres(db, join(APP_DIR, "src", "server", "migrations-pg"));
  for (const name of applied) console.log(`  aplicada: ${name}`);
  console.log(applied.length === 0 ? `Nada que aplicar: las ${skipped.length} migraciones ya estaban.` : `Listo: ${applied.length} aplicadas, ${skipped.length} ya estaban.`);
} catch (error) {
  console.error(`La migración falló y se deshizo entera: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
