// Lo que Pollar firma por las cuentas que custodia lo decide la política de firma de la app (en su panel:
// Wallets, Auth Policy): una fila por contrato, con sus funciones. Sin la fila, el firmante rechaza la entrada de
// autorización (SOROBAN_AUTH_NO_POLICY) y la inscripción con Google termina en "Tu cuenta no autorizó la
// inscripción": pasó el 4-nov-2026 en la primera prueba real. Como cada evento tiene su propio contrato, al
// publicar se le avisa a Pollar con una fila (register y buy). El USDC de prueba (transfer, adentro de buy) y los
// contratos del evento de muestra se cargaron a mano ese día. Hace falta la clave secreta de la app
// (POLLAR_SECRET_KEY, solo en el servidor); sin ella no se hace nada y publicar sigue igual.
import { getEnv } from "./env.ts";
import { describeForLog } from "./log.ts";

export const POLLAR_SERVER_URL = "https://server.api.pollar.xyz";
/** Lo que una persona firma en el contrato de su evento: inscribirse o comprar. */
export const EVENT_CONTRACT_FUNCTIONS = ["register", "buy"] as const;
const CONTRACT_ID = /^C[A-Z2-7]{55}$/;

export type AllowOutcome = { ok: true; policyId: string } | { ok: false; reason: "not_configured" | "failed"; detail: string | null };

export interface AllowDeps {
  fetch: typeof fetch;
  secretKey: string | undefined;
  serverUrl: string;
}

const defaultDeps = (): AllowDeps => ({ fetch: globalThis.fetch, secretKey: getEnv("POLLAR_SECRET_KEY"), serverUrl: getEnv("POLLAR_SERVER_URL", POLLAR_SERVER_URL) });

/**
 * Le avisa a Pollar que el contrato de un evento existe: una fila en la política de firma, con register y buy.
 * Nunca lanza: si falla, lo dice en el registro (sin la clave) y devuelve el motivo, y publicar sigue. Los ids
 * que no son de un contrato real (los de las pruebas) no se mandan.
 */
export async function allowEventContractInPollar(contractId: string, label: string, deps: AllowDeps = defaultDeps()): Promise<AllowOutcome> {
  if (!deps.secretKey || !CONTRACT_ID.test(contractId)) return { ok: false, reason: "not_configured", detail: null };
  try {
    const res = await deps.fetch(`${deps.serverUrl}/v3/treasury/soroban-auth/policies`, {
      method: "POST",
      headers: { "x-pollar-api-key": deps.secretKey, "content-type": "application/json" },
      body: JSON.stringify({ contract_id: contractId, functions: [...EVENT_CONTRACT_FUNCTIONS], label: label.slice(0, 120), enabled: true }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { success?: boolean; code?: string; content?: { id?: string } } | null;
    if (res.ok && body?.success && body.content?.id) return { ok: true, policyId: body.content.id };
    const detail = `HTTP ${res.status}${body?.code ? ` ${body.code}` : ""}`;
    console.warn(`[pollar] Pollar no aceptó la fila del contrato ${contractId}: ${detail}`);
    return { ok: false, reason: "failed", detail };
  } catch (error) {
    console.warn(`[pollar] No se pudo avisar a Pollar del contrato ${contractId}: ${describeForLog(error)}`);
    return { ok: false, reason: "failed", detail: describeForLog(error) };
  }
}
