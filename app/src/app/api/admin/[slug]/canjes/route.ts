import { NextResponse, type NextRequest } from "next/server";
import { editBenefit } from "@/server/kit/canjes.ts";
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
  if (!body || typeof body !== "object" || Array.isArray(body) || body.action !== "edit") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { benefitId, name, station, stock } = body;
  if (typeof benefitId !== "string" || !optionalText(name) || !optionalText(station) || !(stock === null || typeof stock === "number")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const repo = getRepo();
  const result = await editBenefit(repo, auth.event, { benefitId, name, station, stock });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 400 });
  return NextResponse.json({ state: await getPanelState(auth.event, repo) }, { headers: { "Cache-Control": "no-store" } });
}
