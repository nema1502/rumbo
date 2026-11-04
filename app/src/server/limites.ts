// Los frenos contra quien prueba a la fuerza: códigos de puesto al azar, inscripciones en masa, el mismo
// correo una y otra vez. Cuentan por quién pide (la IP que pone la plataforma, nunca la que dice el pedido)
// y también en total, para que cambiar de IP no alcance.
//
// Con SQLite viven en la memoria del proceso (globalThis), como siempre: hay un solo proceso. Con Postgres
// viven en la base (tabla attempt_limits, migrations-pg/010-estado-compartido.sql), porque en Vercel cada
// pedido puede caer en otra instancia y cada una tendría los suyos. Los dos siguen la misma cuenta (noteState).
import { dataEngine, getDb, type Db, type Row } from "./base/index.ts";
import { getEnv } from "./env.ts";

// ---------- Quién pide ----------

/**
 * La IP de quien pide, como la pone la plataforma. En Vercel, x-real-ip: la escribe Vercel y quien pide no
 * la puede cambiar. Detrás de otro proxy, el encabezado que diga RUMBO_TRUSTED_IP_HEADER (si el proxy
 * agrega la IP al final de x-forwarded-for, vale la última). Sin ninguno de los dos (next dev, o un
 * servidor sin proxy delante) ningún encabezado es de fiar: todos los pedidos cuentan como uno solo,
 * "local", y el freno queda global. Lo que diga x-forwarded-for por su cuenta no se cree nunca.
 */
export function clientKey(headers: { get(name: string): string | null }): string {
  const header = getEnv("RUMBO_TRUSTED_IP_HEADER") ?? (getEnv("VERCEL") ? "x-real-ip" : undefined);
  if (!header) return "local";
  const value = headers.get(header);
  const ip = value?.split(",").at(-1)?.trim();
  return ip ? ip.slice(0, 64) : "local";
}

// ---------- El freno de intentos ----------

export interface AttemptLimits {
  /** La ventana en la que se cuentan los intentos. */
  windowMs: number;
  /** Cuántos intentos de una misma clave caben en la ventana antes de frenarla. */
  perKey: number;
  /**
   * Cuántos intentos de todas las claves juntas caben en la ventana. Pasado eso (alguien prueba desde
   * muchas IP a la vez), cada clave que ya falló una vez en la ventana queda frenada: a cada IP le queda
   * un intento por ventana, y quien no falló nunca (el voluntario que escribe bien su código) sigue entrando.
   */
  global: number;
  /** Lo que dura el primer freno de una clave; cada freno siguiente dura el doble, hasta maxLockMs. */
  lockMs: number;
  maxLockMs: number;
  /** Cuánto tiempo sin intentos borra la historia de una clave (y con ella el freno creciente). */
  forgetMs: number;
}

interface KeyState {
  count: number;
  windowStart: number;
  lockedUntil: number;
  lockouts: number;
  last: number;
}

interface TotalState {
  count: number;
  windowStart: number;
}

/** Lo que tienen los dos frenos, el de la memoria y el de la base. El de la base contesta con promesas. */
export interface Limiter {
  /** Si la clave está frenada, cuántos milisegundos le faltan; si no, 0. */
  blockedFor(key: string): number | Promise<number>;
  /** Cuenta un intento de la clave (un código equivocado, una inscripción). */
  note(key: string): void | Promise<void>;
  /**
   * Mirar y contar de un solo golpe, para lo que cuenta cada pedido (la búsqueda de la puerta): si la clave está
   * frenada devuelve cuánto le falta y no cuenta nada; si no, cuenta este intento y devuelve 0. Entre mirar y
   * contar por separado se colaba una ráfaga entera: cuatrocientos pedidos a la vez pasaban todos.
   */
  take(key: string): number | Promise<number>;
  /** Para las pruebas. */
  clear(): void | Promise<void>;
}

function globalAlarm(total: TotalState, at: number, limits: AttemptLimits): boolean {
  return at - total.windowStart < limits.windowMs && total.count >= limits.global;
}

function blockedForState(state: KeyState | undefined, total: TotalState, at: number, limits: AttemptLimits): number {
  if (!state) return 0;
  if (state.lockedUntil > at) return state.lockedUntil - at;
  const inWindow = at - state.windowStart < limits.windowMs;
  if (inWindow && state.count > 0 && globalAlarm(total, at, limits)) return state.windowStart + limits.windowMs - at;
  return 0;
}

/** Un intento más: los estados nuevos de la clave y del total. `fresh` dice que la clave no tenía historia (o la olvidó). */
function noteState(previous: KeyState | undefined, previousTotal: TotalState, at: number, limits: AttemptLimits): { state: KeyState; total: TotalState; fresh: boolean } {
  const total = at - previousTotal.windowStart >= limits.windowMs ? { count: 0, windowStart: at } : { ...previousTotal };
  total.count++;

  const remembered = previous && at - previous.last > limits.forgetMs ? undefined : previous;
  const state: KeyState = remembered ? { ...remembered } : { count: 0, windowStart: at, lockedUntil: 0, lockouts: 0, last: at };
  if (at - state.windowStart >= limits.windowMs) {
    state.count = 0;
    state.windowStart = at;
  }
  state.count++;
  state.last = at;
  if (state.count >= limits.perKey) {
    state.lockouts++;
    state.lockedUntil = at + Math.min(limits.maxLockMs, limits.lockMs * 2 ** (state.lockouts - 1));
    state.count = 0;
    state.windowStart = state.lockedUntil;
  }
  return { state, total, fresh: !remembered };
}

/** Cuántas claves recuerda como mucho: así un ataque desde muchas IP no llena la memoria. */
const MAX_KEYS = 10_000;

/** El freno en la memoria del proceso (SQLite). */
export class AttemptLimiter implements Limiter {
  private readonly limits: AttemptLimits;
  private readonly now: () => number;
  private readonly keys = new Map<string, KeyState>();
  private total: TotalState = { count: 0, windowStart: 0 };

  /** `now` es el reloj: las pruebas pasan uno propio para no esperar de verdad. */
  constructor(limits: AttemptLimits, now: () => number = Date.now) {
    this.limits = limits;
    this.now = now;
  }

  blockedFor(key: string): number {
    return blockedForState(this.keys.get(key), this.total, this.now(), this.limits);
  }

  note(key: string): void {
    const at = this.now();
    const next = noteState(this.keys.get(key), this.total, at, this.limits);
    this.total = next.total;
    if (next.fresh) this.prune(at);
    this.keys.set(key, next.state);
  }

  // Sin nada asíncrono en el medio: en un proceso, mirar y contar seguidos ya es de un solo golpe.
  take(key: string): number {
    const wait = this.blockedFor(key);
    if (wait > 0) return wait;
    this.note(key);
    return 0;
  }

  clear(): void {
    this.keys.clear();
    this.total = { count: 0, windowStart: 0 };
  }

  private prune(at: number): void {
    if (this.keys.size < MAX_KEYS) return;
    for (const [key, state] of this.keys) {
      if (state.lockedUntil <= at && at - state.last > this.limits.windowMs) this.keys.delete(key);
    }
    // Si todavía no hay lugar, se olvida la más vieja: una clave frenada pierde su freno antes que llenar la memoria.
    while (this.keys.size >= MAX_KEYS) {
      const oldest = this.keys.keys().next().value;
      if (oldest === undefined) break;
      this.keys.delete(oldest);
    }
  }
}

/** La fila del total de cada freno lleva la clave vacía (quien pide nunca es vacío: sin IP es "local"). */
const TOTAL_KEY = "";
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (value: unknown) => Date.parse(String(value));

function rowToState(row: Row): KeyState {
  return { count: Number(row.count), windowStart: ms(row.window_start), lockedUntil: ms(row.locked_until), lockouts: Number(row.lockouts), last: ms(row.last_at) };
}

/**
 * El freno en la base (Postgres): la misma cuenta, con el estado en la tabla attempt_limits. Contar un intento
 * toma primero la fila del total del freno (FOR UPDATE): así dos instancias que cuentan a la vez van en fila y
 * ninguna pisa la cuenta de la otra. Mirar si una clave está frenada solo lee.
 */
export class DbAttemptLimiter implements Limiter {
  private readonly name: string;
  private readonly limits: AttemptLimits;
  private readonly db: () => Db;
  private readonly now: () => number;

  constructor(name: string, limits: AttemptLimits, db: () => Db = getDb, now: () => number = Date.now) {
    this.name = name;
    this.limits = limits;
    this.db = db;
    this.now = now;
  }

  private keyOf(key: string): string {
    return key || "local";
  }

  async blockedFor(key: string): Promise<number> {
    const at = this.now();
    const rows = await this.db().all("SELECT * FROM attempt_limits WHERE limiter = ? AND key IN (?, ?)", [this.name, TOTAL_KEY, this.keyOf(key)]);
    const total = rows.find((r) => r.key === TOTAL_KEY);
    const own = rows.find((r) => r.key === this.keyOf(key));
    return blockedForState(own ? rowToState(own) : undefined, total ? rowToState(total) : { count: 0, windowStart: 0 }, at, this.limits);
  }

  async note(key: string): Promise<void> {
    await this.count(key, false);
  }

  async take(key: string): Promise<number> {
    return this.count(key, true);
  }

  /**
   * Cuenta un intento dentro de una transacción que toma primero la fila del total (FOR UPDATE): dos instancias
   * que cuentan a la vez van en fila. Con `onlyIfFree`, antes de contar mira si la clave está frenada y, si lo
   * está, devuelve cuánto le falta sin contar nada (es el `take`); si no, devuelve 0.
   */
  private async count(key: string, onlyIfFree: boolean): Promise<number> {
    const at = this.now();
    const k = this.keyOf(key);
    return this.db().transaction(async (tx) => {
      // El total nace como en la memoria (cero intentos desde el principio de los tiempos) y se toma primero.
      await tx.run(
        "INSERT INTO attempt_limits (limiter, key, count, window_start, locked_until, lockouts, last_at) VALUES (?, ?, 0, ?, ?, 0, ?) ON CONFLICT DO NOTHING",
        [this.name, TOTAL_KEY, iso(0), iso(0), iso(0)],
      );
      const totalRow = await tx.one("SELECT * FROM attempt_limits WHERE limiter = ? AND key = ? FOR UPDATE", [this.name, TOTAL_KEY]);
      const own = await tx.one("SELECT * FROM attempt_limits WHERE limiter = ? AND key = ?", [this.name, k]);
      const total = totalRow ? rowToState(totalRow) : { count: 0, windowStart: 0 };
      if (onlyIfFree) {
        const wait = blockedForState(own ? rowToState(own) : undefined, total, at, this.limits);
        if (wait > 0) return wait;
      }
      const next = noteState(own ? rowToState(own) : undefined, total, at, this.limits);
      const s = next.state;
      await tx.run(
        `INSERT INTO attempt_limits (limiter, key, count, window_start, locked_until, lockouts, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (limiter, key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start,
           locked_until = excluded.locked_until, lockouts = excluded.lockouts, last_at = excluded.last_at`,
        [this.name, k, s.count, iso(s.windowStart), iso(s.lockedUntil), s.lockouts, iso(s.last)],
      );
      await tx.run("UPDATE attempt_limits SET count = ?, window_start = ?, last_at = ? WHERE limiter = ? AND key = ?", [next.total.count, iso(next.total.windowStart), iso(at), this.name, TOTAL_KEY]);
      // Una clave nueva es buen momento para borrar las que ya se olvidaron: no tienen nada que frenar.
      if (next.fresh) {
        await tx.run("DELETE FROM attempt_limits WHERE limiter = ? AND key <> ? AND last_at < ? AND locked_until <= ?", [this.name, TOTAL_KEY, iso(at - this.limits.forgetMs), iso(at)]);
      }
      return 0;
    });
  }

  async clear(): Promise<void> {
    await this.db().run("DELETE FROM attempt_limits WHERE limiter = ?", [this.name]);
  }
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

declare global {
  var __rumboLimiters: Map<string, Limiter> | undefined;
}

/** Un freno por nombre, uno solo por proceso (sobrevive a las recargas de next dev): en memoria con SQLite, en la base con Postgres. */
export function limiter(name: string, limits: AttemptLimits): Limiter {
  const all = (globalThis.__rumboLimiters ??= new Map());
  let found = all.get(name);
  if (!found) {
    found = dataEngine() === "sqlite" ? new AttemptLimiter(limits) : new DbAttemptLimiter(name, limits);
    all.set(name, found);
  }
  return found;
}

/**
 * Los códigos de puesto equivocados: ocho por IP en diez minutos, y después una espera que crece (diez
 * minutos, veinte, cuarenta, hasta un día). Cincuenta equivocados en total en diez minutos encienden la
 * alarma global. Con códigos de sesenta bits, ni a ese ritmo ni desde muchas IP se adivina uno.
 */
export function stationCodeAttempts(): Limiter {
  return limiter("station-code", { windowMs: 10 * MINUTE, perKey: 8, global: 50, lockMs: 10 * MINUTE, maxLockMs: 24 * HOUR, forgetMs: 24 * HOUR });
}

/**
 * Las inscripciones que crean una cuenta nueva (cada una la fondea, le abre la línea de confianza, le da
 * saldo y manda una transacción, todo pagado por el servidor): sesenta pedidos por IP en diez minutos,
 * generoso para la fila de un evento que se inscribe en la puerta detrás del mismo wifi, y seiscientos en total.
 */
export function registrationAttempts(): Limiter {
  return limiter("registration", { windowMs: 10 * MINUTE, perKey: 60, global: 600, lockMs: 10 * MINUTE, maxLockMs: 6 * HOUR, forgetMs: 6 * HOUR });
}

/**
 * Los desafíos para probar una cuenta propia (cada uno es una fila en la base): sesenta por IP en diez minutos,
 * lo mismo que las inscripciones, porque cada inscripción con la cuenta propia pide uno.
 */
export function walletChallengeAttempts(): Limiter {
  return limiter("wallet-challenge", { windowMs: 10 * MINUTE, perKey: 60, global: 1200, lockMs: 10 * MINUTE, maxLockMs: 6 * HOUR, forgetMs: 6 * HOUR });
}

/**
 * Las entradas como organizador que fallan (una prueba que no vale): diez por IP en diez minutos y después una
 * espera que crece. Cada intento gasta además un desafío, que ya tiene su propio freno (walletChallengeAttempts).
 */
export function organizerLoginAttempts(): Limiter {
  return limiter("organizer-login", { windowMs: 10 * MINUTE, perKey: 10, global: 200, lockMs: 10 * MINUTE, maxLockMs: 6 * HOUR, forgetMs: 6 * HOUR });
}

/** El reenvío del enlace a un correo que ya tenía su credencial: uno cada diez minutos por correo y evento. */
export function linkResendAttempts(): Limiter {
  return limiter("link-resend", { windowMs: 10 * MINUTE, perKey: 1, global: Number.MAX_SAFE_INTEGER, lockMs: 10 * MINUTE, maxLockMs: 10 * MINUTE, forgetMs: HOUR });
}
