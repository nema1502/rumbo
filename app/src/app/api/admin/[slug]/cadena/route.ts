// POST /api/admin/<evento>/cadena: contrasta el espejo con la cadena (status, attendees e info del
// contrato), trae lo que falte y devuelve el resumen junto con el estado nuevo del panel.
import { NextResponse, type NextRequest } from "next/server";
import { getPanelState, refreshFromChain } from "@/server/panel.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";

export const dynamic = "force-dynamic";
/** Consultar la cadena pase por pase puede tardar: hasta un minuto antes de cortar. */
export const maxDuration = 60;

type Context = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  try {
    const sync = await refreshFromChain(auth.event);
    const state = await getPanelState(auth.event);
    return NextResponse.json({ sync, state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[panel] No se pudo contrastar con la cadena:", error);
    return NextResponse.json({ error: "chain", message: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
