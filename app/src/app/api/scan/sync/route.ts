// La cola del escáner llega acá cuando hay red: cada entrada y cada canje van al contrato con la
// cuenta de puerta y quedan en el espejo. Devuelve qué pasó con cada uno y, si el escáner la pidió (o
// si es una versión anterior que no sabe pedirla), la foto fresca del evento, para que se entere de lo
// que registraron los otros puestos.
import { authorizeScanRequest, buildSnapshot, parseScanItems, processScanItems, stationOf } from "@/server/escaner.ts";
import { getRepo } from "@/server/repo.ts";
import type { SyncResponse } from "@/lib/escaner-api.ts";

export const dynamic = "force-dynamic";
// Cada registro es una transacción en la red de prueba, de a una: un lote tarda. Con Fluid en Vercel el tope por omisión alcanza; se declara igual.
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const repo = getRepo();
  const auth = await authorizeScanRequest(repo, request);
  if (!auth.ok) return auth.response;
  const items = parseScanItems(auth.body.items ?? []);
  if (!items) return Response.json({ error: "bad_items" }, { status: 400 });
  const results = await processScanItems(repo, auth.access.event, stationOf(auth.access), items);
  const wantsSnapshot = auth.body.snapshot !== false;
  const response: SyncResponse = { results, snapshot: wantsSnapshot ? await buildSnapshot(repo, auth.access) : null };
  return Response.json(response);
}
