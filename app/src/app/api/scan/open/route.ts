// Abrir un puesto: con el código que le dio quien organiza, el escáner recibe su puesto, la llave
// para verificar credenciales sin red, los pases con lo que traen y lo que ya se usó, y la ficha de sesión con
// la que sincroniza desde ahí (sync, buscar y agregar la reciben en vez del código: así el freno de códigos
// equivocados es solo de esta ruta). Con una sesión que todavía vale también abre, y da una ficha nueva.
import { authorizeScanRequest, buildSnapshot, openScanSession } from "@/server/escaner.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const repo = getRepo();
  const auth = await authorizeScanRequest(repo, request);
  if (!auth.ok) return auth.response;
  const [snapshot, session] = await Promise.all([buildSnapshot(repo, auth.access), openScanSession(auth)]);
  return Response.json({ ...snapshot, session });
}
