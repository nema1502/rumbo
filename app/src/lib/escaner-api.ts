// Lo que comparten el servidor y el escáner del voluntario: la forma de lo que viaja por /api/scan
// y el veredicto de cada lectura, que se decide en el navegador, sin red.
//
// El voluntario abre su puesto con red una vez, con el código que le dio quien organiza (uno por
// puesto: la puerta, la mesa del almuerzo; los emite el panel, src/server/panel.ts). Recibe la
// llave del evento (para verificar las credenciales), su puesto y la lista de pases con lo que trae
// cada uno y lo que ya se usó. Después decide solo. Lo que registra va a una cola local
// (src/lib/cola.ts) y, cuando hay red, a /api/scan/sync, que lo lleva al contrato con la cuenta de puerta.
import type { CredentialKind } from "./credential-kinds.ts";
import type { QrVerification } from "./qr-codec.ts";

export type StationKind = "gate" | "benefit";

/** Un puesto: la puerta (check-in) o la mesa de un beneficio (canje). */
export interface ScanStation {
  /** "gate" para la puerta; el id del beneficio para un puesto de canje. */
  id: string;
  kind: StationKind;
  /** El nombre del beneficio. Para la puerta va vacío: el escáner lo traduce. */
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
}

/** La foto del evento que baja el escáner al abrir el puesto y cada vez que sincroniza. */
export interface ScanSnapshot {
  event: ScanEvent;
  /** El puesto que abre el código del voluntario. */
  station: ScanStation;
  /** La llave del evento en base64url: con ella el escáner verifica cada credencial sin red. */
  key: string;
  passes: ScanPassInfo[];
  generatedAt: string;
  /** Si el beneficio del puesto tiene tope (150 poleras): cuántos hay y cuántos quedan según el servidor. */
  stock?: { total: number; left: number } | null;
}

export type ScanAction = "checkin" | "redeem";

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
}

/**
 * Qué pasó con cada registro: llegó al contrato (synced), el contrato dijo que ya estaba hecho
 * (duplicate, "doble, revisar"), hay que volver a intentar (retry: sin red, o un canje antes de que
 * llegue la entrada de otro puesto) o no va a entrar nunca (rejected: un pase que no es del evento,
 * o un registro que no es de este puesto).
 */
export type ScanItemStatus = "synced" | "duplicate" | "retry" | "rejected";

export interface ScanItemResult {
  clientId: string;
  status: ScanItemStatus;
  txHash: string | null;
  error: string | null;
}

export interface OpenRequest {
  /** El código del puesto, como lo escribió el voluntario ("ABCD-EFGH-JKLM", con o sin guiones). */
  code: string;
}

export interface SyncRequest extends OpenRequest {
  items: ScanItem[];
}

export interface SyncResponse {
  results: ScanItemResult[];
  snapshot: ScanSnapshot;
}

/** Cuántos registros manda el escáner por vez. Cada uno es una transacción en la red de prueba. */
export const SYNC_BATCH_SIZE = 5;

// ---------- El veredicto ----------

/** Lo que el propio escáner registró de un pase y todavía puede no estar en el servidor. */
export interface LocalUsage {
  checkedInAt: string | null;
  redeemed: Record<string, string>;
}

export type NoReason = "invalid" | "unknown" | "not_included" | "not_checked_in" | "sold_out";

/** Lo que el veredicto dice de la persona, además de su nombre: quién es en el evento, su equipo y, en la comida, su dieta. */
export interface VerdictWho {
  credential: CredentialKind | null;
  team: string | null;
  /** Solo en un puesto de comida y solo si la persona dijo algo. */
  diet: string | null;
}

/** Los tres veredictos: verde (entró, canjeado), amarillo (ya entró, ya canjeado) y neutro (no corresponde). */
export type Verdict =
  | ({ kind: "ok"; action: ScanAction; passId: string; name: string | null; left?: number | null } & VerdictWho)
  | ({ kind: "already"; action: ScanAction; passId: string; name: string | null; at: string } & VerdictWho)
  | ({ kind: "no"; reason: NoReason; passId: string | null; name: string | null } & VerdictWho);

const NOBODY: VerdictWho = { credential: null, team: null, diet: null };

function whoIs(pass: ScanPassInfo | undefined, station: ScanStation): VerdictWho {
  if (!pass) return NOBODY;
  return { credential: pass.credential ?? "attendee", team: pass.team ?? null, diet: station.kind === "benefit" && station.food ? (pass.diet ?? null) : null };
}

/**
 * Decide qué pasa con una lectura, sin red: la firma de la credencial, lo que el servidor sabía del
 * pase al abrir el puesto y lo que este escáner registró después.
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
  if (!verification.ok) return { kind: "no", reason: "invalid", passId: null, name: null, ...NOBODY };
  const passId = verification.passId;
  const name = pass?.name ?? null;
  const checkedInAt = pass?.checkedInAt ?? local?.checkedInAt ?? null;
  const who = whoIs(pass, station);

  if (station.kind === "gate") {
    if (checkedInAt) return { kind: "already", action: "checkin", passId, name, at: checkedInAt, ...who };
    return { kind: "ok", action: "checkin", passId, name, ...who };
  }

  if (!pass) return { kind: "no", reason: "unknown", passId, name: null, ...NOBODY };
  if (!pass.benefits.includes(station.id)) return { kind: "no", reason: "not_included", passId, name, ...who };
  if (!checkedInAt) return { kind: "no", reason: "not_checked_in", passId, name, ...who };
  const redeemedAt = pass.redeemed[station.id] ?? local?.redeemed[station.id] ?? null;
  if (redeemedAt) return { kind: "already", action: "redeem", passId, name, at: redeemedAt, ...who };
  return { kind: "ok", action: "redeem", passId, name, ...who };
}
