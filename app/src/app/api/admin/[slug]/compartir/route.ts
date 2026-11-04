// POST /api/admin/<evento>/compartir: el enlace con la clave del evento, para pasárselo a quien coorganiza (abre este
// panel sin cuenta, y solo este). La clave se arma recién acá, cuando alguien la pide: quien creó el evento con su
// cuenta no la necesita para entrar. Pide lo mismo que el panel (la clave o la sesión de la cuenta que lo creó) y
// solo desde la propia app. Contesta { path: "/admin/<evento>?k=<clave>" }; el origen lo pone el navegador.
import { NextResponse, type NextRequest } from "next/server";
import { getOrCreateOrganizerKey } from "@/server/panel.ts";
import { PANEL_KEY_QUERY, authorizePanelRequest } from "@/server/panel-sesion.ts";
import { fromOwnSite } from "@/server/pedido.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  if (!fromOwnSite(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  const key = await getOrCreateOrganizerKey(auth.event.id);
  const path = `/admin/${encodeURIComponent(auth.event.slug)}?${PANEL_KEY_QUERY}=${encodeURIComponent(key)}`;
  return NextResponse.json({ path }, { headers: { "Cache-Control": "no-store" } });
}
