// Los turnos: lo que tiene que hacer una sola instancia del servidor a la vez. En SQLite hay un solo proceso y
// alcanza con la memoria, como siempre. En Postgres (Vercel) cada pedido puede caer en otra instancia, así que
// el turno vive en la base, en la tabla leases (migrations-pg/010-estado-compartido.sql):
//
//   - "sponsor": la cuenta patrocinadora arma, firma y manda una transacción a la vez, y espera a que entre,
//     porque todas comparten su número de secuencia (stellar.ts, withSponsorLock). Quien llega después espera.
//   - "scan:<clientId>": el mismo registro del escáner no va dos veces a la vez a la cadena (escaner.ts).
//   - "import:<id>": una sola tanda de cada importación a la vez (kit/importar.ts).
//   - "publish:<evento>": un solo "Publicar" por evento a la vez (kit/publicar.ts).
//
// Por qué un turno con vencimiento y no pg_advisory_xact_lock: ese candado vive mientras dure la transacción, y
// acá la transacción duraría lo que tarda la red de Stellar (hasta un minuto). Con el pooler en modo transacción
// eso ocupa una conexión del servidor por cada instancia que espera, y las del plan de Supabase son pocas. El
// turno es una fila: tomarlo es un INSERT ... ON CONFLICT de un solo golpe, quien lo tiene lo renueva cada pocos
// segundos mientras trabaja y lo suelta al terminar, y si la instancia se cae vence solo. Funciona igual en
// Supabase y en PGlite, y por eso las pruebas lo comprueban de verdad.
//
// La hora del turno es la de la base (now()), nunca la de la instancia: dos instancias con el reloj desfasado no
// se sacan el turno entre sí. Y si quien lo tiene no logra renovarlo (la base no contesta, o ya venció y otra
// instancia lo tomó), el trabajo se aborta con LeaseLost en vez de seguir de a dos.
import { randomUUID } from "node:crypto";
import { dataEngine, getDb, type Db } from "./base/index.ts";
import { describeForLog } from "./log.ts";

export interface LeaseOptions {
  /** Lo que dura el turno si nadie lo renueva. */
  ttlMs: number;
  /** Cada cuánto lo renueva quien lo tiene. */
  renewMs: number;
}

const DEFAULT_LEASE: LeaseOptions = { ttlMs: 30_000, renewMs: 10_000 };

/** El turno se perdió a mitad del trabajo: lo que estaba haciendo se corta, y quien llamó lo trata como un fallo para reintentar. */
export class LeaseLost extends Error {
  constructor(name: string) {
    super(`Se perdió el turno ${name} a mitad del trabajo: no se pudo renovar a tiempo y otra instancia pudo tomarlo`);
    this.name = "LeaseLost";
  }
}

/** Lo que dura el turno, en segundos, para sumarlo a now() en la base. */
const seconds = (ms: number): number => ms / 1000;

/** Toma el turno si está libre o vencido (según el reloj de la base). Devuelve con qué ficha se tomó, o null si lo tiene otro. */
export async function acquireLease(db: Db, name: string, ttlMs: number): Promise<string | null> {
  const holder = randomUUID();
  const row = await db.one(
    `INSERT INTO leases (name, holder, expires_at) VALUES (?, ?, now() + CAST(? AS double precision) * interval '1 second')
     ON CONFLICT (name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at
     WHERE leases.expires_at < now()
     RETURNING holder`,
    [name, holder, seconds(ttlMs)],
  );
  return row && String(row.holder) === holder ? holder : null;
}

/** Alarga el turno, solo si sigue siendo de esa ficha. */
export async function renewLease(db: Db, name: string, holder: string, ttlMs: number): Promise<boolean> {
  return (await db.run("UPDATE leases SET expires_at = now() + CAST(? AS double precision) * interval '1 second' WHERE name = ? AND holder = ?", [seconds(ttlMs), name, holder])) === 1;
}

/** Suelta el turno, solo si sigue siendo de esa ficha (si venció y lo tomó otro, no se lo saca). */
export async function releaseLease(db: Db, name: string, holder: string): Promise<void> {
  await db.run("DELETE FROM leases WHERE name = ? AND holder = ?", [name, holder]);
}

/**
 * Corre fn con el turno tomado, renovándolo mientras dura, y lo suelta al final aunque fn falle. Si una
 * renovación dice que el turno ya no es de esta ficha, o la base no contesta tanto tiempo que el turno ya
 * venció, fn deja de valer: holding termina con LeaseLost (lo que fn siga haciendo se descarta, y lo que
 * escribe en la base lo escribe igual, de forma idempotente, como todo lo que pasa por un turno).
 */
async function holding<T>(db: Db, name: string, holder: string, options: LeaseOptions, fn: () => Promise<T>): Promise<T> {
  let renewedAt = Date.now();
  let lose: (error: Error) => void = () => undefined;
  const lost = new Promise<never>((_, reject) => {
    lose = reject;
  });
  lost.catch(() => undefined);
  const timer = setInterval(() => {
    renewLease(db, name, holder, options.ttlMs)
      .then((renewed) => {
        if (renewed) {
          renewedAt = Date.now();
          return;
        }
        console.error(`[turnos] Se perdió el turno ${name}: venció sin renovarse y otra instancia pudo tomarlo. El trabajo se aborta.`);
        clearInterval(timer);
        lose(new LeaseLost(name));
      })
      .catch((error: unknown) => {
        console.warn(`[turnos] No se pudo renovar el turno ${name}: ${describeForLog(error)}`);
        // Sin renovar desde hace más que lo que dura el turno, ya venció: no se sigue como si fuera propio.
        if (Date.now() - renewedAt >= options.ttlMs) {
          console.error(`[turnos] El turno ${name} venció sin poder renovarse. El trabajo se aborta.`);
          clearInterval(timer);
          lose(new LeaseLost(name));
        }
      });
  }, options.renewMs);
  timer.unref?.();
  const work = fn();
  // Si el turno se pierde, el resultado tardío de fn no lo espera nadie: que no quede como un rechazo sin dueño.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, lost]);
  } finally {
    clearInterval(timer);
    await releaseLease(db, name, holder).catch(() => undefined);
  }
}

// ---------- En memoria (SQLite) ----------

declare global {
  // Los turnos tomados en este proceso; sobreviven a las recargas en caliente de next dev.
  var __rumboTurns: Set<string> | undefined;
}

const localTurns = (): Set<string> => (globalThis.__rumboTurns ??= new Set());

// ---------- Lo que usa el resto ----------

/** Si el turno de ese nombre lo tiene otro: tryExclusive no corrió nada. */
export const BUSY: unique symbol = Symbol("busy");

/**
 * Corre fn si nadie tiene el turno `name`; si lo tiene otro (otra pestaña, otra instancia), devuelve BUSY sin
 * esperar. Para lo que se puede volver a pedir en un momento: el escáner reintenta, la pantalla pide otra tanda.
 */
export async function tryExclusive<T>(name: string, fn: () => Promise<T>, options: LeaseOptions = DEFAULT_LEASE): Promise<T | typeof BUSY> {
  if (dataEngine() === "sqlite") {
    const turns = localTurns();
    if (turns.has(name)) return BUSY;
    turns.add(name);
    try {
      return await fn();
    } finally {
      turns.delete(name);
    }
  }
  const db = getDb();
  const holder = await acquireLease(db, name, options.ttlMs);
  if (!holder) return BUSY;
  return holding(db, name, holder, options, fn);
}

export class TurnTimeout extends Error {
  constructor(name: string, waitedMs: number) {
    super(`Pasaron ${Math.round(waitedMs / 1000)} s esperando el turno ${name}: reintentá más tarde`);
    this.name = "TurnTimeout";
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Espera el turno `name` y corre fn con él. En SQLite no espera nada (la fila la hace quien llama, en memoria).
 * En Postgres pregunta cada pocos cientos de milisegundos, con un poco de azar para que dos instancias no
 * pregunten a la par; pasado `waitMs` se rinde con TurnTimeout, que para el escáner es "reintentá".
 */
export async function serialized<T>(name: string, fn: () => Promise<T>, options: LeaseOptions & { waitMs: number } = { ...DEFAULT_LEASE, waitMs: 120_000 }): Promise<T> {
  if (dataEngine() === "sqlite") return fn();
  const db = getDb();
  const started = Date.now();
  let pause = 100;
  for (;;) {
    const holder = await acquireLease(db, name, options.ttlMs);
    if (holder) return holding(db, name, holder, options, fn);
    if (Date.now() - started > options.waitMs) throw new TurnTimeout(name, Date.now() - started);
    await sleep(pause + Math.floor(Math.random() * pause));
    pause = Math.min(pause * 2, 800);
  }
}
