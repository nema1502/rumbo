// GET /api/vivo/<evento>: lo que muestra la pantalla en vivo, en JSON. Pide la clave de organizador (la cookie
// del panel, o ?k=). Nunca lleva correos: el ranking usa el nombre de pila o el alias que cada persona eligió.
import { NextResponse, type NextRequest } from "next/server";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";
import { getLiveState } from "@/server/vivo.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  return NextResponse.json(await getLiveState(auth.event), { headers: { "Cache-Control": "no-store" } });
}
