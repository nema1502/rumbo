// GET /api/vivo/<evento>/sorteo: la lista de quienes entraron, en el formato de un sorteo comprobable.
//   (sin parámetros)   JSON: { event, generatedAt, total, participants, sha256 }
//   ?formato=csv       CSV: n,pass_id
// Solo códigos de credencial, ordenados, sin nombres ni correos, con la huella SHA-256 de la lista. Pide la clave
// de organizador. Este módulo no sortea: entrega la lista para que quien sortea la publique antes y la use después.
import { NextResponse, type NextRequest } from "next/server";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";
import { buildRaffleList, raffleListCsv } from "@/server/vivo.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  const list = buildRaffleList(auth.event);
  const day = list.generatedAt.slice(0, 10);
  const csv = request.nextUrl.searchParams.get("formato") === "csv";
  return new NextResponse(csv ? raffleListCsv(list) : `${JSON.stringify(list, null, 2)}\n`, {
    headers: {
      "Content-Type": csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="lista-sorteo-${slug}-${day}.${csv ? "csv" : "json"}"`,
      "Cache-Control": "no-store",
    },
  });
}
