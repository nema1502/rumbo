// La pantalla en vivo para proyectar en el evento: los números que sube a la sala (quienes entraron, los
// almuerzos y la merch entregados, el ranking de la ruta de stands) y la lista de quienes participan en el
// sorteo. Todo sale de la base, sin la red de Stellar, y nunca lleva correos: el ranking usa el nombre de pila
// o el alias que cada persona eligió (src/server/stands.ts).
//
// Este módulo NO sortea nada: solo entrega la lista de quienes entraron, con un formato que se pueda comprobar,
// para que la pieza que sortea (con aleatoriedad comprobable) la tome tal cual.
import { createHash } from "node:crypto";
import { getDb } from "./base/index.ts";
import type { EventRecord } from "./repo.ts";
import { effectiveTarget, getRouteGoal, listStands, routeRanking, type RankingRow } from "./stands.ts";

export interface LiveTally {
  /** Entregados hasta ahora. */
  delivered: number;
  /** Cuántos corresponden a las credenciales emitidas. */
  granted: number;
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
    /** Las personas que entraron: todas participan. */
    eligible: number;
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
export async function getLiveState(event: EventRecord, rankingSize = 8): Promise<LiveState> {
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
  return {
    generatedAt: new Date().toISOString(),
    event: { slug: event.slug, name: event.name, startsAt: event.startsAt, timezone: event.timezone, place: event.place, venue: event.venue },
    issued: n(counts?.issued),
    capacity: event.capacity,
    entered,
    lunch: await tally(event.id, "lunch"),
    merch: await tally(event.id, "merch"),
    route: { enabled: stands.length > 0, target, standCount: stands.length, completed, ranking: await routeRanking(event.id, rankingSize) },
    raffle: { eligible: entered },
  };
}

// ---------- La lista del sorteo ----------

export interface RaffleList {
  event: string;
  generatedAt: string;
  /** Cuántas personas entraron. */
  total: number;
  /** Los códigos de credencial de quienes entraron, ordenados: sin nombres ni correos. */
  participants: string[];
  /** SHA-256 de los códigos separados por salto de línea, en ese orden. Publicarla antes del sorteo permite comprobar la lista después. */
  sha256: string;
}

/**
 * La lista de quienes entraron, en el formato de un sorteo comprobable: solo los códigos de credencial (nada
 * personal), siempre en el mismo orden, con la huella SHA-256 de esa lista. Quien sortea la publica antes de
 * sortear y, después, cualquiera puede recalcular la huella con los mismos códigos. El nombre del ganador se
 * busca a partir de su código en el panel.
 */
export async function buildRaffleList(event: EventRecord): Promise<RaffleList> {
  const rows = await getDb().all("SELECT id FROM passes WHERE event_id = ? AND status = 'checked_in' ORDER BY id", [event.id]);
  // El orden se fija acá y no en la base: el de Postgres depende de su configuración regional, y la huella tiene
  // que dar lo mismo en cualquier motor.
  const participants = rows.map((r) => String(r.id)).sort();
  return {
    event: event.slug,
    generatedAt: new Date().toISOString(),
    total: participants.length,
    participants,
    sha256: createHash("sha256").update(participants.join("\n"), "utf8").digest("hex"),
  };
}

/** La misma lista en CSV: número de orden y código de credencial (las columnas no se traducen: las lee un programa). */
export function raffleListCsv(list: RaffleList): string {
  return `n,pass_id\r\n${list.participants.map((id, i) => `${i + 1},${id}`).join("\r\n")}${list.participants.length ? "\r\n" : ""}`;
}
