// El escáner del voluntario, del lado del servidor: abrir un puesto con su código (los códigos los
// emite el panel de quien organiza, src/server/panel.ts: uno por puesto), lo que el escáner baja
// (la llave del evento, su puesto y los pases con lo que traen y lo que ya usaron) y la
// sincronización de la cola: cada entrada y cada canje al contrato, firmados por la cuenta de
// puerta, con su espejo en la base. Lo usan las rutas de /api/scan.
import type { ScanEvent, ScanItem, ScanItemResult, ScanItemStatus, ScanPassInfo, ScanSnapshot, ScanStation } from "../lib/escaner-api.ts";
import { GATE_STATION } from "../lib/escaner-api.ts";
import { isValidPassId } from "../lib/qr-codec.ts";
import { resolveStationCode, type StationAccess } from "./panel.ts";
import type { EventRecord, PassView, Repo } from "./repo.ts";
import { PERMANENT_CONTRACT_ERRORS, isContractError, rumboPass } from "./stellar.ts";

// ---------- El puesto y lo que baja el escáner ----------

/** El puesto que abre un código: la puerta, o la mesa de su beneficio. */
export function stationOf(access: StationAccess): ScanStation {
  if (access.kind === "benefit" && access.benefit) {
    return { id: access.benefit.id, kind: "benefit", name: access.benefit.name, place: access.benefit.station };
  }
  return GATE_STATION;
}

/** Los puestos de un evento: la puerta y una mesa por cada beneficio que alguna entrada trae en el contrato. */
export async function scanStations(repo: Repo, eventId: string): Promise<ScanStation[]> {
  const [benefits, ticketTypes] = await Promise.all([repo.listBenefits(eventId), repo.listTicketTypes(eventId)]);
  const onChain = new Set<string>();
  for (const ticketType of ticketTypes) {
    for (const benefit of await repo.listTicketTypeBenefits(ticketType.id)) onChain.add(benefit.id);
  }
  const stations: ScanStation[] = [GATE_STATION];
  for (const benefit of benefits) {
    if (onChain.has(benefit.id)) stations.push({ id: benefit.id, kind: "benefit", name: benefit.name, place: benefit.station });
  }
  return stations;
}

function toScanEvent(event: EventRecord, stations: ScanStation[]): ScanEvent {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    startsAt: event.startsAt,
    timezone: event.timezone,
    place: event.venue ? `${event.venue}, ${event.place}` : event.place,
    stations,
  };
}

/**
 * Todo lo que el escáner necesita para decidir sin red: la llave del evento, su puesto y cada pase
 * activo con su nombre, sus beneficios, si ya entró y qué ya canjeó (según el espejo: lo que algún
 * escáner ya subió, aunque todavía no haya llegado al contrato).
 */
export async function buildSnapshot(repo: Repo, access: StationAccess): Promise<ScanSnapshot> {
  const event = access.event;
  const [stations, passes, checkIns, redemptions] = await Promise.all([
    scanStations(repo, event.id),
    repo.listPasses(event.id),
    repo.listCheckIns(event.id),
    repo.listRedemptions(event.id),
  ]);

  const checkedIn = new Map<string, string>();
  for (const checkIn of checkIns) {
    const previous = checkedIn.get(checkIn.passId);
    if (!previous || checkIn.scannedAt < previous) checkedIn.set(checkIn.passId, checkIn.scannedAt);
  }
  const redeemed = new Map<string, Record<string, string>>();
  for (const redemption of redemptions) {
    const byBenefit = redeemed.get(redemption.passId) ?? {};
    const previous = byBenefit[redemption.benefitId];
    if (!previous || redemption.scannedAt < previous) byBenefit[redemption.benefitId] = redemption.scannedAt;
    redeemed.set(redemption.passId, byBenefit);
  }

  const infos: ScanPassInfo[] = [];
  for (const pass of passes) {
    if (pass.status === "pending") continue;
    const [person, benefits] = await Promise.all([repo.getPersonById(pass.personId), repo.listPassBenefits(pass.id)]);
    infos.push({
      id: pass.id,
      name: person?.name ?? "",
      benefits: benefits.map((b) => b.id),
      checkedInAt: pass.checkedInAt ?? checkedIn.get(pass.id) ?? null,
      redeemed: redeemed.get(pass.id) ?? {},
    });
  }

  return { event: toScanEvent(event, stations), station: stationOf(access), key: access.qrKey, passes: infos, generatedAt: new Date().toISOString() };
}

// ---------- La sincronización ----------

declare global {
  var __rumboScanInFlight: Set<string> | undefined;
  var __rumboScanAttempts: Map<string, { count: number; until: number }> | undefined;
}

/** Los registros que están yendo al contrato ahora mismo: el mismo clientId no se manda dos veces a la vez. */
function inFlight(): Set<string> {
  return (globalThis.__rumboScanInFlight ??= new Set());
}

/** Los errores del contrato con los que no tiene sentido volver a intentar (el panel los cuenta como rechazados, no como pendientes). */
const PERMANENT_ERRORS: ReadonlySet<string> = PERMANENT_CONTRACT_ERRORS;

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

/**
 * Lleva al contrato lo que el escáner registró, en orden: primero las entradas, después los canjes,
 * cada grupo por hora de lectura. Cada registro es una transacción firmada por la puerta y pagada
 * por la patrocinadora; su espejo queda en la base con el clientId, así reintentar no duplica.
 * Un código de puerta solo registra entradas y el de una mesa solo canjes de su beneficio: lo demás
 * se rechaza.
 */
export async function processScanItems(repo: Repo, event: EventRecord, station: ScanStation, items: ScanItem[]): Promise<ScanItemResult[]> {
  const ordered = [...items].sort((a, b) => {
    if (a.action !== b.action) return a.action === "checkin" ? -1 : 1;
    return a.scannedAt.localeCompare(b.scannedAt);
  });
  const results: ScanItemResult[] = [];
  for (const item of ordered) results.push(await processOne(repo, event, station, item));
  return results;
}

function belongsToStation(station: ScanStation, item: ScanItem): boolean {
  if (station.kind === "gate") return item.action === "checkin";
  return item.action === "redeem" && item.benefitId === station.id;
}

async function processOne(repo: Repo, event: EventRecord, station: ScanStation, item: ScanItem): Promise<ScanItemResult> {
  const result = (status: ScanItemStatus, txHash: string | null = null, error: string | null = null): ScanItemResult => ({
    clientId: item.clientId,
    status,
    txHash,
    error,
  });
  if (!belongsToStation(station, item)) return result("rejected", null, "fuera del puesto");
  if (inFlight().has(item.clientId)) return result("retry", null, "en curso");
  inFlight().add(item.clientId);
  try {
    const view = await repo.getPassView(item.passId);
    if (!view || view.event.id !== event.id) return result("rejected", null, "pase desconocido");
    if (!view.pass.account || view.pass.status === "pending") return result("rejected", null, "pase sin activar");
    if (!view.contractId) return result("rejected", null, "evento sin contrato");
    return item.action === "checkin" ? await syncCheckIn(repo, event, item, view, view.contractId) : await syncRedeem(repo, event, item, view, view.contractId);
  } catch (error) {
    return result("retry", null, describe(error));
  } finally {
    inFlight().delete(item.clientId);
  }
}

async function syncCheckIn(repo: Repo, event: EventRecord, item: ScanItem, view: PassView, contractId: string): Promise<ScanItemResult> {
  const account = view.pass.account as string;
  const row = await repo.recordCheckIn({ clientId: item.clientId, eventId: event.id, passId: view.pass.id, scannerId: item.scannerId, scannedAt: item.scannedAt });
  if (row.synced) return { clientId: item.clientId, status: "synced", txHash: row.txHash, error: null };
  if (row.duplicate) return { clientId: item.clientId, status: "duplicate", txHash: row.txHash, error: row.error };
  try {
    const tx = await rumboPass.checkIn(contractId, account);
    await repo.markCheckIn(row.id, { synced: true, txHash: tx.hash, error: null });
    if (view.pass.status !== "checked_in") await repo.updatePass(view.pass.id, { status: "checked_in", checkedInAt: item.scannedAt });
    return { clientId: item.clientId, status: "synced", txHash: tx.hash, error: null };
  } catch (error) {
    if (isContractError(error, "AlreadyCheckedIn")) {
      // Otro puesto ya marcó la entrada en el contrato: doble, a revisar en el panel.
      await repo.markCheckIn(row.id, { duplicate: true, error: error.errorName });
      if (view.pass.status !== "checked_in") await repo.updatePass(view.pass.id, { status: "checked_in" });
      return { clientId: item.clientId, status: "duplicate", txHash: null, error: error.errorName };
    }
    if (isContractError(error) && error.errorName && PERMANENT_ERRORS.has(error.errorName)) {
      await repo.markCheckIn(row.id, { error: error.errorName });
      return { clientId: item.clientId, status: "rejected", txHash: null, error: error.errorName };
    }
    await repo.markCheckIn(row.id, { error: describe(error) });
    return { clientId: item.clientId, status: "retry", txHash: null, error: describe(error) };
  }
}

async function syncRedeem(repo: Repo, event: EventRecord, item: ScanItem, view: PassView, contractId: string): Promise<ScanItemResult> {
  const account = view.pass.account as string;
  const benefit = item.benefitId ? view.benefits.find((b) => b.id === item.benefitId) : undefined;
  if (!item.benefitId || !benefit) return { clientId: item.clientId, status: "rejected", txHash: null, error: "la entrada no incluye ese beneficio" };
  if (benefit.chainIndex === null) return { clientId: item.clientId, status: "rejected", txHash: null, error: "beneficio sin lugar en el contrato" };
  const row = await repo.recordRedemption({
    clientId: item.clientId,
    eventId: event.id,
    passId: view.pass.id,
    benefitId: benefit.id,
    scannerId: item.scannerId,
    scannedAt: item.scannedAt,
  });
  if (row.synced) return { clientId: item.clientId, status: "synced", txHash: row.txHash, error: null };
  if (row.duplicate) return { clientId: item.clientId, status: "duplicate", txHash: row.txHash, error: row.error };
  try {
    const tx = await rumboPass.redeem(contractId, account, benefit.chainIndex);
    await repo.markRedemption(row.id, { synced: true, txHash: tx.hash, error: null });
    return { clientId: item.clientId, status: "synced", txHash: tx.hash, error: null };
  } catch (error) {
    if (isContractError(error, "AlreadyRedeemed")) {
      await repo.markRedemption(row.id, { duplicate: true, error: error.errorName });
      return { clientId: item.clientId, status: "duplicate", txHash: null, error: error.errorName };
    }
    if (isContractError(error, "NotCheckedIn")) {
      // La entrada la registró otro puesto que todavía no sincronizó: se vuelve a intentar después.
      await repo.markRedemption(row.id, { error: error.errorName });
      return { clientId: item.clientId, status: "retry", txHash: null, error: error.errorName };
    }
    if (isContractError(error) && error.errorName && PERMANENT_ERRORS.has(error.errorName)) {
      await repo.markRedemption(row.id, { error: error.errorName });
      return { clientId: item.clientId, status: "rejected", txHash: null, error: error.errorName };
    }
    await repo.markRedemption(row.id, { error: describe(error) });
    return { clientId: item.clientId, status: "retry", txHash: null, error: describe(error) };
  }
}

// ---------- Los pedidos de /api/scan ----------

const MAX_ITEMS_PER_SYNC = 20;
const MAX_WRONG_CODES = 8;
const WRONG_CODE_WINDOW_MS = 10 * 60 * 1000;

/** Quién pide, para frenar a quien prueba códigos al azar. */
function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

function attempts(): Map<string, { count: number; until: number }> {
  return (globalThis.__rumboScanAttempts ??= new Map());
}

function isLockedOut(key: string): boolean {
  const entry = attempts().get(key);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    attempts().delete(key);
    return false;
  }
  return entry.count >= MAX_WRONG_CODES;
}

function noteWrongCode(key: string): void {
  const entry = attempts().get(key);
  if (entry && Date.now() <= entry.until) entry.count++;
  else attempts().set(key, { count: 1, until: Date.now() + WRONG_CODE_WINDOW_MS });
}

export type ScanAuth = { ok: true; access: StationAccess; body: Record<string, unknown> } | { ok: false; response: Response };

/** Lee el cuerpo del pedido y resuelve el código del puesto: a qué evento y a qué puesto abre. */
export async function authorizeScanRequest(repo: Repo, request: Request): Promise<ScanAuth> {
  const key = clientKey(request);
  if (isLockedOut(key)) return { ok: false, response: Response.json({ error: "too_many_attempts" }, { status: 429 }) };
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, response: Response.json({ error: "bad_request" }, { status: 400 }) };
  }
  const code = typeof body.code === "string" ? body.code : "";
  if (!code) return { ok: false, response: Response.json({ error: "bad_request" }, { status: 400 }) };
  const access = await resolveStationCode(code, repo);
  if (!access) {
    noteWrongCode(key);
    return { ok: false, response: Response.json({ error: "wrong_code" }, { status: 401 }) };
  }
  return { ok: true, access, body };
}

const ACTIONS = new Set(["checkin", "redeem"]);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Los registros del pedido, con su forma comprobada. Devuelve null si alguno no tiene la forma esperada. */
export function parseScanItems(raw: unknown): ScanItem[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS_PER_SYNC) return null;
  const items: ScanItem[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    const clientId = typeof v.clientId === "string" ? v.clientId : "";
    const action = typeof v.action === "string" ? v.action : "";
    const passId = typeof v.passId === "string" ? v.passId.toUpperCase() : "";
    const benefitId = typeof v.benefitId === "string" ? v.benefitId : null;
    const scannedAt = typeof v.scannedAt === "string" ? v.scannedAt : "";
    const scannerId = typeof v.scannerId === "string" ? v.scannerId.slice(0, 64) : "";
    if (!clientId || clientId.length > 64 || !ACTIONS.has(action) || !isValidPassId(passId) || !ISO_RE.test(scannedAt)) return null;
    if (benefitId !== null && benefitId.length > 64) return null;
    items.push({ clientId, action: action as ScanItem["action"], passId, benefitId, scannedAt, scannerId });
  }
  return items;
}
