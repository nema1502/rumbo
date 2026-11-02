// POST /api/admin/<evento>/salir: borra la cookie del panel y vuelve a la puerta con llave.
import type { NextRequest } from "next/server";
import { clearPanelCookie, seeOther } from "@/server/panel-sesion.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function POST(_request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const response = seeOther(`/admin/${slug}`);
  clearPanelCookie(response, slug);
  return response;
}
