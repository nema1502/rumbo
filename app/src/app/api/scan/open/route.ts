// Abrir un puesto: con el código que le dio quien organiza, el escáner recibe su puesto, la llave
// para verificar credenciales sin red y los pases con lo que traen y lo que ya se usó.
import { authorizeScanRequest, buildSnapshot } from "@/server/escaner.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const repo = getRepo();
  const auth = await authorizeScanRequest(repo, request);
  if (!auth.ok) return auth.response;
  return Response.json(await buildSnapshot(repo, auth.access));
}
