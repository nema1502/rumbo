// La ruta de stands de una credencial, para que la credencial se actualice sola y para que la PERSONA conteste
// la pregunta de permiso ("¿querés compartir tu contacto con este stand?") desde su propio celular.
//
//   GET  /api/pase/<id>/ruta?k=<clave>   la ruta: stands visitados, premio y qué contestó en cada stand
//   POST /api/pase/<id>/ruta             { k, action: "consent", standId, answer: "granted" | "declined" }
//                                        { k, action: "display", alias, hidden }
//
// Se entra con la clave de la credencial (la misma de /p/<pase>?k=): sin ella, 404, sin decir si el pase existe.
// El auspiciante no tiene esa clave, así que nadie puede contestar por la persona.
import { NextResponse, type NextRequest } from "next/server";
import { verifyAccessKey } from "@/server/evento/acceso.ts";
import { StandsError, answerConsent, getPassRoute, setDisplay } from "@/server/stands.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ passId: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: Context) {
  const { passId } = await params;
  if (!verifyAccessKey(passId, request.nextUrl.searchParams.get("k"))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ route: await getPassRoute(passId) }, { headers: NO_STORE });
}

export async function POST(request: NextRequest, { params }: Context) {
  const { passId } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!verifyAccessKey(passId, body.k)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    if (body.action === "consent") {
      if (typeof body.standId !== "string") return NextResponse.json({ error: "bad_request" }, { status: 400 });
      answerConsent(passId, body.standId, body.answer);
    } else if (body.action === "display") {
      setDisplay(passId, { alias: body.alias, hidden: body.hidden });
    } else {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof StandsError) return NextResponse.json({ error: error.code }, { status: 400 });
    throw error;
  }
  return NextResponse.json({ route: await getPassRoute(passId) }, { headers: NO_STORE });
}
