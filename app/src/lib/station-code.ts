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
