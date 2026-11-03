// GET /api/stand/<código>/csv: los contactos del stand en CSV (nombre, correo, calificación, nota y hora de la
// visita), en el idioma de la cookie o de ?lang=. Solo trae a quienes aceptaron compartir su contacto, y las
// celdas que empiezan como fórmula van neutralizadas, igual que en el CSV de quien organiza.
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANG, LANG_COOKIE, LANG_QUERY, isLang } from "@/i18n/index.ts";
import { authorizeStandCode, buildContactsCsv } from "@/server/stands.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ codigo: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { codigo } = await params;
  const auth = await authorizeStandCode(decodeURIComponent(codigo), request.headers);
  if (!auth.ok) {
    return auth.reason === "blocked"
      ? NextResponse.json({ error: "too_many_attempts" }, { status: 429, headers: { "Retry-After": String(auth.retryAfterSeconds) } })
      : NextResponse.json({ error: "wrong_code" }, { status: 401 });
  }
  const fromQuery = request.nextUrl.searchParams.get(LANG_QUERY);
  const fromCookie = request.cookies.get(LANG_COOKIE)?.value;
  const lang = isLang(fromQuery) ? fromQuery : isLang(fromCookie) ? fromCookie : DEFAULT_LANG;
  const csv = await buildContactsCsv(auth.stand.id, lang);
  const day = new Date().toISOString().slice(0, 10);
  const nombre = auth.stand.name.normalize("NFD").replace(/\p{M}+/gu, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "stand";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contactos-${nombre}-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
