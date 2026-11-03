// El motor de desarrollo y de las pruebas: un archivo SQLite con node:sqlite (Node 24), en modo WAL. Aplica
// las migraciones de src/server/migrations al abrirse, como siempre. node:sqlite se carga en tiempo de
// ejecución (process.getBuiltinModule), así el empaquetador de Next no lo resuelve y con Postgres no se carga.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { appDir } from "../env.ts";
import type { SecretCodec } from "./cifrado.ts";
import { migrationsDir, type Db, type Row, type SqlValue } from "./comun.ts";

/** node:sqlite no sabe de booleanos: van como 1 y 0, igual que los guardaban las migraciones. */
const toSqlite = (params: readonly SqlValue[]): SQLInputValue[] => params.map((v) => (v === true ? 1 : v === false ? 0 : v));

function loadSqlite(): typeof import("node:sqlite") {
  const sqlite = process.getBuiltinModule("node:sqlite") as unknown as typeof import("node:sqlite") | undefined;
  if (!sqlite) throw new Error("Esta versión de Node no trae node:sqlite. Hace falta Node 24 o más nuevo.");
  return sqlite;
}

class SqliteDb implements Db {
  readonly engine = "sqlite" as const;
  readonly dialect = "sqlite" as const;
  readonly secrets: SecretCodec;
  private readonly db: DatabaseSync;
  /** La transacción en curso: lo de afuera espera a que termine, porque comparte la conexión. */
  private busy: Promise<unknown> = Promise.resolve();

  constructor(db: DatabaseSync, secrets: SecretCodec) {
    this.db = db;
    this.secrets = secrets;
  }

  /** La misma conexión, para adentro de una transacción: no espera a la transacción, porque es ella. */
  private inner(): Db {
    const self = this;
    return {
      engine: this.engine,
      dialect: this.dialect,
      secrets: this.secrets,
      all: async (sql, params = []) => self.allNow(sql, params),
      one: async (sql, params = []) => self.oneNow(sql, params),
      run: async (sql, params = []) => self.runNow(sql, params),
      exec: async (script) => void self.db.exec(script),
      transaction: (fn) => fn(self.inner()),
      close: async () => undefined,
    };
  }

  private allNow(sql: string, params: readonly SqlValue[]): Row[] {
    return this.db.prepare(sql).all(...toSqlite(params)) as Row[];
  }

  private oneNow(sql: string, params: readonly SqlValue[]): Row | null {
    return (this.db.prepare(sql).get(...toSqlite(params)) as Row | undefined) ?? null;
  }

  private runNow(sql: string, params: readonly SqlValue[]): number {
    return Number(this.db.prepare(sql).run(...toSqlite(params)).changes);
  }

  async all(sql: string, params: readonly SqlValue[] = []): Promise<Row[]> {
    await this.busy;
    return this.allNow(sql, params);
  }

  async one(sql: string, params: readonly SqlValue[] = []): Promise<Row | null> {
    await this.busy;
    return this.oneNow(sql, params);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<number> {
    await this.busy;
    return this.runNow(sql, params);
  }

  async exec(script: string): Promise<void> {
    await this.busy;
    this.db.exec(script);
  }

  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const run = this.busy.then(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(this.inner());
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
    this.busy = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    await this.busy;
    if (this.db.isOpen) this.db.close();
  }

  /** Aplica las migraciones que falten, cada una con su registro en schema_migrations, en orden de nombre. */
  migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    const applied = new Set(this.allNow("SELECT name FROM schema_migrations", []).map((r) => String(r.name)));
    const dir = migrationsDir("sqlite", appDir());
    if (!fs.existsSync(dir)) {
      throw new Error(`No encuentro la carpeta de migraciones de la base (${dir}). Los scripts corren desde la carpeta app.`);
    }
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      this.db.exec("BEGIN");
      try {
        this.db.exec(sql);
        this.runNow("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", [file, new Date().toISOString()]);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }
}

/** Abre (o crea) la base SQLite y le aplica las migraciones. ":memory:" la deja en memoria. */
export function openSqlite(file: string, secrets: SecretCodec): Db {
  const sqlite = loadSqlite();
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new sqlite.DatabaseSync(file);
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec("PRAGMA busy_timeout = 5000");
  const db = new SqliteDb(raw, secrets);
  db.migrate();
  return db;
}
