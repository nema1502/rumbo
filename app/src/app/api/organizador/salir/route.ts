// POST /api/organizador/salir: cierra la sesión de organizador (la borra de la base), borra la cookie y vuelve a /admin.
// Solo por POST y solo desde la propia app: un formulario de otro sitio no le cierra la sesión a nadie (403).
import { NextResponse, type NextRequest } from "next/server";
import { ORGANIZER_COOKIE, clearOrganizerCookie, logoutOrganizer } from "@/server/organizador.ts";
import { seeOther } from "@/server/panel-sesion.ts";
import { fromOwnSite } from "@/server/pedido.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!fromOwnSite(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await logoutOrganizer(getRepo(), request.cookies.get(ORGANIZER_COOKIE)?.value);
  const response = seeOther("/admin");
  clearOrganizerCookie(response);
  return response;
}
