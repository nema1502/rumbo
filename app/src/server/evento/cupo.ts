// El cupo de una entrada según su contrato: cuántas credenciales emitió (issued) y cuántas puede emitir
// (capacity), leídos con info(). Se recuerdan un minuto por contrato, así la página del evento, la credencial
// y el panel no le pegan a la red en cada carga. Si la red no contesta en cuatro segundos, no se sabe (null)
// y la pantalla sigue con lo que dice la base; eso se recuerda menos tiempo, para volver a preguntar pronto.
import { rumboPass } from "../stellar.ts";

export interface ContractCapacity {
  capacity: number;
  issued: number;
}

const REMEMBER_MS = 60_000;
const REMEMBER_FAILURE_MS = 15_000;
const TIMEOUT_MS = 4000;

interface Remembered {
  at: number;
  value: ContractCapacity | null;
}

const remembered = new Map<string, Remembered>();
const inFlight = new Map<string, Promise<ContractCapacity | null>>();

async function readFromChain(contractId: string): Promise<ContractCapacity | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const info = await Promise.race([
      rumboPass.info(contractId),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
    return info ? { capacity: info.capacity, issued: info.issued } : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** El cupo del contrato, recordado un minuto. Null si no hay contrato o la red no contestó. */
export async function readContractCapacity(contractId: string | null | undefined): Promise<ContractCapacity | null> {
  if (!contractId) return null;
  const known = remembered.get(contractId);
  if (known && Date.now() - known.at < (known.value ? REMEMBER_MS : REMEMBER_FAILURE_MS)) return known.value;
  let pending = inFlight.get(contractId);
  if (!pending) {
    pending = readFromChain(contractId).then((value) => {
      remembered.set(contractId, { at: Date.now(), value });
      inFlight.delete(contractId);
      return value;
    });
    inFlight.set(contractId, pending);
  }
  return pending;
}

/** Si el contrato ya no emite más: emitió tantas como puede. Sin dato, no se dice agotada. */
export function isSoldOut(cupo: ContractCapacity | null): boolean {
  return cupo !== null && cupo.capacity > 0 && cupo.issued >= cupo.capacity;
}

/**
 * El cupo que se muestra ("Credencial 3 de 200", "de 200 lugares"): el menor entre el de la base y el de los
 * contratos que se conocen. El evento de muestra tiene 200 lugares en la base y los contratos compartidos
 * pueden tener menos: manda el que primero se llena.
 */
export function smallestCapacity(dbCapacity: number | null, ...contracts: Array<ContractCapacity | null>): number | null {
  const values = [dbCapacity, ...contracts.map((c) => c?.capacity ?? null)].filter((v): v is number => typeof v === "number" && v > 0);
  return values.length > 0 ? Math.min(...values) : null;
}

/** Para las pruebas: olvida lo recordado. */
export function forgetContractCapacities(): void {
  remembered.clear();
}
