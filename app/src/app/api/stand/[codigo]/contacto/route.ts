// POST /api/stand/<código>/contacto: la calificación (1 a 5) y la nota que quien atiende el stand le pone a un
// contacto. Solo se puede sobre quien aceptó compartir su contacto: sin permiso, 403.
//   { passId, rating?: 1..5 | null, note?: string }
import { NextResponse, type NextRequest } from "next/server";
import { StandsError, authorizeStandCode, saveContactNote } from "@/server/stands.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ codigo: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  const { codigo } = await params;
  const auth = await authorizeStandCode(decodeURIComponent(codigo), request.headers);
  if (!auth.ok) {
    return auth.reason === "blocked"
      ? NextResponse.json({ error: "too_many_attempts" }, { status: 429, headers: { "Retry-After": String(auth.retryAfterSeconds) } })
      : NextResponse.json({ error: "wrong_code" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (typeof body.passId !== "string") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    const rating = saveContactNote(auth.stand.id, body.passId.toUpperCase(), { rating: body.rating, note: body.note });
    return NextResponse.json({ ok: true, rating }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StandsError) return NextResponse.json({ error: error.code }, { status: error.code === "no_consent" ? 403 : 400 });
    throw error;
  }
}
