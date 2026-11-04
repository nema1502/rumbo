// Importar la lista de invitados que exporta Luma o Bevy (o cualquier planilla con una columna de correos) y darle
// a cada persona su credencial del tipo que corresponda. Va en dos tiempos, porque crear la cuenta de cada persona
// y anotarla en el contrato son transacciones de unos segundos:
//
//   1. prepareImport: lee, filtra por estado, salta repetidas y correos inválidos, y deja una credencial pendiente
//      por persona. Es rápido y da el resumen ("importadas 142, salteadas 6 duplicadas, 3 con correo inválido").
//      Si una importación anterior se cortó, sus credenciales pendientes pasan a esta y se retoman.
//   2. activateBatch: de a una tanda, crea la cuenta de cada persona (igual que la inscripción), la anota en el
//      contrato, le da sus canjes y le manda el correo con su enlace. La pantalla pide tandas hasta que no queda
//      ninguna pendiente; si se corta, las pendientes siguen ahí y se retoman (la pantalla recuerda la importación).
//      Si este servidor no tiene con qué mandar correos, la credencial queda igual y el enlace se baja en CSV.
//
// Nunca va nada personal a la cadena: a la cadena va la cuenta, como en la inscripción. Lo que la lista trae de
// más (teléfonos, campañas, respuestas) se ignora, salvo una restricción de dieta si la hay.
import { translate, type Lang } from "../../i18n/index.ts";
import { isPublicKind, type CredentialKind } from "../../lib/credential-kinds.ts";
import { getAccountProvider, type AccountProvider } from "../accounts.ts";
import { EMAIL_MAX, EMAIL_RE, NAME_MAX, passUrl } from "../evento/inscripcion.ts";
import { BUSY, tryExclusive } from "../compartido.ts";
import { getOrCreateAccessKey } from "../evento/acceso.ts";
import { describeForLog } from "../log.ts";
import { getMailer, type Mailer } from "../mailer.ts";
import { csvCell } from "../panel.ts";
import { emailKey, normalizeEmail, type EventRecord, type ImportRun, type Pass, type Person, type Repo, type TicketType } from "../repo.ts";
import { isContractError, rumboPass } from "../stellar.ts";
import { buildImportedEmail } from "./correo.ts";
import { CsvLimitError, cell, decodeText, detectSource, emailColumn, findColumn, fixCase, nameKey, parseTable, statusColumn, type Table } from "./csv.ts";

// ---------- Leer la lista ----------

export type GuestStatus = "approved" | "pending" | "waitlist" | "declined" | "cancelled" | "unknown";
export const GUEST_STATUSES: readonly GuestStatus[] = ["approved", "pending", "waitlist", "declined", "cancelled", "unknown"];

/** Los estados que quieren decir "viene": aprobada en Luma, registrada o confirmada en Bevy. */
const STATUS_WORDS: Array<[GuestStatus, RegExp]> = [
  ["approved", /^(approved|aprobad[oa]s?|confirmed|confirmad[oa]s?|going|attending|registered|registrad[oa]s?|accepted|aceptad[oa]s?|attended|asisti[oó]|checked[ _-]?in|invited[ _-]?approved|yes|si|sí)$/],
  ["pending", /^(pending|pending[ _-]?approval|pendiente|pendientes|invited|invitad[oa]s?|awaiting[ _-]?approval|requested|not[ _-]?approved[ _-]?yet|maybe|talvez)$/],
  ["waitlist", /^(waitlist|waitlisted|wait[ _-]?list|lista[ _-]?de[ _-]?espera|en[ _-]?espera|on[ _-]?waitlist)$/],
  ["declined", /^(declined|rejected|denied|rechazad[oa]s?|denegad[oa]s?|not[ _-]?approved)$/],
  ["cancelled", /^(cancelled|canceled|cancelad[oa]s?|not[ _-]?going|no[ _-]?va|withdrawn|refunded|reembolsad[oa]s?|no)$/],
];

export function normalizeStatus(raw: string | null | undefined): GuestStatus {
  const clean = nameKey(raw ?? "");
  if (!clean) return "unknown";
  for (const [status, re] of STATUS_WORDS) if (re.test(clean)) return status;
  return "unknown";
}

export interface GuestRow {
  name: string;
  email: string;
  status: GuestStatus;
  /** Lo que dice la columna del tipo de entrada, o null. */
  ticketLabel: string | null;
  /** La restricción de dieta si la lista la trae (una pregunta de la inscripción), o null. */
  diet: string | null;
}

export interface ColumnsRead {
  name: string | null;
  email: string;
  status: string | null;
  ticket: string | null;
  diet: string | null;
}

export interface ParsedGuests {
  source: "luma" | "bevy" | "other";
  columns: ColumnsRead;
  /** Cuántas columnas de la lista no se leen (teléfonos, campañas, respuestas). */
  ignored: number;
  rows: GuestRow[];
  /** Las líneas con filas que no se pudieron leer. */
  skippedLines: number[];
}

export type ImportFormatCode = "empty" | "no_text" | "no_email" | "cell_too_long" | "too_many_columns" | "too_many_rows";

export class ImportFormatError extends Error {
  readonly code: ImportFormatCode;
  constructor(code: ImportFormatCode) {
    super(`La lista no se puede leer: ${code}`);
    this.name = "ImportFormatError";
    this.code = code;
  }
}

const NAME_HINTS = ["name", "full name", "full_name", "nombre completo", "attendee name", "guest name", "display name", "nombre y apellido", "nombres y apellidos", "participante", "asistente", "invitado"];
const FIRST_HINTS = ["first name", "first_name", "given name", "nombres", "nombre de pila"];
const LAST_HINTS = ["last name", "last_name", "surname", "family name", "apellido", "apellidos"];
const TICKET_HINTS = ["ticket_name", "ticket name", "ticket type", "ticket_type", "ticket type name", "tipo de entrada", "tipo de ticket", "tipo de inscripcion", "registration type", "attendee type", "tipo de asistente", "entrada", "ticket"];
/** Una pregunta de la inscripción sobre comida: "¿Tenés alguna restricción alimentaria?", "Dietary restrictions". */
const DIET_HEADER = /(diet|dieta|aliment|allerg|alerg|vegetar|vegan|restricci[oó]n(es)? de comida|food)/i;

/** Más largo que esto no es un correo, y la expresión no se prueba (sobre un texto enorme tardaría de más). */
const EMAIL_SHAPE_MAX = 254;
const EMAIL_SHAPE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const looksLikeEmail = (v: string): boolean => v.length <= EMAIL_SHAPE_MAX && EMAIL_SHAPE.test(v);

/** Sin cabecera, la columna donde casi todo son correos. */
function guessEmailColumn(table: Table): number {
  for (let c = 0; c < table.columns.length; c++) {
    const values = table.rows.map((r) => cell(r, c)).filter(Boolean);
    if (values.length > 0 && values.filter(looksLikeEmail).length / values.length >= 0.8) return c;
  }
  return -1;
}

/** Los caracteres de control (el NUL que Postgres rechaza entre ellos) no son parte de un nombre. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Un nombre como se escribe en una credencial: sin controles ni espacios de más, con mayúsculas si llegó todo igual, y no más largo que el tope. */
export function tidyName(raw: string): string {
  return fixCase(raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim()).slice(0, NAME_MAX).trim();
}

/** "ana.quiroga@example.com" → "Ana Quiroga": para quien no trae nombre en la lista. */
function nameFromEmail(email: string): string {
  return tidyName((email.split("@")[0] ?? "").replace(/[._\-+]+/g, " ").replace(/\d+/g, " "));
}

/** Lee el texto de una lista. Lanza ImportFormatError si está vacía, no tiene dónde estén los correos o se pasa de los topes. */
export function parseGuests(text: string): ParsedGuests {
  let table: Table | null;
  try {
    table = parseTable(text);
  } catch (error) {
    if (error instanceof CsvLimitError) throw new ImportFormatError(error.code);
    throw error;
  }
  if (!table || table.rows.length === 0) throw new ImportFormatError("empty");

  let emailCol = emailColumn(table);
  if (emailCol < 0) emailCol = guessEmailColumn(table);
  if (emailCol < 0) throw new ImportFormatError("no_email");

  const nameCol = findColumn(table, NAME_HINTS);
  let firstCol = findColumn(table, FIRST_HINTS);
  const lastCol = findColumn(table, LAST_HINTS);
  // "Nombre" a secas es el nombre de pila si hay una columna de apellido, y el nombre completo si no.
  const plainName = findColumn(table, ["nombre"]);
  let fullCol = nameCol;
  if (plainName >= 0) {
    if (lastCol >= 0 && firstCol < 0) firstCol = plainName;
    else if (fullCol < 0) fullCol = plainName;
  }
  if (!table.headerDetected && fullCol < 0 && firstCol < 0) fullCol = table.suggested === emailCol ? -1 : table.suggested;

  const statusCol = statusColumn(table);
  const ticketCol = findColumn(table, TICKET_HINTS);
  const dietCol = table.headerDetected ? table.columns.findIndex((name, i) => i !== emailCol && DIET_HEADER.test(name)) : -1;

  const used = new Set([emailCol, fullCol, firstCol, lastCol, statusCol, ticketCol, dietCol].filter((c) => c >= 0));
  const header = (c: number): string | null => (c >= 0 && table.headerDetected ? (table.columns[c] ?? null) : null);

  const rows: GuestRow[] = table.rows.map((row) => {
    const email = cell(row, emailCol).replace(CONTROL_CHARS, "");
    const full = fullCol >= 0 ? cell(row, fullCol) : "";
    const joined = [firstCol >= 0 ? cell(row, firstCol) : "", lastCol >= 0 ? cell(row, lastCol) : ""].filter(Boolean).join(" ");
    const name = tidyName(full || joined) || nameFromEmail(email);
    const ticket = ticketCol >= 0 ? cell(row, ticketCol).replace(CONTROL_CHARS, " ").trim() : "";
    const diet = dietCol >= 0 ? cell(row, dietCol).replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, 120) : "";
    return {
      name,
      email,
      status: statusCol >= 0 ? normalizeStatus(cell(row, statusCol)) : "approved",
      ticketLabel: ticket || null,
      diet: diet && !/^(no|none|ninguna?|ninguno|n\/a|-|—)$/i.test(diet) ? diet : null,
    };
  });

  return {
    source: detectSource(table) ?? "other",
    columns: {
      name: header(fullCol) ?? header(firstCol),
      email: header(emailCol) ?? "email",
      status: header(statusCol),
      ticket: header(ticketCol),
      diet: header(dietCol),
    },
    ignored: Math.max(0, table.columns.length - used.size),
    rows,
    skippedLines: table.skipped,
  };
}

/** Lee los bytes de un archivo, en la codificación que traiga. Lanza ImportFormatError si no es texto. */
export function parseGuestFile(bytes: Uint8Array): ParsedGuests {
  const text = decodeText(bytes);
  if (text === null) throw new ImportFormatError("no_text");
  return parseGuests(text);
}

// ---------- A qué credencial va cada entrada ----------

/** Lo que dice una entrada de la lista ("Speaker", "Jurado", "Mentor"), como tipo de credencial, o null si es una entrada común. */
export function suggestKind(label: string | null | undefined): CredentialKind | null {
  const key = nameKey(label ?? "");
  if (!key) return null;
  if (/(speaker|orador|ponente|conferencista|charlista|keynote|panelista)/.test(key)) return "speaker";
  if (/(mentor|mentoria|coach)/.test(key)) return "mentor";
  if (/(jurad|judge|jury)/.test(key)) return "judge";
  if (/(volunt)/.test(key)) return "volunteer";
  if (/(sponsor|auspic|patrocin)/.test(key)) return "sponsor";
  if (/(organi[sz]|staff|equipo)/.test(key)) return "organizer";
  return null;
}

/** La clave con que se agrupan las entradas iguales de la lista. */
export function labelKey(label: string | null | undefined): string {
  return nameKey(label ?? "");
}

/** Los tipos de entrada del evento a los que se puede importar: los gratis (a quien se importa no se le cobra). */
export function importableTypes(types: TicketType[]): TicketType[] {
  return types.filter((t) => t.priceUsdc === 0);
}

/** El tipo que corresponde a lo que dice una entrada de la lista: el que se llama igual, el del tipo de credencial que nombra, o el asistente. */
export function suggestType(label: string | null | undefined, types: TicketType[]): TicketType | null {
  const free = importableTypes(types);
  const key = labelKey(label);
  const byName = key ? free.find((t) => nameKey(t.name) === key) : undefined;
  if (byName) return byName;
  const kind = suggestKind(label);
  const byKind = kind ? free.find((t) => t.credentialKind === kind) : undefined;
  if (byKind) return byKind;
  return free.find((t) => isPublicKind(t.credentialKind)) ?? free[0] ?? null;
}

// ---------- Quién ya está ----------

/** Lo que la base sabe de las personas de la lista, en dos consultas: su persona (si existe) y su pase en este evento (si tiene). */
interface Known {
  personOf: Map<string, Person>;
  passOf: Map<string, Pass>;
}

async function lookupKnown(repo: Repo, event: EventRecord, parsed: ParsedGuests): Promise<Known> {
  const personOf = new Map<string, Person>();
  for (const person of await repo.listPersonsByEmails(parsed.rows.map((r) => r.email).filter((e) => e.length <= EMAIL_MAX))) {
    personOf.set(emailKey(person.email), person);
  }
  const passOf = new Map<string, Pass>();
  for (const { pass } of await repo.listPassesWithPerson(event.id)) passOf.set(pass.personId, pass);
  return { personOf, passOf };
}

/** Un pase pendiente que dejó una importación que se cortó: nadie lo va a activar salvo que otra importación lo retome. */
const isResumable = (pass: Pass | undefined): pass is Pass => pass !== undefined && pass.status === "pending" && pass.importRunId !== null;

// ---------- La vista previa ----------

export interface StatusBucket {
  /** Con correo válido, sin repetir y con lugar en este evento (incluye las que se retoman). */
  valid: number;
  invalidEmail: number;
  duplicatesInFile: number;
  alreadyHere: number;
  /** De las válidas, las que quedaron pendientes de una importación anterior que se cortó: se retoman. */
  resumable: number;
}

export interface GuestPreview {
  source: ParsedGuests["source"];
  columns: ColumnsRead;
  ignored: number;
  total: number;
  skippedLines: number[];
  /** Las primeras filas, como se leyeron: para que se note un archivo con las tildes rotas o las columnas corridas. */
  sample: Array<{ name: string; email: string }>;
  /** Por estado, solo los que aparecen en la lista. */
  buckets: Partial<Record<GuestStatus, StatusBucket>>;
  /** Cada tipo de entrada que trae la lista, cuántas personas, y el tipo de acá que le corresponde. */
  tickets: Array<{ key: string; label: string; count: number; suggestedTypeId: string | null }>;
  /** Los tipos de entrada del evento a los que se puede importar. */
  types: Array<{ id: string; name: string; kind: CredentialKind }>;
  /** El tipo para las personas sin entrada nombrada. */
  defaultTypeId: string | null;
}

export const PREVIEW_SAMPLE = 3;

function isValidEmail(email: string): boolean {
  return email.length <= EMAIL_MAX && EMAIL_RE.test(email);
}

/** Qué pasaría con cada fila: sin crear nada. Es lo que se muestra antes de importar. */
export async function previewGuests(repo: Repo, event: EventRecord, parsed: ParsedGuests): Promise<GuestPreview> {
  const types = await repo.listTicketTypes(event.id);
  const known = await lookupKnown(repo, event, parsed);
  const buckets: GuestPreview["buckets"] = {};
  const seen = new Set<string>();
  const tickets = new Map<string, { label: string; count: number }>();
  for (const row of parsed.rows) {
    const bucket = (buckets[row.status] ??= { valid: 0, invalidEmail: 0, duplicatesInFile: 0, alreadyHere: 0, resumable: 0 });
    const email = normalizeEmail(row.email);
    if (!isValidEmail(email)) {
      bucket.invalidEmail++;
      continue;
    }
    const key = emailKey(email);
    if (seen.has(key)) {
      bucket.duplicatesInFile++;
      continue;
    }
    seen.add(key);
    const person = known.personOf.get(key);
    const pass = person ? known.passOf.get(person.id) : undefined;
    if (pass && !isResumable(pass)) {
      bucket.alreadyHere++;
      continue;
    }
    bucket.valid++;
    if (pass) bucket.resumable++;
    const label = labelKey(row.ticketLabel);
    const entry = tickets.get(label) ?? { label: row.ticketLabel ?? "", count: 0 };
    entry.count++;
    tickets.set(label, entry);
  }
  const free = importableTypes(types);
  return {
    source: parsed.source,
    columns: parsed.columns,
    ignored: parsed.ignored,
    total: parsed.rows.length,
    skippedLines: parsed.skippedLines,
    sample: parsed.rows.slice(0, PREVIEW_SAMPLE).map((r) => ({ name: r.name, email: r.email })),
    buckets,
    tickets: [...tickets].map(([key, { label, count }]) => ({ key, label, count, suggestedTypeId: suggestType(label, types)?.id ?? null })),
    types: free.map((t) => ({ id: t.id, name: t.name, kind: t.credentialKind })),
    defaultTypeId: suggestType(null, types)?.id ?? null,
  };
}

// ---------- Importar ----------

export interface ImportOptions {
  /** Los estados que entran (por defecto, los aprobados o confirmados). */
  statuses: GuestStatus[];
  /** La clave de cada entrada de la lista (labelKey) → el id del tipo de entrada de acá. */
  mapping: Record<string, string>;
  /** El tipo para quienes no traen entrada o traen una que no está en `mapping`. */
  defaultTypeId: string;
}

export type ImportOptionsCode = "draft" | "no_type" | "bad_type" | "paid_type" | "no_contract";

export class ImportOptionsError extends Error {
  readonly code: ImportOptionsCode;
  constructor(code: ImportOptionsCode) {
    super(`No se puede importar: ${code}`);
    this.name = "ImportOptionsError";
    this.code = code;
  }
}

export interface ImportSummary {
  source: string;
  /** Filas que tenía la lista. */
  read: number;
  /** Las que no entraron por su estado (rechazadas, canceladas, pendientes...). */
  notSelected: number;
  invalidEmail: number;
  duplicatesInFile: number;
  /** Personas que ya tenían credencial en este evento: no se tocan, ni su entrada ni sus canjes. */
  alreadyHere: number;
  /** Salteadas por repetidas: en el archivo o ya inscriptas. */
  duplicates: number;
  /** Credenciales de esta importación (pendientes hasta que se mandan), con las retomadas. */
  created: number;
  /** De las creadas, las que quedaron pendientes de una importación anterior y esta retoma. */
  resumed: number;
  /** Cuántas se importaron por cada tipo de credencial. */
  byType: Record<string, number>;
  // Lo que van sumando las tandas:
  activated: number;
  emailsSent: number;
  emailsFailed: number;
  /** Con credencial y enlace, pero sin correo: este servidor no tiene con qué mandarlo. El enlace se baja en CSV. */
  linkOnly: number;
  /** Intentos que no pudieron preparar la credencial (se reintentan). */
  failed: number;
}

const emptySummary = (source: string, read: number): ImportSummary => ({
  source,
  read,
  notSelected: 0,
  invalidEmail: 0,
  duplicatesInFile: 0,
  alreadyHere: 0,
  duplicates: 0,
  created: 0,
  resumed: 0,
  byType: {},
  activated: 0,
  emailsSent: 0,
  emailsFailed: 0,
  linkOnly: 0,
  failed: 0,
});

export interface Prepared {
  run: ImportRun;
  summary: ImportSummary;
}

/**
 * Deja una credencial pendiente por cada persona que entra. Las que ya tenían credencial en el evento no se
 * tocan: ni su entrada, ni sus canjes, ni su tipo. Dos veces el mismo archivo no crea dos credenciales. Lo que
 * otra importación dejó pendiente (se cerró la pestaña, se cayó el servidor) pasa a esta y se retoma.
 */
export async function prepareImport(repo: Repo, event: EventRecord, parsed: ParsedGuests, options: ImportOptions): Promise<Prepared> {
  if (!event.published) throw new ImportOptionsError("draft");
  const types = await repo.listTicketTypes(event.id);
  const typeById = new Map(types.map((t) => [t.id, t] as const));
  const resolve = (id: string | undefined): TicketType => {
    const type = id ? typeById.get(id) : undefined;
    if (!type) throw new ImportOptionsError(id ? "bad_type" : "no_type");
    if (type.priceUsdc > 0) throw new ImportOptionsError("paid_type");
    if (!(type.contractId ?? event.contractId)) throw new ImportOptionsError("no_contract");
    return type;
  };
  const fallback = resolve(options.defaultTypeId);
  const selected = new Set(options.statuses);

  const known = await lookupKnown(repo, event, parsed);
  const run = await repo.createImportRun({ eventId: event.id, source: parsed.source, summary: {} });
  const summary = emptySummary(parsed.source, parsed.rows.length);
  const seen = new Set<string>();
  const count = (type: TicketType) => {
    summary.created++;
    summary.byType[type.id] = (summary.byType[type.id] ?? 0) + 1;
  };
  for (const row of parsed.rows) {
    if (!selected.has(row.status)) {
      summary.notSelected++;
      continue;
    }
    const email = normalizeEmail(row.email);
    if (!isValidEmail(email)) {
      summary.invalidEmail++;
      continue;
    }
    const key = emailKey(email);
    if (seen.has(key)) {
      summary.duplicatesInFile++;
      continue;
    }
    seen.add(key);
    const mapped = options.mapping[labelKey(row.ticketLabel)];
    const type = mapped ? resolve(mapped) : fallback;
    // Quien ya está en el evento queda como estaba. Quien ya existe como persona (de otro evento) conserva su nombre.
    const knownPerson = known.personOf.get(key);
    const existing = knownPerson ? known.passOf.get(knownPerson.id) : undefined;
    if (existing && !isResumable(existing)) {
      summary.alreadyHere++;
      continue;
    }
    if (existing) {
      // Quedó pendiente de una importación que se cortó: pasa a esta, con la entrada y la dieta de esta lista.
      await repo.updatePass(existing.id, { importRunId: run.id, ticketTypeId: type.id, ...(row.diet ? { diet: row.diet } : {}) });
      summary.resumed++;
      count(type);
      continue;
    }
    const person = knownPerson ?? (await repo.upsertPerson({ name: row.name, email }));
    try {
      await repo.createPass({ eventId: event.id, personId: person.id, ticketTypeId: type.id, status: "pending", diet: row.diet, importRunId: run.id });
    } catch (error) {
      // Dos importaciones a la vez con la misma persona: la otra ganó.
      if (await repo.findPass(event.id, person.id)) {
        summary.alreadyHere++;
        continue;
      }
      throw error;
    }
    count(type);
  }
  summary.duplicates = summary.duplicatesInFile + summary.alreadyHere;
  return { run: await repo.updateImportRun(run.id, { ...summary }), summary };
}

// ---------- Mandar las credenciales en tandas ----------

/** Lo que la activación necesita de afuera. Las pruebas ponen cuentas, contrato y correo de mentira. */
export interface ImportDeps {
  accounts: Pick<AccountProvider, "getOrCreateForPerson" | "authSigner">;
  chain: Pick<typeof rumboPass, "register" | "status">;
  mailer: Pick<Mailer, "send">;
  lang: Lang;
  /** De dónde se pidió, para que en desarrollo el enlace del correo abra en el mismo servidor. */
  origin?: string | null;
}

declare global {
  /** Un contrato de mentira para las capturas y las pruebas con un servidor adentro (scripts/capturas-kit.mjs). Como __rumboAccounts y __rumboMailer. En producción se ignora. */
  var __rumboKitChain: ImportDeps["chain"] | undefined;
}

export function defaultImportDeps(lang: Lang, origin?: string | null, repo?: Repo): ImportDeps {
  const chain = process.env.NODE_ENV === "production" ? rumboPass : (globalThis.__rumboKitChain ?? rumboPass);
  return { accounts: getAccountProvider(repo), chain, mailer: getMailer(), lang, origin };
}

export interface BatchResult {
  /** Credenciales que esta tanda intentó. */
  processed: number;
  activated: number;
  emailsSent: number;
  emailsFailed: number;
  /** Con credencial y enlace, pero sin correo: no hay servicio de correo en este servidor. */
  linkOnly: number;
  failed: number;
  /** Cuántas siguen pendientes. */
  remaining: number;
  /** Otra tanda de esta importación está corriendo: se vuelve a pedir en un momento. */
  busy: boolean;
}

export const BATCH_SIZE = 5;
export const MAX_BATCH_SIZE = 20;

/**
 * Activa una tanda de credenciales pendientes de la importación: cuenta, contrato, canjes y correo. Una sola
 * tanda de cada importación a la vez, aunque la pidan dos pestañas o caigan en dos instancias del servidor: la
 * otra recibe "busy" y la pantalla la vuelve a pedir en un momento. Una tanda de cinco tarda menos de dos
 * minutos; el turno se renueva mientras dura y, si la instancia se cae, vence solo.
 */
export async function activateBatch(repo: Repo, event: EventRecord, runId: string, size: number, deps: ImportDeps): Promise<BatchResult> {
  const pendingOf = async (): Promise<Pass[]> => (await repo.listPassesByImportRun(runId)).filter((p) => p.status === "pending");
  const outcome = await tryExclusive(`import:${runId}`, () => runBatch(repo, event, runId, size, deps, pendingOf));
  if (outcome === BUSY) return { processed: 0, activated: 0, emailsSent: 0, emailsFailed: 0, linkOnly: 0, failed: 0, remaining: (await pendingOf()).length, busy: true };
  return outcome;
}

async function runBatch(repo: Repo, event: EventRecord, runId: string, size: number, deps: ImportDeps, pendingOf: () => Promise<Pass[]>): Promise<BatchResult> {
  const run = await repo.getImportRun(runId);
  if (!run || run.eventId !== event.id) throw new Error(`No existe la importación ${runId} en este evento`);
  const batch = (await pendingOf()).slice(0, Math.max(1, Math.min(size, MAX_BATCH_SIZE)));
  const result: BatchResult = { processed: batch.length, activated: 0, emailsSent: 0, emailsFailed: 0, linkOnly: 0, failed: 0, remaining: 0, busy: false };
  for (const pass of batch) {
    const outcome = await activateOne(repo, event, pass, deps);
    if (outcome === "failed") result.failed++;
    else {
      result.activated++;
      if (outcome === "emailed") result.emailsSent++;
      else if (outcome === "link_only") result.linkOnly++;
      else result.emailsFailed++;
    }
  }
  result.remaining = (await pendingOf()).length;
  const summary = run.summary as unknown as ImportSummary;
  await repo.updateImportRun(runId, {
    ...summary,
    activated: (summary.activated ?? 0) + result.activated,
    emailsSent: (summary.emailsSent ?? 0) + result.emailsSent,
    emailsFailed: (summary.emailsFailed ?? 0) + result.emailsFailed,
    linkOnly: (summary.linkOnly ?? 0) + result.linkOnly,
    // Lo que falló y sigue pendiente es lo que falló en la última tanda: se vuelve a intentar.
    failed: result.failed,
  });
  return result;
}

type Outcome = "emailed" | "link_only" | "email_failed" | "failed";

async function activateOne(repo: Repo, event: EventRecord, pass: Pass, deps: ImportDeps): Promise<Outcome> {
  const [person, ticketType] = await Promise.all([repo.getPersonById(pass.personId), repo.getTicketType(pass.ticketTypeId)]);
  const contractId = ticketType?.contractId ?? event.contractId;
  if (!person || !ticketType || !contractId) return "failed";

  let account: string;
  let txHash: string | null = null;
  let chainNumber: number | null = null;
  try {
    account = await deps.accounts.getOrCreateForPerson(person.id);
    try {
      const result = await deps.chain.register(contractId, account, await deps.accounts.authSigner(person.id));
      txHash = result.hash;
      chainNumber = result.number;
    } catch (error) {
      // La cuenta ya tenía su lugar en el contrato (un intento anterior que no llegó a guardarse): se toma de ahí.
      if (!isContractError(error, "AlreadyHasPass")) throw error;
      chainNumber = (await deps.chain.status(contractId, account)).number;
    }
  } catch (error) {
    // Cupo lleno, la red que no contesta: queda pendiente y se reintenta. En el registro va el id de la persona, nunca su correo.
    console.warn(`[importar] No se pudo preparar la credencial del pase ${pass.id}: ${describeForLog(error)}`);
    return "failed";
  }

  await repo.updatePass(pass.id, { account, status: "active", txHash, chainNumber });
  await repo.grantTicketBenefits(pass.id);
  const url = passUrl(pass.id, await getOrCreateAccessKey(pass.id), deps.lang, deps.origin);
  try {
    const sent = await deps.mailer.send(buildImportedEmail({ event, person, ticketType, url, lang: deps.lang }));
    // Un correo de mentira de las pruebas puede no decir qué pasó: si no dice que no salió, salió.
    return sent?.outcome === "not_configured" ? "link_only" : "emailed";
  } catch (error) {
    console.warn(`[importar] No se pudo mandar el correo de la persona ${person.id} (pase ${pass.id}): ${describeForLog(error)}`);
    return "email_failed";
  }
}

/** Cuántas credenciales de la importación siguen pendientes, y su resumen. */
export async function importStatus(repo: Repo, runId: string): Promise<{ summary: ImportSummary; remaining: number } | null> {
  const run = await repo.getImportRun(runId);
  if (!run) return null;
  const remaining = (await repo.listPassesByImportRun(runId)).filter((p) => p.status === "pending").length;
  return { summary: run.summary as unknown as ImportSummary, remaining };
}

// ---------- Los enlaces, para quien organiza ----------

/**
 * El CSV con el enlace personal de cada credencial que esta importación ya preparó (nombre, correo, enlace),
 * para que quien organiza los mande por su cuenta cuando este servidor no tiene con qué mandar correos. Lleva
 * las claves de acceso: se trata como el CSV de pases del panel, y nunca va al JSON del panel. Las celdas pasan
 * por csvCell, como los otros CSV, así un nombre que empieza con "=" no se ejecuta en la planilla.
 */
export async function buildImportLinksCsv(repo: Repo, event: EventRecord, runId: string, lang: Lang, origin?: string | null): Promise<string | null> {
  const run = await repo.getImportRun(runId);
  if (!run || run.eventId !== event.id) return null;
  const personOf = new Map((await repo.listPassesWithPerson(event.id)).map(({ pass, person }) => [pass.id, person] as const));
  const t = (key: string) => translate(lang, key);
  const header = [t("panel.csv.nombre"), t("panel.csv.correo"), t("kit.importar.csv.enlace")];
  const rows: string[][] = [];
  for (const pass of await repo.listPassesByImportRun(runId)) {
    if (pass.status === "pending") continue;
    const person = personOf.get(pass.id);
    if (!person) continue;
    rows.push([person.name, person.email, passUrl(pass.id, await getOrCreateAccessKey(pass.id), lang, origin)]);
  }
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
