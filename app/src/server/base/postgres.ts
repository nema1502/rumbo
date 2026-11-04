// El motor de producción: Postgres en Supabase, por el pooler en modo transacción (Supavisor, puerto 6543),
// con el driver postgres (porsager). Ese pooler le da a cada transacción una conexión cualquiera del servidor:
// no sostiene sentencias preparadas con nombre (prepare: false) ni nada que viva en la sesión, así que acá no
// hay SET, ni LISTEN, ni candados de sesión. El paquete se carga recién cuando hace falta: con SQLite no se toca.
import fs from "node:fs";
import type { Sql, TransactionSql } from "postgres";
import { getEnv } from "../env.ts";
import type { SecretCodec } from "./cifrado.ts";
import { normalizePgRow, toDollarParams, withoutNul, type Db, type Row, type SqlValue } from "./comun.ts";

type Runner = Sql | TransactionSql;

const toPg = (params: readonly SqlValue[]): unknown[] => withoutNul(params).map((v) => (v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v) : v));

/** Las sentencias sobre una conexión: la del pool, o la de una transacción. */
class PgRunner implements Db {
  readonly engine = "postgres" as const;
  readonly dialect = "postgres" as const;
  readonly secrets: SecretCodec;
  private readonly runner: () => Promise<Runner>;
  private readonly inTransaction: boolean;

  constructor(runner: () => Promise<Runner>, secrets: SecretCodec, inTransaction: boolean) {
    this.runner = runner;
    this.secrets = secrets;
    this.inTransaction = inTransaction;
  }

  async all(sql: string, params: readonly SqlValue[] = []): Promise<Row[]> {
    const rows = await (await this.runner()).unsafe(toDollarParams(sql), toPg(params) as never[]);
    return Array.from(rows as unknown as Row[], normalizePgRow);
  }

  async one(sql: string, params: readonly SqlValue[] = []): Promise<Row | null> {
    return (await this.all(sql, params))[0] ?? null;
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<number> {
    const result = await (await this.runner()).unsafe(toDollarParams(sql), toPg(params) as never[]);
    return result.count ?? 0;
  }

  async exec(script: string): Promise<void> {
    // El protocolo simple acepta varias sentencias juntas (y ningún parámetro).
    await (await this.runner()).unsafe(script).simple();
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    const sql = (await this.runner()) as Sql;
    return (await sql.begin(async (tx) => fn(new PgRunner(async () => tx, this.secrets, true)))) as T;
  }

  async close(): Promise<void> {
    if (this.inTransaction) return;
    await ((await this.runner()) as Sql).end({ timeout: 5 });
  }
}

/** Si la cadena apunta a esta misma máquina: ahí no hay TLS (las pruebas con el servidor local de PGlite). */
function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * El pool de Postgres. Pocas conexiones por instancia (RUMBO_PG_POOL_MAX, cinco): en Vercel hay muchas
 * instancias y el pooler de Supabase reparte las suyas entre todas. Las que quedan quietas se cierran solas.
 */
export function openPostgres(url: string, secrets: SecretCodec): Db {
  let pool: Promise<Sql> | null = null;
  const connect = (): Promise<Sql> =>
    (pool ??= import("postgres").then(({ default: postgres }) =>
      postgres(url, {
        // El pooler en modo transacción no guarda sentencias preparadas entre una transacción y otra.
        prepare: false,
        max: Number(getEnv("RUMBO_PG_POOL_MAX", "5")),
        idle_timeout: 20,
        connect_timeout: 15,
        max_lifetime: 60 * 30,
        // Supabase pide TLS; el servidor local de las pruebas no lo tiene.
        ssl: isLocal(url) ? false : "require",
        onnotice: () => undefined,
        // Los conteos (bigint) como número, como los da SQLite.
        types: { int8: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) } },
      }),
    ));
  return new PgRunner(connect, secrets, false);
}
