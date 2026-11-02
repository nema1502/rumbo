// GET /api/admin/<evento>: el estado del panel en JSON, para que el panel se actualice solo.
// Pide la clave de organizador (la cookie, o ?k=).
import { NextResponse, type NextRequest } from "next/server";
import { getPanelState } from "@/server/panel.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  return NextResponse.json(await getPanelState(auth.event), { headers: { "Cache-Control": "no-store" } });
}
