import { NextResponse, type NextRequest } from "next/server";
import { getOrCreateAccessKey } from "@/server/evento/acceso.ts";
import { passUrl } from "@/server/evento/inscripcion.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";
import { langOfRequest, originOfRequest } from "@/server/pedido.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  const passId = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).passId : undefined;
  if (typeof passId !== "string") return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  const pass = await getRepo().getPass(passId);
  if (!pass || pass.eventId !== auth.event.id || pass.status === "pending") return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const url = passUrl(pass.id, await getOrCreateAccessKey(pass.id), langOfRequest(request), originOfRequest(request));
  return NextResponse.json({ url }, { headers: NO_STORE });
}
