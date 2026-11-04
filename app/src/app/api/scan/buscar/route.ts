// POST /api/scan/buscar: el respaldo manual de la puerta. Cuerpo: { token, query } (o code en vez de token).
// Busca entre las personas inscriptas por nombre, o por el correo entero (el correo vuelve tapado). Solo lo abre
// la sesión (o el código) del puesto Puerta.
import type { DoorSearchResponse } from "@/lib/escaner-api.ts";
import { authorizeScanRequest } from "@/server/escaner.ts";
import { clientKey } from "@/server/limites.ts";
import { doorSearchAttempts, requireGate, searchDoor } from "@/server/puerta.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const repo = getRepo();
  const auth = await authorizeScanRequest(repo, request);
  if (!auth.ok) return auth.response;
  const denied = requireGate(auth.access);
  if (denied) return denied;

  // El cupo es de cada sesión (o código) en cada IP, no del evento: quien lo agota no deja sin buscador a la
  // Puerta de al lado. Y se cuenta y se decide de un solo golpe, así una ráfaga no pasa entera.
  const wait = await doorSearchAttempts().take(`${auth.access.event.id}:${auth.principal}:${clientKey(request.headers)}`);
  if (wait > 0) {
    return Response.json({ error: "too_many_attempts" }, { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } });
  }

  const query = typeof auth.body.query === "string" ? auth.body.query.slice(0, 80) : "";
  const response: DoorSearchResponse = { matches: await searchDoor(repo, auth.access.event, query) };
  return Response.json(response, { headers: { "Cache-Control": "no-store" } });
}
