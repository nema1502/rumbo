// El respaldo manual de la puerta: cuando una credencial no se lee (el celular sin batería, la cámara que
// no enfoca, alguien que no trajo nada), el voluntario del puesto Puerta busca a la persona por nombre o
// correo y le marca la entrada a mano, o la agrega en el momento con una inscripción gratis. Solo el
// código del puesto Puerta lo habilita (las rutas lo comprueban con requireGate). Lo que se marca a mano
// entra por la misma cola y el mismo camino que una lectura (src/server/escaner.ts), con el id de escáner
// "manual:puerta:<celular>": queda en el espejo como entrada manual, con su puesto y su hora.
import { SEARCH_MAX_RESULTS, SEARCH_MIN_LENGTH, normalizeSearch } from "../lib/busqueda.ts";
import type { DoorMatch } from "../lib/escaner-api.ts";
import type { Lang } from "../i18n/types.ts";
import { registerForEvent, validateFields, type FailureReason, type FieldErrors } from "./evento/inscripcion.ts";
import { limiter, type Limiter } from "./limites.ts";
import { describeForLog } from "./log.ts";
import type { StationAccess } from "./panel.ts";
import type { EventRecord, Pass, Repo } from "./repo.ts";

// ---------- El permiso ----------

/** Solo el código del puesto Puerta abre el buscador y el "agregar en la puerta". */
export function requireGate(access: StationAccess): Response | null {
  return access.kind === "gate" ? null : Response.json({ error: "gate_only" }, { status: 403 });
}

// ---------- El freno de la búsqueda ----------

/**
 * Las búsquedas son por código de puesto: un voluntario escribe de a una por vez. Ciento veinte por
 * puesto en diez minutos alcanza de sobra; si alguien recorre la lista con búsquedas de tres letras, se frena.
 */
export function doorSearchAttempts(): Limiter {
  return limiter("door-search", {
    windowMs: 10 * 60 * 1000,
    perKey: 120,
    global: Number.MAX_SAFE_INTEGER,
    lockMs: 10 * 60 * 1000,
    maxLockMs: 60 * 60 * 1000,
    forgetMs: 60 * 60 * 1000,
  });
}

// ---------- Buscar ----------

/** "ana.perez@example.com" se muestra como "a***@example.com": alcanza para distinguir a dos Ana sin dar el correo entero. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/**
 * Las personas inscriptas del evento cuyo nombre o correo contiene lo escrito (sin importar mayúsculas ni
 * tildes). Hasta ocho, por nombre. Devuelve el correo tapado, nunca entero.
 */
export async function searchDoor(repo: Repo, event: EventRecord, query: string): Promise<DoorMatch[]> {
  const needle = normalizeSearch(query);
  if (needle.length < SEARCH_MIN_LENGTH) return [];
  const [passes, checkIns, ticketTypes] = await Promise.all([repo.listPasses(event.id), repo.listCheckIns(event.id), repo.listTicketTypes(event.id)]);
  const mirrored = new Map<string, string>();
  for (const checkIn of checkIns) {
    const previous = mirrored.get(checkIn.passId);
    if (!previous || checkIn.scannedAt < previous) mirrored.set(checkIn.passId, checkIn.scannedAt);
  }
  const ticketName = new Map(ticketTypes.map((ticket) => [ticket.id, ticket.name]));

  const matches: DoorMatch[] = [];
  for (const pass of passes) {
    if (pass.status === "pending") continue;
    const person = await repo.getPersonById(pass.personId);
    if (!person) continue;
    if (!normalizeSearch(person.name).includes(needle) && !person.email.toLowerCase().includes(needle)) continue;
    matches.push({
      passId: pass.id,
      name: person.name,
      emailHint: maskEmail(person.email),
      checkedInAt: pass.checkedInAt ?? mirrored.get(pass.id) ?? null,
      ticket: ticketName.get(pass.ticketTypeId) ?? "",
    });
  }
  matches.sort((a, b) => a.name.localeCompare(b.name));
  return matches.slice(0, SEARCH_MAX_RESULTS);
}

// ---------- Agregar en la puerta ----------

export type DoorAddResult =
  | { kind: "added" | "existing"; match: DoorMatch }
  | { kind: "invalid"; errors: FieldErrors }
  | { kind: "no_free_ticket" }
  | { kind: "failed"; reason: FailureReason };

export interface DoorAddInput {
  name: string;
  email: string;
  lang: Lang;
  /** De dónde se pidió, para el enlace del correo en desarrollo. */
  origin?: string | null;
  /** Quién pide, para el freno de inscripciones (clientKey de limites.ts). */
  clientKey?: string | null;
}

/** La entrada gratis del evento a la que se inscribe quien llega sin credencial: la primera sin precio. */
async function freeTicketType(repo: Repo, event: EventRecord) {
  const types = await repo.listTicketTypes(event.id);
  return types.find((ticket) => ticket.priceUsdc === 0) ?? null;
}

function toMatch(pass: Pass, name: string, email: string, ticket: string): DoorMatch {
  return { passId: pass.id, name, emailHint: maskEmail(email), checkedInAt: pass.checkedInAt, ticket };
}

/**
 * Inscribe a alguien en el momento, gratis, con nombre y correo: la misma inscripción de siempre
 * (registerForEvent), con la primera entrada gratis del evento. Quien ya estaba inscripto con ese
 * correo vuelve como "existing", para que el voluntario le marque la entrada.
 */
export async function addAtDoor(repo: Repo, event: EventRecord, input: DoorAddInput): Promise<DoorAddResult> {
  const errors = validateFields({ name: input.name, email: input.email });
  if (errors.name !== undefined || errors.email !== undefined) return { kind: "invalid", errors };
  const ticket = await freeTicketType(repo, event);
  if (!ticket) return { kind: "no_free_ticket" };
  let result;
  try {
    result = await registerForEvent({
      slug: event.slug,
      ticketTypeId: ticket.id,
      name: input.name,
      email: input.email,
      lang: input.lang,
      origin: input.origin,
      clientKey: input.clientKey,
    });
  } catch (error) {
    // El evento no tiene contrato, o algo que la inscripción no esperaba: para el voluntario, no se pudo.
    console.warn(`[puerta] No se pudo agregar a una persona en el evento ${event.slug}: ${describeForLog(error)}`);
    return { kind: "failed", reason: "misconfigured" };
  }
  if (result.kind === "failed") return { kind: "failed", reason: result.reason };
  return { kind: result.kind === "created" ? "added" : "existing", match: toMatch(result.pass, result.person.name, result.person.email, result.ticketType.name) };
}
