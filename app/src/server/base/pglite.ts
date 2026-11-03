// Postgres compilado a WASM, dentro del proceso (@electric-sql/pglite): el mismo dialecto y las mismas
// migraciones que Supabase, sin servidor. Lo usan las pruebas (pnpm test:pg) y el desarrollo; una carpeta de
// PGlite la abre un solo proceso a la vez (para varios, scripts/postgres-local.mjs la sirve por la red).
// Es una dependencia de desarrollo: se importa con un nombre que el empaquetador no sigue, así no entra al
// bundle de producción.
import fs from "node:fs";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { appDir } from "../env.ts";
import type { SecretCodec } from "./cifrado.ts";
import { migrationsDir, normalizePgRow, toDollarParams, type Db, type Row, type SqlValue } from "./comun.ts";
import { migratePostgres } from "./migrar.ts";

type Runner = PGlite | Transaction;

const PGLITE_MODULE = "@electric-sql/pglite";

class PgliteDb implements Db {
  readonly engine = "pglite" as const;
  readonly dialect = "postgres" as const;
  readonly secrets: SecretCodec;
  private readonly runner: () => Promise<Runner>;
  private readonly inTransaction: boolean;
  private readonly closeFn: () => Promise<void>;

  constructor(runner: () => Promise<Runner>, secrets: SecretCodec, inTransaction: boolean, closeFn: () => Promise<void>) {
    this.runner = runner;
    this.secrets = secrets;
    this.inTransaction = inTransaction;
    this.closeFn = closeFn;
  }

  async all(sql: string, params: readonly SqlValue[] = []): Promise<Row[]> {
    const result = await (await this.runner()).query<Row>(toDollarParams(sql), [...params]);
    return result.rows.map(normalizePgRow);
  }

  async one(sql: string, params: readonly SqlValue[] = []): Promise<Row | null> {
    return (await this.all(sql, params))[0] ?? null;
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<number> {
    return (await (await this.runner()).query(toDollarParams(sql), [...params])).affectedRows ?? 0;
  }

  async exec(script: string): Promise<void> {
    await (await this.runner()).exec(script);
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    const pg = (await this.runner()) as PGlite;
    return pg.transaction(async (tx) => fn(new PgliteDb(async () => tx, this.secrets, true, async () => undefined)));
  }

  close(): Promise<void> {
    return this.closeFn();
  }
}

/** PGlite en `dir` (null: en memoria), con las migraciones de migrations-pg aplicadas. */
export function openPglite(dir: string | null, secrets: SecretCodec): Db {
  let ready: Promise<PGlite> | null = null;
  const open = (): Promise<PGlite> =>
    (ready ??= (async () => {
      const { PGlite } = (await import(/* webpackIgnore: true */ PGLITE_MODULE)) as typeof import("@electric-sql/pglite");
      if (dir) fs.mkdirSync(dir, { recursive: true });
      const pg = await PGlite.create(dir ?? undefined);
      await migratePostgres(new PgliteDb(async () => pg, secrets, false, async () => undefined), migrationsDir("postgres", appDir()));
      return pg;
    })());
  return new PgliteDb(open, secrets, false, async () => {
    if (ready) await (await ready).close();
    ready = null;
  });
}
