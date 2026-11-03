// POST /api/scan/buscar: el respaldo manual de la puerta. Cuerpo: { code, query }. Busca entre las personas
// inscriptas por nombre o correo (el correo vuelve tapado). Solo lo abre el código del puesto Puerta.
import type { DoorSearchResponse } from "@/lib/escaner-api.ts";
import { authorizeScanRequest } from "@/server/escaner.ts";
import { doorSearchAttempts, requireGate, searchDoor } from "@/server/puerta.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const repo = getRepo();
  const auth = await authorizeScanRequest(repo, request);
  if (!auth.ok) return auth.response;
  const denied = requireGate(auth.access);
  if (denied) return denied;

  const attempts = doorSearchAttempts();
  const key = auth.access.event.id;
  const wait = await attempts.blockedFor(key);
  if (wait > 0) {
    return Response.json({ error: "too_many_attempts" }, { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } });
  }
  await attempts.note(key);

  const query = typeof auth.body.query === "string" ? auth.body.query.slice(0, 80) : "";
  const response: DoorSearchResponse = { matches: await searchDoor(repo, auth.access.event, query) };
  return Response.json(response, { headers: { "Cache-Control": "no-store" } });
}
