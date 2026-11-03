// GET /api/stand/<código>: el panel del stand en JSON, para que se actualice solo. El código es el del puesto del
// stand (el mismo que abre su escáner); uno de la puerta o de una mesa no abre nada. Los códigos equivocados se
// cuentan con el mismo freno que el escáner.
import { NextResponse, type NextRequest } from "next/server";
import { authorizeStandCode, getStandPanel } from "@/server/stands.ts";

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
  return NextResponse.json(await getStandPanel(auth.stand.id), { headers: { "Cache-Control": "no-store" } });
}
