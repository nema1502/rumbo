// Los datos del informe del evento que se imprime (app/informes): los números del panel, la llegada por
// hora, los contratos y una muestra de las transacciones de entrada. Números y identificadores públicos,
// nunca personas: nada de nombres ni de correos. Lo usan scripts/informe.mjs y
// scripts/paquete-embajadores.mjs; el JSON que devuelve es el mismo que acepta `--datos`.
import { reportNetwork, type ReportNetwork } from "./explorador.ts";
import { getLastChainSync, getPanelState } from "./panel.ts";
import { getRepo, type BenefitKind, type EventRecord, type Repo } from "./repo.ts";

export const REPORT_VERSION = 1;
/** Cuántas transacciones de entrada van en la muestra del informe. */
export const REPORT_TX_SAMPLE = 10;
/** Más de esto, la llegada por hora no entra en una página: el informe no la dibuja. */
export const REPORT_MAX_ARRIVAL_HOURS = 16;

export interface EventReportData {
  version: typeof REPORT_VERSION;
  /** Un ejemplo con datos ficticios: el informe lo dice en cada página y no muestra transacciones. */
  example?: boolean;
  /** El corte de los datos (ISO 8601). */
  generatedAt: string;
  network: ReportNetwork;
  event: {
    slug: string;
    name: string;
    /** Quien organiza: la comunidad. */
    community: string;
    startsAt: string;
    endsAt: string | null;
    timezone: string;
    place: string;
    venue: string | null;
    capacity: number | null;
  };
  /** Credenciales emitidas: quienes se inscribieron (gratis) o pagaron su entrada. */
  issued: number;
  /** Inscripciones que no terminaron (el pago no llegó). No cuentan como inscritos. */
  pending: number;
  /** Quienes entraron: cada entrada la marcó la puerta en el contrato, una vez por persona. */
  checkedIn: number;
  /** Intentos de entrar o canjear otra vez que se rechazaron. */
  duplicates: { checkIns: number; redemptions: number };
  /** Entradas y canjes que un escáner registró y todavía no llegaron al contrato: no cuentan hasta que lleguen. */
  pendingSync?: number;
  /**
   * Quienes entraron con una credencial de asistente: la cuenta que vale para el programa de embajadores de
   * Stellar, que no cuenta a oradores, mentoría, jurado, voluntariado, organización ni auspiciantes. Los informes
   * viejos no lo traen: se toma `checkedIn`.
   */
  verifiedAttendees?: number;
  ticketTypes: Array<{ name: string; priceUsdc: number; issued: number }>;
  benefits: Array<{ name: string; kind: BenefitKind; granted: number; redeemed: number; duplicates: number }>;
  /** Entradas por hora, en la hora del evento ("09:00"). Vacío si no hay horas o no entran en la página. */
  arrivals: Array<{ hour: string; count: number }>;
  /** Los contratos rumbo-pass del evento, con los tipos de entrada que viven en cada uno. */
  contracts: Array<{ id: string; label: string }>;
  /** Las transacciones de entrada que el espejo guarda: cuántas hay y una muestra, en orden de llegada. */
  checkInTxs: { recorded: number; sample: Array<{ hash: string; at: string }> };
  /** El último contraste del panel con la cadena: cuántas entradas contó el contrato, si se pudo leer entero. */
  chainCheck: { at: string; checkedIn: number } | null;
  /** Lo que informa quien organiza: los minutos de contenido de Stellar de la agenda. */
  stellarMinutes: number | null;
  /** Lo que informa quien organiza: el gasto en comida, en dólares. */
  foodSpendUsd: number | null;
  /** Quien auspicia: su nombre, su beneficio (el nombre de uno del catálogo) y cuántos contactos aceptaron compartirse. */
  sponsor: { name: string; benefit: string | null; contactsShared: number | null } | null;
  /** El sorteo comprobable: el enlace a su comprobante, si quien organiza lo pasa. */
  raffle: { proofUrl: string | null } | null;
}

const HOUR_MS = 3_600_000;

/** Las entradas agrupadas por hora, en la zona del evento, sin huecos entre la de antes y la de después. */
export function arrivalsByHour(times: string[], timeZone: string, maxHours = REPORT_MAX_ARRIVAL_HOURS): Array<{ hour: string; count: number }> {
  const buckets = new Map<number, number>();
  for (const iso of times) {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) continue;
    const bucket = Math.floor(ms / HOUR_MS);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  if (buckets.size === 0) return [];
  const first = Math.min(...buckets.keys());
  const last = Math.max(...buckets.keys());
  if (last - first + 1 > maxHours) return [];
  const label = new Intl.DateTimeFormat("es-BO", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  const out: Array<{ hour: string; count: number }> = [];
  for (let b = first; b <= last; b++) out.push({ hour: label.format(new Date(b * HOUR_MS)), count: buckets.get(b) ?? 0 });
  return out;
}

/** Los datos del informe de un evento, leídos del espejo con el mismo código que usa el panel. */
export async function buildEventReportData(event: EventRecord, repo: Repo = getRepo()): Promise<EventReportData> {
  const [state, ticketTypes, checkIns] = await Promise.all([getPanelState(event, repo), repo.listTicketTypes(event.id), repo.listCheckIns(event.id)]);
  const network = reportNetwork();

  // La primera entrada de cada pase que entró (las dobles no cuentan).
  const checkedIn = new Set(state.passes.filter((p) => p.status === "checked_in").map((p) => p.id));
  const firstEntry = new Map<string, { at: string; hash: string | null; synced: boolean }>();
  for (const c of [...checkIns].sort((a, b) => a.scannedAt.localeCompare(b.scannedAt))) {
    if (c.duplicate || !checkedIn.has(c.passId) || firstEntry.has(c.passId)) continue;
    firstEntry.set(c.passId, { at: c.scannedAt, hash: c.txHash, synced: c.synced });
  }
  // Si el pase entró pero el espejo no tiene su registro (lo trajo el contraste con la cadena), vale la hora del pase.
  const times = state.passes
    .filter((p) => checkedIn.has(p.id))
    .map((p) => firstEntry.get(p.id)?.at ?? p.checkedInAt)
    .filter((t): t is string => Boolean(t));
  const withTx = [...firstEntry.values()].filter((e) => e.synced && e.hash).sort((a, b) => a.at.localeCompare(b.at));

  const contractIds = [...new Set([...ticketTypes.map((t) => t.contractId ?? event.contractId), event.contractId].filter((c): c is string => Boolean(c)))];
  const contracts = contractIds.map((id) => ({
    id,
    label: ticketTypes.filter((t) => (t.contractId ?? event.contractId) === id).map((t) => t.name).join(", "),
  }));

  const sync = await getLastChainSync(event.id);
  const chainCheck =
    sync && sync.contracts.length > 0 && sync.contracts.every((c) => c.error === null)
      ? { at: sync.syncedAt, checkedIn: sync.contracts.reduce((acc, c) => acc + c.checkedIn, 0) }
      : null;

  const e = state.event;
  return {
    version: REPORT_VERSION,
    generatedAt: state.generatedAt,
    network,
    event: { slug: e.slug, name: e.name, community: e.organizerName, startsAt: e.startsAt, endsAt: e.endsAt, timezone: e.timezone, place: e.place, venue: e.venue, capacity: e.capacity },
    issued: state.counters.issued,
    pending: state.counters.pending,
    checkedIn: state.counters.checkedIn,
    verifiedAttendees: state.passes.filter((p) => p.status === "checked_in" && p.kind === "attendee").length,
    duplicates: {
      checkIns: state.duplicates.filter((d) => d.kind === "checkin").length,
      redemptions: state.duplicates.filter((d) => d.kind === "redemption").length,
    },
    pendingSync: state.pendingSync,
    ticketTypes: state.ticketTypes.map((t) => ({ name: t.name, priceUsdc: t.priceUsdc, issued: t.issued })),
    benefits: state.benefits.map((b) => ({ name: b.name, kind: b.kind, granted: b.granted, redeemed: b.redeemed, duplicates: b.duplicates })),
    arrivals: arrivalsByHour(times, event.timezone),
    contracts,
    checkInTxs: { recorded: withTx.length, sample: withTx.slice(0, REPORT_TX_SAMPLE).map((e) => ({ hash: e.hash as string, at: e.at })) },
    chainCheck,
    stellarMinutes: null,
    foodSpendUsd: null,
    sponsor: null,
    raffle: state.benefits.some((b) => b.kind === "prize" && b.granted > 0) ? { proofUrl: null } : null,
  };
}
