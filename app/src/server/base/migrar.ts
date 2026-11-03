// Las migraciones de Postgres (src/server/migrations-pg): las mismas nueve de SQLite traducidas, más las que
// solo tiene Postgres. Cada una entra en su transacción junto con su registro en schema_migrations; si dos
// procesos migran a la vez, un candado de transacción los pone en fila y el segundo ve lo que hizo el primero.
// La usa pnpm db:migrate contra Supabase y PGlite al abrirse.
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./comun.ts";

/** El número del candado de las migraciones (pg_advisory_xact_lock). Cualquiera fijo sirve: es solo de Rumbo. */
const MIGRATION_LOCK = 4_107_202_611;

export interface MigrationReport {
  applied: string[];
  skipped: string[];
}

export async function migratePostgres(db: Db, dir: string): Promise<MigrationReport> {
  if (db.dialect !== "postgres") throw new Error("migratePostgres es para Postgres");
  if (!fs.existsSync(dir)) throw new Error(`No encuentro la carpeta de migraciones de Postgres (${dir}). Los scripts corren desde la carpeta app.`);
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const report: MigrationReport = { applied: [], skipped: [] };
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const done = await db.transaction(async (tx) => {
      await tx.one("SELECT pg_advisory_xact_lock(?)", [MIGRATION_LOCK]);
      if (await tx.one("SELECT 1 AS yes FROM schema_migrations WHERE name = ?", [file])) return false;
      await tx.exec(sql);
      await tx.run("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", [file, new Date().toISOString()]);
      return true;
    });
    (done ? report.applied : report.skipped).push(file);
  }
  return report;
}
