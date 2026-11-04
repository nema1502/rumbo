// Una fecha ISO 8601 que existe de verdad, como la escribe el escáner en cada lectura y como la guarda el
// espejo. La comparten la lectura del pedido (src/server/escaner.ts) y la capa de datos (repo.ts, stands.ts),
// que la vuelve a mirar antes de escribir: una fecha que no existe no entra a la base por ningún camino.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Antes de este año no hubo ninguna lectura: una fecha así es un reloj roto o un dato inventado. Y el driver de
 * Postgres no sabe leer un año de menos de cien (lo devuelve como una fecha inválida que rompía cada lectura).
 */
export const MIN_YEAR = 2000;

/**
 * Si el texto es una fecha ISO 8601 que existe de verdad: la forma, y además el mes, el día (según el mes y el
 * año), la hora y el desfase. Date.parse acepta un 30 de febrero y lo corre a marzo; Postgres lo rechaza, y
 * un registro con esa fecha quedaba reintentando para siempre. Nunca antes del año 2000.
 */
export function isRealIsoDate(text: string): boolean {
  const m = ISO_RE.exec(text);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [number, number, number, number, number, number];
  if (year < MIN_YEAR || year > 9999 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return false;
  if (m[8] !== "Z" && (Number(m[10]) > 14 || Number(m[11]) > 59)) return false;
  return Number.isFinite(Date.parse(text));
}

/** Si el texto se puede leer como un instante (Date.parse lo entiende): lo mínimo para mostrarlo sin que la pantalla reviente. */
export function isReadableDate(text: unknown): text is string {
  return typeof text === "string" && Number.isFinite(Date.parse(text));
}

/** El más temprano de dos instantes (el que no se puede leer pierde): la hora de la lectura, o la de llegada si el escáner iba adelantado. */
export function earliestIso(a: string, b: string): string {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return tb < ta ? b : a;
}
