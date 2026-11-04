// Lo que comparten el servidor y el escáner del voluntario: la forma de lo que viaja por /api/scan
// y el veredicto de cada lectura, que se decide en el navegador, sin red.
//
// El voluntario abre su puesto con red una vez, con el código que le dio quien organiza (uno por
// puesto: la puerta, la mesa del almuerzo; los emite el panel, src/server/panel.ts). Recibe la
// clave pública del evento (para verificar las credenciales), su puesto y la lista de pases con lo que trae
// cada uno y lo que ya se usó. Después decide solo. Lo que registra va a una cola local
// (src/lib/cola.ts) y, cuando hay red, a /api/scan/sync, que lo lleva al contrato con la cuenta de puerta.
import type { CredentialKind } from "./credential-kinds.ts";
import type { QrVerification } from "./qr-codec.ts";

export type StationKind = "gate" | "benefit" | "stand";

/** Un puesto: la puerta (check-in), la mesa de un beneficio (canje) o el stand de quien auspicia (visita). */
export interface ScanStation {
  /** "gate" para la puerta; el id del beneficio para un puesto de canje; el id del stand para un stand. */
  id: string;
  kind: StationKind;
  /** El nombre del beneficio o de quien auspicia. Para la puerta va vacío: el escáner lo traduce. */
  name: string;
  /** Dónde está el puesto ("Mesa del almuerzo"), si quien organiza lo dijo. */
  place: string | null;
  /** Si es un puesto de comida (almuerzo, refrigerio, cena): ahí se muestra la dieta de cada persona, en grande. */
  food?: boolean;
}

export const GATE_STATION: ScanStation = { id: "gate", kind: "gate", name: "", place: null };

export interface ScanEvent {
  id: string;
  slug: string;
  name: string;
  startsAt: string;
  timezone: string;
  place: string;
  /** Todos los puestos del evento, para mostrar; el del voluntario es el de la foto. */
  stations: ScanStation[];
}

/** Un pase, visto desde el escáner: quién es, qué trae y qué ya usó. Nunca el correo. */
export interface ScanPassInfo {
  id: string;
  name: string;
  /** Los ids de los beneficios que trae el pase. */
  benefits: string[];
  checkedInAt: string | null;
  /** Id del beneficio ya canjeado y cuándo. */
  redeemed: Record<string, string>;
  /** Quién es en el evento (jurado, mentoría...). Una foto vieja no lo trae: se toma como asistente. */
  credential?: CredentialKind;
  /** El equipo, si el evento se inscribe por equipos. */
  team?: string | null;
  /** La restricción de dieta. Solo viaja a los puestos de comida, no a la puerta ni a los demás. */
  diet?: string | null;
  /**
   * Los stands que ya visitó y cuándo. En el escáner de un stand viene solo el suyo: quien auspicia nunca se
   * entera de qué otros stands visitó la persona. Las fotos viejas, guardadas antes de los stands, no lo traen.
   */
  visited?: Record<string, string>;
}

/** Cómo contestó una persona a "¿querés compartir tu contacto con este stand?". */
export type ConsentState = "pending" | "granted" | "declined";

/** Una visita al stand, como la ve su escáner: el nombre solo aparece si la persona aceptó compartir su contacto. */
export interface ScanStandVisit {
  passId: string;
  at: string;
  consent: ConsentState;
  name: string | null;
}

/** Lo que el escáner de un stand muestra de su propio stand. */
export interface ScanStandInfo {
  visits: ScanStandVisit[];
}

/** La foto del evento que baja el escáner al abrir el puesto y cada vez que sincroniza. */
export interface ScanSnapshot {
  event: ScanEvent;
  /** El puesto que abre el código del voluntario. */
  station: ScanStation;
  /** La clave pública del evento en base64url: con ella el escáner verifica cada credencial sin red. La privada no sale del servidor. */
  publicKey: string;
  passes: ScanPassInfo[];
  /** Solo en el escáner de un stand: sus visitas y quién aceptó compartir su contacto. */
  stand?: ScanStandInfo;
  generatedAt: string;
  /**
   * Si el beneficio del puesto tiene tope (150 poleras): cuántos hay, cuántos quedan según el servidor y, si
   * dos mesas sin red entregaron de más, por cuántas se pasó (`over`; una foto vieja no lo trae).
   */
  stock?: { total: number; left: number; over?: number } | null;
}

export type ScanAction = "checkin" | "redeem" | "visit";

/**
 * Cómo se leyó la credencial, según lo comprobó el servidor: el QR del celular ("live"), el QR fijo de la
 * credencial impresa ("printed") o marcada a mano en la puerta ("manual", sin QR). Queda en el espejo.
 */
export type ScanVia = "live" | "printed" | "manual";

/** Lo que el escáner registró y manda a sincronizar. */
export interface ScanItem {
  /** El id que le puso el escáner: con el mismo id el servidor no registra dos veces. */
  clientId: string;
  action: ScanAction;
  passId: string;
  /** El beneficio canjeado, solo en un canje. */
  benefitId: string | null;
  scannedAt: string;
  scannerId: string;
  /**
   * El texto del QR que se leyó (el del celular o el impreso). Toda lectura lo lleva: el servidor vuelve a
   * comprobar la firma con la clave del evento y que sea de este mismo pase antes de registrarla, así con un
   * código de puesto no se registran entradas, canjes ni visitas de credenciales que nunca pasaron por ahí.
   * La ventana de tiempo no se exige, porque la cola puede subir mucho después de la lectura. Solo falta en
   * una entrada marcada a mano en la puerta (`via: "manual"`).
   */
  qr?: string;
  /**
   * "manual": la entrada la marcó a mano el voluntario de la puerta, desde el buscador, sin QR. Solo vale con
   * el código (o la sesión) de la Puerta. El id de escáner lo marca el servidor ("manual:puerta:<celular>").
   */
  via?: "manual";
}

/**
 * Qué pasó con cada registro: llegó al contrato (synced), el contrato dijo que ya estaba hecho
 * (duplicate, "doble, revisar"), hay que volver a intentar (retry: sin red, o un canje antes de que
 * llegue la entrada de otro puesto) o no va a entrar nunca (rejected: un pase que no es del evento,
 * o un registro que no es de este puesto).
 */
export type ScanItemStatus = "synced" | "duplicate" | "retry" | "rejected";

/** Un canje que entró, pero con él se pasó el tope del beneficio (dos mesas sin red lo entregaron de más). */
export const STOCK_EXCEEDED = "stock_exceeded";

export interface ScanItemResult {
  clientId: string;
  status: ScanItemStatus;
  txHash: string | null;
  /** Por qué no entró; o, con `synced`, un aviso como STOCK_EXCEEDED. */
  error: string | null;
}

export interface OpenRequest {
  /** El código del puesto, como lo escribió el voluntario ("ABCD-EFGH-JKLM", con o sin guiones). */
  code: string;
}

export interface SyncRequest extends OpenRequest {
  items: ScanItem[];
  /**
   * Si el escáner quiere la foto fresca del evento con la respuesta. Armarla cuesta varias consultas por
   * pedido, y el escáner sincroniza cada pocos segundos: la pide cada tanto, no en cada vuelta. Un escáner de
   * una versión anterior no manda el campo, y entonces la foto va siempre, como antes.
   */
  snapshot?: boolean;
}

export interface SyncResponse {
  results: ScanItemResult[];
  /** La foto fresca, si se pidió (o si el pedido no dijo nada). */
  snapshot: ScanSnapshot | null;
}

/** Cuántos registros manda el escáner por vez. Cada uno es una transacción en la red de prueba. */
export const SYNC_BATCH_SIZE = 5;

// ---------- La puerta, a mano ----------
// Solo el código del puesto Puerta abre estas dos rutas (src/server/puerta.ts). Lo que se marca a mano va por
// la cola de siempre; lo que lo distingue es el id del escáner.

/** Lo que lleva adelante el id de escáner de una entrada marcada a mano en la puerta: "manual:puerta:<celular>". */
export const MANUAL_SCANNER_PREFIX = "manual:puerta:";

export function manualScannerId(deviceId: string): string {
  return `${MANUAL_SCANNER_PREFIX}${deviceId}`.slice(0, 64);
}

export function isManualScannerId(scannerId: string | null | undefined): boolean {
  return Boolean(scannerId?.startsWith(MANUAL_SCANNER_PREFIX));
}

/** Una persona encontrada en la puerta. El correo viene tapado ("a***@example.com"), nunca entero. */
export interface DoorMatch {
  passId: string;
  name: string;
  emailHint: string;
  /** Cuándo entró, si ya entró. */
  checkedInAt: string | null;
  /** El nombre de su entrada. */
  ticket: string;
}

export interface DoorSearchRequest extends OpenRequest {
  query: string;
}

export interface DoorSearchResponse {
  matches: DoorMatch[];
}

export interface DoorAddRequest extends OpenRequest {
  name: string;
  email: string;
}

export type DoorAddError = "invalid_name" | "invalid_email" | "no_free_ticket" | "sold_out" | "too_many" | "failed";

export type DoorAddResponse = { kind: "added" | "existing"; match: DoorMatch } | { kind: "error"; error: DoorAddError };

// ---------- El veredicto ----------

/** Lo que el propio escáner registró de un pase y todavía puede no estar en el servidor. */
export interface LocalUsage {
  checkedInAt: string | null;
  redeemed: Record<string, string>;
  /** Los stands que este escáner ya sumó a la visita de la persona. */
  visited?: Record<string, string>;
}

export type NoReason = "invalid" | "expired" | "unknown" | "not_included" | "not_checked_in" | "sold_out";

/**
 * Cómo se leyó la credencial, cuando no es la lectura de siempre del QR del celular: la impresa (el QR fijo,
 * que vale siempre y se puede copiar) o marcada a mano en la puerta.
 */
export type ReadVia = "printed" | "manual";

/** Lo que el veredicto dice de la persona, además de su nombre: quién es en el evento, su equipo y, en la comida, su dieta. */
export interface VerdictWho {
  credential: CredentialKind | null;
  team: string | null;
  /** Solo en un puesto de comida y solo si la persona dijo algo. */
  diet: string | null;
}

/** Los tres veredictos: verde (entró, canjeado), amarillo (ya entró, ya canjeado) y neutro (no corresponde). */
export type Verdict =
  | ({ kind: "ok"; action: ScanAction; passId: string; name: string | null; left?: number | null; via?: ReadVia } & VerdictWho)
  | ({ kind: "already"; action: ScanAction; passId: string; name: string | null; at: string; via?: ReadVia } & VerdictWho)
  | ({ kind: "no"; reason: NoReason; passId: string | null; name: string | null } & VerdictWho);

const NOBODY: VerdictWho = { credential: null, team: null, diet: null };

/** Quién es la persona para el veredicto: su credencial, su equipo y, solo en un puesto de comida, su dieta. */
export function whoIs(pass: ScanPassInfo | undefined, station: ScanStation): VerdictWho {
  if (!pass) return NOBODY;
  return { credential: pass.credential ?? "attendee", team: pass.team ?? null, diet: station.kind === "benefit" && station.food ? (pass.diet ?? null) : null };
}

/**
 * Decide qué pasa con una lectura, sin red: la firma de la credencial, lo que el servidor sabía del
 * pase al abrir el puesto y lo que este escáner registró después. La firma se comprueba antes, con la
 * función de verificación de src/lib/qr-verify.ts, y llega acá ya resuelta en `verification`.
 *
 * En un stand alcanza con que la credencial sea auténtica: cada persona suma un sello por stand, y si
 * ya lo tenía, el veredicto es "ya visitó". No hace falta que haya pasado por la puerta.
 *
 * En la puerta, una credencial auténtica de un pase que el escáner no tiene cargado entra igual:
 * la firma prueba que es del evento, y el servidor la revisa al sincronizar. En un puesto de canje
 * no alcanza, porque no se sabe qué trae: el escáner la actualiza con red y, sin red, no corresponde.
 */
export function decideVerdict(
  verification: QrVerification,
  station: ScanStation,
  pass: ScanPassInfo | undefined,
  local: LocalUsage | undefined,
): Verdict {
  if (!verification.ok) {
    // Un QR que venció (por ejemplo una captura de pantalla) es de alguien: se dice de quién.
    if (verification.reason === "expired") return { kind: "no", reason: "expired", passId: verification.passId, name: pass?.name ?? null, ...NOBODY };
    return { kind: "no", reason: "invalid", passId: null, name: null, ...NOBODY };
  }
  const passId = verification.passId;
  const name = pass?.name ?? null;
  const checkedInAt = pass?.checkedInAt ?? local?.checkedInAt ?? null;
  const via: { via?: ReadVia } = verification.via === "printed" ? { via: "printed" } : {};
  const who = whoIs(pass, station);

  if (station.kind === "gate") {
    if (checkedInAt) return { kind: "already", action: "checkin", passId, name, at: checkedInAt, ...via, ...who };
    return { kind: "ok", action: "checkin", passId, name, ...via, ...who };
  }

  // En un stand, quien auspicia ve el nombre (si la persona aceptó) y nada más: ni su credencial ni su equipo.
  // Sí ve que la credencial es la impresa, como en la puerta y en las mesas: una impresa se puede copiar.
  if (station.kind === "stand") {
    const visitedAt = pass?.visited?.[station.id] ?? local?.visited?.[station.id] ?? null;
    if (visitedAt) return { kind: "already", action: "visit", passId, name, at: visitedAt, ...via, ...NOBODY };
    return { kind: "ok", action: "visit", passId, name, ...via, ...NOBODY };
  }

  if (!pass) return { kind: "no", reason: "unknown", passId, name: null, ...NOBODY };
  if (!pass.benefits.includes(station.id)) return { kind: "no", reason: "not_included", passId, name, ...who };
  if (!checkedInAt) return { kind: "no", reason: "not_checked_in", passId, name, ...who };
  const redeemedAt = pass.redeemed[station.id] ?? local?.redeemed[station.id] ?? null;
  if (redeemedAt) return { kind: "already", action: "redeem", passId, name, at: redeemedAt, ...via, ...who };
  return { kind: "ok", action: "redeem", passId, name, ...via, ...who };
}
