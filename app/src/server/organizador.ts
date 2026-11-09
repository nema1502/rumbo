// La cuenta de organizador: quien organiza entra con Google o con su correo por Pollar, igual que quien se
// inscribe, y prueba que la cuenta de Stellar es suya con el mismo desafío SEP-53 (cuenta-propia.ts). Con eso:
//   - se crea o se actualiza su cuenta de organizador (tabla organizers: la clave pública, quién la custodia y el
//     nombre que dio Pollar; nunca el correo);
//   - se abre una sesión de treinta días: una ficha de 128 bits al azar viaja en la cookie "rumbo.organizador" y en
//     la base queda solo su huella (SHA-256), así quien lea la base no tiene con qué entrar;
//   - sus eventos se abren con la sesión, además de con la clave por evento de siempre (panel-sesion.ts);
//   - crea eventos sin la clave de la casa, con un tope por cuenta y por día (RUMBO_EVENTS_PER_DAY) y otro por IP
//     (RUMBO_EVENTS_PER_IP_PER_DAY), porque las cuentas son gratis.
// Lo que depende del pedido HTTP (la cookie) vive acá abajo, junto con lo demás, porque todo se usa junto.
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { verifyWalletProof, type ProofCheck, type WalletProof } from "./cuenta-propia.ts";
import { BUSY, tryExclusive } from "./compartido.ts";
import { claimAccountGrants, eventRole, type EventRole } from "./coorganizar.ts";
import { getEnv } from "./env.ts";
import { checkTemplateInput, createEventFromTemplate, type NewEventFromTemplate } from "./kit/plantillas.ts";
import { eventCreateAttempts } from "./limites.ts";
import { getRepo, type EventRecord, type Organizer, type OrganizerSession, type Repo } from "./repo.ts";

export const ORGANIZER_COOKIE = "rumbo.organizador";
/** Cuánto dura una sesión: treinta días, como la cookie de la clave del panel. */
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
/** Cada cuánto se anota que la sesión se usó: una vez por hora alcanza para saber cuáles siguen vivas. */
export const TOUCH_EVERY_MS = 3600_000;
/** Cuántos eventos puede crear una cuenta en veinticuatro horas si RUMBO_EVENTS_PER_DAY no dice otra cosa. */
export const DEFAULT_EVENTS_PER_DAY = 3;
/** El techo de todo Rumbo, sumando todas las cuentas y conexiones: los topes por cuenta y por IP se esquivan abriendo más. */
export const DEFAULT_EVENTS_GLOBAL_PER_DAY = 100;
const DAY_MS = 24 * 3600_000;

/** La huella con la que se guarda una ficha: SHA-256 en hex. La ficha nunca toca la base. */
export function sessionIdOf(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Cuánto puede medir el nombre de una cuenta de organizador, en caracteres (no en unidades de UTF-16). */
export const MAX_ORGANIZER_NAME = 80;

/**
 * El nombre lo manda el navegador (lo que dio Pollar), así que se limpia acá: sin caracteres de control ni NUL (que
 * Postgres no guarda), sin los invisibles que dan vuelta el texto, recortado a ochenta sin partir un carácter, y
 * vacío si parece un correo: en la tabla organizers no hay correos.
 */
export function cleanOrganizerName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const name = Array.from(raw.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "").replace(/\s+/g, " ").trim())
    .slice(0, MAX_ORGANIZER_NAME)
    .join("")
    .trim();
  return name.includes("@") ? "" : name;
}

export type LoginResult = { ok: true; organizer: Organizer; token: string } | { ok: false; why: Extract<ProofCheck, { ok: false }>["why"] };

/**
 * Entra con la prueba de la cuenta (el desafío de /api/cuenta/desafio, firmado): crea o actualiza la cuenta de
 * organizador y abre una sesión. Devuelve la ficha para la cookie; en la base queda solo su huella.
 */
export async function loginOrganizer(repo: Repo, proof: WalletProof, name?: unknown, now: number = Date.now()): Promise<LoginResult> {
  const check = await verifyWalletProof(repo, proof);
  if (!check.ok) return check;
  const organizer = await repo.upsertOrganizer({ publicKey: check.publicKey, provider: check.provider, name: cleanOrganizerName(name) });
  // Si alguna dueña autorizó esta cuenta en su evento, entrar la suma a ese equipo.
  await claimAccountGrants(organizer);
  const token = randomBytes(16).toString("base64url");
  await repo.createOrganizerSession({ id: sessionIdOf(token), organizerId: organizer.id, expiresAt: new Date(now + SESSION_TTL_MS).toISOString() });
  return { ok: true, organizer, token };
}

export interface OrganizerAccess {
  organizer: Organizer;
  session: OrganizerSession;
}

/** La cuenta detrás de una ficha: la sesión existe, no venció y es de una cuenta que existe. Si no, null. */
export async function resolveOrganizerSession(repo: Repo, token: string | null | undefined, now: number = Date.now()): Promise<OrganizerAccess | null> {
  if (!token || token.length > 64) return null;
  const session = await repo.getOrganizerSession(sessionIdOf(token));
  if (!session || Date.parse(session.expiresAt) <= now) return null;
  const organizer = await repo.getOrganizerById(session.organizerId);
  if (!organizer) return null;
  if (now - Date.parse(session.lastSeenAt) >= TOUCH_EVERY_MS) {
    const at = new Date(now).toISOString();
    await repo.touchOrganizerSession(session.id, at);
    session.lastSeenAt = at;
  }
  return { organizer, session };
}

/** Desde una página (componente de servidor): la cuenta de organizador de la cookie, o null. */
export async function organizerFromCookies(repo: Repo = getRepo()): Promise<Organizer | null> {
  return (await resolveOrganizerSession(repo, (await cookies()).get(ORGANIZER_COOKIE)?.value))?.organizer ?? null;
}

/** Desde una ruta de la API: la cuenta de organizador de la cookie del pedido, o null. */
export async function organizerFromRequest(request: NextRequest, repo: Repo = getRepo()): Promise<Organizer | null> {
  return (await resolveOrganizerSession(repo, request.cookies.get(ORGANIZER_COOKIE)?.value))?.organizer ?? null;
}

export function setOrganizerCookie(response: NextResponse, request: NextRequest, token: string): void {
  response.cookies.set(ORGANIZER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    secure: request.nextUrl.protocol === "https:",
  });
}

export function clearOrganizerCookie(response: NextResponse): void {
  response.cookies.set(ORGANIZER_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

/** Cierra la sesión de esa ficha (si existe). La cookie la borra quien contesta. */
export async function logoutOrganizer(repo: Repo, token: string | null | undefined): Promise<void> {
  if (!token) return;
  await repo.deleteOrganizerSession(sessionIdOf(token));
}

/** Si esa cuenta puede abrir el panel del evento: los que creó con ella y los que coorganiza (coorganizar.ts). */
export async function canManageEvent(organizer: Organizer, event: EventRecord): Promise<boolean> {
  return (await eventRole(organizer, event)) !== null;
}

export type { EventRole };

// ---------- Crear eventos con la cuenta ----------

export function eventsPerDay(): number {
  const n = Number(getEnv("RUMBO_EVENTS_PER_DAY", String(DEFAULT_EVENTS_PER_DAY)));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_EVENTS_PER_DAY;
}

export function eventsGlobalPerDay(): number {
  const n = Number(getEnv("RUMBO_EVENTS_GLOBAL_PER_DAY", String(DEFAULT_EVENTS_GLOBAL_PER_DAY)));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_EVENTS_GLOBAL_PER_DAY;
}

export type CreateWithAccount =
  | { ok: true; event: EventRecord }
  | { ok: false; reason: "quota"; limit: number }
  | { ok: false; reason: "busy" }
  | { ok: false; reason: "ip"; waitMs: number }
  | { ok: false; reason: "global" };

export interface CreateOptions {
  /** Quién pide (clientKey): el tope por IP. Sin él, no se cuenta (el MCP y las pruebas que no lo pasan). */
  requester?: string;
  now?: number;
}

/**
 * Crea el borrador desde la plantilla a nombre de esa cuenta, sin la clave de la casa. Dos topes: el de la cuenta
 * (RUMBO_EVENTS_PER_DAY en las últimas veinticuatro horas) y el de la IP (eventCreateAttempts), porque una cuenta
 * es gratis y se abren de a muchas. En la red de prueba cada evento publicado despliega contratos.
 *
 * Contar y crear van juntos dentro del turno crear-evento:<cuenta> (compartido.ts, que en Postgres vive en la base):
 * sin él, una ráfaga de pedidos a la vez cuenta cero antes de que el primero escriba y pasan todos. Si el turno lo
 * tiene otro pedido de la misma cuenta (un doble clic), contesta "busy" sin esperar. Los datos se revisan antes de
 * gastar nada; sus errores (TemplateInputError) suben tal cual.
 */
export async function createEventWithAccount(
  repo: Repo,
  organizer: Organizer,
  input: Omit<NewEventFromTemplate, "organizerId">,
  { requester, now = Date.now() }: CreateOptions = {},
): Promise<CreateWithAccount> {
  checkTemplateInput(input);
  const outcome = await tryExclusive(`crear-evento:${organizer.id}`, async (): Promise<CreateWithAccount> => {
    const limit = eventsPerDay();
    const since = new Date(now - DAY_MS).toISOString();
    if ((await repo.countEventsByOrganizerSince(organizer.id, since)) >= limit) return { ok: false, reason: "quota", limit };
    // El techo de todos: aproximado (el turno es por cuenta), alcanza para que nadie llene la red de prueba de a muchas cuentas.
    if ((await repo.listAccountEventTimesSince(since)).length >= eventsGlobalPerDay()) return { ok: false, reason: "global" };
    if (requester !== undefined) {
      const waitMs = await eventCreateAttempts().take(requester);
      if (waitMs > 0) return { ok: false, reason: "ip", waitMs };
    }
    return { ok: true, event: await createEventFromTemplate(repo, { ...input, organizerId: organizer.id }) };
  });
  return outcome === BUSY ? { ok: false, reason: "busy" } : outcome;
}

export type CreateQuota =
  | { ok: true; limit: number; left: number }
  | { ok: false; reason: "quota"; limit: number; freesInMs: number }
  | { ok: false; reason: "ip"; freesInMs: number }
  | { ok: false; reason: "global"; freesInMs: number };

/**
 * Para la pantalla de /admin/nuevo: si esa cuenta (y esa IP) pueden crear un evento ahora, y si no, cuándo se libera.
 * Solo mira: el que cuenta es createEventWithAccount.
 */
export async function createQuota(repo: Repo, organizer: Organizer, requester: string | undefined, now: number = Date.now()): Promise<CreateQuota> {
  const limit = eventsPerDay();
  const since = now - DAY_MS;
  const recent = (await repo.listEventsByOrganizer(organizer.id))
    .map((event) => Date.parse(event.createdAt))
    .filter((at) => at >= since)
    .sort((a, b) => a - b);
  // Se libera cuando el más viejo de los que sobran sale de las veinticuatro horas.
  if (recent.length >= limit) return { ok: false, reason: "quota", limit, freesInMs: Math.max(0, recent[recent.length - limit]! + DAY_MS - now) };
  const techo = eventsGlobalPerDay();
  const todos = (await repo.listAccountEventTimesSince(new Date(since).toISOString())).map((at) => Date.parse(at));
  if (todos.length >= techo) return { ok: false, reason: "global", freesInMs: Math.max(0, todos[todos.length - techo]! + DAY_MS - now) };
  if (requester !== undefined) {
    const waitMs = await eventCreateAttempts().blockedFor(requester);
    if (waitMs > 0) return { ok: false, reason: "ip", freesInMs: waitMs };
  }
  return { ok: true, limit, left: limit - recent.length };
}
