// Un Postgres local sin instalar nada, para probar el motor de producción en esta máquina: PGlite servido por la
// red (scripts/lib/postgres-local.mjs). Varios procesos lo comparten (next dev, el seed, el e2e) por DATABASE_URL.
// Imprime la cadena de conexión y queda andando hasta que se lo corta (Ctrl+C). No aplica las migraciones: eso
// lo hace pnpm db:migrate, igual que contra Supabase.
//
//   node scripts/postgres-local.mjs [--datos ./data/postgres] [--puerto 5433]
//   DATABASE_URL=<la que imprime> pnpm db:migrate
//   RUMBO_REPO=postgres DATABASE_URL=<...> RUMBO_DATA_KEY=<32 bytes en base64> pnpm dev
import { resolve } from "node:path";
import { APP_DIR } from "./lib/env.mjs";
import { startLocalPostgres } from "./lib/postgres-local.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const datos = option("--datos", "./data/postgres");
const puerto = Number(option("--puerto", 5433));

const local = await startLocalPostgres({ dir: datos === "memoria" ? null : resolve(APP_DIR, datos), port: puerto });
console.log(`Postgres local (PGlite) en ${datos === "memoria" ? "memoria" : datos}`);
console.log(`DATABASE_URL=${local.url}`);

const apagar = async () => {
  await local.stop().catch(() => undefined);
  process.exit(0);
};
process.on("SIGINT", apagar);
process.on("SIGTERM", apagar);
