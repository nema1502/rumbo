// La lista de quienes participan en el sorteo, en el formato de un sorteo comprobable. Pide la clave de organizador.
//   GET  /api/vivo/<evento>/sorteo              JSON: { event, generatedAt, frozenAt, scope, total, participants, sha256, algorithm }
//   GET  ...?formato=csv                        CSV: dos líneas de comentario (evento, hora, huella) y n,pass_id
//   GET  ...?todos=1                            la lista viva con todas las credenciales que entraron (si no hay congelada)
//   POST /api/vivo/<evento>/sorteo              { action: "freeze", all?: boolean } congela la lista de este momento
//                                               { action: "thaw" } vuelve a la lista viva
// Solo códigos de credencial, ordenados, sin nombres ni correos, con la huella SHA-256 y cómo se calcula. Si hay una
// lista congelada, el GET devuelve esa: es la que se proyectó y la que se sortea. Este módulo no sortea.
import { NextResponse, type NextRequest } from "next/server";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";
import { freezeRaffleList, getRaffleList, raffleListCsv, thawRaffleList, type RaffleList } from "@/server/vivo.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

function asDownload(list: RaffleList, slug: string, csv: boolean): NextResponse {
  const day = list.generatedAt.slice(0, 10);
  return new NextResponse(csv ? raffleListCsv(list) : `${JSON.stringify(list, null, 2)}\n`, {
    headers: {
      "Content-Type": csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="lista-sorteo-${slug}-${day}.${csv ? "csv" : "json"}"`,
      ...NO_STORE,
    },
  });
}

export async function GET(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  const query = request.nextUrl.searchParams;
  const list = await getRaffleList(auth.event, query.get("todos") === "1" ? "all" : "attendees");
  return asDownload(list, slug, query.get("formato") === "csv");
}

export async function POST(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (body.action === "freeze") {
    const list = await freezeRaffleList(auth.event, body.all === true ? "all" : "attendees");
    return NextResponse.json(list, { headers: NO_STORE });
  }
  if (body.action === "thaw") {
    await thawRaffleList(auth.event);
    return NextResponse.json({ frozenAt: null }, { headers: NO_STORE });
  }
  return NextResponse.json({ error: "bad_request" }, { status: 400 });
}
