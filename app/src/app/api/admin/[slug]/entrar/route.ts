// Entrar al panel: con la clave en el enlace (GET ?k=...) o con el formulario de la clave (POST).
// Si la clave sirve, queda en una cookie y se sigue al panel (o al informe, con next=informe);
// si no, se vuelve al formulario con el aviso.
import type { NextRequest, NextResponse } from "next/server";
import { getOrCreateOrganizerKey, verifyOrganizerKey } from "@/server/panel.ts";
import { PANEL_KEY_QUERY, seeOther, setPanelCookie } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

/** A dónde se puede seguir después de entrar. Nada más, para que el enlace no lleve a cualquier lado. */
const NEXT_PAGES: Record<string, string> = { "": "", informe: "/informe", stands: "/stands" };

async function enter(request: NextRequest, slug: string, key: string | null, next: string): Promise<NextResponse> {
  const event = await getRepo().getEventBySlug(slug);
  // La pantalla en vivo cuelga de /vivo, no de /admin, pero se abre con la misma clave de organizador.
  const target = next === "vivo" ? `/vivo/${slug}` : `/admin/${slug}${NEXT_PAGES[next] ?? ""}`;
  if (!event) return seeOther(target);
  if (!verifyOrganizerKey(event.id, key)) return seeOther(`${target}?error=clave`);
  const response = seeOther(target);
  setPanelCookie(response, request, slug, getOrCreateOrganizerKey(event.id));
  return response;
}

export async function GET(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const query = request.nextUrl.searchParams;
  return enter(request, slug, query.get(PANEL_KEY_QUERY), query.get("next") ?? "");
}

export async function POST(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const form = await request.formData();
  const key = form.get(PANEL_KEY_QUERY);
  const next = form.get("next");
  return enter(request, slug, typeof key === "string" ? key : null, typeof next === "string" ? next : "");
}
