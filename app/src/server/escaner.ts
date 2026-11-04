// El escáner del voluntario, del lado del servidor: abrir un puesto con su código (los códigos los
// emite el panel de quien organiza, src/server/panel.ts: uno por puesto), lo que el escáner baja
// (la clave pública del evento, su puesto y los pases con lo que traen y lo que ya usaron) y la
// sincronización de la cola: cada entrada y cada canje al contrato, firmados por la cuenta de
// puerta, con su espejo en la base. Lo usan las rutas de /api/scan.
import type { ScanEvent, ScanItem, ScanItemResult, ScanItemStatus, ScanPassInfo, ScanSnapshot, ScanStation } from "../lib/escaner-api.ts";
import { GATE_STATION } from "../lib/escaner-api.ts";
import { isValidPassId } from "../lib/qr-codec.ts";
import { verifyQrSignature } from "../lib/qr-verify.ts";
import { BUSY, tryExclusive } from "./compartido.ts";
import { isFoodBenefit } from "./kit/plantillas.ts";
import { clientKey, stationCodeAttempts } from "./limites.ts";
import { resolveStationCode, type StationAccess } from "./panel.ts";
import { getEventPublicKey } from "./qr-keys.ts";
import { ClientIdTaken, type CheckIn, type EventRecord, type PassView, type Repo, type SyncMark } from "./repo.ts";
import { claimRoutePrize, isRoutePrize, recordVisit, StandsError, standScanVisits } from "./stands.ts";
import {
  PERMANENT_CONTRACT_ERRORS,
  TX_TIMEOUT_SECONDS,
  isContractError,
  rumboPass,
  transactionOutcome,
  type SubmitHooks,
  type TxOutcome,
} from "./stellar.ts";

// ---------- El puesto y lo que baja el escáner ----------

/** El puesto que abre un código: la puerta, la mesa de su beneficio o el stand de quien auspicia. */
export function stationOf(access: StationAccess): ScanStation {
  if (access.kind === "stand" && access.stand) {
    return { id: access.stand.id, kind: "stand", name: access.stand.name, place: null };
  }
  if (access.kind === "benefit" && access.benefit) {
    return { id: access.benefit.id, kind: "benefit", name: access.benefit.name, place: access.benefit.station, food: isFoodBenefit(access.benefit) };
  }
  return GATE_STATION;
}

// Un puesto de comida (almuerzo, refrigerio, cena: isFoodBenefit, en kit/plantillas.ts) es el único que recibe la
// dieta de cada persona. Un beneficio "other" a secas (el café del auspiciante, una taza) no la necesita y no la ve.

/** Los puestos de un evento: la puerta y una mesa por cada beneficio que alguna entrada trae en el contrato. */
export async function scanStations(repo: Repo, eventId: string): Promise<ScanStation[]> {
  const [benefits, ticketTypes] = await Promise.all([repo.listBenefits(eventId), repo.listTicketTypes(eventId)]);
  const onChain = new Set<string>();
  for (const ticketType of ticketTypes) {
    for (const benefit of await repo.listTicketTypeBenefits(ticketType.id)) onChain.add(benefit.id);
  }
  const stations: ScanStation[] = [GATE_STATION];
  for (const benefit of benefits) {
    if (onChain.has(benefit.id)) stations.push({ id: benefit.id, kind: "benefit", name: benefit.name, place: benefit.station, food: isFoodBenefit(benefit) });
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
 * Todo lo que el escáner necesita para decidir sin red: la clave pública del evento, su puesto y cada pase
 * activo con su nombre, sus beneficios, si ya entró y qué ya canjeó (según el espejo: lo que algún
 * escáner ya subió, aunque todavía no haya llegado al contrato).
 */
export async function buildSnapshot(repo: Repo, access: StationAccess): Promise<ScanSnapshot> {
  const event = access.event;
  if (access.kind === "stand" && access.stand) return await buildStandSnapshot(access);
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

  const station = stationOf(access);
  const [types, teams] = await Promise.all([repo.listTicketTypes(event.id), repo.listPassTeams(event.id)]);
  const kindOfType = new Map(types.map((t) => [t.id, t.credentialKind] as const));
  const teamOf = new Map(teams.map((t) => [t.passId, t.team.name] as const));

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
      credential: kindOfType.get(pass.ticketTypeId) ?? "attendee",
      team: teamOf.get(pass.id) ?? null,
      // La dieta solo baja a los puestos de comida: la puerta y las demás mesas no la necesitan.
      diet: station.kind === "benefit" && station.food ? pass.diet : null,
    });
  }

  // Si el beneficio del puesto tiene tope (150 poleras): cuántas quedan, según lo que algún escáner ya subió.
  let stock: ScanSnapshot["stock"] = null;
  if (station.kind === "benefit" && access.benefit?.stock != null) {
    const used = new Set(redemptions.filter((r) => r.benefitId === station.id && !r.duplicate).map((r) => r.passId));
    stock = { total: access.benefit.stock, left: Math.max(0, access.benefit.stock - used.size) };
  }

  return { event: toScanEvent(event, stations), station, publicKey: access.publicKey, passes: infos, generatedAt: new Date().toISOString(), stock };
}

/**
 * La foto de un stand. A diferencia de la puerta y las mesas, NO trae la lista de asistentes: a quien auspicia
 * solo le llegan las personas que ya pasaron por su stand, y su nombre únicamente si aceptaron compartir su
 * contacto. Así un auspiciante no se lleva el listado entero del evento en el celular.
 */
async function buildStandSnapshot(access: StationAccess): Promise<ScanSnapshot> {
  const stand = access.stand as NonNullable<StationAccess["stand"]>;
  const station = stationOf(access);
  const visits = await standScanVisits(stand.id);
  const passes: ScanPassInfo[] = visits.map((v) => ({
    id: v.passId,
    name: v.name ?? "",
    benefits: [],
    checkedInAt: null,
    redeemed: {},
    visited: { [stand.id]: v.at },
  }));
  return {
    event: toScanEvent(access.event, [station]),
    station,
    publicKey: access.publicKey,
    passes,
    stand: { visits },
    generatedAt: new Date().toISOString(),
  };
}

// ---------- La sincronización ----------

/** Los errores del contrato con los que no tiene sentido volver a intentar (el panel los cuenta como rechazados, no como pendientes). */
const PERMANENT_ERRORS: ReadonlySet<string> = PERMANENT_CONTRACT_ERRORS;

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

/**
 * Lo que la sincronización necesita de la red: marcar la entrada y el canje (avisando el hash de la
 * transacción apenas se manda) y saber cómo terminó una transacción mandada. Las pruebas usan otra.
 */
export interface ScanChain {
  checkIn(contractId: string, account: string, hooks: SubmitHooks): Promise<{ hash: string }>;
  redeem(contractId: string, account: string, benefit: number, hooks: SubmitHooks): Promise<{ hash: string }>;
  outcome(hash: string): Promise<TxOutcome>;
}

/** La red de prueba de verdad, con la cuenta de puerta. */
export const networkChain: ScanChain = {
  checkIn: (contractId, account, hooks) => rumboPass.checkIn(contractId, account, hooks),
  redeem: (contractId, account, benefit, hooks) => rumboPass.redeem(contractId, account, benefit, hooks),
  outcome: (hash) => transactionOutcome(hash),
};

/**
 * Cuánto puede tardar en entrar una transacción ya mandada: lo que vale (TX_TIMEOUT_SECONDS) y un margen.
 * Pasado eso, si la red no la conoce, no va a entrar nunca y se puede mandar otra.
 */
export const TX_SETTLE_MS = (TX_TIMEOUT_SECONDS + 30) * 1000;

/**
 * Qué pasó con la transacción que un intento anterior mandó por este registro y no llegó a confirmar:
 * entró (el registro está hecho, con ese hash), todavía puede entrar (hay que esperar antes de mandar
 * otra, o quedarían dos y la segunda parecería un doble) o no entró ni va a entrar.
 */
async function previousAttempt(row: CheckIn, chain: ScanChain): Promise<"none" | "landed" | "pending" | "dead"> {
  if (!row.txHash) return "none";
  const outcome = await chain.outcome(row.txHash);
  if (outcome === "success") return "landed";
  if (outcome === "failed") return "dead";
  const sentAt = row.txSentAt ? Date.parse(row.txSentAt) : 0;
  return Date.now() - sentAt < TX_SETTLE_MS ? "pending" : "dead";
}

/**
 * Lleva al contrato lo que el escáner registró, en orden: primero las entradas, después los canjes,
 * cada grupo por hora de lectura. Cada registro es una transacción firmada por la puerta y pagada
 * por la patrocinadora; su espejo queda en la base con el clientId, así reintentar no duplica.
 * Un código de puerta solo registra entradas y el de una mesa solo canjes de su beneficio: lo demás
 * se rechaza.
 */
export async function processScanItems(
  repo: Repo,
  event: EventRecord,
  station: ScanStation,
  items: ScanItem[],
  chain: ScanChain = networkChain,
): Promise<ScanItemResult[]> {
  const order: Record<ScanItem["action"], number> = { checkin: 0, redeem: 1, visit: 2 };
  const ordered = [...items].sort((a, b) => {
    if (a.action !== b.action) return order[a.action] - order[b.action];
    return a.scannedAt.localeCompare(b.scannedAt);
  });
  const results: ScanItemResult[] = [];
  for (const item of ordered) results.push(await processOne(repo, event, station, item, chain));
  return results;
}

function belongsToStation(station: ScanStation, item: ScanItem): boolean {
  if (station.kind === "gate") return item.action === "checkin";
  if (station.kind === "stand") return item.action === "visit";
  return item.action === "redeem" && item.benefitId === station.id;
}

async function processOne(repo: Repo, event: EventRecord, station: ScanStation, item: ScanItem, chain: ScanChain): Promise<ScanItemResult> {
  const result = (status: ScanItemStatus, txHash: string | null = null, error: string | null = null): ScanItemResult => ({
    clientId: item.clientId,
    status,
    txHash,
    error,
  });
  if (!belongsToStation(station, item)) return result("rejected", null, "fuera del puesto");
  // El mismo clientId no va dos veces a la vez al contrato: si otro pedido (de esta instancia o de otra) lo está
  // mandando, este vuelve a la cola del escáner y se reintenta.
  const outcome = await tryExclusive(`scan:${item.clientId}`, () => syncItem(repo, event, station, item, chain));
  return outcome === BUSY ? result("retry", null, "en curso") : outcome;
}

async function syncItem(repo: Repo, event: EventRecord, station: ScanStation, item: ScanItem, chain: ScanChain): Promise<ScanItemResult> {
  const result = (status: ScanItemStatus, txHash: string | null = null, error: string | null = null): ScanItemResult => ({
    clientId: item.clientId,
    status,
    txHash,
    error,
  });
  try {
    // La visita a un stand se comprueba por su QR, antes de mirar nada del pase: así la respuesta no cuenta qué
    // ids de pase existen. Los stands viven en la base, no en el contrato: no piden cuenta ni contrato.
    if (item.action === "visit") return await syncVisit(repo, event, item, station);
    const view = await repo.getPassView(item.passId);
    // Un mismo mensaje para un pase que no existe, uno de otro evento y uno sin activar: la respuesta no distingue.
    if (!view || view.event.id !== event.id || view.pass.status === "pending") return result("rejected", null, UNKNOWN_PASS);
    // El premio de la ruta también vive en la base.
    if (item.action === "redeem" && item.benefitId && (await isRoutePrize(event.id, item.benefitId))) return await syncRoutePrize(repo, event, item, view);
    if (!view.pass.account) return result("rejected", null, UNKNOWN_PASS);
    if (!view.contractId) return result("rejected", null, "evento sin contrato");
    return item.action === "checkin"
      ? await syncCheckIn(repo, event, item, view, view.contractId, chain)
      : await syncRedeem(repo, event, item, view, view.contractId, chain);
  } catch (error) {
    // Un clientId de otro registro no se reintenta: con el mismo id el servidor no daría nunca otra cosa.
    if (error instanceof ClientIdTaken) return result("rejected", null, "clientId de otro registro");
    return result("retry", null, describe(error));
  }
}

/** Lo que se contesta por un pase que no existe, es de otro evento o todavía no se activó: lo mismo en los tres casos. */
export const UNKNOWN_PASS = "pase desconocido o sin activar";
/** Lo que se contesta por una visita sin su QR, con un QR que no cierra o con el QR de otro pase: lo mismo en los tres casos. */
export const UNVERIFIED_VISIT = "visita sin credencial verificada";

/**
 * La visita a un stand: un sello por persona y stand, solo en la base. Antes de contarla, el servidor vuelve a
 * comprobar el QR que leyó el escáner (el del celular o el impreso) con la clave pública del evento: tiene que ser
 * auténtico y de ese mismo pase. Sin eso, con el código de un stand bastaría un id de pase (ocho letras, por ejemplo
 * de la lista del sorteo) para sumar visitas, subir el ranking y hasta ganar el premio de la ruta sin haber pasado.
 * La ventana de tiempo no se exige: la cola puede subir la lectura mucho después. Repetir la visita (otro escáner
 * del mismo stand, o la misma lectura que se reintenta) deja el mismo sello, así que siempre queda "sincronizada":
 * una visita repetida no es un doble que haya que revisar. El permiso para compartir el contacto arranca sin responder.
 */
async function syncVisit(repo: Repo, event: EventRecord, item: ScanItem, station: ScanStation): Promise<ScanItemResult> {
  const rejected = (error: string): ScanItemResult => ({ clientId: item.clientId, status: "rejected", txHash: null, error });
  if (!item.qr) return rejected(UNVERIFIED_VISIT);
  const signed = await verifyQrSignature(item.qr, await getEventPublicKey(event.id));
  if (!signed.ok || signed.passId !== item.passId) return rejected(UNVERIFIED_VISIT);
  try {
    await recordVisit({ standId: station.id, passId: item.passId, clientId: item.clientId, scannerId: item.scannerId, scannedAt: item.scannedAt }, repo);
  } catch (error) {
    if (error instanceof StandsError) return rejected("stand o pase desconocido");
    throw error;
  }
  return { clientId: item.clientId, status: "synced", txHash: null, error: null };
}

/**
 * El canje del premio de la ruta. No está en el contrato (la ruta es de la base), así que "una sola vez" lo
 * garantiza la base: claimRoutePrize marca el primer canje de esa persona de un solo golpe, y el segundo,
 * aunque llegue de otro escáner, queda como doble para revisar. Hay que haber ganado el premio.
 */
async function syncRoutePrize(repo: Repo, event: EventRecord, item: ScanItem, view: PassView): Promise<ScanItemResult> {
  const benefit = view.benefits.find((b) => b.id === item.benefitId);
  if (!benefit) return { clientId: item.clientId, status: "rejected", txHash: null, error: "la credencial todavía no ganó este premio" };
  const row = await repo.recordRedemption({
    clientId: item.clientId,
    eventId: event.id,
    passId: view.pass.id,
    benefitId: benefit.id,
    scannerId: item.scannerId,
    scannedAt: item.scannedAt,
  });
  if (row.synced) return { clientId: item.clientId, status: "synced", txHash: null, error: null };
  if (row.duplicate) return { clientId: item.clientId, status: "duplicate", txHash: null, error: row.error };
  if (await claimRoutePrize(row.id)) {
    await repo.markRedemption(row.id, { synced: true, error: null });
    return { clientId: item.clientId, status: "synced", txHash: null, error: null };
  }
  await repo.markRedemption(row.id, { duplicate: true, error: "AlreadyRedeemed" });
  return { clientId: item.clientId, status: "duplicate", txHash: null, error: "AlreadyRedeemed" };
}

/** Guarda en el espejo el hash de la transacción apenas se manda, antes de saber cómo termina. */
function rememberSent(mark: (id: string, m: SyncMark) => Promise<unknown>, id: string): SubmitHooks {
  return {
    onSubmitted: async (hash) => {
      await mark(id, { txHash: hash, txSentAt: new Date().toISOString() });
    },
    // La red estaba ocupada y no la tomó: esa transacción no entró ni va a entrar, el próximo intento no tiene que esperarla.
    onRejected: async () => {
      await mark(id, { txHash: null, txSentAt: null });
    },
  };
}

async function syncCheckIn(repo: Repo, event: EventRecord, item: ScanItem, view: PassView, contractId: string, chain: ScanChain): Promise<ScanItemResult> {
  const account = view.pass.account as string;
  const row = await repo.recordCheckIn({ clientId: item.clientId, eventId: event.id, passId: view.pass.id, scannerId: item.scannerId, scannedAt: item.scannedAt });
  if (row.synced) return { clientId: item.clientId, status: "synced", txHash: row.txHash, error: null };
  if (row.duplicate) return { clientId: item.clientId, status: "duplicate", txHash: row.txHash, error: row.error };

  const done = async (hash: string): Promise<ScanItemResult> => {
    await repo.markCheckIn(row.id, { synced: true, txHash: hash, error: null });
    if (view.pass.status !== "checked_in") await repo.updatePass(view.pass.id, { status: "checked_in", checkedInAt: item.scannedAt });
    return { clientId: item.clientId, status: "synced", txHash: hash, error: null };
  };
  // Un intento anterior mandó su transacción y no supo cómo terminó: se le pregunta a la red antes de mandar otra.
  const previous = row.txHash;
  const before = await previousAttempt(row, chain);
  if (before === "landed") return done(previous as string);
  if (before === "pending") return { clientId: item.clientId, status: "retry", txHash: null, error: "en curso" };

  try {
    const tx = await chain.checkIn(contractId, account, rememberSent((id, m) => repo.markCheckIn(id, m), row.id));
    return await done(tx.hash);
  } catch (error) {
    if (isContractError(error, "AlreadyCheckedIn")) {
      // Antes de llamarlo doble: puede ser la transacción de este mismo registro, que entró tarde.
      if (previous && (await chain.outcome(previous)) === "success") return done(previous);
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

async function syncRedeem(repo: Repo, event: EventRecord, item: ScanItem, view: PassView, contractId: string, chain: ScanChain): Promise<ScanItemResult> {
  const account = view.pass.account as string;
  const benefit = item.benefitId ? view.benefits.find((b) => b.id === item.benefitId) : undefined;
  if (!item.benefitId || !benefit) return { clientId: item.clientId, status: "rejected", txHash: null, error: "la entrada no incluye ese beneficio" };
  if (benefit.chainIndex === null) return { clientId: item.clientId, status: "rejected", txHash: null, error: "beneficio sin lugar en el contrato" };
  const chainIndex = benefit.chainIndex;
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

  const done = async (hash: string): Promise<ScanItemResult> => {
    await repo.markRedemption(row.id, { synced: true, txHash: hash, error: null });
    return { clientId: item.clientId, status: "synced", txHash: hash, error: null };
  };
  const previous = row.txHash;
  const before = await previousAttempt(row, chain);
  if (before === "landed") return done(previous as string);
  if (before === "pending") return { clientId: item.clientId, status: "retry", txHash: null, error: "en curso" };

  try {
    const tx = await chain.redeem(contractId, account, chainIndex, rememberSent((id, m) => repo.markRedemption(id, m), row.id));
    return await done(tx.hash);
  } catch (error) {
    if (isContractError(error, "AlreadyRedeemed")) {
      // Antes de llamarlo doble: puede ser la transacción de este mismo canje, que entró tarde.
      if (previous && (await chain.outcome(previous)) === "success") return done(previous);
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

export type ScanAuth = { ok: true; access: StationAccess; body: Record<string, unknown> } | { ok: false; response: Response };

/**
 * Lee el cuerpo del pedido y resuelve el código del puesto: a qué evento y a qué puesto abre. Los códigos
 * equivocados se cuentan por la IP que pone la plataforma (no la que dice x-forwarded-for) y en total, con
 * una espera que crece: ver stationCodeAttempts en limites.ts.
 */
export async function authorizeScanRequest(repo: Repo, request: Request): Promise<ScanAuth> {
  const attempts = stationCodeAttempts();
  const key = clientKey(request.headers);
  const wait = await attempts.blockedFor(key);
  if (wait > 0) {
    return {
      ok: false,
      response: Response.json({ error: "too_many_attempts" }, { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } }),
    };
  }
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
    await attempts.note(key);
    return { ok: false, response: Response.json({ error: "wrong_code" }, { status: 401 }) };
  }
  return { ok: true, access, body };
}

const ACTIONS = new Set(["checkin", "redeem", "visit"]);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** El QR del celular tiene 274 letras y el impreso 112: nada más largo es un QR. */
const QR_MAX_LENGTH = 320;

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
    const qr = typeof v.qr === "string" ? v.qr.trim().toUpperCase() : "";
    if (!clientId || clientId.length > 64 || !ACTIONS.has(action) || !isValidPassId(passId) || !ISO_RE.test(scannedAt)) return null;
    if (benefitId !== null && benefitId.length > 64) return null;
    if (qr.length > QR_MAX_LENGTH) return null;
    items.push({ clientId, action: action as ScanItem["action"], passId, benefitId, scannedAt, scannerId, ...(qr ? { qr } : {}) });
  }
  return items;
}
