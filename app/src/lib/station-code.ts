// La forma de los códigos de puesto, compartida por el servidor, el panel y el escáner.
// Un código son ocho letras y números (base32), que la interfaz muestra en dos grupos: "ABCD-EFGH".
// Se acepta escrito en minúsculas, con o sin guion y con espacios alrededor.

export const STATION_CODE_LENGTH = 8;
const STATION_CODE_RE = /^[A-Z2-7]{8}$/;

/** Lo que escribió el voluntario, como se guarda: mayúsculas, sin guion ni espacios. */
export function normalizeStationCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function isValidStationCode(code: string): boolean {
  return STATION_CODE_RE.test(code);
}

/** Como se muestra y se dicta: "ABCD-EFGH". */
export function formatStationCode(code: string): string {
  const clean = normalizeStationCode(code);
  return clean.length === STATION_CODE_LENGTH ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}
