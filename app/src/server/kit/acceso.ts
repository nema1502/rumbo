// Quién puede crear eventos. Todavía no hay cuentas de organizador: el panel de cada evento se abre con su clave,
// pero crear el primero necesita otra cosa. Con RUMBO_CREATE_KEY, quien crea escribe esa "clave de la casa";
// sin ella, crear está abierto solo en desarrollo y cerrado en producción (así nadie llena el servidor de eventos).
// La clave de la casa tiene el mismo freno que los códigos de puesto: ocho intentos equivocados por IP en diez
// minutos y después una espera que crece, así nadie la prueba a la fuerza.
import { timingSafeEqual } from "node:crypto";
import { getEnv } from "../env.ts";
import { stationCodeAttempts } from "../limites.ts";

export interface CreateGate {
  /** Si se pueden crear eventos en este servidor. */
  open: boolean;
  /** Si el formulario tiene que pedir la clave de la casa. */
  needsKey: boolean;
}

export function createGate(): CreateGate {
  if (getEnv("RUMBO_CREATE_KEY")) return { open: true, needsKey: true };
  return { open: process.env.NODE_ENV !== "production", needsKey: false };
}

/** Si la clave de la casa sirve (o no hace falta). Se compara sin que el tiempo delate en qué letra difiere. */
export function verifyCreateKey(given: string | null | undefined): boolean {
  const gate = createGate();
  if (!gate.open) return false;
  if (!gate.needsKey) return true;
  const expected = Buffer.from(getEnv("RUMBO_CREATE_KEY", ""), "utf8");
  const received = Buffer.from((given ?? "").trim(), "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export type CreateKeyCheck = "ok" | "wrong" | "blocked";

/**
 * La clave de la casa, con freno. `requester` es quien pide (clientKey, la IP que pone la plataforma): cada
 * clave equivocada cuenta en el freno de los códigos de puesto, y con el freno puesto ni la clave buena entra
 * hasta que pase la espera. Cuando no hace falta clave, siempre "ok".
 */
export async function checkCreateKey(given: string | null | undefined, requester: string): Promise<CreateKeyCheck> {
  const gate = createGate();
  if (!gate.open) return "wrong";
  if (!gate.needsKey) return "ok";
  const attempts = stationCodeAttempts();
  if ((await attempts.blockedFor(requester)) > 0) return "blocked";
  if (verifyCreateKey(given)) return "ok";
  await attempts.note(requester);
  return "wrong";
}
