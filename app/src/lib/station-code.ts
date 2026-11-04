// La forma de los códigos de puesto, compartida por el servidor, el panel y el escáner.
// Un código son doce letras y números (base32, sesenta bits: no se adivina ni probando desde muchas IP),
// que la interfaz muestra en tres grupos: "ABCD-EFGH-JKLM". Se acepta escrito en minúsculas, con o sin
// guiones y con espacios.

export const STATION_CODE_LENGTH = 12;
const STATION_CODE_RE = /^[A-Z2-7]{12}$/;

/** Lo que escribió el voluntario, como se guarda: mayúsculas, sin guiones ni espacios. */
export function normalizeStationCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function isValidStationCode(code: string): boolean {
  return STATION_CODE_RE.test(code);
}

/** Como se muestra y se dicta: "ABCD-EFGH-JKLM". */
export function formatStationCode(code: string): string {
  const clean = normalizeStationCode(code);
  return clean.length === STATION_CODE_LENGTH ? `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8)}` : clean;
}

/**
 * Hasta cuándo abren los códigos de puesto de un evento: un día después de su final, o un día y medio después de
 * su inicio si no tiene final. Después, el escáner contesta "vencido": un código que se quedó en un celular no
 * sirve semanas más tarde para dejar constancia de una entrada que no pasó. Sin fechas que se puedan leer, no vencen.
 */
export const STATION_CODE_GRACE_MS = 24 * 60 * 60 * 1000;
export const STATION_CODE_NO_END_MS = 36 * 60 * 60 * 1000;

export function stationCodesExpireAt(event: { startsAt: string; endsAt: string | null }): number {
  const end = event.endsAt ? Date.parse(event.endsAt) : NaN;
  if (Number.isFinite(end)) return end + STATION_CODE_GRACE_MS;
  const start = Date.parse(event.startsAt);
  return Number.isFinite(start) ? start + STATION_CODE_NO_END_MS : Number.POSITIVE_INFINITY;
}

export function stationCodesExpired(event: { startsAt: string; endsAt: string | null }, now: number = Date.now()): boolean {
  return now >= stationCodesExpireAt(event);
}
