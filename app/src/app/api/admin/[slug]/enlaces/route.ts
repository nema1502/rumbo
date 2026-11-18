import { NextResponse, type NextRequest } from "next/server";
import { buildAllLinksCsv } from "@/server/kit/importar.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";
import { langOfRequest, originOfRequest } from "@/server/pedido.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  const csv = await buildAllLinksCsv(getRepo(), auth.event, langOfRequest(request), originOfRequest(request));
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${auth.event.slug}-todos-los-enlaces-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
