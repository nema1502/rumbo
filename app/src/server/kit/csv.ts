/**
 * Lectura de CSV: la tabla que exporta Luma, Bevy, Meetup o una hoja de cálculo.
 *
 * Ya leyó exports reales de Luma de 35 columnas: parseTable y sus arreglos,
 * findColumn, la detección del origen y la decodificación del archivo, más el
 * reconocimiento de Bevy (gdg.community.dev). Lo propio del sorteo (filtros de asistencia, lista de
 * nombres para el protocolo, homónimos) se dejó afuera.
 *
 * Licencia MIT, la misma de este repositorio (ver LICENSE).
 *
 * Qué resuelve: la primera columna suele ser un identificador, y un nombre como
 * "Salvatierra, Rodrigo" se partía en la coma. El ancho de la tabla lo da el
 * encabezado, una fila corta se completa y una larga se arregla si hay una sola
 * forma segura de hacerlo; el punto y coma de Excel en español, las tabulaciones
 * de una hoja pegada, el BOM y las comillas escapadas se leen bien.
 */

export interface Table {
  /** Nombres de las columnas, o `Columna 1`, `Columna 2`… si no hay cabecera. */
  columns: string[];
  /** Filas de datos, ya sin la cabecera. */
  rows: string[][];
  headerDetected: boolean;
  /** Índice de la columna que probablemente tenga los nombres. */
  suggested: number;
  /**
   * Las líneas del archivo (desde 1) con filas que no se pudieron leer: más
   * celdas que columnas y ninguna forma segura de arreglarlas. No entran, y
   * la ventana dice cuántas son y dónde están.
   */
  skipped: number[];
}

/** Separadores que usan las herramientas más comunes, en orden de probabilidad. */
const DELIMITERS = [",", ";", "\t"] as const;

/**
 * Los topes de una tabla que se lee de un archivo ajeno. Una lista de invitados tiene decenas de columnas y
 * algunos miles de filas; más que esto es un archivo roto o uno armado para hacer trabajar de más al servidor
 * (una celda de cuarenta mil puntos contra la expresión del correo, cinco mil columnas que se rellenan en cada
 * fila). Pasado un tope, se avisa con CsvLimitError y no se lee más.
 */
export interface TableLimits {
  /** Letras por celda. */
  maxCell: number;
  maxColumns: number;
  /** Filas de datos, sin la cabecera. */
  maxRows: number;
}

export const TABLE_LIMITS: TableLimits = { maxCell: 1000, maxColumns: 100, maxRows: 5000 };

export type CsvLimitCode = "cell_too_long" | "too_many_columns" | "too_many_rows";

export class CsvLimitError extends Error {
  readonly code: CsvLimitCode;
  constructor(code: CsvLimitCode) {
    super(`La tabla se pasa del tope: ${code}`);
    this.name = "CsvLimitError";
    this.code = code;
  }
}

/** Cabeceras que suelen contener el nombre de la persona, en varios idiomas. */
const NAME_HINTS = [
  "name", "full name", "attendee name", "guest name", "display name",
  "nombre", "nombre completo", "nombres", "participante", "asistente", "invitado",
  "first name", "nome", "nom",
];

/** Cabeceras que nunca son el nombre, aunque queden primeras. */
const NOT_NAME = ["id", "order", "ticket", "email", "correo", "mail", "phone", "teléfono", "telefono", "date", "fecha", "status", "estado", "amount", "monto", "url", "código", "codigo"];

/** Una celda de encabezado, para comparar: sin tildes, mayúsculas, comillas ni dos puntos. */
const headerKey = (s: string): string => nameKey(s.replace(/\uFEFF/g, "")).replace(/^["'\s]+|["'\s:*]+$/g, "");

/**
 * Lo que dice una primera fila que es encabezado y no una persona: las pistas
 * de arriba y otras formas que se ven en planillas hechas a mano. Sin esto,
 * "Participantes" o "Nombres y apellidos" entraban al sorteo como una persona
 * más. Van solo palabras que nunca son el dato de una celda: "Guest" o
 * "Attendee" pueden ser el tipo de entrada de alguien, y no están.
 */
const HEADERS = new Set(
  [
    ...NAME_HINTS, ...NOT_NAME,
    "names", "nombre y apellido", "nombre y apellidos", "nombres y apellidos", "apellidos y nombres",
    "apellido", "apellidos", "last name", "surname", "participantes", "asistentes", "invitados", "invitadas",
    "participants", "attendees", "guests", "e-mail", "email address", "correo electrónico",
    // Los encabezados de Luma y de Bevy que no dicen nombre ni correo.
    "first_name", "last_name", "approval_status", "ticket_name", "ticket_type", "api_id", "guest_id", "created_at",
    "checked_in_at", "registration status", "attendee status", "registered at", "registration date",
  ].map(headerKey),
);

const isHeaderCell = (c: string): boolean => HEADERS.has(headerKey(c));

/**
 * ¿Este texto es una tabla y no una lista de nombres?
 *
 * Con una sola columna no hay nada que elegir, así que se trata como lista
 * suelta y el flujo de siempre alcanza.
 */
export function looksTabular(text: string): boolean {
  const table = parseTable(text);
  return table !== null && table.columns.length > 1;
}

/**
 * Lee el texto como tabla. Devuelve `null` si no hay nada escrito.
 *
 * Una fila con otro ancho ya no descarta la tabla entera: hasta el QA del 16
 * de octubre de 2026, una sola coma sin comillas ("Salvatierra, Rodrigo" escrito a
 * mano) hacía que el archivo entrara como texto suelto, con el encabezado de
 * participante y los nombres cortados en la coma. Ahora el ancho lo da el
 * encabezado (o el de la mayoría de las filas), una fila corta se completa con
 * celdas vacías, que es lo que hace cualquier planilla, y una larga se arregla
 * si hay una sola forma segura de hacerlo. Si no, se salta y queda anotada.
 */
export function parseTable(text: string, limits: TableLimits = TABLE_LIMITS): Table | null {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!clean.trim()) return null;

  const { delimiter, rows: parsed } = pickDelimiter(clean, limits);
  const grid = parsed.filter(filled);
  if (!grid[0]) return null;
  // Un encabezado con una coma final ("Name,Email,Status,") no tiene una columna de más... salvo que las filas de
  // datos sí la llenen ("Name,Email," con "Ana Uno,ana1@example.com,approved"): entonces la columna existe, sin nombre.
  const headerCells = withoutTrailingEmpty(grid[0].cells);
  if (headerCells.length > 1 && headerCells.some(isHeaderCell) && !dataFillsColumns(grid.slice(1), headerCells.length)) grid[0] = { ...grid[0], cells: headerCells };
  const first = grid[0];

  const width = expectedWidth(grid);
  // Los topes se miran antes de rellenar o arreglar nada: era al rellenar donde un archivo hostil costaba gigas.
  if (width > limits.maxColumns) throw new CsvLimitError("too_many_columns");
  if (grid.length - 1 > limits.maxRows) throw new CsvLimitError("too_many_rows");
  for (const r of grid) for (const c of r.cells) if (c.length > limits.maxCell) throw new CsvLimitError("cell_too_long");

  const headerDetected = first.cells.length === width && looksLikeHeader(first.cells, grid.slice(1).map((r) => r.cells));
  const data = headerDetected ? grid.slice(1) : grid;
  const kinds = columnKinds(data, width, headerDetected ? nameHintColumn(first.cells) : -1);
  const pad = (cells: readonly string[]): string[] => [...cells, ...new Array<string>(Math.max(0, width - cells.length)).fill("")];
  const fitsAll = (row: readonly string[]): boolean => row.every((v, i) => fits(kinds[i] ?? "free", v));

  const rows: string[][] = [];
  const skipped: number[] = [];
  for (const r of data) {
    if (r.cells.length === width) rows.push(r.cells);
    // La que no escribió las celdas vacías del final.
    else if (r.cells.length < width) rows.push(pad(r.cells));
    else {
      // Una coma final en los datos ("Ana,ana@example.com,approved,") deja una celda vacía de más: sin ella la fila
      // encaja, y se toma así si cada columna queda con lo que suele tener. Si no, es una coma sin comillas adentro
      // de un campo, y se intenta arreglar (primero sin la celda vacía del final, después con todo).
      const cut = withoutTrailingEmpty(r.cells);
      const mended =
        cut.length <= width && fitsAll(pad(cut))
          ? pad(cut)
          : ((cut.length > width ? mend(cut, width, kinds, delimiter) : null) ?? (cut.length < r.cells.length ? mend(r.cells, width, kinds, delimiter) : null));
      if (mended) rows.push(mended);
      else skipped.push(r.line);
    }
  }
  const columns = Array.from({ length: width }, (_, i) =>
    (headerDetected ? first.cells[i]?.trim() : "") || `Columna ${i + 1}`);
  return { columns, rows, headerDetected, suggested: suggestColumn(columns, rows, headerDetected), skipped };
}

/** Cabeceras que dicen si la persona fue: el check-in de Luma, la asistencia de otras. */
const PRESENT_HINTS = [
  "checked_in_at", "checked in", "checked_in", "check-in", "check in", "checkin",
  "attended", "attendance", "attendee status", "asistió", "asistio", "asistencia", "presente",
];

/** El contenido de una celda, sin espacios de los bordes. Vacío si la fila no llega hasta ahí. */
export const cell = (row: string[], i: number): string => (row[i] ?? "").trim();

/* ------------------------------------------------ qué columna es cuál */

/** Una cabecera para comparar: sin tildes ni mayúsculas, y con guiones, guiones bajos y espacios iguales. */
const columnKey = (s: string): string => nameKey(s).replace(/[\s_\-.]+/g, " ").trim();

/**
 * La primera columna cuya cabecera es una de las pistas, sin importar mayúsculas, tildes ni si se separa con
 * espacio o con guion bajo ("First Name", "first_name"). -1 si no está o la tabla no tiene cabecera.
 */
export function findColumn(table: Table, hints: readonly string[]): number {
  if (!table.headerDetected) return -1;
  const wanted = hints.map(columnKey);
  const columns = table.columns.map(columnKey);
  for (const hint of wanted) {
    const at = columns.indexOf(hint);
    if (at >= 0) return at;
  }
  return -1;
}

/** La columna que dice si la persona fue (el check-in de Luma). */
export const presentColumn = (t: Table): number => findColumn(t, PRESENT_HINTS);
/** El estado de la inscripción: aprobado, pendiente, invitado, rechazado. */
export const statusColumn = (t: Table): number =>
  findColumn(t, [
    "approval_status", "registration status", "attendee status", "rsvp status", "rsvp", "status",
    "estado de aprobacion", "estado de la inscripcion", "estado", "ticket status",
  ]);
/** El correo. */
export const emailColumn = (t: Table): number =>
  findColumn(t, ["email", "e-mail", "email address", "correo", "correo electronico", "mail"]);

/** De dónde parece venir el archivo, por las columnas que cada plataforma pone y las otras no. */
export type ListSource = "luma" | "bevy";

export function detectSource(t: Table): ListSource | null {
  if (!t.headerDetected) return null;
  // Luma: un identificador de invitado, el QR del check-in o el estado de aprobación con su hora de check-in.
  if (findColumn(t, ["api_id", "guest_id", "qr_code_url"]) >= 0) return "luma";
  if (findColumn(t, ["approval_status"]) >= 0 && (presentColumn(t) >= 0 || findColumn(t, ["ticket_name"]) >= 0)) return "luma";
  // Bevy (gdg.community.dev): el capítulo, el evento de la plataforma y el estado de la inscripción.
  if (findColumn(t, ["chapter", "chapter name", "event id", "event name", "attendee id", "registration date", "registered at", "date registered"]) >= 0) return "bevy";
  if (findColumn(t, ["attendee status", "registration status"]) >= 0) return "bevy";
  return null;
}

/** Partículas que van en minúscula en medio de un nombre. */
const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "das", "do", "dos", "van", "von", "di"]);

/**
 * Mayúsculas de nombre para lo que llegó todo en minúsculas o todo en
 * mayúsculas ("juan perez", "MARIA QUISPE"), que en la pantalla grande se ve
 * descuidado. Un nombre con mayúsculas mezcladas se deja como está: "McDonald"
 * o "de la Cruz" los escribió así la persona.
 */
export function fixCase(name: string): string {
  const letters = name.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) return name;
  const low = name.toLocaleLowerCase("es");
  if (name !== low && name !== name.toLocaleUpperCase("es")) return name;
  let first = true;
  return low
    .split(/(\s+|-)/)
    .map((w) => {
      if (!/\p{L}/u.test(w)) return w;
      const keep = !first && PARTICLES.has(w);
      first = false;
      return keep ? w : w.charAt(0).toLocaleUpperCase("es") + w.slice(1);
    })
    .join("");
}

/** Para comparar nombres: sin tildes, sin mayúsculas, sin espacios de más. */
export function nameKey(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------ el archivo, antes de la tabla */

/** Firmas de archivos que no son texto: zip (xlsx, ods), Office viejo (xls) y PDF. */
const BINARY = [
  [0x50, 0x4b, 0x03, 0x04],
  [0xd0, 0xcf, 0x11, 0xe0],
  [0x25, 0x50, 0x44, 0x46],
];

/**
 * El texto de un archivo, en la codificación que traiga.
 *
 * Excel en Windows guarda el CSV en ANSI (Windows-1252) salvo que se elija
 * "CSV UTF-8", y leerlo como UTF-8 dejaba "Mar�a" en vez de "María" (QA, 16
 * de octubre de 2026). Con la marca del principio (BOM) no hay que adivinar:
 * UTF-8, o UTF-16, que es lo que guarda Excel como "Texto Unicode". Sin marca,
 * UTF-16 se reconoce por los ceros. Si no, es UTF-8 si es UTF-8 válido, o si
 * la mayoría de lo que no es ASCII son secuencias UTF-8 bien formadas (un
 * archivo UTF-8 con un solo byte suelto pegado de otra parte no se lee entero
 * como Windows-1252: solo ese byte queda como "�"); y si no, Windows-1252, que
 * para el castellano tiene las mismas tildes y eñes que Latin-1. Los finales
 * de línea quedan en `\n`: Excel en Mac separaba las filas con un retorno de
 * carro solo. Un NUL dentro del texto se descarta: no es parte de ningún
 * nombre, y Postgres no lo acepta.
 *
 * Devuelve `null` si no es texto: una planilla de Excel o un PDF soltados
 * sobre la sección llenaban la lista de basura.
 */
export function decodeText(bytes: Uint8Array): string | null {
  const b = bytes;
  const decode = (encoding: string, from = 0): string => new TextDecoder(encoding).decode(b.subarray(from));
  let text: string;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) text = decode("utf-8", 3);
  else if (b[0] === 0xff && b[1] === 0xfe) text = decode("utf-16le", 2);
  else if (b[0] === 0xfe && b[1] === 0xff) text = decode("utf-16be", 2);
  else if (BINARY.some((sig) => sig.every((x, i) => b[i] === x))) return null;
  else {
    const wide = utf16Order(b);
    if (wide) text = decode(wide);
    // Un cero que no es de UTF-16 es de un archivo binario.
    else if (b.includes(0)) return null;
    else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(b);
      } catch {
        text = mostlyUtf8(b) ? decode("utf-8") : windows1252(b);
      }
    }
  }
  return text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
}

/**
 * Si lo que no es ASCII son, en su mayoría, secuencias UTF-8 bien formadas. Un archivo en Windows-1252 casi
 * no tiene ninguna ("María" es 4D 61 72 ED 61: el ED no abre una secuencia válida); un archivo UTF-8 con un
 * byte suelto las tiene casi todas.
 */
function mostlyUtf8(b: Uint8Array): boolean {
  let valid = 0;
  let stray = 0;
  for (let i = 0; i < b.length; i++) {
    const x = b[i] as number;
    if (x < 0x80) continue;
    const need = x >= 0xf0 && x <= 0xf4 ? 3 : x >= 0xe0 ? 2 : x >= 0xc2 && x <= 0xdf ? 1 : -1;
    let ok = need > 0 && i + need < b.length;
    for (let k = 1; ok && k <= need; k++) {
      const y = b[i + k];
      if (y === undefined || (y & 0xc0) !== 0x80) ok = false;
    }
    if (ok) {
      valid++;
      i += need;
    } else stray++;
  }
  return valid > stray;
}

/**
 * Windows-1252 se parece a Latin-1 salvo de 0x80 a 0x9F, donde trae el euro,
 * las comillas tipográficas y la raya que pone Excel. Va a mano porque
 * `TextDecoder("windows-1252")` en Node lo lee como Latin-1, y las pruebas
 * tienen que decodificar lo mismo que el navegador.
 */
const CP1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

function windows1252(b: Uint8Array): string {
  const codes = Array.from(b, (x) => (x >= 0x80 && x < 0xa0 ? (CP1252[x - 0x80] as number) : x));
  let s = "";
  for (let i = 0; i < codes.length; i += 8192) s += String.fromCharCode(...codes.slice(i, i + 8192));
  return s;
}

/** UTF-16 sin BOM: en texto latino, uno de cada dos bytes es cero. */
function utf16Order(b: Uint8Array): "utf-16le" | "utf-16be" | null {
  const n = Math.min(b.length, 4096) & ~1;
  if (n < 4) return null;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < n; i += 2) {
    if (b[i] === 0) even++;
    if (b[i + 1] === 0) odd++;
  }
  const pairs = n / 2;
  if (odd > pairs * 0.6 && even < pairs * 0.1) return "utf-16le";
  if (even > pairs * 0.6 && odd < pairs * 0.1) return "utf-16be";
  return null;
}

/**
 * El separador que mejor parte el texto en columnas: el que deja más filas
 * del mismo ancho y, entre esos, el que da más columnas. Que una fila tenga
 * otro ancho ya no lo descarta. Sin separador que dé más de una columna,
 * sigue siendo una lista de nombres, y la coma es tan buena como cualquiera.
 */
function pickDelimiter(text: string, limits: TableLimits): { delimiter: string; rows: Row[] } {
  let best: { d: string; width: number; fit: number; rows: Row[] } | null = null;
  let comma: Row[] | null = null;
  for (const d of DELIMITERS) {
    let all: Row[];
    try {
      all = parseRows(text, d, limits);
    } catch (error) {
      // Con este separador una celda se pasa del tope (una línea entera de un archivo separado por comas, leída con
      // tabulaciones): no es el separador. Si con ninguno entra, el de respaldo lo vuelve a decir.
      if (error instanceof CsvLimitError && error.code === "cell_too_long") continue;
      throw error;
    }
    if (d === ",") comma = all;
    const rows = all.filter(filled);
    const width = expectedWidth(rows);
    if (width < 2) continue;
    const fit = rows.filter((r) => r.cells.length === width).length / rows.length;
    if (!best || fit > best.fit || (fit === best.fit && width > best.width)) best = { d, width, fit, rows: all };
  }
  return best ? { delimiter: best.d, rows: best.rows } : { delimiter: ",", rows: comma ?? parseRows(text, ",", limits) };
}

/** Las celdas sin las vacías del final: la coma final que deja alguna planilla en cada fila. */
function withoutTrailingEmpty(cells: readonly string[]): string[] {
  let end = cells.length;
  while (end > 1 && (cells[end - 1] as string).trim() === "") end--;
  return cells.slice(0, end);
}

/** Si la mayoría de las filas de datos trae algo escrito más allá de la columna `from`: esa columna existe aunque el encabezado la haya dejado vacía. */
function dataFillsColumns(rows: readonly Row[], from: number): boolean {
  if (rows.length === 0) return false;
  const filledBeyond = rows.filter((r) => r.cells.slice(from).some((c) => c.trim() !== "")).length;
  return filledBeyond * 2 > rows.length;
}

/** Una fila del archivo, con la línea donde empieza (desde 1) para poder decir cuál falló. */
interface Row {
  cells: string[];
  line: number;
}

const filled = (r: Row): boolean => r.cells.some((c) => c.trim() !== "");

/**
 * Parser de CSV según RFC 4180: campos entre comillas pueden tener el
 * separador adentro, y `""` es una comilla literal.
 *
 * Una comilla que abre y nunca cierra se tragaba el resto del archivo en una
 * sola celda: se vuelve a leer tomándola como una comilla suelta. Las líneas
 * vacías no son filas (dos megas de saltos de línea no son un millón de
 * filas).
 */
function parseRows(text: string, delimiter: string, limits: TableLimits = TABLE_LIMITS): Row[] {
  const rows: Row[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let quoteAt = -1;
  let line = 1;
  let start = 1;

  const endRow = () => {
    cells.push(field);
    if (cells.length > 1 || (cells[0] as string).trim() !== "") {
      rows.push({ cells, line: start });
      // Más filas que el tope: no se sigue leyendo (las filas no dependen del separador: da lo mismo con cuál se cuente).
      if (rows.length > limits.maxRows + 1) throw new CsvLimitError("too_many_rows");
    }
    cells = [];
    field = "";
  };

  // El tope de la celda se mide mientras se arma: una celda de megas no se recorre entera antes de avisar.
  const grow = (c: string) => {
    field += c;
    if (field.length > limits.maxCell) throw new CsvLimitError("cell_too_long");
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === "\n") line++;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          grow('"');
          i++;
        } else {
          quoted = false;
        }
      } else {
        grow(c);
      }
      continue;
    }
    if (c === '"' && field.trim() === "") {
      quoted = true;
      quoteAt = i;
      field = "";
    } else if (c === delimiter) {
      cells.push(field);
      field = "";
    } else if (c === "\n") {
      endRow();
      start = line;
    } else if (c !== "\r") {
      grow(c);
    }
  }
  if (quoted) return parseRows(text.slice(0, quoteAt) + text.slice(quoteAt + 1), delimiter, limits);
  endRow();
  return rows;
}

/**
 * Cuántas columnas tiene la tabla: las del encabezado, si la primera fila lo
 * es, y si no, el ancho de la mayoría de las filas. Con empate, el menor: ante
 * la duda, menos columnas, que se parece más a una lista de nombres.
 */
function expectedWidth(rows: readonly Row[]): number {
  const first = rows[0]?.cells ?? [];
  if (first.length > 1 && first.some(isHeaderCell)) return first.length;
  const seen = new Map<number, number>();
  for (const r of rows) seen.set(r.cells.length, (seen.get(r.cells.length) ?? 0) + 1);
  let width = 0;
  let most = 0;
  for (const [w, n] of seen) {
    if (n > most || (n === most && w < width)) {
      width = w;
      most = n;
    }
  }
  return width;
}

/**
 * Lo que suele tener cada columna, mirando las filas sanas: nada, correos,
 * palabras sueltas sin espacios (códigos, fechas, estados) o texto libre.
 */
type Kind = "empty" | "email" | "token" | "free";
/** Más largo que esto no es un correo ni un código: la expresión del correo, sobre un texto enorme, tardaba segundos. */
const SHORT_MAX = 254;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const TOKEN = /^[^\s,;]+$/;
const isEmail = (v: string): boolean => v.length <= SHORT_MAX && EMAIL.test(v);
const isToken = (v: string): boolean => v.length <= SHORT_MAX && TOKEN.test(v);

function kindOf(values: readonly string[]): Kind {
  const vals = values.map((v) => v.trim()).filter(Boolean);
  if (vals.length === 0) return "empty";
  if (vals.every(isEmail)) return "email";
  if (vals.every(isToken)) return "token";
  return "free";
}

/** ¿Este valor puede ir en una columna de esa clase? Vacío puede ir en cualquiera. */
function fits(kind: Kind, value: string): boolean {
  const v = value.trim();
  if (kind === "free" || v === "") return true;
  if (kind === "empty") return false;
  return kind === "email" ? isEmail(v) : isToken(v);
}

/**
 * La clase de cada columna. La de nombres, si el encabezado la nombra, es
 * siempre texto libre aunque las filas sanas tengan nombres de una palabra:
 * es justo donde suele estar la coma sin comillas ("Salvatierra, Rodrigo").
 */
function columnKinds(rows: readonly Row[], width: number, names: number): Kind[] {
  // Si ninguna fila tiene el ancho justo (todas traen la coma final), valen las que lo tienen sin sus celdas vacías del final.
  const strict = rows.filter((r) => r.cells.length === width).map((r) => r.cells);
  const sane = strict.length > 0 ? strict : rows.map((r) => withoutTrailingEmpty(r.cells)).filter((cells) => cells.length === width);
  return Array.from({ length: width }, (_, c) => (c === names ? "free" : kindOf(sane.map((cells) => cells[c] ?? ""))));
}

/** La columna que el encabezado llama nombre, sin adivinar por forma. -1 si ninguna. */
function nameHintColumn(header: readonly string[]): number {
  const keys = header.map(headerKey);
  for (const hint of NAME_HINTS) {
    const at = keys.indexOf(headerKey(hint));
    if (at >= 0) return at;
  }
  return -1;
}

/**
 * Una fila con más celdas que columnas casi siempre es una coma sin comillas
 * dentro de un campo. Se prueba juntar las celdas de más en cada columna de
 * texto libre, y se acepta solo si una única forma deja cada columna con lo
 * que suele tener: correos donde hay correos, códigos donde hay códigos. Si
 * hay dos formas posibles (el nombre y la dirección, los dos texto libre), no
 * se adivina: la fila se salta y la ventana lo avisa.
 */
function mend(cells: readonly string[], width: number, kinds: readonly Kind[], delimiter: string): string[] | null {
  const extra = cells.length - width;
  let found: string[] | null = null;
  for (let c = 0; c < width; c++) {
    if (kinds[c] !== "free") continue;
    const row = [...cells.slice(0, c), cells.slice(c, c + extra + 1).join(delimiter), ...cells.slice(c + extra + 1)];
    if (!row.every((v, i) => fits(kinds[i] ?? "free", v))) continue;
    if (found) return null;
    found = row;
  }
  return found;
}

/**
 * La primera fila es cabecera si nombra columnas en vez de contener datos.
 * Un archivo que solo trae el encabezado también: es una tabla sin filas, no
 * una fila con "Nombre" como participante.
 */
function looksLikeHeader(first: string[], rest: string[][]): boolean {
  if (first.some(isHeaderCell)) return true;
  if (rest.length === 0) return false;
  // Si la primera fila no tiene números y las siguientes sí, es cabecera.
  const hasDigits = (r: string[]): boolean => r.some((c) => /\d/.test(c));
  return !hasDigits(first) && rest.slice(0, 3).some(hasDigits);
}

/** Qué columna tiene los nombres: primero por cabecera, si no por forma. */
function suggestColumn(columns: string[], rows: string[][], headerDetected: boolean): number {
  if (headerDetected) {
    const lower = columns.map((c) => c.trim().toLowerCase());
    for (const hint of NAME_HINTS) {
      const exact = lower.indexOf(hint);
      if (exact >= 0) return exact;
    }
    const partial = lower.findIndex(
      (c) => NAME_HINTS.some((h) => c.includes(h)) && !NOT_NAME.some((n) => c === n),
    );
    if (partial >= 0) return partial;
  }
  // Sin pistas: la columna con más texto de aspecto humano y menos repetidos.
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < columns.length; i++) {
    const values = rows.slice(0, 40).map((r) => (r[i] ?? "").trim()).filter(Boolean);
    if (values.length === 0) continue;
    const letters = values.filter((v) => /\p{L}{2,}/u.test(v) && !/@/.test(v)).length / values.length;
    const digits = values.filter((v) => /^\s*[\d.\-/]+\s*$/.test(v)).length / values.length;
    const unique = new Set(values).size / values.length;
    const score = letters * 2 + unique - digits * 3;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
