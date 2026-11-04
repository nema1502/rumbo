// POST /api/admin/<evento>/puestos: un código de puesto nuevo en lugar del dado (se filtró, o cambió quien
// atiende). Cuerpo: { code }. El viejo deja de abrir el escáner en el acto, y con él la sesión de cualquier celular
// que lo tuviera abierto. Devuelve el estado del panel, con el código nuevo. Pide la clave de organizador.
import { NextResponse, type NextRequest } from "next/server";
import { getPanelState, regenerateStationCode } from "@/server/panel.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.code !== "string") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const fresh = await regenerateStationCode(auth.event, body.code);
  if (!fresh) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ code: fresh.code, state: await getPanelState(auth.event) }, { headers: { "Cache-Control": "no-store" } });
}
