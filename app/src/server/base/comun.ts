// Lo que comparten los adaptadores de la base (sqlite.ts, postgres.ts, pglite.ts) y quien los usa: la forma de
// una base, los valores que se le pasan y las conversiones entre un dialecto y otro.
import path from "node:path";
import { getEnv } from "../env.ts";
import type { SecretCodec } from "./cifrado.ts";

export type Engine = "sqlite" | "postgres" | "pglite";
/** Cómo se escriben las sentencias: SQLite, o Postgres (el de Supabase y el de PGlite). */
export type Dialect = "sqlite" | "postgres";
export type SqlValue = string | number | boolean | null | Uint8Array;
export type Row = Record<string, unknown>;

export interface Db {
  readonly engine: Engine;
  readonly dialect: Dialect;
  /** Cómo se guardan los secretos: cifrados con RUMBO_DATA_KEY en Postgres, tal cual en SQLite de desarrollo. */
  readonly secrets: SecretCodec;
  all(sql: string, params?: readonly SqlValue[]): Promise<Row[]>;
  one(sql: string, params?: readonly SqlValue[]): Promise<Row | null>;
  /** Una sentencia que escribe. Devuelve cuántas filas cambió. */
  run(sql: string, params?: readonly SqlValue[]): Promise<number>;
  /** Varias sentencias sin parámetros, como un archivo de migración. */
  exec(script: string): Promise<void>;
  /**
   * Todo lo que fn hace con `tx` entra junto o no entra. Adentro se usa solo `tx`: la base de afuera espera a
   * que la transacción termine (en SQLite y en PGlite hay una sola conexión).
   */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** "?" pasa a "$1", "$2"... para Postgres. Lo que está entre comillas simples no se toca. */
export function toDollarParams(sql: string): string {
  let out = "";
  let n = 0;
  let quoted = false;
  for (const char of sql) {
    if (char === "'") quoted = !quoted;
    if (char === "?" && !quoted) out += `$${++n}`;
    else out += char;
  }
  return out;
}

/** Una fila de Postgres como la da SQLite: fechas en ISO 8601 y enteros grandes como número. */
export function normalizePgRow(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) out[key] = value.toISOString();
    else if (typeof value === "bigint") out[key] = Number(value);
    else out[key] = value;
  }
  return out;
}

/** La carpeta con las migraciones de cada dialecto. next dev y los scripts corren desde app/. */
export function migrationsDir(dialect: Dialect, appDir: string): string {
  if (dialect === "sqlite") return getEnv("RUMBO_MIGRATIONS_DIR") ?? path.join(appDir, "src", "server", "migrations");
  return getEnv("RUMBO_PG_MIGRATIONS_DIR") ?? path.join(appDir, "src", "server", "migrations-pg");
}

/** Cómo se escribe un parámetro JSON: en Postgres va como texto y se convierte, así ningún driver lo vuelve a codificar. */
export function jsonParam(db: Db): string {
  return db.dialect === "postgres" ? "CAST(? AS text)::jsonb" : "?";
}

/** Un valor JSON leído de la base: SQLite lo da como texto, Postgres ya convertido. */
export function readJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}
