// La hora del servidor, medida desde el navegador: lo que comparten la credencial (el QR que rota, QrRotante.tsx)
// y el escáner (la ventana que acepta, Escaner.tsx). Un celular con el reloj desfasado igual arma, o lee, el QR
// de la ventana que corresponde. Se mide con el viaje de ida y vuelta: la hora que dice el servidor es la de la
// mitad del viaje. Y se vuelve a medir cada tanto, porque el reloj del celular puede saltar después (cuando se
// sincroniza solo, o cuando alguien lo cambia).
import { clockOffset } from "./qr-live.ts";

/** Cada cuánto conviene volver a medir mientras la pantalla está a la vista. */
export const CLOCK_REMEASURE_MS = 60_000;
/** Cuánto puede diferir lo que avanzó el reloj de pared de lo que avanzó el monotónico antes de darlo por un salto. */
export const CLOCK_JUMP_MS = 5_000;

/**
 * Cuánto hay que sumarle al reloj de este aparato para tener la hora del servidor (0 si está bien, o si no hay red).
 * `fetchImpl` y `now` son para las pruebas.
 */
export async function measureClockOffset(fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<number> {
  try {
    const before = now();
    const response = await fetchImpl("/api/hora", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    const after = now();
    if (!response.ok) return 0;
    const { now: serverNow } = (await response.json()) as { now?: number };
    if (typeof serverNow !== "number" || !Number.isFinite(serverNow)) return 0;
    // Lo que dijo el servidor vale para la mitad del viaje: a la vuelta ya pasó la mitad.
    return clockOffset(serverNow + (after - before) / 2, after);
  } catch {
    return 0;
  }
}

/**
 * Detecta si el reloj de pared saltó entre dos miradas: el monotónico (performance.now) no salta nunca, así que si
 * los dos avanzaron distinto, el de pared se movió (o el aparato durmió). Devuelve de cuánto fue el salto, o 0.
 */
export function clockJumpSince(previous: { wall: number; mono: number }, current: { wall: number; mono: number }): number {
  const jump = current.wall - previous.wall - (current.mono - previous.mono);
  return Math.abs(jump) > CLOCK_JUMP_MS ? jump : 0;
}

/** La hora de pared y la monotónica de este instante. */
export function clockMark(): { wall: number; mono: number } {
  const mono = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  return { wall: Date.now(), mono };
}
