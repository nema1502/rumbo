// La base de datos, con dos motores. SQLite (node:sqlite) para el desarrollo y las pruebas; Postgres para
// producción, en Supabase y por su pooler en modo transacción. Todo lo que lee o escribe datos pasa por acá:
// el repo, el panel, los stands, la pantalla en vivo, las llaves de los QR, las claves de las credenciales, los
// turnos (compartido.ts) y los frenos (limites.ts).
//
// Qué motor se usa lo dice RUMBO_REPO:
//   sqlite    el archivo data/rumbo.db (o RUMBO_DATA_DIR), con las migraciones de migrations/ al abrirse.
//   postgres  DATABASE_URL, la cadena del pooler de Supabase (puerto 6543). Las migraciones de migrations-pg/
//             se aplican aparte, con pnpm db:migrate. Pide RUMBO_DATA_KEY para cifrar los secretos guardados.
//   pglite    el mismo Postgres, compilado a WASM y dentro del proceso (data/pglite, o en memoria con
//             RUMBO_PGLITE_DIR=memory). Para las pruebas y el desarrollo: aplica sus migraciones al abrirse.
//
// Las sentencias se escriben una sola vez para los dos: parámetros con "?", booleanos con TRUE y FALSE, fechas
// en ISO 8601 y ON CONFLICT en vez de INSERT OR IGNORE. Lo que cambia entre motores lo resuelve cada adaptador.
import path from "node:path";
import { dataDir, getEnv } from "../env.ts";
import { aesSecrets, loadDataKey, plainSecrets } from "./cifrado.ts";
import type { Db, Engine } from "./comun.ts";
import { openPglite } from "./pglite.ts";
import { openPostgres } from "./postgres.ts";
import { openSqlite } from "./sqlite.ts";

export { jsonParam, readJson, type Db, type Dialect, type Engine, type Row, type SqlValue } from "./comun.ts";

export class DataConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataConfigError";
  }
}

const ENGINES: readonly Engine[] = ["sqlite", "postgres", "pglite"];

/** El motor que pide la configuración. Un valor desconocido no cae en SQLite: en producción eso perdería los datos. */
export function dataEngine(): Engine {
  const value = getEnv("RUMBO_REPO", "sqlite").trim().toLowerCase();
  if (!ENGINES.includes(value as Engine)) {
    throw new DataConfigError(`RUMBO_REPO=${value} no es un motor de la base: tiene que ser sqlite, postgres o pglite.`);
  }
  return value as Engine;
}

/**
 * Lo que el motor necesita para arrancar. Con Postgres: DATABASE_URL y RUMBO_DATA_KEY. En Vercel la carpeta de
 * la app no se puede escribir y cada instancia tendría la suya: ahí SQLite no sirve. Lanza un error que dice lo
 * que falta; sin eso la app no arranca (src/instrumentation.ts lo comprueba al levantar).
 */
export function assertDataConfig(): Engine {
  const engine = dataEngine();
  if (engine === "postgres") {
    if (!getEnv("DATABASE_URL")) {
      throw new DataConfigError("Falta DATABASE_URL: con RUMBO_REPO=postgres es la cadena del pooler de Supabase en modo transacción (puerto 6543).");
    }
    loadDataKey();
  }
  if (engine === "pglite") loadDataKey();
  if (engine === "sqlite" && getEnv("VERCEL")) {
    throw new DataConfigError("En Vercel la base tiene que ser Postgres: RUMBO_REPO=postgres, con DATABASE_URL y RUMBO_DATA_KEY.");
  }
  return engine;
}

/** La carpeta de PGlite: RUMBO_PGLITE_DIR, o data/pglite. "memory" la deja en memoria (se pierde al cerrar). */
function pgliteDir(): string | null {
  const dir = getEnv("RUMBO_PGLITE_DIR");
  if (dir === "memory") return null;
  return dir ? path.resolve(dir) : path.join(dataDir(), "pglite");
}

declare global {
  // Una sola conexión (o un solo pool) por proceso, que sobrevive a las recargas en caliente de next dev.
  var __rumboDb: Db | undefined;
}

export function getDb(): Db {
  if (globalThis.__rumboDb) return globalThis.__rumboDb;
  const engine = assertDataConfig();
  let db: Db;
  if (engine === "postgres") db = openPostgres(getEnv("DATABASE_URL") as string, aesSecrets(loadDataKey()));
  else if (engine === "pglite") db = openPglite(pgliteDir(), aesSecrets(loadDataKey()));
  else db = openSqlite(path.join(dataDir(), "rumbo.db"), plainSecrets);
  globalThis.__rumboDb = db;
  return db;
}

/** Cierra la base del proceso (los scripts lo llaman al terminar, para que el pool no los deje colgados). */
export async function closeDb(): Promise<void> {
  const db = globalThis.__rumboDb;
  globalThis.__rumboDb = undefined;
  globalThis.__rumboRepo = undefined;
  await db?.close();
}
