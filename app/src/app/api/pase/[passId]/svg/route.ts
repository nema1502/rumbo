// GET /api/pase/<id>/svg?k=<clave>[&lang=es|en][&ver=1]: la credencial para imprimir, como SVG.
// Por defecto se descarga; con ver=1 se muestra en el navegador.
import type { NextRequest } from "next/server";
import { DEFAULT_LANG, LANG_COOKIE, isLang } from "@/i18n/index.ts";
import { loadCredential } from "@/server/evento/credencial.ts";
import { renderCredentialSvg } from "@/server/evento/credencial-svg.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ passId: string }>;

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const { passId } = await params;
  const query = request.nextUrl.searchParams;
  const view = await loadCredential(passId, query.get("k"));
  if (!view) return new Response("Not found", { status: 404 });

  const fromQuery = query.get("lang");
  const fromCookie = request.cookies.get(LANG_COOKIE)?.value;
  const lang = isLang(fromQuery) ? fromQuery : isLang(fromCookie) ? fromCookie : DEFAULT_LANG;
  const svg = renderCredentialSvg(view, lang);
  const disposition = query.get("ver") === "1" ? "inline" : "attachment";

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": `${disposition}; filename="credencial-${view.pass.id}.svg"`,
      "Cache-Control": "no-store",
    },
  });
}
