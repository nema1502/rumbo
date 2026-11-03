// Quién puede crear eventos. Todavía no hay cuentas de organizador: el panel de cada evento se abre con su clave,
// pero crear el primero necesita otra cosa. Con RUMBO_CREATE_KEY, quien crea escribe esa "clave de la casa";
// sin ella, crear está abierto solo en desarrollo y cerrado en producción (así nadie llena el servidor de eventos).
import { timingSafeEqual } from "node:crypto";
import { getEnv } from "../env.ts";

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
