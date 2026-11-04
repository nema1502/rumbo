// La pantalla en vivo para proyectar en el evento: los números que sube a la sala (quienes entraron, los
// almuerzos y la merch entregados, el ranking de la ruta de stands) y la lista de quienes participan en el
// sorteo. Todo sale de la base, sin la red de Stellar, y nunca lleva correos: el ranking usa el nombre de pila
// o el alias que cada persona eligió (src/server/stands.ts).
//
// Este módulo NO sortea nada: solo entrega la lista de quienes entraron, con un formato que se pueda comprobar,
// para que la pieza que sortea (con aleatoriedad comprobable) la tome tal cual. Quien organiza la congela antes
// de sortear (tabla raffle_lists, migración 012): desde ese momento la lista que se proyecta es la que se sortea,
// aunque alguien entre después.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { base32Encode } from "../lib/qr-codec.ts";
import { getDb, jsonParam, readJson } from "./base/index.ts";
import type { EventRecord } from "./repo.ts";
import { effectiveTarget, getRouteGoal, listStands, routeRanking, LIVE_RANKING_SIZE, type RankingRow } from "./stands.ts";

export interface LiveTally {
  /** Entregados hasta ahora. */
  delivered: number;
  /** Cuántos corresponden a las credenciales emitidas. */
  granted: number;
}

/** Quiénes entran en el sorteo: solo las credenciales de asistente (lo de siempre), o todas las que entraron (también oradores, staff, auspiciantes). */
export type RaffleScope = "attendees" | "all";

/** La lista congelada, como la ve la pantalla: cuándo, cuántos y la huella. Sin los códigos. */
export interface FrozenRaffle {
  at: string;
  scope: RaffleScope;
  total: number;
  sha256: string;
}

export interface LiveState {
  generatedAt: string;
  event: { slug: string; name: string; startsAt: string; timezone: string; place: string; venue: string | null };
  /** Credenciales emitidas (activas o que ya entraron). */
  issued: number;
  capacity: number | null;
  /** Personas que entraron. */
  entered: number;
  lunch: LiveTally;
  merch: LiveTally;
  route: {
    enabled: boolean;
    /** La meta efectiva ("4"), o null si no hay meta. */
    target: number | null;
    standCount: number;
    /** Personas que completaron la ruta. */
    completed: number;
    ranking: RankingRow[];
  };
  raffle: {
    /** Las credenciales de asistente que entraron: las que participan si se congela ahora. */
    eligible: number;
    /** La lista ya congelada, si quien organiza la congeló: esa es la que se sortea. */
    frozen: FrozenRaffle | null;
  };
}

const n = (value: unknown): number => Number(value ?? 0);

async function tally(eventId: string, kind: "lunch" | "merch"): Promise<LiveTally> {
  const db = getDb();
  const granted = await db.one(
    `SELECT COUNT(*) AS n FROM pass_benefits pb
     JOIN benefits b ON b.id = pb.benefit_id JOIN passes p ON p.id = pb.pass_id
     WHERE b.event_id = ? AND b.kind = ? AND p.status != 'pending'`,
    [eventId, kind],
  );
  const delivered = await db.one(
    `SELECT COUNT(*) AS n FROM (
       SELECT DISTINCT r.pass_id, r.benefit_id FROM redemptions r JOIN benefits b ON b.id = r.benefit_id
       WHERE r.event_id = ? AND b.kind = ? AND r.duplicate = FALSE) AS delivered`,
    [eventId, kind],
  );
  return { delivered: n(delivered?.n), granted: n(granted?.n) };
}

/** Todo lo que muestra la pantalla en vivo. Se pide cada tres segundos: son pocas consultas, todas de conteo. */
export async function getLiveState(event: EventRecord, rankingSize = LIVE_RANKING_SIZE): Promise<LiveState> {
  const db = getDb();
  const counts = await db.one(
    `SELECT SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) AS issued,
            SUM(CASE WHEN status = 'checked_in' THEN 1 ELSE 0 END) AS entered
     FROM passes WHERE event_id = ?`,
    [event.id],
  );
  const stands = await listStands(event.id);
  const target = effectiveTarget(await getRouteGoal(event.id), stands.length);
  const completed =
    target === null
      ? 0
      : n((await db.one("SELECT COUNT(*) AS n FROM (SELECT pass_id FROM stand_visits WHERE event_id = ? GROUP BY pass_id HAVING COUNT(*) >= ?) AS done", [event.id, target]))?.n);
  const entered = n(counts?.entered);
  const frozen = await getFrozenRaffleList(event);
  return {
    generatedAt: new Date().toISOString(),
    event: { slug: event.slug, name: event.name, startsAt: event.startsAt, timezone: event.timezone, place: event.place, venue: event.venue },
    issued: n(counts?.issued),
    capacity: event.capacity,
    entered,
    lunch: await tally(event.id, "lunch"),
    merch: await tally(event.id, "merch"),
    route: { enabled: stands.length > 0, target, standCount: stands.length, completed, ranking: await routeRanking(event.id, rankingSize) },
    raffle: {
      eligible: await countRaffleParticipants(event.id, "attendees"),
      frozen: frozen ? { at: frozen.frozenAt as string, scope: frozen.scope, total: frozen.total, sha256: frozen.sha256 } : null,
    },
  };
}

// ---------- La lista del sorteo ----------

export interface RaffleList {
  event: string;
  generatedAt: string;
  /** Cuándo se congeló; null si es la lista viva de este momento, que cambia con cada entrada. */
  frozenAt: string | null;
  /** Quiénes entran: solo asistentes, o todas las credenciales que entraron. */
  scope: RaffleScope;
  /** Cuántas personas participan. */
  total: number;
  /** Los códigos de credencial de quienes participan, ordenados: sin nombres ni correos. */
  participants: string[];
  /** SHA-256 de los códigos separados por salto de línea, en ese orden. Publicarla antes del sorteo permite comprobar la lista después. */
  sha256: string;
  /** Cómo se calcula la huella, para que cualquiera la recalcule con los mismos códigos. */
  algorithm: string;
}

/** Cómo se calcula la huella, dicho para quien la quiera comprobar a mano. */
export const RAFFLE_ALGORITHM = "SHA-256 de los códigos unidos con \\n, sin salto final, ordenados letra por letra (A-Z2-7)";

/** La huella de una lista: la misma regla acá, en la prueba y en quien la verifica. */
export function raffleSha256(participants: string[]): string {
  return createHash("sha256").update(participants.join("\n"), "utf8").digest("hex");
}

/** De dónde salen quienes participan: las credenciales que entraron, solo las de asistente o todas. */
function participantsSql(scope: RaffleScope, columns: string): string {
  return scope === "all"
    ? `SELECT ${columns} FROM passes p WHERE p.event_id = ? AND p.status = 'checked_in'`
    : `SELECT ${columns} FROM passes p JOIN ticket_types t ON t.id = p.ticket_type_id
       WHERE p.event_id = ? AND p.status = 'checked_in' AND t.credential_kind = 'attendee'`;
}

/** Los códigos de quienes participan, ordenados. El orden se fija acá y no en la base: el de Postgres depende de su configuración regional, y la huella tiene que dar lo mismo en cualquier motor. */
async function raffleParticipants(eventId: string, scope: RaffleScope): Promise<string[]> {
  const rows = await getDb().all(participantsSql(scope, "p.id"), [eventId]);
  return rows.map((r) => String(r.id)).sort();
}

/** Cuántas personas participarían si se congelara ahora. La pantalla lo pide cada tres segundos: se cuenta, no se baja la lista. */
async function countRaffleParticipants(eventId: string, scope: RaffleScope): Promise<number> {
  return n((await getDb().one(participantsSql(scope, "COUNT(*) AS n"), [eventId]))?.n);
}

/**
 * La lista viva de quienes entraron, en el formato de un sorteo comprobable: solo los códigos de credencial (nada
 * personal), siempre en el mismo orden, con la huella SHA-256 de esa lista. Por defecto entran las credenciales de
 * asistente; con "all", también las de oradores, staff y auspiciantes. El nombre del ganador se busca a partir de
 * su código en el panel.
 */
export async function buildRaffleList(event: EventRecord, scope: RaffleScope = "attendees"): Promise<RaffleList> {
  const participants = await raffleParticipants(event.id, scope);
  return {
    event: event.slug,
    generatedAt: new Date().toISOString(),
    frozenAt: null,
    scope,
    total: participants.length,
    participants,
    sha256: raffleSha256(participants),
    algorithm: RAFFLE_ALGORITHM,
  };
}

/**
 * Congela la lista: la de este momento queda guardada con su hora y su huella, y desde ahora es la que se
 * proyecta y la que se exporta, aunque alguien entre después. Congelar de nuevo la reemplaza (la anterior queda
 * guardada, pero ya no se muestra).
 */
export async function freezeRaffleList(event: EventRecord, scope: RaffleScope = "attendees"): Promise<RaffleList> {
  const db = getDb();
  const list = await buildRaffleList(event, scope);
  await db.run(`INSERT INTO raffle_lists (id, event_id, frozen_at, scope, total, participants, sha256) VALUES (?, ?, ?, ?, ?, ${jsonParam(db)}, ?)`, [
    randomUUID(),
    event.id,
    list.generatedAt,
    scope,
    list.total,
    JSON.stringify(list.participants),
    list.sha256,
  ]);
  return { ...list, frozenAt: list.generatedAt };
}

/** Vuelve a la lista viva: se borran las congeladas del evento. Para cuando se congeló antes de tiempo. */
export async function thawRaffleList(event: EventRecord): Promise<void> {
  await getDb().run("DELETE FROM raffle_lists WHERE event_id = ?", [event.id]);
}

/** La última lista congelada del evento, o null si no hay ninguna. */
export async function getFrozenRaffleList(event: EventRecord): Promise<RaffleList | null> {
  const row = await getDb().one("SELECT * FROM raffle_lists WHERE event_id = ? ORDER BY frozen_at DESC LIMIT 1", [event.id]);
  if (!row) return null;
  const at = String(row.frozen_at);
  return {
    event: event.slug,
    generatedAt: at,
    frozenAt: at,
    scope: row.scope === "all" ? "all" : "attendees",
    total: Number(row.total),
    participants: readJson<string[]>(row.participants),
    sha256: String(row.sha256),
    algorithm: RAFFLE_ALGORITHM,
  };
}

/** La lista que se sortea: la congelada si la hay (la que se proyectó); si no, la viva de este momento. */
export async function getRaffleList(event: EventRecord, scope: RaffleScope = "attendees"): Promise<RaffleList> {
  return (await getFrozenRaffleList(event)) ?? buildRaffleList(event, scope);
}

/**
 * La misma lista en CSV: dos líneas de comentario (el evento, la hora y la huella con su regla) y después número
 * de orden y código de credencial. Las columnas no se traducen: las lee un programa.
 */
export function raffleListCsv(list: RaffleList): string {
  const scope = list.scope === "all" ? "todas las credenciales que entraron" : "solo asistentes";
  const head = [
    `# evento ${list.event}, lista ${list.frozenAt ? "congelada" : "viva"} ${list.generatedAt}, ${scope}, ${list.total} participantes`,
    `# sha256 ${list.sha256} (${list.algorithm})`,
    "n,pass_id",
  ];
  return `${head.join("\r\n")}\r\n${list.participants.map((id, i) => `${i + 1},${id}`).join("\r\n")}${list.participants.length ? "\r\n" : ""}`;
}

// ---------- El enlace del proyector ----------
// La computadora del proyector queda a la vista de toda la sala (y a veces es prestada): no tiene por qué llevar la
// clave de organizador. Su enlace lleva una clave propia (tabla screen_keys, migración 013) que abre solo la pantalla
// en vivo en modo proyector y su JSON, nada más: ni el sorteo, ni el CSV, ni el panel.

const SCREEN_KEY_BYTES = 15;

/** La clave del enlace del proyector del evento. Se crea la primera vez que hace falta. */
export async function getOrCreateScreenKey(eventId: string): Promise<string> {
  const db = getDb();
  const select = async () => (await db.one("SELECT key FROM screen_keys WHERE event_id = ?", [eventId]))?.key as string | undefined;
  const found = await select();
  if (found) return found;
  // Si dos pedidos llegan a la vez, gana el primero y el otro lee la clave que quedó.
  const key = base32Encode(new Uint8Array(randomBytes(SCREEN_KEY_BYTES)));
  await db.run("INSERT INTO screen_keys (event_id, key, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", [eventId, key, new Date().toISOString()]);
  return (await select()) as string;
}

/** Si la clave es la del enlace del proyector de ese evento. Se compara sin que el tiempo delate en qué letra difiere. */
export async function verifyScreenKey(eventId: string, key: string | null | undefined): Promise<boolean> {
  if (!key) return false;
  const expected = Buffer.from(await getOrCreateScreenKey(eventId), "utf8");
  const given = Buffer.from(key.trim().toUpperCase(), "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Un enlace de proyector nuevo (si el de antes quedó a la vista de quien no debía): el viejo deja de abrir en el acto. */
export async function regenerateScreenKey(eventId: string): Promise<string> {
  await getDb().run("DELETE FROM screen_keys WHERE event_id = ?", [eventId]);
  return getOrCreateScreenKey(eventId);
}
