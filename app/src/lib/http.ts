// Los pedidos del escáner al servidor, siempre con tiempo límite. Con un wifi que el navegador cree
// conectado pero que no tiene salida (el del evento, un portal cautivo), un pedido sin límite queda
// colgado: mientras tanto el escáner descarta las lecturas y parece muerto. Pasado el tiempo, el pedido
// se corta y el escáner sigue con lo que sabe sin red.

/** Lo que espera, en medio de una lectura, la foto fresca de un pase que no tenía cargado. */
export const READ_REFRESH_TIMEOUT_MS = 4_000;
/** Lo que espera al abrir un puesto con su código. */
export const OPEN_TIMEOUT_MS = 15_000;
/**
 * Lo que espera una sincronización. Cada registro es una transacción de la red de prueba, de a una, y un
 * lote son cinco: unos segundos cada una, más si la red está lenta. Si se corta, el servidor termina lo
 * suyo igual y el próximo intento (con los mismos clientId) no duplica nada.
 */
export const SYNC_TIMEOUT_MS = 120_000;

/** El pedido no terminó en el tiempo dado: se cortó. */
export class RequestTimeout extends Error {
  constructor(url: string, ms: number) {
    super(`${url} no contestó en ${ms} ms`);
    this.name = "RequestTimeout";
  }
}

/**
 * Un POST con JSON que se corta si en `timeoutMs` no terminó (también la lectura del cuerpo). Devuelve
 * el estado y el cuerpo si es JSON. Si se corta, rechaza con RequestTimeout.
 */
export async function postJson<T>(url: string, body: unknown, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<{ status: number; data: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = response.headers.get("content-type")?.includes("json") ? ((await response.json()) as T) : null;
    return { status: response.status, data };
  } catch (error) {
    if (controller.signal.aborted) throw new RequestTimeout(url, timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
