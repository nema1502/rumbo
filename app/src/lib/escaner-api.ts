// Lo que comparten el servidor y el escáner del voluntario: la forma de lo que viaja por /api/scan
// y el veredicto de cada lectura, que se decide en el navegador, sin red.
//
// El voluntario abre su puesto con red una vez, con el código que le dio quien organiza (uno por
// puesto: la puerta, la mesa del almuerzo; los emite el panel, src/server/panel.ts). Recibe la
// llave del evento (para verificar las credenciales), su puesto y la lista de pases con lo que trae
// cada uno y lo que ya se usó. Después decide solo. Lo que registra va a una cola local
// (src/lib/cola.ts) y, cuando hay red, a /api/scan/sync, que lo lleva al contrato con la cuenta de puerta.
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

export type NoReason = "invalid" | "unknown" | "not_included" | "not_checked_in";

/** Los tres veredictos: verde (entró, canjeado), amarillo (ya entró, ya canjeado) y neutro (no corresponde). */
export type Verdict =
  | { kind: "ok"; action: ScanAction; passId: string; name: string | null }
  | { kind: "already"; action: ScanAction; passId: string; name: string | null; at: string }
  | { kind: "no"; reason: NoReason; passId: string | null; name: string | null };

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
  if (!verification.ok) return { kind: "no", reason: "invalid", passId: null, name: null };
  const passId = verification.passId;
  const name = pass?.name ?? null;
  const checkedInAt = pass?.checkedInAt ?? local?.checkedInAt ?? null;

  if (station.kind === "gate") {
    if (checkedInAt) return { kind: "already", action: "checkin", passId, name, at: checkedInAt };
    return { kind: "ok", action: "checkin", passId, name };
  }

  if (!pass) return { kind: "no", reason: "unknown", passId, name: null };
  if (!pass.benefits.includes(station.id)) return { kind: "no", reason: "not_included", passId, name };
  if (!checkedInAt) return { kind: "no", reason: "not_checked_in", passId, name };
  const redeemedAt = pass.redeemed[station.id] ?? local?.redeemed[station.id] ?? null;
  if (redeemedAt) return { kind: "already", action: "redeem", passId, name, at: redeemedAt };
  return { kind: "ok", action: "redeem", passId, name };
}
