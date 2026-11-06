// POST /api/admin/<evento>/publicar: un paso de publicar (src/server/kit/publicar.ts, publishStep). Crea el contrato
// de un solo tipo de credencial, primero los del asistente, y apenas tienen el suyo el evento queda publicado. La
// pantalla /admin/<evento>/publicando lo pide una y otra vez hasta que no queda nada, y el panel lo retoma con
// "Terminar de preparar". Pide lo mismo que el panel (la clave, o la sesión de la dueña o de quien coorganiza) y
// solo desde la propia app. Contesta 200 { published, done, total, publicDone, publicTotal, path }, con path la
// página pública (/e/<evento>); 409 { error: "busy" } si otro paso está corriendo (se pide de nuevo en un momento);
// 422 { error: <motivo> } si al borrador le falta algo (sin asistente gratis, sin cupo), y 502 si el despliegue falló.
import { NextResponse, type NextRequest } from "next/server";
import { publishStep } from "@/server/kit/publicar.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";
import { fromOwnSite } from "@/server/pedido.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";
// Un paso es un solo despliegue en la red de prueba (unos segundos): con un minuto sobra.
export const maxDuration = 60;

type Context = { params: Promise<{ slug: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest, { params }: Context) {
  if (!fromOwnSite(request)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) {
    auth.response.headers.set("Cache-Control", "no-store");
    return auth.response;
  }
  const step = await publishStep(getRepo(), auth.event);
  if (!step.ok) {
    if (step.reason === "deploy_failed") console.error(`[publicar] No se pudo preparar una credencial de ${slug}: ${step.detail ?? ""}`);
    const status = step.reason === "busy" ? 409 : step.reason === "deploy_failed" ? 502 : 422;
    return NextResponse.json({ error: step.reason }, { status, headers: NO_STORE });
  }
  const { published, done, total, publicDone, publicTotal } = step;
  return NextResponse.json({ published, done, total, publicDone, publicTotal, path: `/e/${encodeURIComponent(auth.event.slug)}` }, { headers: NO_STORE });
}
