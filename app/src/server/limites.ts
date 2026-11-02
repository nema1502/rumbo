// Los frenos contra quien prueba a la fuerza: códigos de puesto al azar, inscripciones en masa, el mismo
// correo una y otra vez. Cuentan por quién pide (la IP que pone la plataforma, nunca la que dice el pedido)
// y también en total, para que cambiar de IP no alcance.
//
// Viven en la memoria del proceso (globalThis), como el resto del modo de prueba. TODO producción: con
// varias instancias del servidor cada una tiene los suyos; cuando exista SupabaseRepo, los contadores
// tienen que vivir en la base o en un almacén compartido.
import { getEnv } from "./env.ts";

// ---------- Quién pide ----------

/**
 * La IP de quien pide, como la pone la plataforma. En Vercel, x-real-ip: la escribe Vercel y quien pide no
 * la puede cambiar. Detrás de otro proxy, el encabezado que diga RUMBO_TRUSTED_IP_HEADER (si el proxy
 * agrega la IP al final de x-forwarded-for, vale la última). Sin ninguno de los dos (next dev, o un
 * servidor sin proxy delante) ningún encabezado es de fiar: todos los pedidos cuentan como uno solo,
 * "local", y el freno queda global. Lo que diga x-forwarded-for por su cuenta no se cree nunca.
 */
export function clientKey(headers: Headers): string {
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

/** Cuántas claves recuerda como mucho: así un ataque desde muchas IP no llena la memoria. */
const MAX_KEYS = 10_000;

export class AttemptLimiter {
  private readonly limits: AttemptLimits;
  private readonly now: () => number;
  private readonly keys = new Map<string, KeyState>();
  private total = { count: 0, windowStart: 0 };

  /** `now` es el reloj: las pruebas pasan uno propio para no esperar de verdad. */
  constructor(limits: AttemptLimits, now: () => number = Date.now) {
    this.limits = limits;
    this.now = now;
  }

  /** Si la clave está frenada, cuántos milisegundos le faltan; si no, 0. */
  blockedFor(key: string): number {
    const at = this.now();
    const state = this.keys.get(key);
    if (!state) return 0;
    if (state.lockedUntil > at) return state.lockedUntil - at;
    const inWindow = at - state.windowStart < this.limits.windowMs;
    if (inWindow && state.count > 0 && this.globalAlarm(at)) return state.windowStart + this.limits.windowMs - at;
    return 0;
  }

  /** Cuenta un intento de la clave (un código equivocado, una inscripción). */
  note(key: string): void {
    const at = this.now();
    if (at - this.total.windowStart >= this.limits.windowMs) this.total = { count: 0, windowStart: at };
    this.total.count++;

    let state = this.keys.get(key);
    if (state && at - state.last > this.limits.forgetMs) state = undefined;
    if (!state) {
      this.prune(at);
      state = { count: 0, windowStart: at, lockedUntil: 0, lockouts: 0, last: at };
      this.keys.set(key, state);
    }
    if (at - state.windowStart >= this.limits.windowMs) {
      state.count = 0;
      state.windowStart = at;
    }
    state.count++;
    state.last = at;
    if (state.count >= this.limits.perKey) {
      state.lockouts++;
      state.lockedUntil = at + Math.min(this.limits.maxLockMs, this.limits.lockMs * 2 ** (state.lockouts - 1));
      state.count = 0;
      state.windowStart = state.lockedUntil;
    }
  }

  /** Para las pruebas. */
  clear(): void {
    this.keys.clear();
    this.total = { count: 0, windowStart: 0 };
  }

  private globalAlarm(at: number): boolean {
    return at - this.total.windowStart < this.limits.windowMs && this.total.count >= this.limits.global;
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

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

declare global {
  var __rumboLimiters: Map<string, AttemptLimiter> | undefined;
}

/** Un freno por nombre, uno solo por proceso (sobrevive a las recargas de next dev). */
function limiter(name: string, limits: AttemptLimits): AttemptLimiter {
  const all = (globalThis.__rumboLimiters ??= new Map());
  let found = all.get(name);
  if (!found) {
    found = new AttemptLimiter(limits);
    all.set(name, found);
  }
  return found;
}

/**
 * Los códigos de puesto equivocados: ocho por IP en diez minutos, y después una espera que crece (diez
 * minutos, veinte, cuarenta, hasta un día). Cincuenta equivocados en total en diez minutos encienden la
 * alarma global. Con códigos de sesenta bits, ni a ese ritmo ni desde muchas IP se adivina uno.
 */
export function stationCodeAttempts(): AttemptLimiter {
  return limiter("station-code", { windowMs: 10 * MINUTE, perKey: 8, global: 50, lockMs: 10 * MINUTE, maxLockMs: 24 * HOUR, forgetMs: 24 * HOUR });
}

/**
 * Las inscripciones que crean una cuenta nueva (cada una la fondea, le abre la línea de confianza, le da
 * saldo y manda una transacción, todo pagado por el servidor): sesenta pedidos por IP en diez minutos,
 * generoso para la fila de un evento que se inscribe en la puerta detrás del mismo wifi, y seiscientos en total.
 */
export function registrationAttempts(): AttemptLimiter {
  return limiter("registration", { windowMs: 10 * MINUTE, perKey: 60, global: 600, lockMs: 10 * MINUTE, maxLockMs: 6 * HOUR, forgetMs: 6 * HOUR });
}

/** El reenvío del enlace a un correo que ya tenía su credencial: uno cada diez minutos por correo y evento. */
export function linkResendAttempts(): AttemptLimiter {
  return limiter("link-resend", { windowMs: 10 * MINUTE, perKey: 1, global: Number.MAX_SAFE_INTEGER, lockMs: 10 * MINUTE, maxLockMs: 10 * MINUTE, forgetMs: HOUR });
}
