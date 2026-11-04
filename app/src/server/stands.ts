// Los stands de quienes auspician, la ruta de visitas y los contactos que la gente acepta compartir.
// Todo vive fuera de la cadena, en la base (migración 008-stands.sql): nombres y correos nunca van al contrato.
//
// Cómo encaja:
//   - Quien organiza define los stands (uno por auspiciante) y una meta ("visitá 4 de 6"). Cada stand tiene un
//     código de puesto de tipo "stand" (panel.ts: ensureStationCodes), con el que su gente abre el escáner.
//   - Escanear la credencial en un stand deja un sello (recordVisit): uno por persona y stand. Al llegar a la
//     meta, el beneficio "Premio de la ruta" pasa a la credencial y se canjea en el puesto de Premios.
//   - Cada visita nace con el permiso "pending": no se comparte nada. La PERSONA contesta desde su credencial
//     (answerConsent); recién ahí el auspiciante ve su nombre y su correo (getStandPanel, buildContactsCsv).
//   - Los números para el informe (getEventStandsReport, getStandReport) son agregados: nunca personas.
//
// Las tablas viven en la base de siempre (src/server/base): SQLite en desarrollo, Postgres en producción.
import { randomUUID } from "node:crypto";
import { translate, type Lang } from "../i18n/index.ts";
import type { ConsentState, ScanStandVisit, ScanVia } from "../lib/escaner-api.ts";
import { isLocalLogoPath, localLogoOrNull } from "../lib/logo.ts";
import { getDb, type Row, type SqlValue } from "./base/index.ts";
import { isFoodBenefit } from "./kit/plantillas.ts";
import { clientKey, stationCodeAttempts } from "./limites.ts";
import { csvCell, ensureStationCodes, resolveStationCode, type StationAccess, type StationStand } from "./panel.ts";
import { ClientIdTaken, checkedScannedAt, getRepo, type EventRecord, type Repo } from "./repo.ts";
import { isReadableDate } from "../lib/fecha-iso.ts";

// ---------- La base ----------

const all = (sql: string, ...params: SqlValue[]): Promise<Row[]> => getDb().all(sql, params);
const one = (sql: string, ...params: SqlValue[]): Promise<Row | null> => getDb().one(sql, params);
/** Una sentencia que escribe: devuelve cuántas filas cambió. */
const run = (sql: string, ...params: SqlValue[]): Promise<number> => getDb().run(sql, params);
const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);
/** SQLite guarda los booleanos como 1 y 0; Postgres los da como true y false. */
const bool = (v: unknown): boolean => v === true || Number(v) === 1;
const now = () => new Date().toISOString();

// ---------- Los errores ----------

export type StandsErrorCode =
  | "invalid_name"
  | "invalid_logo"
  | "invalid_benefit"
  | "invalid_target"
  | "no_stands"
  | "not_found"
  | "no_visit"
  | "invalid_answer"
  | "invalid_alias"
  | "invalid_rating"
  | "invalid_note"
  | "no_consent";

/** Un pedido que no se puede cumplir. `code` es estable, para que la API conteste con él. */
export class StandsError extends Error {
  readonly code: StandsErrorCode;
  constructor(code: StandsErrorCode) {
    super(code);
    this.name = "StandsError";
    this.code = code;
  }
}

// ---------- Limpiar lo que escribe la gente ----------

/**
 * Lo que no se ve y cambia cómo se lee un texto en pantalla, o lo deja en blanco: controles, separadores raros,
 * marcas de dirección, el guion blando, los rellenos (hangul, braille en blanco), los selectores de variante y
 * las etiquetas (U+E0000 a U+E007F). Todo eso se vuelve un espacio.
 */
const INVISIBLE = new RegExp(
  "[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u2800\u3164\ufe00-\ufe0f\ufeff\uffa0\u{e0000}-\u{e007f}]",
  "gu",
);

/** Una línea de texto limpia: sin controles, con los espacios juntos, de a lo sumo `max` letras. */
export function cleanLine(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  const text = input.normalize("NFC").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
  return [...text].slice(0, max).join("").trim();
}

export const STAND_NAME_MAX = 60;
export const ALIAS_MAX = 20;
export const NOTE_MAX = 500;

/** Lo que no puede ser un nombre de pila en la pantalla: una arroba, una barra o un punto (un correo, un enlace) o dos dígitos seguidos (un teléfono). */
const NOT_A_NAME = /[@/.]|\d{2}/;

/**
 * El nombre de pila: la primera palabra del nombre, o lo que sigue a la coma en "Apellido, Nombre". Null si lo
 * que queda no parece un nombre (un correo, un teléfono, un enlace): la pantalla lo muestra como anónimo antes
 * que proyectar un dato de contacto a toda la sala.
 */
export function firstName(name: string): string | null {
  const clean = cleanLine(name, 120);
  const comma = clean.indexOf(",");
  const given = comma > 0 ? clean.slice(comma + 1).trim() : clean;
  // La palabra entera se mira antes de recortarla: un correo largo recortado a veinte letras parecía un nombre.
  const word = given.split(" ")[0] ?? "";
  if (!word || NOT_A_NAME.test(word)) return null;
  return [...word].slice(0, ALIAS_MAX).join("");
}

/** Lo que se muestra en la pantalla del evento: el alias si lo hay, si no el nombre de pila; null si la persona pidió no aparecer. */
export function publicLabel(name: string, display: { alias: string | null; hidden: boolean } | null): string | null {
  if (display?.hidden) return null;
  return display?.alias || firstName(name);
}

/** Lo que un alias no puede llevar: una arroba, un enlace (con "://", "www." o un dominio seguido de barra) o seis dígitos seguidos (un teléfono). */
const NOT_AN_ALIAS = /@|:\/\/|www\.|\d{6}|[^\s.]\.[a-z]{2,}(?:\/|$)/i;

/**
 * El alias que escribió la persona. Vacío es "ninguno"; un correo, un enlace o un teléfono no valen: la pantalla
 * se ve desde toda la sala. Se normaliza a NFKC antes de mirar, así una arroba de ancho completo es una arroba.
 */
export function cleanAlias(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") throw new StandsError("invalid_alias");
  const alias = cleanLine(input.normalize("NFKC"), ALIAS_MAX);
  if (NOT_AN_ALIAS.test(alias)) throw new StandsError("invalid_alias");
  return alias || null;
}

/** El logo: solo una ruta propia de la app (src/lib/logo.ts). Un enlace a otro servidor no vale: vería la IP de cada persona que abre su credencial. */
function cleanLogo(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  const value = typeof input === "string" ? input.trim() : input;
  if (!isLocalLogoPath(value)) throw new StandsError("invalid_logo");
  return value;
}

// ---------- Los stands ----------

export interface Stand {
  id: string;
  eventId: string;
  name: string;
  logoUrl: string | null;
  /** El beneficio que el auspiciante regala y se canjea en su mesa, para sumar sus canjes en el informe. */
  benefitId: string | null;
  sortOrder: number;
  createdAt: string;
}

const rowToStand = (r: Row): Stand => ({
  id: str(r.id),
  eventId: str(r.event_id),
  name: str(r.name),
  // Un logo de otro servidor guardado antes de la regla de rutas propias no se muestra.
  logoUrl: localLogoOrNull(strOrNull(r.logo_url)),
  benefitId: strOrNull(r.benefit_id),
  sortOrder: num(r.sort_order),
  createdAt: str(r.created_at),
});

export async function listStands(eventId: string): Promise<Stand[]> {
  return (await all("SELECT * FROM stands WHERE event_id = ? ORDER BY sort_order, created_at", eventId)).map(rowToStand);
}

export async function getStand(id: string): Promise<Stand | null> {
  const row = await one("SELECT * FROM stands WHERE id = ?", id);
  return row ? rowToStand(row) : null;
}

async function checkedBenefit(eventId: string, benefitId: unknown, repo: Repo): Promise<string | null> {
  if (benefitId === null || benefitId === undefined || benefitId === "") return null;
  if (typeof benefitId !== "string") throw new StandsError("invalid_benefit");
  const benefit = await repo.getBenefit(benefitId);
  if (!benefit || benefit.eventId !== eventId) throw new StandsError("invalid_benefit");
  return benefit.id;
}

/** Suma un stand al evento. Después de crearlo, panel.ts (ensureStationCodes) le da su código de puesto. */
export async function createStand(
  event: EventRecord,
  input: { name: unknown; logoUrl?: unknown; benefitId?: unknown },
  repo: Repo = getRepo(),
): Promise<Stand> {
  const name = cleanLine(input.name, STAND_NAME_MAX);
  if (!name) throw new StandsError("invalid_name");
  const logoUrl = cleanLogo(input.logoUrl);
  const benefitId = await checkedBenefit(event.id, input.benefitId, repo);
  const next = num((await one("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM stands WHERE event_id = ?", event.id))?.n ?? 0);
  const id = randomUUID();
  await run("INSERT INTO stands (id, event_id, name, logo_url, benefit_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, event.id, name, logoUrl, benefitId, next, now());
  return (await getStand(id)) as Stand;
}

/** Cambia el nombre, el logo o el beneficio de un stand. Lo que no viene, queda como estaba. */
export async function updateStand(
  standId: string,
  patch: { name?: unknown; logoUrl?: unknown; benefitId?: unknown },
  repo: Repo = getRepo(),
): Promise<Stand> {
  const stand = await getStand(standId);
  if (!stand) throw new StandsError("not_found");
  const name = patch.name === undefined ? stand.name : cleanLine(patch.name, STAND_NAME_MAX);
  if (!name) throw new StandsError("invalid_name");
  const logoUrl = patch.logoUrl === undefined ? stand.logoUrl : cleanLogo(patch.logoUrl);
  const benefitId = patch.benefitId === undefined ? stand.benefitId : await checkedBenefit(stand.eventId, patch.benefitId, repo);
  await run("UPDATE stands SET name = ?, logo_url = ?, benefit_id = ? WHERE id = ?", name, logoUrl, benefitId, standId);
  return (await getStand(standId)) as Stand;
}

/** Saca un stand: se van con él sus sellos y sus contactos. */
export async function deleteStand(standId: string): Promise<void> {
  if (!(await getStand(standId))) throw new StandsError("not_found");
  await run("DELETE FROM stands WHERE id = ?", standId);
}

/**
 * Un código de puesto nuevo para el stand (si el de antes se filtró, o cambió quien atiende). El viejo deja de
 * abrir el escáner y el panel en el acto: un escáner que lo tenga abierto ve "este puesto ya no se puede
 * sincronizar". Devuelve el código nuevo.
 */
export async function regenerateStandCode(event: EventRecord, standId: string, repo: Repo = getRepo()): Promise<string> {
  const stand = await getStand(standId);
  if (!stand || stand.eventId !== event.id) throw new StandsError("not_found");
  await run("DELETE FROM station_codes WHERE kind = 'stand' AND stand_id = ?", standId);
  const code = (await ensureStationCodes(event, repo)).find((c) => c.kind === "stand" && c.standId === standId)?.code;
  if (!code) throw new StandsError("not_found");
  return code;
}

// ---------- La meta de la ruta ----------

export interface RouteGoal {
  eventId: string;
  /** Cuántos stands hay que visitar para completar la ruta. */
  target: number;
  /** El beneficio que se otorga al completarla ("Premio de la ruta"). */
  prizeBenefitId: string | null;
}

export async function getRouteGoal(eventId: string): Promise<RouteGoal | null> {
  const row = await one("SELECT * FROM route_goals WHERE event_id = ?", eventId);
  return row ? { eventId: str(row.event_id), target: num(row.target), prizeBenefitId: strOrNull(row.prize_benefit_id) } : null;
}

/** La meta que de verdad se puede cumplir: si se sacaron stands, nunca pide más de los que hay. Null sin meta o sin stands. */
export function effectiveTarget(goal: RouteGoal | null, standCount: number): number | null {
  if (!goal || standCount === 0) return null;
  return Math.min(goal.target, standCount);
}

/**
 * Fija la meta de la ruta ("visitá 4 de 6 stands") y deja listo el premio: si el evento todavía no tiene el
 * beneficio "Premio de la ruta", lo crea (tipo premio, se canjea en el puesto de Premios). Quienes ya
 * cumplían la nueva meta lo reciben en el acto.
 */
export async function setRouteGoal(event: EventRecord, input: { target: unknown; prizeName?: unknown }, repo: Repo = getRepo()): Promise<RouteGoal> {
  const stands = await listStands(event.id);
  if (stands.length === 0) throw new StandsError("no_stands");
  const target = typeof input.target === "number" ? input.target : typeof input.target === "string" && input.target.trim() ? Number(input.target) : NaN;
  if (!Number.isInteger(target) || target < 1 || target > stands.length) throw new StandsError("invalid_target");

  let prizeId = (await getRouteGoal(event.id))?.prizeBenefitId ?? null;
  const prize = prizeId ? await repo.getBenefit(prizeId) : null;
  if (!prize) {
    const name = cleanLine(input.prizeName, STAND_NAME_MAX) || ROUTE_PRIZE_NAME;
    const created = await repo.createBenefit({ eventId: event.id, name, kind: "prize", station: ROUTE_PRIZE_PLACE, sortOrder: 90 });
    prizeId = created.id;
  } else if (typeof input.prizeName === "string" && cleanLine(input.prizeName, STAND_NAME_MAX)) {
    // Renombrar el premio no cambia al beneficio: sigue siendo el mismo para quien ya lo ganó.
    await run("UPDATE benefits SET name = ? WHERE id = ?", cleanLine(input.prizeName, STAND_NAME_MAX), prize.id);
  }
  await run(
    `INSERT INTO route_goals (event_id, target, prize_benefit_id, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (event_id) DO UPDATE SET target = excluded.target, prize_benefit_id = excluded.prize_benefit_id, updated_at = excluded.updated_at`,
    event.id,
    target,
    prizeId,
    now(),
  );
  const goal = (await getRouteGoal(event.id)) as RouteGoal;
  await grantRoutePrizes(event.id, repo);
  return goal;
}

export const ROUTE_PRIZE_NAME = "Premio de la ruta";
export const ROUTE_PRIZE_PLACE = "Premios";

/** Si el beneficio es el premio de la ruta de ese evento. El escáner lo canjea sin pasar por el contrato. */
export async function isRoutePrize(eventId: string, benefitId: string): Promise<boolean> {
  return (await one("SELECT 1 AS yes FROM route_goals WHERE event_id = ? AND prize_benefit_id = ?", eventId, benefitId)) !== null;
}

/**
 * Marca como hecho el canje del premio de la ruta, de un solo golpe y solo si esa persona no tiene ya otro
 * canje hecho del mismo premio. Devuelve false si llegó segundo: ese es un doble. Dos escáneres que suben al
 * mismo tiempo no pueden ganar los dos: en SQLite la sentencia es una sola y la base escribe de a una; en
 * Postgres, donde dos instancias escriben a la vez de verdad, primero se toma la fila del pase (FOR UPDATE) y
 * quien llega segundo espera, y al seguir ya ve el canje del primero.
 */
export async function claimRoutePrize(redemptionId: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    if (tx.dialect === "postgres") {
      await tx.one("SELECT p.id FROM passes p JOIN redemptions r ON r.pass_id = p.id WHERE r.id = ? FOR UPDATE OF p", [redemptionId]);
    }
    const changes = await tx.run(
      `UPDATE redemptions SET synced = TRUE, error = NULL
       WHERE id = ? AND duplicate = FALSE
         AND NOT EXISTS (
           SELECT 1 FROM redemptions o
           WHERE o.pass_id = redemptions.pass_id AND o.benefit_id = redemptions.benefit_id
             AND o.id != redemptions.id AND o.synced = TRUE AND o.duplicate = FALSE
         )`,
      [redemptionId],
    );
    return changes === 1;
  });
}

/**
 * Les da el premio a todas las personas que ya cumplen la meta. Se puede correr las veces que haga falta;
 * hay que llamarla después de sacar un stand, porque la meta efectiva baja cuando hay menos stands.
 */
export async function grantRoutePrizes(eventId: string, repo: Repo = getRepo()): Promise<number> {
  const goal = await getRouteGoal(eventId);
  const target = effectiveTarget(goal, (await listStands(eventId)).length);
  if (!goal?.prizeBenefitId || target === null) return 0;
  const rows = await all("SELECT pass_id FROM stand_visits WHERE event_id = ? GROUP BY pass_id HAVING COUNT(*) >= ?", eventId, target);
  for (const row of rows) await repo.grantBenefit(str(row.pass_id), goal.prizeBenefitId, "manual");
  return rows.length;
}

// ---------- Los sellos ----------

export interface StandVisit {
  id: string;
  standId: string;
  eventId: string;
  passId: string;
  scannerId: string | null;
  scannedAt: string;
  /** Cuándo llegó al servidor (la pone el servidor). */
  receivedAt: string;
  /** Cómo se leyó la credencial: el QR del celular o el impreso. Null en las visitas de antes. */
  via: ScanVia | null;
  consent: ConsentState;
  consentAt: string | null;
  rating: number | null;
  note: string;
}

const rowToVisit = (r: Row): StandVisit => ({
  id: str(r.id),
  standId: str(r.stand_id),
  eventId: str(r.event_id),
  passId: str(r.pass_id),
  scannerId: strOrNull(r.scanner_id),
  // Una fila con una hora que no se puede leer (de antes de validarla) no tumba la credencial: vale la de llegada.
  scannedAt: isReadableDate(r.scanned_at) ? r.scanned_at : str(r.created_at),
  receivedAt: isReadableDate(r.received_at) ? r.received_at : str(r.created_at),
  via: r.via === "live" || r.via === "printed" || r.via === "manual" ? r.via : null,
  consent: str(r.consent) as ConsentState,
  consentAt: strOrNull(r.consent_at),
  rating: r.rating === null || r.rating === undefined ? null : num(r.rating),
  note: strOrNull(r.note) ?? "",
});

export interface VisitResult {
  visit: StandVisit;
  /** false si la persona ya tenía el sello de ese stand (otro escáner, o la misma lectura repetida). */
  created: boolean;
  /** Cuántos stands lleva la persona. */
  visited: number;
  target: number | null;
  completed: boolean;
  /** true si con este sello se llegó a la meta y el premio quedó en su credencial. */
  completedNow: boolean;
}

/**
 * Deja el sello de un stand en la credencial de una persona: uno solo por persona y stand, así se lea dos
 * veces o con dos celulares. `clientId` es el de la cola del escáner: reintentar no duplica, y con el mismo
 * id para otra persona u otro stand lanza ClientIdTaken. Si con este sello se cumple la meta, el premio
 * pasa a la credencial en el mismo acto. El permiso para compartir el contacto empieza sin responder.
 */
export async function recordVisit(
  input: { standId: string; passId: string; clientId?: string | null; scannerId?: string | null; scannedAt?: string; via?: ScanVia | null },
  repo: Repo = getRepo(),
): Promise<VisitResult> {
  const scannedAt = checkedScannedAt(input.scannedAt);
  const stand = await getStand(input.standId);
  if (!stand) throw new StandsError("not_found");
  const pass = await repo.getPass(input.passId);
  if (!pass || pass.eventId !== stand.eventId || pass.status === "pending") throw new StandsError("not_found");

  if (input.clientId) {
    const prior = await one("SELECT * FROM stand_visits WHERE client_id = ?", input.clientId);
    if (prior && (str(prior.stand_id) !== stand.id || str(prior.pass_id) !== pass.id)) throw new ClientIdTaken(input.clientId);
  }
  const before = await visitCount(pass.id);
  const at = now();
  await run(
    `INSERT INTO stand_visits (id, client_id, stand_id, event_id, pass_id, scanner_id, scanned_at, received_at, via, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    randomUUID(),
    input.clientId ?? null,
    stand.id,
    stand.eventId,
    pass.id,
    input.scannerId ?? null,
    scannedAt,
    at,
    input.via ?? null,
    at,
  );
  const visit = rowToVisit((await one("SELECT * FROM stand_visits WHERE stand_id = ? AND pass_id = ?", stand.id, pass.id)) as Row);
  const visited = await visitCount(pass.id);
  const goal = await getRouteGoal(stand.eventId);
  const target = effectiveTarget(goal, (await listStands(stand.eventId)).length);
  const completed = target !== null && visited >= target;
  if (completed && goal?.prizeBenefitId) await repo.grantBenefit(pass.id, goal.prizeBenefitId, "manual");
  return { visit, created: visited > before, visited, target, completed, completedNow: completed && visited > before && before < (target as number) };
}

async function visitCount(passId: string): Promise<number> {
  return num((await one("SELECT COUNT(*) AS n FROM stand_visits WHERE pass_id = ?", passId))?.n ?? 0);
}

// ---------- La ruta en la credencial ----------

export interface PassRouteStand {
  id: string;
  name: string;
  logoUrl: string | null;
  visitedAt: string | null;
  /** Cómo contestó la persona; null si todavía no visitó el stand. */
  consent: ConsentState | null;
}

export interface PassRoute {
  eventId: string;
  /** La meta ("4"), o null si el evento no fijó una. */
  target: number | null;
  visited: number;
  /** Cuántos stands tiene la ruta. */
  total: number;
  completed: boolean;
  prize: { id: string; name: string; granted: boolean; redeemed: boolean } | null;
  stands: PassRouteStand[];
  /** Cómo aparece en la pantalla del evento. */
  display: { alias: string | null; hidden: boolean; shownAs: string | null };
}

async function displayOf(passId: string): Promise<{ alias: string | null; hidden: boolean } | null> {
  const row = await one("SELECT alias, hidden FROM route_display WHERE pass_id = ?", passId);
  return row ? { alias: strOrNull(row.alias), hidden: bool(row.hidden) } : null;
}

/**
 * Lo que la credencial muestra de la ruta: cuántos stands lleva, cuáles faltan, el premio, y qué contestó la
 * persona en cada uno. Null si el evento no tiene stands (la credencial no muestra nada de la ruta).
 */
export async function getPassRoute(passId: string, repo: Repo = getRepo()): Promise<PassRoute | null> {
  const view = await repo.getPassView(passId);
  if (!view) return null;
  const stands = await listStands(view.event.id);
  if (stands.length === 0) return null;
  const visits = new Map((await all("SELECT * FROM stand_visits WHERE pass_id = ?", passId)).map((r) => [str(r.stand_id), rowToVisit(r)]));
  const goal = await getRouteGoal(view.event.id);
  const target = effectiveTarget(goal, stands.length);
  const prizeBenefit = goal?.prizeBenefitId ? await repo.getBenefit(goal.prizeBenefitId) : null;
  let prize: PassRoute["prize"] = null;
  if (prizeBenefit) {
    const granted = view.benefits.some((b) => b.id === prizeBenefit.id);
    const redeemed = (await repo.listRedemptionsForPass(passId)).some((r) => r.benefitId === prizeBenefit.id);
    prize = { id: prizeBenefit.id, name: prizeBenefit.name, granted, redeemed };
  }
  const display = await displayOf(passId);
  return {
    eventId: view.event.id,
    target,
    visited: visits.size,
    total: stands.length,
    completed: target !== null && visits.size >= target,
    prize,
    stands: stands.map((s) => ({ id: s.id, name: s.name, logoUrl: s.logoUrl, visitedAt: visits.get(s.id)?.scannedAt ?? null, consent: visits.get(s.id)?.consent ?? null })),
    display: { alias: display?.alias ?? null, hidden: display?.hidden ?? false, shownAs: publicLabel(view.person.name, display) },
  };
}

/**
 * La respuesta de la persona a "¿querés compartir tu contacto con este stand?". Solo ella la da, desde su
 * credencial. "granted" muestra su nombre y su correo en la lista del auspiciante; "declined" los saca de ahí
 * (y se borran la calificación y la nota que le hubieran puesto). Se puede cambiar cuando quiera.
 */
export async function answerConsent(passId: string, standId: string, answer: unknown): Promise<StandVisit> {
  if (answer !== "granted" && answer !== "declined") throw new StandsError("invalid_answer");
  const row = await one("SELECT * FROM stand_visits WHERE pass_id = ? AND stand_id = ?", passId, standId);
  if (!row) throw new StandsError("no_visit");
  if (answer === "granted") {
    // Volver a decir que sí después de un "no" arranca limpio: la calificación y la nota se borraron con el "no" y
    // no vuelven, ni siquiera una que se haya colado justo entre retirar el permiso y borrar. Si ya era "sí", quedan.
    await run(
      `UPDATE stand_visits SET consent = 'granted', consent_at = ?,
         rating = CASE WHEN consent = 'granted' THEN rating END, note = CASE WHEN consent = 'granted' THEN note END
       WHERE id = ?`,
      now(),
      str(row.id),
    );
  } else {
    await run("UPDATE stand_visits SET consent = 'declined', consent_at = ?, rating = NULL, note = NULL WHERE id = ?", now(), str(row.id));
  }
  return rowToVisit((await one("SELECT * FROM stand_visits WHERE id = ?", str(row.id))) as Row);
}

/** Cómo quiere aparecer la persona en la pantalla del evento: con un alias, con su nombre de pila, o sin aparecer. */
export async function setDisplay(passId: string, input: { alias?: unknown; hidden?: unknown }): Promise<{ alias: string | null; hidden: boolean }> {
  const alias = cleanAlias(input.alias);
  const hidden = input.hidden === true;
  await run(
    `INSERT INTO route_display (pass_id, alias, hidden) VALUES (?, ?, ?)
     ON CONFLICT (pass_id) DO UPDATE SET alias = excluded.alias, hidden = excluded.hidden`,
    passId,
    alias,
    hidden,
  );
  return { alias, hidden };
}

/**
 * Quien organiza saca a una persona de la pantalla del evento (un alias que no va para proyectar): queda oculta y
 * el alias se borra. La persona puede volver a elegir cómo aparecer desde su credencial, y lo nuevo pasa por el
 * mismo filtro y la misma mirada. Solo un pase de este evento.
 */
export async function hideFromScreen(event: EventRecord, passId: string, repo: Repo = getRepo()): Promise<void> {
  const pass = await repo.getPass(passId);
  if (!pass || pass.eventId !== event.id) throw new StandsError("not_found");
  await run(
    `INSERT INTO route_display (pass_id, alias, hidden) VALUES (?, NULL, TRUE)
     ON CONFLICT (pass_id) DO UPDATE SET alias = NULL, hidden = TRUE`,
    pass.id,
  );
}

// ---------- El escáner del stand ----------

/**
 * Las visitas de un stand como las ve su escáner. El nombre aparece solo si la persona aceptó compartir su
 * contacto: sin eso, quien atiende el stand ve apenas una credencial y la hora. El escáner del stand nunca
 * recibe la lista de asistentes del evento.
 */
export async function standScanVisits(standId: string): Promise<ScanStandVisit[]> {
  return (
    await all(
    `SELECT v.pass_id, v.scanned_at, v.created_at, v.consent, per.name
     FROM stand_visits v JOIN passes p ON p.id = v.pass_id JOIN persons per ON per.id = p.person_id
     WHERE v.stand_id = ? ORDER BY v.scanned_at DESC`,
      standId,
    )
  ).map((r) => ({
    passId: str(r.pass_id),
    at: isReadableDate(r.scanned_at) ? r.scanned_at : str(r.created_at),
    consent: str(r.consent) as ConsentState,
    name: str(r.consent) === "granted" ? str(r.name) : null,
  }));
}

// ---------- El panel del auspiciante ----------

export interface StandContact {
  passId: string;
  name: string;
  email: string;
  visitedAt: string;
  consentAt: string | null;
  /** De 1 a 5, o null si todavía no la calificó. */
  rating: number | null;
  note: string;
}

export interface StandNumbers {
  /** Visitas verificadas: una por persona. */
  visits: number;
  /** Personas que aceptaron compartir su contacto. */
  accepted: number;
  /** Visitas cuya persona todavía no contestó. */
  waiting: number;
  declined: number;
}

export interface StandPanel {
  stand: Stand;
  event: { name: string; slug: string; startsAt: string; endsAt: string | null; timezone: string; place: string; venue: string | null };
  numbers: StandNumbers;
  /** El beneficio del auspiciante con sus canjes, si el stand tiene uno. */
  benefit: { id: string; name: string; granted: number; redeemed: number } | null;
  /** Solo quienes aceptaron. Quien no aceptó, o no contestó, no figura. */
  contacts: StandContact[];
  generatedAt: string;
}

async function standNumbers(standId: string): Promise<StandNumbers> {
  const rows = await all("SELECT consent, COUNT(*) AS n FROM stand_visits WHERE stand_id = ? GROUP BY consent", standId);
  const by = (consent: ConsentState) => num(rows.find((r) => str(r.consent) === consent)?.n ?? 0);
  return { visits: by("pending") + by("granted") + by("declined"), accepted: by("granted"), waiting: by("pending"), declined: by("declined") };
}

/** Lo que ve quien atiende el stand: sus números y los contactos de quienes aceptaron, con su calificación y su nota. */
export async function getStandPanel(standId: string, repo: Repo = getRepo()): Promise<StandPanel> {
  const stand = await getStand(standId);
  if (!stand) throw new StandsError("not_found");
  const event = await repo.getEventById(stand.eventId);
  if (!event) throw new StandsError("not_found");
  const contacts = (
    await all(
    `SELECT v.pass_id, v.scanned_at, v.created_at, v.consent_at, v.rating, v.note, per.name, per.email
     FROM stand_visits v JOIN passes p ON p.id = v.pass_id JOIN persons per ON per.id = p.person_id
     WHERE v.stand_id = ? AND v.consent = 'granted' ORDER BY v.scanned_at DESC`,
      standId,
    )
  ).map(
    (r): StandContact => ({
      passId: str(r.pass_id),
      name: str(r.name),
      email: str(r.email),
      visitedAt: isReadableDate(r.scanned_at) ? r.scanned_at : str(r.created_at),
      consentAt: strOrNull(r.consent_at),
      rating: r.rating === null || r.rating === undefined ? null : num(r.rating),
      note: strOrNull(r.note) ?? "",
    }),
  );
  return {
    stand,
    event: { name: event.name, slug: event.slug, startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone, place: event.place, venue: event.venue },
    numbers: await standNumbers(standId),
    benefit: (await getStandReport(standId, repo))?.benefit ?? null,
    contacts,
    generatedAt: now(),
  };
}

/**
 * La calificación (1 a 5) y la nota que escribe quien atiende el stand. Solo se puede sobre quien aceptó
 * compartir su contacto: sin permiso no hay nada que anotar. La escritura misma exige que el permiso siga dado:
 * si la persona lo retiró entre que se leyó la fila y se guardó la nota, no se guarda nada.
 */
export async function saveContactNote(standId: string, passId: string, input: { rating?: unknown; note?: unknown }): Promise<StandContact["rating"]> {
  const row = await one("SELECT * FROM stand_visits WHERE stand_id = ? AND pass_id = ?", standId, passId);
  if (!row) throw new StandsError("no_visit");
  if (str(row.consent) !== "granted") throw new StandsError("no_consent");
  let rating = row.rating === null || row.rating === undefined ? null : num(row.rating);
  let note = strOrNull(row.note) ?? "";
  if (input.rating !== undefined) {
    if (input.rating === null) rating = null;
    else if (typeof input.rating === "number" && Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5) rating = input.rating;
    else throw new StandsError("invalid_rating");
  }
  if (input.note !== undefined) {
    if (typeof input.note !== "string") throw new StandsError("invalid_note");
    note = cleanLine(input.note, NOTE_MAX);
  }
  const changed = await run("UPDATE stand_visits SET rating = ?, note = ? WHERE id = ? AND consent = 'granted'", rating, note || null, str(row.id));
  if (changed !== 1) throw new StandsError("no_consent");
  return rating;
}

/** El CSV de contactos del auspiciante: solo quienes aceptaron, con la misma neutralización de fórmulas que el CSV de quien organiza. */
export async function buildContactsCsv(standId: string, lang: Lang, repo: Repo = getRepo()): Promise<string> {
  const panel = await getStandPanel(standId, repo);
  const t = (key: string) => translate(lang, key);
  const header = ["nombre", "correo", "calificacion", "nota", "visita"].map((k) => t(`stands.csv.${k}`));
  const rows = panel.contacts.map((c) => [c.name, c.email, c.rating ?? "", c.note, c.visitedAt]);
  return `\ufeff${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

// ---------- El permiso para entrar con un código de stand ----------

export type StandAuth = { ok: true; access: StationAccess; stand: StationStand } | { ok: false; reason: "blocked" | "wrong"; retryAfterSeconds: number };

/**
 * Abre el panel de un stand con su código de puesto. Los códigos equivocados se cuentan por quién pide, con el
 * mismo freno que el escáner (stationCodeAttempts): probar a la fuerza no sirve. El código de la puerta o de una
 * mesa de canje no abre un stand.
 */
export async function authorizeStandCode(code: string, headers: { get(name: string): string | null }, repo: Repo = getRepo()): Promise<StandAuth> {
  const attempts = stationCodeAttempts();
  const key = clientKey(headers);
  const wait = await attempts.blockedFor(key);
  if (wait > 0) return { ok: false, reason: "blocked", retryAfterSeconds: Math.ceil(wait / 1000) };
  const access = await resolveStationCode(code, repo);
  if (!access || access.kind !== "stand" || !access.stand) {
    await attempts.note(key);
    return { ok: false, reason: "wrong", retryAfterSeconds: 0 };
  }
  return { ok: true, access, stand: access.stand };
}

// ---------- Los números para el informe ----------

export interface StandReport {
  standId: string;
  name: string;
  logoUrl: string | null;
  /** Visitas verificadas: la credencial es auténtica y cada persona cuenta una sola vez. */
  visits: number;
  /** El beneficio del auspiciante, con cuántos se otorgaron y cuántos se canjearon. Null si el stand no tiene. */
  benefit: { id: string; name: string; granted: number; redeemed: number } | null;
  /** Personas que aceptaron compartir su contacto (un número: nunca quiénes). */
  contactsAccepted: number;
  /** Visitas cuya persona todavía no contestó. */
  contactsWaiting: number;
  contactsDeclined: number;
  /** De las personas que visitaron este stand, cuántas completaron la ruta entera. */
  routeCompleted: number;
}

export interface StandsReport {
  generatedAt: string;
  eventId: string;
  route: {
    /** La meta ("4"), o null si el evento no fijó una. */
    target: number | null;
    standCount: number;
    /** Personas que visitaron al menos un stand. */
    participants: number;
    /** Personas que completaron la ruta. */
    completed: number;
    prize: { id: string; name: string; granted: number; redeemed: number } | null;
  };
  /** Un renglón por auspiciante, en el orden de los stands. */
  stands: StandReport[];
}

async function benefitCounts(benefitId: string): Promise<{ granted: number; redeemed: number }> {
  const granted = (
    await one("SELECT COUNT(*) AS n FROM pass_benefits pb JOIN passes p ON p.id = pb.pass_id WHERE pb.benefit_id = ? AND p.status != 'pending'", benefitId)
  )?.n;
  const redeemed = (await one("SELECT COUNT(DISTINCT pass_id) AS n FROM redemptions WHERE benefit_id = ? AND duplicate = FALSE", benefitId))?.n;
  return { granted: num(granted ?? 0), redeemed: num(redeemed ?? 0) };
}

/**
 * Los agregados de cada auspiciante y de la ruta, para el informe (el PDF de app/informes los toma de acá):
 * visitas verificadas, canjes de su beneficio, contactos que aceptaron y ruta completada. Solo números;
 * los contactos mismos los ve únicamente el auspiciante, en su panel.
 */
export async function getEventStandsReport(event: EventRecord, repo: Repo = getRepo()): Promise<StandsReport> {
  const stands = await listStands(event.id);
  const goal = await getRouteGoal(event.id);
  const target = effectiveTarget(goal, stands.length);
  const perPass = await all("SELECT pass_id, COUNT(*) AS n FROM stand_visits WHERE event_id = ? GROUP BY pass_id", event.id);
  const completedPasses = new Set(target === null ? [] : perPass.filter((r) => num(r.n) >= target).map((r) => str(r.pass_id)));

  const reports: StandReport[] = [];
  for (const stand of stands) {
    const numbers = await standNumbers(stand.id);
    const benefit = stand.benefitId ? await repo.getBenefit(stand.benefitId) : null;
    const visitors = (await all("SELECT pass_id FROM stand_visits WHERE stand_id = ?", stand.id)).map((r) => str(r.pass_id));
    reports.push({
      standId: stand.id,
      name: stand.name,
      logoUrl: stand.logoUrl,
      visits: numbers.visits,
      benefit: benefit ? { id: benefit.id, name: benefit.name, ...(await benefitCounts(benefit.id)) } : null,
      contactsAccepted: numbers.accepted,
      contactsWaiting: numbers.waiting,
      contactsDeclined: numbers.declined,
      routeCompleted: visitors.filter((passId) => completedPasses.has(passId)).length,
    });
  }
  const prize = goal?.prizeBenefitId ? await repo.getBenefit(goal.prizeBenefitId) : null;
  return {
    generatedAt: now(),
    eventId: event.id,
    route: {
      target,
      standCount: stands.length,
      participants: perPass.length,
      completed: completedPasses.size,
      prize: prize ? { id: prize.id, name: prize.name, ...(await benefitCounts(prize.id)) } : null,
    },
    stands: reports,
  };
}

/** Los agregados de un solo auspiciante. Null si el stand no existe. */
export async function getStandReport(standId: string, repo: Repo = getRepo()): Promise<StandReport | null> {
  const stand = await getStand(standId);
  if (!stand) return null;
  const event = await repo.getEventById(stand.eventId);
  if (!event) return null;
  return (await getEventStandsReport(event, repo)).stands.find((s) => s.standId === standId) ?? null;
}

// ---------- La pantalla de quien organiza ----------

export interface AdminStandRow extends Stand {
  /** El código con el que su gente abre el escáner y su panel. */
  code: string | null;
  report: StandReport;
}

/** Una fila de lo que hoy se proyecta, para quien organiza: con el pase, para poder sacarla de la pantalla. */
export interface AdminScreenRow {
  rank: number;
  passId: string;
  /** Lo que la sala ve: el alias o el nombre de pila; null si está oculta (se proyecta como anónima). */
  label: string | null;
  visited: number;
  hidden: boolean;
}

export interface AdminStandsState {
  generatedAt: string;
  event: { slug: string; name: string };
  /** La meta que fijó quien organiza (la guardada, aunque hoy haya menos stands) y el nombre del premio. */
  goal: { target: number; prizeName: string | null } | null;
  stands: AdminStandRow[];
  /** Lo que se puede regalar desde un stand: la merch y lo demás que no sea comida (la dieta no viaja a un stand) ni premio. */
  benefits: Array<{ id: string; name: string }>;
  route: StandsReport["route"];
  /** Quiénes están hoy en el ranking de la pantalla en vivo, con su pase, para sacar de la pantalla un alias que no va. */
  screen: AdminScreenRow[];
}

/** Todo lo que necesita la pantalla "Stands y ruta": cada stand con su código y sus números, la meta, el resumen de la ruta y lo que se proyecta. */
export async function getAdminStands(event: EventRecord, repo: Repo = getRepo()): Promise<AdminStandsState> {
  const codes = await ensureStationCodes(event, repo);
  const report = await getEventStandsReport(event, repo);
  const goal = await getRouteGoal(event.id);
  const prize = goal?.prizeBenefitId ? await repo.getBenefit(goal.prizeBenefitId) : null;
  return {
    generatedAt: report.generatedAt,
    event: { slug: event.slug, name: event.name },
    goal: goal ? { target: goal.target, prizeName: prize?.name ?? null } : null,
    stands: (await listStands(event.id)).map((stand) => ({
      ...stand,
      code: codes.find((c) => c.kind === "stand" && c.standId === stand.id)?.code ?? null,
      report: report.stands.find((r) => r.standId === stand.id) as StandReport,
    })),
    benefits: (await repo.listBenefits(event.id))
      .filter((b) => b.kind !== "prize" && !isFoodBenefit(b))
      .map((b) => ({ id: b.id, name: b.name })),
    route: report.route,
    screen: (await screenRows(event.id, LIVE_RANKING_SIZE)).map((r, i) => ({ rank: i + 1, passId: r.passId, label: r.label, visited: r.visited, hidden: r.hidden })),
  };
}

// ---------- El ranking de la ruta ----------

/** Cuántas filas del ranking muestra la pantalla en vivo (y ve quien organiza para moderarlas). */
export const LIVE_RANKING_SIZE = 8;

export interface RankingRow {
  /** 1 para quien lleva más stands; a igualdad, gana quien llegó antes. */
  rank: number;
  /** Nombre de pila o alias; null si la persona pidió no aparecer ("Anónimo" en pantalla). Nunca el correo. */
  label: string | null;
  visited: number;
  completed: boolean;
}

interface ScreenRow {
  passId: string;
  label: string | null;
  visited: number;
  hidden: boolean;
}

/** Las primeras personas de la ruta con lo que la pantalla muestra de cada una. El pase se queda del lado de quien organiza. */
async function screenRows(eventId: string, limit: number): Promise<ScreenRow[]> {
  // Lo que no se cuenta va también en GROUP BY: Postgres lo pide, y en SQLite no cambia nada (es uno por pase).
  const rows = await all(
    `SELECT v.pass_id, COUNT(*) AS n, MAX(v.scanned_at) AS last_at, per.name, d.alias, d.hidden
     FROM stand_visits v
     JOIN passes p ON p.id = v.pass_id JOIN persons per ON per.id = p.person_id
     LEFT JOIN route_display d ON d.pass_id = v.pass_id
     WHERE v.event_id = ? GROUP BY v.pass_id, per.name, d.alias, d.hidden ORDER BY n DESC, last_at ASC, v.pass_id LIMIT ?`,
    eventId,
    limit,
  );
  return rows.map((r) => {
    const display = r.alias === null && r.hidden === null ? null : { alias: strOrNull(r.alias), hidden: bool(r.hidden) };
    return { passId: str(r.pass_id), label: publicLabel(str(r.name), display), visited: num(r.n), hidden: display?.hidden ?? false };
  });
}

/** Los primeros de la ruta, para la pantalla del evento: sin el pase, solo lo que se proyecta. */
export async function routeRanking(eventId: string, limit = LIVE_RANKING_SIZE): Promise<RankingRow[]> {
  const target = effectiveTarget(await getRouteGoal(eventId), (await listStands(eventId)).length);
  return (await screenRows(eventId, limit)).map((r, i) => ({ rank: i + 1, label: r.label, visited: r.visited, completed: target !== null && r.visited >= target }));
}
