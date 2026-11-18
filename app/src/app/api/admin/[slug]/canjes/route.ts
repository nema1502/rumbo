import { NextResponse, type NextRequest } from "next/server";
import { addBenefit, editBenefit } from "@/server/kit/canjes.ts";
import { getPanelState } from "@/server/panel.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

const optionalText = (value: unknown): value is string | undefined => value === undefined || typeof value === "string";

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
  const { name, station, stock } = body;
  if (!optionalText(name) || !optionalText(station) || !(stock === null || typeof stock === "number")) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const repo = getRepo();
  const ok = async () => NextResponse.json({ state: await getPanelState(auth.event, repo) }, { headers: { "Cache-Control": "no-store" } });

  if (body.action === "edit") {
    if (typeof body.benefitId !== "string") return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const result = await editBenefit(repo, auth.event, { benefitId: body.benefitId, name, station, stock });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 400 });
    return ok();
  }

  if (body.action === "add") {
    const { ticketTypeIds } = body;
    if (typeof name !== "string" || !Array.isArray(ticketTypeIds) || !ticketTypeIds.every((id) => typeof id === "string")) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const result = await addBenefit(repo, auth.event, { name, station, stock, ticketTypeIds });
    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : result.error === "full" || result.error === "busy" ? 409 : 400;
      return NextResponse.json({ error: result.error, ticketTypeName: result.ticketTypeName }, { status });
    }
    return ok();
  }

  return NextResponse.json({ error: "bad_request" }, { status: 400 });
}
