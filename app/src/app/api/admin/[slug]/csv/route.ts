// GET /api/admin/<evento>/csv: la lista de pases para quien organiza (pase, nombre, correo, entrada,
// estado y canjes), en el idioma de la cookie o de ?lang=. Pide la clave de organizador.
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANG, LANG_COOKIE, LANG_QUERY, isLang } from "@/i18n/index.ts";
import { buildPassesCsv } from "@/server/panel.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;

  const fromQuery = request.nextUrl.searchParams.get(LANG_QUERY);
  const fromCookie = request.cookies.get(LANG_COOKIE)?.value;
  const lang = isLang(fromQuery) ? fromQuery : isLang(fromCookie) ? fromCookie : DEFAULT_LANG;

  const csv = await buildPassesCsv(auth.event, lang);
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-pases-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
