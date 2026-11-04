// La pantalla en vivo, en JSON. Nunca lleva correos: el ranking usa el nombre de pila o el alias que cada persona eligió.
//   GET  /api/vivo/<evento>   lo que muestra la pantalla. La abre lo mismo que abre el panel (la clave del evento en
//                             la cookie o en ?k=, o la sesión de la cuenta de organizador) o la clave del enlace del
//                             proyector (?pantalla=), que no abre ninguna otra ruta
//   POST /api/vivo/<evento>   { action: "screen-link" }  un enlace de proyector nuevo; el viejo deja de servir en el
//                             acto. Pide lo mismo que el panel
import { NextResponse, type NextRequest } from "next/server";
import { SCREEN_KEY_QUERY } from "@/lib/pantalla.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";
import { getLiveState, regenerateScreenKey, verifyScreenKey } from "@/server/vivo.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  // Lo que abre el panel abre la pantalla; si no, el proyector con su propio enlace, de solo lectura.
  const auth = await authorizePanelRequest(request, slug);
  if (auth.event) return NextResponse.json(await getLiveState(auth.event), { headers: NO_STORE });
  if (auth.response.status !== 401) return auth.response;
  const event = await getRepo().getEventBySlug(slug);
  if (!event || !(await verifyScreenKey(event.id, request.nextUrl.searchParams.get(SCREEN_KEY_QUERY)))) return auth.response;
  return NextResponse.json(await getLiveState(event), { headers: NO_STORE });
}

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
  // Un cuerpo que es JSON pero no es un objeto ("null", una lista) tampoco sirve.
  if (!body || typeof body !== "object" || Array.isArray(body) || body.action !== "screen-link") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  return NextResponse.json({ screenKey: await regenerateScreenKey(auth.event.id) }, { headers: NO_STORE });
}
