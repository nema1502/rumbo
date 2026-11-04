// La cuenta de organizador: quien organiza entra con Google o con su correo por Pollar, igual que quien se
// inscribe, y prueba que la cuenta de Stellar es suya con el mismo desafío SEP-53 (cuenta-propia.ts). Con eso:
//   - se crea o se actualiza su cuenta de organizador (tabla organizers: la clave pública, quién la custodia y el
//     nombre que dio Pollar; nunca el correo);
//   - se abre una sesión de treinta días: una ficha de 128 bits al azar viaja en la cookie "rumbo.organizador" y en
//     la base queda solo su huella (SHA-256), así quien lea la base no tiene con qué entrar;
//   - sus eventos se abren con la sesión, además de con la clave por evento de siempre (panel-sesion.ts);
//   - crea eventos sin la clave de la casa, con un tope por cuenta y por día (RUMBO_EVENTS_PER_DAY).
// Lo que depende del pedido HTTP (la cookie) vive acá abajo, junto con lo demás, porque todo se usa junto.
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { verifyWalletProof, type ProofCheck, type WalletProof } from "./cuenta-propia.ts";
import { getEnv } from "./env.ts";
import { createEventFromTemplate, type NewEventFromTemplate } from "./kit/plantillas.ts";
import { getRepo, type EventRecord, type Organizer, type OrganizerSession, type Repo } from "./repo.ts";

export const ORGANIZER_COOKIE = "rumbo.organizador";
/** Cuánto dura una sesión: treinta días, como la cookie de la clave del panel. */
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
/** Cada cuánto se anota que la sesión se usó: una vez por hora alcanza para saber cuáles siguen vivas. */
export const TOUCH_EVERY_MS = 3600_000;
/** Cuántos eventos puede crear una cuenta en veinticuatro horas si RUMBO_EVENTS_PER_DAY no dice otra cosa. */
export const DEFAULT_EVENTS_PER_DAY = 3;

/** La huella con la que se guarda una ficha: SHA-256 en hex. La ficha nunca toca la base. */
export function sessionIdOf(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type LoginResult = { ok: true; organizer: Organizer; token: string } | { ok: false; why: Extract<ProofCheck, { ok: false }>["why"] };

/**
 * Entra con la prueba de la cuenta (el desafío de /api/cuenta/desafio, firmado): crea o actualiza la cuenta de
 * organizador y abre una sesión. Devuelve la ficha para la cookie; en la base queda solo su huella.
 */
export async function loginOrganizer(repo: Repo, proof: WalletProof, name?: string, now: number = Date.now()): Promise<LoginResult> {
  const check = await verifyWalletProof(repo, proof);
  if (!check.ok) return check;
  const organizer = await repo.upsertOrganizer({ publicKey: check.publicKey, provider: check.provider, name });
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

/** Si esa cuenta puede abrir el panel del evento: solo los eventos que creó con ella. */
export function canManageEvent(organizer: Organizer, event: EventRecord): boolean {
  return event.organizerId !== null && event.organizerId === organizer.id;
}

// ---------- Crear eventos con la cuenta ----------

export function eventsPerDay(): number {
  const n = Number(getEnv("RUMBO_EVENTS_PER_DAY", String(DEFAULT_EVENTS_PER_DAY)));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_EVENTS_PER_DAY;
}

export type CreateWithAccount = { ok: true; event: EventRecord } | { ok: false; reason: "quota"; limit: number };

/**
 * Crea el borrador desde la plantilla a nombre de esa cuenta, sin la clave de la casa. El tope cuenta los eventos
 * que la cuenta creó en las últimas veinticuatro horas: en la red de prueba cada evento publicado despliega
 * contratos, y una cuenta no puede llenar el servidor. Los errores de los datos (TemplateInputError) suben tal cual.
 */
export async function createEventWithAccount(
  repo: Repo,
  organizer: Organizer,
  input: Omit<NewEventFromTemplate, "organizerId">,
  now: number = Date.now(),
): Promise<CreateWithAccount> {
  const limit = eventsPerDay();
  const since = new Date(now - 24 * 3600_000).toISOString();
  if ((await repo.countEventsByOrganizerSince(organizer.id, since)) >= limit) return { ok: false, reason: "quota", limit };
  const event = await createEventFromTemplate(repo, { ...input, organizerId: organizer.id });
  return { ok: true, event };
}
