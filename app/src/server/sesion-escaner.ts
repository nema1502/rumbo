// La sesión del escáner: lo que recibe un celular al abrir su puesto con el código, para seguir sincronizando,
// buscando y agregando sin volver a mandar el código en cada pedido. Es una ficha firmada por el servidor (HMAC
// con una clave derivada de la raíz secreta del evento, que nunca sale del servidor) que dice el evento, el código
// del puesto, el id del celular y hasta cuándo vale (treinta y seis horas). Con ella, los pedidos del escáner no
// pasan por el freno de códigos equivocados (src/server/limites.ts): ese freno es solo para abrir el puesto. Así un
// celular con un código muerto, o alguien probando códigos desde el mismo wifi, no deja sin sincronizar a los
// voluntarios de al lado. La ficha va atada al código: si quien organiza lo cambia, la ficha deja de valer.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { EventQrKeys } from "./qr.ts";
import { findEventQrKeys, getEventQrKeys } from "./qr-keys.ts";

/** Lo que dura la sesión desde que se abre el puesto. Pasado eso, el escáner vuelve a pedir el código. */
export const SCAN_SESSION_TTL_MS = 36 * 60 * 60 * 1000;

export interface ScanSessionClaims {
  eventId: string;
  /** El código del puesto con que se abrió, normalizado (doce letras). */
  code: string;
  /** El id del celular que abrió el puesto (lo elige el escáner; vacío si no lo dijo). */
  scannerId: string;
  /** Hasta cuándo vale, en milisegundos desde 1970. */
  expiresAt: number;
}

/** Lo que separa esta firma de las demás que salen de la raíz del evento (las semillas de las credenciales, el código del certificado). */
const DOMAIN = "rumbo:sesion-escaner:v1";

interface Wire {
  v: 1;
  e: string;
  c: string;
  s: string;
  x: number;
}

/** La clave con que se firman las fichas de un evento, derivada de su raíz secreta. */
const signingKey = (keys: EventQrKeys): Buffer => createHmac("sha256", keys.credentialRoot).update(DOMAIN, "utf8").digest();

const sign = (key: Buffer, payload: string): string => createHmac("sha256", key).update(payload, "utf8").digest("base64url");

/** Emite la ficha de un puesto abierto. El evento existe (lo resolvió el código), así que si todavía no tiene llaves se le crean. */
export async function issueScanSession(claims: Omit<ScanSessionClaims, "expiresAt">, now: number = Date.now()): Promise<{ token: string; expiresAt: string }> {
  const expiresAt = now + SCAN_SESSION_TTL_MS;
  const wire: Wire = { v: 1, e: claims.eventId, c: claims.code, s: claims.scannerId.slice(0, 64), x: expiresAt };
  const payload = Buffer.from(JSON.stringify(wire), "utf8").toString("base64url");
  return { token: `${payload}.${sign(signingKey(await getEventQrKeys(claims.eventId)), payload)}`, expiresAt: new Date(expiresAt).toISOString() };
}

/**
 * Lee la ficha: lo que dice, si la firmó este servidor para ese evento y todavía no venció. Si no, null. El id de
 * evento que trae lo escribió quien la manda: las llaves se buscan sin crearlas, así una ficha inventada de un
 * evento que no existe no genera un par de llaves por pedido ni choca con la base (daba 500); solo cuesta una lectura,
 * y una vencida ni eso.
 */
export async function readScanSession(token: string, now: number = Date.now()): Promise<ScanSessionClaims | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined || token.length > 1024) return null;
  let wire: Wire;
  try {
    wire = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Wire;
  } catch {
    return null;
  }
  if (!wire || typeof wire !== "object" || wire.v !== 1 || typeof wire.e !== "string" || typeof wire.c !== "string" || typeof wire.s !== "string" || typeof wire.x !== "number") return null;
  if (!/^[0-9a-f-]{36}$/.test(wire.e)) return null;
  if (!Number.isFinite(wire.x) || wire.x <= now) return null;
  const keys = await findEventQrKeys(wire.e);
  if (!keys) return null;
  const expected = Buffer.from(sign(signingKey(keys), payload), "utf8");
  const given = Buffer.from(signature, "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { eventId: wire.e, code: wire.c, scannerId: wire.s, expiresAt: wire.x };
}

/**
 * Una huella corta del código del puesto, para contar por puesto sin guardar el código entero. Es la misma venga el
 * pedido con la ficha (que lleva el código adentro) o con el código: pedir una ficha nueva no renueva ningún cupo.
 */
export function sessionFingerprint(secret: string): string {
  return createHmac("sha256", "rumbo:huella-de-sesion").update(secret, "utf8").digest("base64url").slice(0, 16);
}
