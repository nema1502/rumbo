// El QR que rota, del lado de quien asiste. El servidor le entrega a la credencial, al abrirla con conexión,
// lo que necesita (la clave de ESA credencial y su certificado, src/server/qr.ts: buildLiveGrant). Después
// el celular arma solo un QR nuevo cada 20 segundos, sin red: firma la ventana de tiempo con la clave de la
// credencial y la une al certificado. Una captura de pantalla vale lo que dura su ventana y la siguiente.
import { ed25519Sign } from "./ed25519.ts";
import { base64urlToBytes, joinLivePayload, windowMessage, windowOf } from "./qr-codec.ts";

/** Lo que recibe el celular de la persona para armar el QR de su credencial. */
export interface LiveGrant {
  passId: string;
  /** La clave privada de esta credencial (semilla Ed25519, 32 bytes) en base64url. Solo sirve para este pase. */
  seed: string;
  /** La clave pública de la credencial y la firma del evento sobre ella y sobre el pase (96 bytes) en base32. */
  certificate: string;
}

/** El contenido del QR que corresponde a un instante (milisegundos desde 1970). */
export async function buildLivePayload(grant: LiveGrant, nowMs: number): Promise<string> {
  const window = windowOf(nowMs);
  const signature = await ed25519Sign(base64urlToBytes(grant.seed), windowMessage(grant.passId, window));
  return joinLivePayload(grant.passId, window, grant.certificate, signature);
}

/** Una diferencia de reloj menor que esto no se corrige: la tolera la ventana, y medirla con red tiene su propio error. */
const CLOCK_TOLERANCE_MS = 3000;

/**
 * Cuánto hay que sumarle al reloj de este aparato para tener la hora del servidor. Si el reloj está bien
 * (la diferencia es chica) devuelve 0; si está desfasado, la diferencia. Así un celular con la hora mal
 * puesta igual arma, o lee, el QR de la ventana que corresponde.
 */
export function clockOffset(serverMs: number, localMs: number): number {
  const diff = serverMs - localMs;
  return Math.abs(diff) > CLOCK_TOLERANCE_MS ? diff : 0;
}
