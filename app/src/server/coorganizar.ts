// Coorganizar: la dueña de un evento (la cuenta de organizador que lo creó) suma a otras personas a su equipo, y
// cada una entra con su propia cuenta de organizador. Quien coorganiza puede todo lo del panel y el borrador salvo
// sumar o sacar a otras personas, que es de la dueña. Se suma de dos maneras:
//   - un enlace de invitación (/admin/invitacion/<ficha>): de un solo uso, vence a los siete días, y en la base
//     queda solo la huella SHA-256 de la ficha (event_invites.token_hash), así quien lea la base no tiene con qué
//     sumarse. Quien lo abre con su sesión toca "Sumarme al equipo" y queda.
//   - autorizar una cuenta: la dueña pega la cuenta de Stellar (G...) de la otra persona, y quien entra como
//     organizador con esa cuenta queda como coorganizador la primera vez (event_account_grants pasa a
//     event_coorganizers).
// Ninguna llave ni correo: las cuentas son las de organizers (clave pública y nombre). El enlace con la clave del
// evento ("Compartir el panel") sigue, para quien no tiene cuenta. Las tablas están en 020-coorganizadores.sql.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { getDb } from "./base/index.ts";
import type { EventRecord, Organizer } from "./repo.ts";

/** Cuánto vive un enlace de invitación sin usarse. */
export const INVITE_TTL_MS = 7 * 24 * 3600_000;
/** Cuántas invitaciones abiertas y cuentas autorizadas que todavía no entraron puede tener un evento a la vez. */
export const MAX_OPEN_PER_EVENT = 20;

const iso = (ms: number) => new Date(ms).toISOString();
const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** La huella con la que se guarda la ficha de una invitación: SHA-256 en hex. La ficha nunca toca la base. */
export function inviteHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Qué es una cuenta para un evento: su dueña, quien coorganiza, o nada. */
export type EventRole = "owner" | "coorganizer";

/**
 * Qué es esa cuenta para el evento. Si la dueña había autorizado esa cuenta y es la primera vez que entra a él, la
 * autorización pasa a coorganizar acá mismo.
 */
export async function eventRole(organizer: Organizer, event: EventRecord): Promise<EventRole | null> {
  if (event.organizerId !== null && event.organizerId === organizer.id) return "owner";
  const db = getDb();
  if (await db.one("SELECT 1 AS yes FROM event_coorganizers WHERE event_id = ? AND organizer_id = ?", [event.id, organizer.id])) return "coorganizer";
  const grant = await db.one("SELECT granted_by FROM event_account_grants WHERE event_id = ? AND public_key = ?", [event.id, organizer.publicKey]);
  if (!grant || event.organizerId === null) return null;
  await claimGrant(event.id, organizer, strOrNull(grant.granted_by));
  return "coorganizer";
}

async function claimGrant(eventId: string, organizer: Organizer, grantedBy: string | null): Promise<void> {
  const db = getDb();
  await db.run("INSERT INTO event_coorganizers (event_id, organizer_id, added_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", [eventId, organizer.id, grantedBy, iso(Date.now())]);
  await db.run("DELETE FROM event_account_grants WHERE event_id = ? AND public_key = ?", [eventId, organizer.publicKey]);
}

/** Las autorizaciones que esperaban a esa cuenta pasan a coorganizar: al entrar como organizador y al abrir Mis eventos. */
export async function claimAccountGrants(organizer: Organizer): Promise<number> {
  const rows = await getDb().all(
    "SELECT g.event_id, g.granted_by FROM event_account_grants g JOIN events e ON e.id = g.event_id WHERE g.public_key = ? AND (e.organizer_id IS NULL OR e.organizer_id <> ?)",
    [organizer.publicKey, organizer.id],
  );
  for (const row of rows) await claimGrant(str(row.event_id), organizer, strOrNull(row.granted_by));
  return rows.length;
}

/** Los eventos que esa cuenta coorganiza (no los suyos), los más nuevos primero. */
export async function listCoorganizedEventIds(organizerId: string): Promise<string[]> {
  const rows = await getDb().all("SELECT c.event_id FROM event_coorganizers c JOIN events e ON e.id = c.event_id WHERE c.organizer_id = ? ORDER BY e.created_at DESC", [organizerId]);
  return rows.map((row) => str(row.event_id));
}

// ---------- Lo que ve la dueña: "Tu equipo" ----------

export interface TeamMember {
  organizerId: string;
  name: string;
  publicKey: string;
  addedAt: string;
}

export interface OpenInvite {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export interface PendingGrant {
  publicKey: string;
  createdAt: string;
}

export interface EventTeam {
  members: TeamMember[];
  invites: OpenInvite[];
  grants: PendingGrant[];
}

/** El equipo del evento: quienes coorganizan, las invitaciones abiertas (sin usar, sin anular y sin vencer) y las cuentas autorizadas que todavía no entraron. */
export async function listTeam(event: EventRecord, now: number = Date.now()): Promise<EventTeam> {
  const db = getDb();
  const [members, invites, grants] = await Promise.all([
    db.all("SELECT o.id, o.name, o.public_key, c.created_at FROM event_coorganizers c JOIN organizers o ON o.id = c.organizer_id WHERE c.event_id = ? ORDER BY c.created_at", [event.id]),
    db.all("SELECT id, created_at, expires_at FROM event_invites WHERE event_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at", [event.id, iso(now)]),
    db.all("SELECT public_key, created_at FROM event_account_grants WHERE event_id = ? ORDER BY created_at", [event.id]),
  ]);
  return {
    members: members.map((r) => ({ organizerId: str(r.id), name: str(r.name ?? ""), publicKey: str(r.public_key), addedAt: str(r.created_at) })),
    invites: invites.map((r) => ({ id: str(r.id), createdAt: str(r.created_at), expiresAt: str(r.expires_at) })),
    grants: grants.map((r) => ({ publicKey: str(r.public_key), createdAt: str(r.created_at) })),
  };
}

async function openCount(eventId: string, now: number): Promise<number> {
  const db = getDb();
  const invites = await db.one("SELECT COUNT(*) AS n FROM event_invites WHERE event_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?", [eventId, iso(now)]);
  const grants = await db.one("SELECT COUNT(*) AS n FROM event_account_grants WHERE event_id = ?", [eventId]);
  return Number(invites?.n ?? 0) + Number(grants?.n ?? 0);
}

export type CreateInviteResult = { ok: true; token: string; invite: OpenInvite } | { ok: false; reason: "limit" };

/** Un enlace de invitación nuevo. La ficha se devuelve una sola vez (para mostrarla); en la base queda su huella. */
export async function createInvite(event: EventRecord, owner: Organizer, now: number = Date.now()): Promise<CreateInviteResult> {
  if ((await openCount(event.id, now)) >= MAX_OPEN_PER_EVENT) return { ok: false, reason: "limit" };
  const token = randomBytes(18).toString("base64url");
  const invite: OpenInvite = { id: randomUUID(), createdAt: iso(now), expiresAt: iso(now + INVITE_TTL_MS) };
  await getDb().run("INSERT INTO event_invites (id, token_hash, event_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)", [
    invite.id,
    inviteHash(token),
    event.id,
    owner.id,
    invite.createdAt,
    invite.expiresAt,
  ]);
  return { ok: true, token, invite };
}

/** La dirección relativa de la invitación, para el enlace: /admin/invitacion/<ficha>. */
export const invitePath = (token: string): string => `/admin/invitacion/${encodeURIComponent(token)}`;

export type AuthorizeResult = { ok: true; publicKey: string } | { ok: false; reason: "invalid" | "self" | "already" | "limit" };

/** Autoriza una cuenta de Stellar (G...): quien entre como organizador con ella queda en el equipo la primera vez. */
export async function authorizeAccount(event: EventRecord, owner: Organizer, raw: unknown, now: number = Date.now()): Promise<AuthorizeResult> {
  const publicKey = typeof raw === "string" ? raw.replace(/\s+/g, "").toUpperCase() : "";
  if (!StrKey.isValidEd25519PublicKey(publicKey)) return { ok: false, reason: "invalid" };
  if (publicKey === owner.publicKey) return { ok: false, reason: "self" };
  const db = getDb();
  const member = await db.one("SELECT 1 AS yes FROM event_coorganizers c JOIN organizers o ON o.id = c.organizer_id WHERE c.event_id = ? AND o.public_key = ?", [event.id, publicKey]);
  if (member || (await db.one("SELECT 1 AS yes FROM event_account_grants WHERE event_id = ? AND public_key = ?", [event.id, publicKey]))) return { ok: false, reason: "already" };
  if ((await openCount(event.id, now)) >= MAX_OPEN_PER_EVENT) return { ok: false, reason: "limit" };
  await db.run("INSERT INTO event_account_grants (event_id, public_key, granted_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", [event.id, publicKey, owner.id, iso(now)]);
  return { ok: true, publicKey };
}

/** Saca a alguien del equipo. Si había entrado por una cuenta autorizada, la autorización tampoco queda. */
export async function removeCoorganizer(event: EventRecord, organizerId: string): Promise<boolean> {
  const db = getDb();
  const row = await db.one("SELECT public_key FROM organizers WHERE id = ?", [organizerId]);
  const removed = await db.run("DELETE FROM event_coorganizers WHERE event_id = ? AND organizer_id = ?", [event.id, organizerId]);
  if (row) await db.run("DELETE FROM event_account_grants WHERE event_id = ? AND public_key = ?", [event.id, str(row.public_key)]);
  return removed === 1;
}

/** Anula una invitación que todavía no se usó. */
export async function revokeInvite(event: EventRecord, inviteId: string, now: number = Date.now()): Promise<boolean> {
  return (await getDb().run("UPDATE event_invites SET revoked_at = ? WHERE id = ? AND event_id = ? AND used_at IS NULL AND revoked_at IS NULL", [iso(now), inviteId, event.id])) === 1;
}

/** Anula una cuenta autorizada que todavía no entró. */
export async function revokeGrant(event: EventRecord, publicKey: string): Promise<boolean> {
  return (await getDb().run("DELETE FROM event_account_grants WHERE event_id = ? AND public_key = ?", [event.id, publicKey])) === 1;
}

// ---------- La invitación, del lado de quien la recibe ----------

export type InviteState = "open" | "used" | "expired" | "revoked" | "missing";

export interface InviteLookup {
  state: InviteState;
  /** El evento, si la invitación existe. */
  eventId: string | null;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Cómo está una invitación, por su ficha. Una ficha que no tiene la forma de las nuestras ni se busca. */
export async function lookupInvite(token: string, now: number = Date.now()): Promise<InviteLookup> {
  if (!TOKEN_RE.test(token)) return { state: "missing", eventId: null };
  const row = await getDb().one("SELECT event_id, expires_at, used_at, revoked_at FROM event_invites WHERE token_hash = ?", [inviteHash(token)]);
  if (!row) return { state: "missing", eventId: null };
  const eventId = str(row.event_id);
  if (row.revoked_at) return { state: "revoked", eventId };
  if (row.used_at) return { state: "used", eventId };
  if (Date.parse(str(row.expires_at)) <= now) return { state: "expired", eventId };
  return { state: "open", eventId };
}

export type AcceptResult = { ok: true; eventId: string; already: boolean } | { ok: false; reason: Exclude<InviteState, "open"> | "owner" };

/**
 * Suma a esa cuenta al equipo del evento de la invitación y la gasta: una sola vez, y nunca después de vencida o
 * anulada. Dos pedidos a la vez con la misma ficha los decide la base (un UPDATE con la condición): entra uno. La
 * dueña no se suma a su propio evento, y quien ya coorganiza no gasta la invitación (queda para quien era).
 */
export async function acceptInvite(token: string, organizer: Organizer, event: EventRecord | null, now: number = Date.now()): Promise<AcceptResult> {
  const found = await lookupInvite(token, now);
  if (found.state !== "open") return { ok: false, reason: found.state };
  if (!event || event.id !== found.eventId) return { ok: false, reason: "missing" };
  const role = await eventRole(organizer, event);
  if (role === "owner") return { ok: false, reason: "owner" };
  if (role === "coorganizer") return { ok: true, eventId: event.id, already: true };
  const db = getDb();
  const used = await db.run("UPDATE event_invites SET used_at = ?, used_by = ? WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?", [
    iso(now),
    organizer.id,
    inviteHash(token),
    iso(now),
  ]);
  if (used !== 1) return { ok: false, reason: (await lookupInvite(token, now)).state === "revoked" ? "revoked" : "used" };
  const by = await db.one("SELECT created_by FROM event_invites WHERE token_hash = ?", [inviteHash(token)]);
  await db.run("INSERT INTO event_coorganizers (event_id, organizer_id, added_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", [event.id, organizer.id, strOrNull(by?.created_by), iso(now)]);
  return { ok: true, eventId: event.id, already: false };
}

/** La cuenta como se muestra: las cuatro primeras y las cuatro últimas, "GABC...WXYZ". */
export const shortAccount = (publicKey: string): string => (publicKey.length > 12 ? `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}` : publicKey);
