// POST /api/organizador/salir: cierra la sesión de organizador (la borra de la base), borra la cookie y vuelve a /admin.
import type { NextRequest } from "next/server";
import { ORGANIZER_COOKIE, clearOrganizerCookie, logoutOrganizer } from "@/server/organizador.ts";
import { seeOther } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  await logoutOrganizer(getRepo(), request.cookies.get(ORGANIZER_COOKIE)?.value);
  const response = seeOther("/admin");
  clearOrganizerCookie(response);
  return response;
}
