// POST /api/admin/<evento>/equipos, con el acceso del panel:
//   { action: "remove", passId }: saca a una persona de su equipo (alguien que se sumó a uno que no era el suyo).
//     El equipo que queda vacío se borra.
//   { action: "prize", teamId, benefitId }: le da un premio a cada integrante del equipo, para retirarlo en la mesa.
import { NextResponse, type NextRequest } from "next/server";
import { grantPrizeToTeam, removeFromTeamByPanel } from "@/server/evento/equipo.ts";
import { getPanelState } from "@/server/panel.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

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
  if (!body || typeof body !== "object") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const repo = getRepo();
  if (body.action === "remove" && typeof body.passId === "string") {
    if (!(await removeFromTeamByPanel(repo, auth.event, body.passId))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  } else if (body.action === "prize" && typeof body.teamId === "string" && typeof body.benefitId === "string") {
    const result = await grantPrizeToTeam(repo, auth.event, body.teamId, body.benefitId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 400 });
  } else return NextResponse.json({ error: "bad_request" }, { status: 400 });
  return NextResponse.json({ state: await getPanelState(auth.event, repo) }, { headers: { "Cache-Control": "no-store" } });
}
