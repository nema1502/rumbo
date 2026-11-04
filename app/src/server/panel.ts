// El panel de quien organiza y el informe para quien auspicia, del lado del servidor: la clave con la
// que se entra al panel de cada evento, los códigos de puesto que reciben los voluntarios, los números
// que salen del espejo en la base y el contraste con la cadena (status, attendees e info del contrato).
// No importa nada de Next, así los scripts también lo pueden usar; lo que depende del pedido HTTP
// (la cookie, las respuestas) está en panel-sesion.ts. Las tablas propias están en migrations/003-panel.sql.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { translate, type Lang } from "../i18n/index.ts";
import type { CredentialKind } from "../lib/credential-kinds.ts";
import type { ScanVia } from "../lib/escaner-api.ts";
import { localLogoOrNull } from "../lib/logo.ts";
import { base32Encode, bytesToBase64url } from "../lib/qr-codec.ts";
import { STATION_CODE_LENGTH, isValidStationCode, normalizeStationCode } from "../lib/station-code.ts";
import { getDb, jsonParam, readJson, type Db } from "./base/index.ts";
import { describeForLog } from "./log.ts";
import { getEventPublicKey } from "./qr-keys.ts";
import {
  getRepo,
  type Benefit,
  type BenefitKind,
  type EventRecord,
  type GrantSource,
  type Pass,
  type PassStatus,
  type Repo,
} from "./repo.ts";
import { readContractCapacity, smallestCapacity } from "./evento/cupo.ts";
import { isPermanentContractError, rumboPass, type PassStatusOnChain } from "./stellar.ts";

// ---------- La base ----------
// Las tablas del panel (003-panel.sql) viven en la base de siempre (src/server/base), con el resto.

const now = () => new Date().toISOString();

/** Un registro del espejo que la cola del escáner todavía va a llevar al contrato: ni llegó, ni fue doble, ni lo rechazó el contrato para siempre. */
const isPendingSync = (row: { synced: boolean; duplicate: boolean; error: string | null }): boolean => !row.synced && !row.duplicate && !isPermanentContractError(row.error);

// ---------- La clave de organizador ----------

/** Quince bytes al azar: veinticuatro letras y números en base32. */
const ORGANIZER_KEY_BYTES = 15;

/** La clave con la que se entra al panel del evento. La crea la primera vez que hace falta. */
export async function getOrCreateOrganizerKey(eventId: string): Promise<string> {
  const db = getDb();
  const select = async () => (await db.one("SELECT key FROM organizer_keys WHERE event_id = ?", [eventId]))?.key as string | undefined;
  const found = await select();
  if (found) return found;
  // Si dos pedidos llegan a la vez, gana el primero y el otro lee la clave que quedó.
  const key = base32Encode(new Uint8Array(randomBytes(ORGANIZER_KEY_BYTES)));
  await db.run("INSERT INTO organizer_keys (event_id, key, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", [eventId, key, now()]);
  return (await select()) as string;
}

/** Si la clave abre el panel de ese evento. Se compara sin que el tiempo delate en qué letra difiere. */
export async function verifyOrganizerKey(eventId: string, key: string | null | undefined): Promise<boolean> {
  if (!key) return false;
  const expected = Buffer.from(await getOrCreateOrganizerKey(eventId), "utf8");
  const given = Buffer.from(key.trim().toUpperCase(), "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ---------- Los códigos de puesto ----------
// Un código por puesto: la puerta y una mesa por beneficio. Quien organiza los ve en el panel y se
// los pasa a cada voluntario; el escáner abre el puesto con el suyo (src/server/escaner.ts usa
// resolveStationCode) y recibe la clave pública del evento para verificar las credenciales sin red.

export type StationKind = "gate" | "benefit" | "stand";

export interface StationCode {
  /** Doce letras y números, sin guiones. La interfaz lo muestra como "ABCD-EFGH-JKLM" (src/lib/station-code.ts). */
  code: string;
  eventId: string;
  kind: StationKind;
  /** El beneficio que se canjea en el puesto, o null si es la puerta o un stand. */
  benefitId: string | null;
  /** El stand de quien auspicia, si el puesto es un stand (src/server/stands.ts). */
  standId: string | null;
  createdAt: string;
}

/** Un código de puesto con cómo se llama y dónde está, para mostrarlo. */
export interface PanelStation extends StationCode {
  /** El nombre del beneficio; null para la puerta (la interfaz pone "Puerta") y para un stand. */
  benefitName: string | null;
  /** El nombre de quien auspicia, si el puesto es un stand. */
  standName: string | null;
  /** Dónde se canjea, si el beneficio lo dice ("Mesa del almuerzo"). */
  station: string | null;
}

/** El stand que abre un código de puesto de tipo "stand". */
export interface StationStand {
  id: string;
  name: string;
  logoUrl: string | null;
}

/** Lo que recibe el escáner cuando un voluntario abre su puesto con el código. */
export interface StationAccess {
  event: EventRecord;
  kind: StationKind;
  benefit: Benefit | null;
  /** El stand, si el código es de un stand; si no, null. */
  stand: StationStand | null;
  /** El catálogo entero del evento, para que el escáner sepa qué puede ver en una credencial. */
  benefits: Benefit[];
  /** La clave pública del evento en base64url: con ella el escáner verifica los QR sin red (la privada no sale del servidor). */
  publicKey: string;
}

const rowToStation = (row: Record<string, unknown>): StationCode => ({
  code: String(row.code),
  eventId: String(row.event_id),
  kind: String(row.kind) as StationKind,
  benefitId: row.benefit_id === null || row.benefit_id === undefined ? null : String(row.benefit_id),
  standId: row.stand_id === null || row.stand_id === undefined ? null : String(row.stand_id),
  createdAt: String(row.created_at),
});

/** Ocho bytes al azar dan trece letras en base32: se usan las primeras doce, sesenta bits. */
async function newStationCode(db: Db): Promise<string> {
  for (;;) {
    const code = base32Encode(new Uint8Array(randomBytes(8))).slice(0, STATION_CODE_LENGTH);
    if (!(await db.one("SELECT 1 AS yes FROM station_codes WHERE code = ?", [code]))) return code;
  }
}

export async function listStationCodes(eventId: string): Promise<StationCode[]> {
  const rows = await getDb().all("SELECT * FROM station_codes WHERE event_id = ? ORDER BY CASE kind WHEN 'gate' THEN 0 WHEN 'benefit' THEN 1 ELSE 2 END, created_at", [eventId]);
  return rows.map(rowToStation);
}

/** Los códigos de puesto del evento, uno para la puerta, uno por beneficio y uno por stand. Crea los que falten. */
export async function ensureStationCodes(event: EventRecord, repo: Repo = getRepo()): Promise<StationCode[]> {
  const db = getDb();
  const existing = await listStationCodes(event.id);
  // ON CONFLICT: si dos pedidos abren el panel a la vez, el segundo no choca con el código que ya creó el primero.
  const insert = async (kind: StationKind, benefitId: string | null, standId: string | null) =>
    db.run("INSERT INTO station_codes (code, event_id, kind, benefit_id, stand_id, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING", [
      await newStationCode(db),
      event.id,
      kind,
      benefitId,
      standId,
      now(),
    ]);
  if (!existing.some((c) => c.kind === "gate")) await insert("gate", null, null);
  for (const benefit of await repo.listBenefits(event.id)) {
    if (!existing.some((c) => c.kind === "benefit" && c.benefitId === benefit.id)) await insert("benefit", benefit.id, null);
  }
  // Los stands (src/server/stands.ts) viven en su propia tabla: acá solo se lee el id.
  const stands = await db.all("SELECT id FROM stands WHERE event_id = ? ORDER BY sort_order, created_at", [event.id]);
  for (const stand of stands) {
    if (!existing.some((c) => c.kind === "stand" && c.standId === stand.id)) await insert("stand", null, String(stand.id));
  }
  return listStationCodes(event.id);
}

/**
 * Un código de puesto nuevo en lugar del dado (si se filtró, o cambió quien atiende): el viejo deja de abrir el
 * escáner en el acto (y con él, la sesión de cualquier celular que lo tuviera abierto), y el puesto queda con uno
 * nuevo. Solo un código de este evento. Devuelve el código nuevo, o null si el dado no era de este evento.
 */
export async function regenerateStationCode(event: EventRecord, input: string, repo: Repo = getRepo()): Promise<StationCode | null> {
  const code = normalizeStationCode(input);
  if (!isValidStationCode(code)) return null;
  const db = getDb();
  const row = await db.one("SELECT * FROM station_codes WHERE code = ? AND event_id = ?", [code, event.id]);
  if (!row) return null;
  const old = rowToStation(row);
  await db.run("DELETE FROM station_codes WHERE code = ? AND event_id = ?", [code, event.id]);
  const fresh = await ensureStationCodes(event, repo);
  return fresh.find((c) => c.kind === old.kind && c.benefitId === old.benefitId && c.standId === old.standId) ?? null;
}

/** Para el escáner: a qué evento y puesto corresponde lo que escribió el voluntario, o null. */
export async function resolveStationCode(input: string, repo: Repo = getRepo()): Promise<StationAccess | null> {
  const code = normalizeStationCode(input);
  if (!isValidStationCode(code)) return null;
  const db = getDb();
  const row = await db.one("SELECT * FROM station_codes WHERE code = ?", [code]);
  if (!row) return null;
  const station = rowToStation(row);
  const event = await repo.getEventById(station.eventId);
  if (!event) return null;
  const benefits = await repo.listBenefits(event.id);
  const benefit = station.benefitId ? (benefits.find((b) => b.id === station.benefitId) ?? null) : null;
  let stand: StationStand | null = null;
  if (station.kind === "stand") {
    const standRow = await db.one("SELECT id, name, logo_url FROM stands WHERE id = ?", [station.standId]);
    if (!standRow) return null;
    stand = { id: String(standRow.id), name: String(standRow.name), logoUrl: localLogoOrNull(standRow.logo_url) };
  }
  return { event, kind: station.kind, benefit, stand, benefits, publicKey: bytesToBase64url(await getEventPublicKey(event.id)) };
}

// ---------- El estado del panel ----------

export interface PanelEvent {
  id: string;
  slug: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  place: string;
  venue: string | null;
  organizerName: string;
  capacity: number | null;
}

export interface PanelPassBenefit {
  benefitId: string;
  name: string;
  kind: BenefitKind;
  source: GrantSource;
  redeemed: boolean;
  /** Si algún escáner intentó canjearlo de nuevo. */
  duplicate: boolean;
}

export interface PanelPass {
  id: string;
  name: string;
  ticketTypeId: string;
  ticketTypeName: string;
  /** Quién es en el evento: asistente, jurado, mentoría... */
  kind: CredentialKind;
  /** El equipo, si el evento se inscribe por equipos. */
  team: string | null;
  status: PassStatus;
  /** Si el pase tiene cuenta en la cadena (y por eso se puede contrastar). */
  onChain: boolean;
  createdAt: string;
  checkedInAt: string | null;
  /** Si aceptó que la comunidad le escriba (la casilla opcional de la inscripción). */
  contactConsent: boolean;
  benefits: PanelPassBenefit[];
}

export interface PanelDuplicate {
  id: string;
  kind: "checkin" | "redemption";
  passId: string;
  name: string;
  benefitName: string | null;
  scannedAt: string;
  scannerId: string | null;
  /** El puesto donde se registró (la mesa del beneficio); null si no se sabe. La puerta la pone la pantalla. */
  station: string | null;
  /** Cómo se leyó la credencial (el QR del celular, el impreso, a mano); null si el registro es de antes o vino de la cadena. */
  via: ScanVia | null;
}

export interface Tally {
  granted: number;
  redeemed: number;
}

export interface PanelCounters {
  /** Credenciales emitidas: pases activos o que ya entraron. */
  issued: number;
  /** Pases que todavía no se activaron (el pago no terminó). */
  pending: number;
  capacity: number | null;
  checkedIn: number;
  lunch: Tally;
  prizes: Tally;
}

export interface PanelBenefitRow {
  id: string;
  name: string;
  kind: BenefitKind;
  station: string | null;
  granted: number;
  redeemed: number;
  duplicates: number;
  /** Cuántos hay en total (150 poleras), o null si no hay tope. */
  stock: number | null;
  /** Cuántos quedan: el stock menos lo canjeado, nunca menos que cero. Null si no hay tope. */
  remaining: number | null;
  /** Por cuántos se pasó el tope (dos mesas sin red que entregaron de más). Cero si no hay tope o no se pasó. */
  exceeded: number;
}

export interface PanelTicketTypeRow {
  id: string;
  name: string;
  priceUsdc: number;
  issued: number;
  pending: number;
}

export interface PanelState {
  generatedAt: string;
  event: PanelEvent;
  counters: PanelCounters;
  /** Entradas y canjes que un escáner registró y todavía no llegaron al contrato. */
  pendingSync: number;
  ticketTypes: PanelTicketTypeRow[];
  benefits: PanelBenefitRow[];
  passes: PanelPass[];
  duplicates: PanelDuplicate[];
  /** Los códigos de puesto para los voluntarios: la puerta y una mesa por beneficio. */
  stations: PanelStation[];
  lastChainSync: ChainSyncSummary | null;
}

function toPanelEvent(event: EventRecord): PanelEvent {
  const { id, slug, name, startsAt, endsAt, timezone, place, venue, organizerName, capacity } = event;
  return { id, slug, name, startsAt, endsAt, timezone, place, venue, organizerName, capacity };
}

interface Collected {
  state: PanelState;
  /** El correo de cada pase, solo para el CSV. Nunca va al JSON del panel ni al informe. */
  emails: Map<string, string>;
}

async function collect(event: EventRecord, repo: Repo): Promise<Collected> {
  // Todo por lote: el panel se pide cada cinco segundos, y con trescientas credenciales no puede costar seiscientas consultas.
  const [ticketTypes, benefits, withPerson, granted, checkIns, redemptions, passTeams] = await Promise.all([
    repo.listTicketTypes(event.id),
    repo.listBenefits(event.id),
    repo.listPassesWithPerson(event.id),
    repo.listPassBenefitsByEvent(event.id),
    repo.listCheckIns(event.id),
    repo.listRedemptions(event.id),
    repo.listPassTeams(event.id),
  ]);
  const teamOf = new Map(passTeams.map((p) => [p.passId, p.team.name] as const));
  const passes = withPerson.map((w) => w.pass);
  const persons = new Map(withPerson.map((w) => [w.pass.id, w.person] as const));
  const benefitById = new Map(benefits.map((b) => [b.id, b]));
  const ticketTypeById = new Map(ticketTypes.map((t) => [t.id, t]));

  // Un canje está hecho si alguna fila del espejo no es doble; es doble si alguna lo es.
  const redeemed = new Set<string>();
  const duplicated = new Set<string>();
  for (const r of redemptions) (r.duplicate ? duplicated : redeemed).add(`${r.passId}:${r.benefitId}`);

  const emails = new Map<string, string>();
  const panelPasses: PanelPass[] = passes.map((pass) => {
    const person = persons.get(pass.id);
    if (person) emails.set(pass.id, person.email);
    return {
      id: pass.id,
      name: person?.name ?? "",
      ticketTypeId: pass.ticketTypeId,
      ticketTypeName: ticketTypeById.get(pass.ticketTypeId)?.name ?? "",
      kind: ticketTypeById.get(pass.ticketTypeId)?.credentialKind ?? "attendee",
      team: teamOf.get(pass.id) ?? null,
      status: pass.status,
      onChain: Boolean(pass.account),
      createdAt: pass.createdAt,
      checkedInAt: pass.checkedInAt,
      contactConsent: pass.contactConsent,
      benefits: (granted.get(pass.id) ?? []).map((b) => ({
        benefitId: b.id,
        name: b.name,
        kind: b.kind,
        source: b.source,
        redeemed: redeemed.has(`${pass.id}:${b.id}`),
        duplicate: duplicated.has(`${pass.id}:${b.id}`),
      })),
    };
  });
  panelPasses.sort((a, b) => a.name.localeCompare(b.name, "es") || a.createdAt.localeCompare(b.createdAt));

  // Lo otorgado se cuenta sobre las credenciales emitidas: un pase pendiente de pago todavía no tiene su almuerzo.
  const issuedPasses = panelPasses.filter((p) => p.status !== "pending");
  const benefitRows: PanelBenefitRow[] = benefits.map((b) => {
    const redeemedCount = panelPasses.filter((p) => p.benefits.some((pb) => pb.benefitId === b.id && pb.redeemed)).length;
    return {
      id: b.id,
      name: b.name,
      kind: b.kind,
      station: b.station,
      granted: issuedPasses.filter((p) => p.benefits.some((pb) => pb.benefitId === b.id)).length,
      redeemed: redeemedCount,
      duplicates: redemptions.filter((r) => r.duplicate && r.benefitId === b.id).length,
      stock: b.stock,
      remaining: b.stock === null ? null : Math.max(0, b.stock - redeemedCount),
      exceeded: b.stock === null ? 0 : Math.max(0, redeemedCount - b.stock),
    };
  });
  const tally = (kind: BenefitKind): Tally =>
    benefitRows
      .filter((b) => b.kind === kind)
      .reduce((acc, b) => ({ granted: acc.granted + b.granted, redeemed: acc.redeemed + b.redeemed }), { granted: 0, redeemed: 0 });

  const ticketTypeRows: PanelTicketTypeRow[] = ticketTypes.map((t) => ({
    id: t.id,
    name: t.name,
    priceUsdc: t.priceUsdc,
    issued: panelPasses.filter((p) => p.ticketTypeId === t.id && p.status !== "pending").length,
    pending: panelPasses.filter((p) => p.ticketTypeId === t.id && p.status === "pending").length,
  }));

  const nameOf = (passId: string) => persons.get(passId)?.name ?? passId;
  const duplicates: PanelDuplicate[] = [
    ...checkIns
      .filter((c) => c.duplicate)
      .map((c) => ({ id: c.id, kind: "checkin" as const, passId: c.passId, name: nameOf(c.passId), benefitName: null, scannedAt: c.scannedAt, scannerId: c.scannerId, station: null, via: c.via })),
    ...redemptions
      .filter((r) => r.duplicate)
      .map((r) => ({
        id: r.id,
        kind: "redemption" as const,
        passId: r.passId,
        name: nameOf(r.passId),
        benefitName: benefitById.get(r.benefitId)?.name ?? null,
        scannedAt: r.scannedAt,
        scannerId: r.scannerId,
        station: benefitById.get(r.benefitId)?.station ?? null,
        via: r.via,
      })),
  ].sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));

  const standNames = new Map((await getDb().all("SELECT id, name FROM stands WHERE event_id = ?", [event.id])).map((s) => [String(s.id), String(s.name)]));
  const stations: PanelStation[] = (await listStationCodes(event.id)).map((c) => {
    const benefit = c.benefitId ? benefitById.get(c.benefitId) : undefined;
    return { ...c, benefitName: benefit?.name ?? null, standName: c.standId ? (standNames.get(c.standId) ?? null) : null, station: benefit?.station ?? null };
  });

  // "de 200 lugares": el cupo de la base, o el del contrato si es menor (se recuerda un minuto, no se lee en cada pedido).
  const capacity = smallestCapacity(event.capacity, ...(await Promise.all(ticketTypes.map((t) => readContractCapacity(t.contractId ?? event.contractId)))));

  const state: PanelState = {
    generatedAt: now(),
    event: toPanelEvent(event),
    counters: {
      issued: issuedPasses.length,
      pending: panelPasses.length - issuedPasses.length,
      capacity,
      checkedIn: panelPasses.filter((p) => p.status === "checked_in").length,
      lunch: tally("lunch"),
      prizes: tally("prize"),
    },
    // Lo que la cola del escáner todavía va a mandar. Lo que el contrato rechazó para siempre no está pendiente.
    pendingSync: checkIns.filter(isPendingSync).length + redemptions.filter(isPendingSync).length,
    ticketTypes: ticketTypeRows,
    benefits: benefitRows,
    passes: panelPasses,
    duplicates,
    stations,
    lastChainSync: await getLastChainSync(event.id),
  };
  return { state, emails };
}

/** Todo lo que el panel muestra, leído del espejo en la base. */
export async function getPanelState(event: EventRecord, repo: Repo = getRepo()): Promise<PanelState> {
  return (await collect(event, repo)).state;
}

// ---------- El informe para quien auspicia ----------

/** Números, nunca personas. */
export interface SponsorReport {
  generatedAt: string;
  event: PanelEvent;
  issued: number;
  /** El cupo que se muestra: el de la base, o el del contrato si es menor. Null si no hay cupo fijado. */
  capacity: number | null;
  checkedIn: number;
  ticketTypes: PanelTicketTypeRow[];
  benefits: PanelBenefitRow[];
  /** El beneficio que abre el informe: el almuerzo, o el primero del catálogo. */
  headline: PanelBenefitRow | null;
  /** Intentos de canjear o entrar de nuevo que se rechazaron. */
  duplicatesRejected: number;
}

export async function getSponsorReport(event: EventRecord, repo: Repo = getRepo()): Promise<SponsorReport> {
  const state = await getPanelState(event, repo);
  return {
    generatedAt: state.generatedAt,
    event: state.event,
    issued: state.counters.issued,
    capacity: state.counters.capacity,
    checkedIn: state.counters.checkedIn,
    ticketTypes: state.ticketTypes,
    benefits: state.benefits,
    headline: state.benefits.find((b) => b.kind === "lunch") ?? state.benefits[0] ?? null,
    duplicatesRejected: state.duplicates.length,
  };
}

// ---------- El CSV ----------

/** Cómo empieza una celda que una hoja de cálculo toma como fórmula: =, +, -, @, una tabulación o un retorno. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Una celda del CSV. El nombre y el correo los escribe quien se inscribe, y un "=HYPERLINK(...)" o un
 * "=cmd|..." se ejecutaría como fórmula al abrir el CSV en Excel o en Sheets, en la computadora de quien
 * organiza. Al texto que empieza así se le antepone una comilla simple, que la hoja muestra como texto;
 * después se entrecomilla si lleva comas, comillas, punto y coma o saltos de línea.
 */
export function csvCell(value: string | number): string {
  if (typeof value === "number") return String(value);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** La lista de pases para quien organiza: pase, nombre, correo, entrada, estado y canjes. Con marca de orden para que Excel lo abra en UTF-8. */
export async function buildPassesCsv(event: EventRecord, lang: Lang, repo: Repo = getRepo()): Promise<string> {
  const { state, emails } = await collect(event, repo);
  const t = (key: string) => translate(lang, key);
  const statusLabel: Record<PassStatus, string> = {
    pending: t("panel.pase.pendiente"),
    active: t("panel.pase.activo"),
    checked_in: t("panel.pase.entro"),
  };
  const benefitLabel = (b: PanelPassBenefit) =>
    `${b.name}: ${b.redeemed ? t("panel.csv.canjeado") : b.source === "raffle" ? t("panel.csv.ganado") : t("panel.csv.pendiente")}`;
  const header = ["pase", "nombre", "correo", "entrada", "estado", "canjes"].map((k) => t(`panel.csv.${k}`));
  const rows = state.passes.map((p) => [p.id, p.name, emails.get(p.id) ?? "", p.ticketTypeName, statusLabel[p.status], p.benefits.map(benefitLabel).join("; ")]);
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/**
 * Quienes aceptaron que la comunidad que organiza les escriba (la casilla opcional de la inscripción),
 * con su correo. Solo las credenciales emitidas: una inscripción que no terminó no cuenta. Lo usa el
 * paquete para el programa de embajadores; nunca va al JSON del panel ni al informe.
 */
export async function listChapterContacts(event: EventRecord, repo: Repo = getRepo()): Promise<Array<{ passId: string; name: string; email: string }>> {
  const { state, emails } = await collect(event, repo);
  return state.passes
    .filter((p) => p.status !== "pending" && p.contactConsent && emails.has(p.id))
    .map((p) => ({ passId: p.id, name: p.name, email: emails.get(p.id) as string }));
}

/** El CSV de esos contactos: nombre y correo, sin fórmulas, con marca de orden para Excel. */
export async function buildChapterContactsCsv(event: EventRecord, lang: Lang, repo: Repo = getRepo()): Promise<string> {
  const t = (key: string) => translate(lang, key);
  const header = [t("panel.csv.nombre"), t("panel.csv.correo")];
  const rows = (await listChapterContacts(event, repo)).map((c) => [c.name, c.email]);
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

// ---------- El contraste con la cadena ----------

/** Quién figura como escáner en lo que el contraste trae de la cadena. */
export const CHAIN_SCANNER_ID = "cadena";
const CHAIN_CONCURRENCY = 4;

export type ChainMismatchReason = "no_pass_on_chain" | "checked_in_only_in_mirror" | "redeemed_only_in_mirror" | "unknown_benefit";

export interface ChainMismatch {
  passId: string;
  reason: ChainMismatchReason;
  detail: string | null;
}

export interface ChainContractSummary {
  contractId: string;
  /** Los tipos de entrada que viven en ese contrato. */
  label: string;
  issued: number;
  checkedIn: number;
  attendees: number;
  /** Cuántos de los que entraron según la cadena son pases de este espejo. */
  knownAttendees: number;
  error: string | null;
}

export interface ChainSyncSummary {
  syncedAt: string;
  durationMs: number;
  contracts: ChainContractSummary[];
  /** Pases con cuenta que se consultaron uno por uno (status). */
  passesChecked: number;
  /** Entradas y canjes que estaban en la cadena y faltaban en el espejo: se agregaron. */
  checkInsAdded: number;
  redemptionsAdded: number;
  /** Pases a los que se les corrigió el estado o el número de pase. */
  passesFixed: number;
  /** Registros del espejo que todavía no llegaron a la cadena (la cola del escáner los va a mandar). */
  pendingSync: number;
  /** Cuentas que entraron según la cadena y no son de ningún pase del espejo. */
  unknownOnChain: number;
  mismatches: ChainMismatch[];
  errors: string[];
}

/**
 * Lo que el resumen dice de una consulta que falló. El detalle (direcciones del RPC, texto del SDK) va al
 * registro del servidor y no al panel, que solo necesita saber que no se pudo.
 */
export const CHAIN_UNAVAILABLE = "unavailable";

function logChainError(what: string, error: unknown): void {
  console.error(`[panel] No se pudo consultar la cadena (${what}): ${describeForLog(error)}`);
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function saveChainSync(eventId: string, summary: ChainSyncSummary): Promise<void> {
  const db = getDb();
  await db.run(`INSERT INTO chain_syncs (id, event_id, synced_at, summary) VALUES (?, ?, ?, ${jsonParam(db)})`, [randomUUID(), eventId, summary.syncedAt, JSON.stringify(summary)]);
}

export async function getLastChainSync(eventId: string): Promise<ChainSyncSummary | null> {
  const row = await getDb().one("SELECT summary FROM chain_syncs WHERE event_id = ? ORDER BY synced_at DESC LIMIT 1", [eventId]);
  return row ? readJson<ChainSyncSummary>(row.summary) : null;
}

/**
 * Lee la cadena y la compara con el espejo. La cadena es la que garantiza "una sola vez", así que lo
 * que ella dice que pasó y acá falta se agrega (entradas, canjes, el número de pase); lo que acá figura
 * y en la cadena no, o está por sincronizar (lo manda la cola del escáner) o es una diferencia para revisar.
 */
export async function refreshFromChain(event: EventRecord, repo: Repo = getRepo()): Promise<ChainSyncSummary> {
  const started = Date.now();
  const [ticketTypes, passes] = await Promise.all([repo.listTicketTypes(event.id), repo.listPasses(event.id)]);
  const contractOf = (pass: Pass): string | null => ticketTypes.find((t) => t.id === pass.ticketTypeId)?.contractId ?? event.contractId;
  const contractIds = [...new Set([...ticketTypes.map((t) => t.contractId), event.contractId].filter((c): c is string => Boolean(c)))];
  const accounts = new Set(passes.map((p) => p.account).filter(Boolean));
  const summary: ChainSyncSummary = {
    syncedAt: "",
    durationMs: 0,
    contracts: [],
    passesChecked: 0,
    checkInsAdded: 0,
    redemptionsAdded: 0,
    passesFixed: 0,
    pendingSync: 0,
    unknownOnChain: 0,
    mismatches: [],
    errors: [],
  };

  for (const contractId of contractIds) {
    const label = ticketTypes.filter((t) => (t.contractId ?? event.contractId) === contractId).map((t) => t.name).join(", ") || event.name;
    try {
      const [info, attendees] = await Promise.all([rumboPass.info(contractId), rumboPass.attendees(contractId)]);
      const known = attendees.filter((a) => accounts.has(a)).length;
      summary.contracts.push({ contractId, label, issued: info.issued, checkedIn: info.checked_in, attendees: attendees.length, knownAttendees: known, error: null });
      summary.unknownOnChain += attendees.length - known;
    } catch (error) {
      logChainError(`contrato ${contractId}`, error);
      summary.contracts.push({ contractId, label, issued: 0, checkedIn: 0, attendees: 0, knownAttendees: 0, error: CHAIN_UNAVAILABLE });
      summary.errors.push(`${label}: ${CHAIN_UNAVAILABLE}`);
    }
  }

  const withAccount = passes.filter((p) => p.account && contractOf(p));
  await mapLimit(withAccount, CHAIN_CONCURRENCY, async (pass) => {
    let status: PassStatusOnChain;
    try {
      status = await rumboPass.status(contractOf(pass) as string, pass.account as string);
    } catch (error) {
      logChainError(`pase ${pass.id}`, error);
      summary.errors.push(`${pass.id}: ${CHAIN_UNAVAILABLE}`);
      return;
    }
    summary.passesChecked++;
    await reconcilePass(pass, status, repo, summary);
  });

  summary.syncedAt = now();
  summary.durationMs = Date.now() - started;
  await saveChainSync(event.id, summary);
  return summary;
}

async function reconcilePass(pass: Pass, status: PassStatusOnChain, repo: Repo, summary: ChainSyncSummary): Promise<void> {
  if (!status.has_pass) {
    if (pass.status !== "pending") summary.mismatches.push({ passId: pass.id, reason: "no_pass_on_chain", detail: null });
    return;
  }

  // El pase existe en la cadena: el espejo tiene que decir al menos "activo" y tener su número.
  const patch: { status?: PassStatus; chainNumber?: number } = {};
  if (pass.status === "pending") patch.status = "active";
  if (status.number > 0 && pass.chainNumber !== status.number) patch.chainNumber = status.number;
  if (status.checked_in && pass.status !== "checked_in") patch.status = "checked_in";
  if (Object.keys(patch).length > 0) {
    await repo.updatePass(pass.id, patch);
    summary.passesFixed++;
  }

  const [checkIns, redemptions, ticketBenefits] = await Promise.all([
    repo.listCheckInsForPass(pass.id),
    repo.listRedemptionsForPass(pass.id),
    repo.listTicketTypeBenefits(pass.ticketTypeId),
  ]);

  if (status.checked_in) {
    const real = checkIns.filter((c) => !c.duplicate);
    if (real.length === 0) {
      const added = await repo.recordCheckIn({ clientId: `chain:${pass.id}:checkin`, eventId: pass.eventId, passId: pass.id, scannerId: CHAIN_SCANNER_ID });
      await repo.markCheckIn(added.id, { synced: true });
      summary.checkInsAdded++;
    } else {
      for (const c of real.filter((c) => !c.synced)) await repo.markCheckIn(c.id, { synced: true });
    }
  } else if (pass.status === "checked_in") {
    if (checkIns.some(isPendingSync)) summary.pendingSync++;
    else summary.mismatches.push({ passId: pass.id, reason: "checked_in_only_in_mirror", detail: null });
  }

  const realRedemptions = redemptions.filter((r) => !r.duplicate);
  for (const index of status.redeemed) {
    const benefit = ticketBenefits.find((b) => b.chainIndex === index);
    if (!benefit) {
      summary.mismatches.push({ passId: pass.id, reason: "unknown_benefit", detail: String(index) });
      continue;
    }
    const mine = realRedemptions.filter((r) => r.benefitId === benefit.id);
    if (mine.length === 0) {
      await repo.grantBenefit(pass.id, benefit.id, "ticket");
      const added = await repo.recordRedemption({
        clientId: `chain:${pass.id}:${benefit.id}`,
        eventId: pass.eventId,
        passId: pass.id,
        benefitId: benefit.id,
        scannerId: CHAIN_SCANNER_ID,
      });
      await repo.markRedemption(added.id, { synced: true });
      summary.redemptionsAdded++;
    } else {
      for (const r of mine.filter((r) => !r.synced)) await repo.markRedemption(r.id, { synced: true });
    }
  }
  for (const r of realRedemptions) {
    const benefit = ticketBenefits.find((b) => b.id === r.benefitId);
    if (!benefit || status.redeemed.includes(benefit.chainIndex)) continue;
    if (isPendingSync(r)) summary.pendingSync++;
    else summary.mismatches.push({ passId: pass.id, reason: "redeemed_only_in_mirror", detail: benefit.name });
  }
}
