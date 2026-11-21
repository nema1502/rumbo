// GET /api/pase/<id>/equipo?k=<clave>: el equipo de la credencial (o si puede armar uno).
// POST con { action: "create", name } | { action: "join", code } | { action: "rename", name } | { action: "leave" }.
// Sin la clave correcta, 404, sin decir si el pase existe, como la credencial.
import { NextResponse, type NextRequest } from "next/server";
import { verifyAccessKey } from "@/server/evento/acceso.ts";
import { createTeamFor, joinTeamFor, leaveTeamFor, passTeamState, renameTeamFor, type TeamError } from "@/server/evento/equipo.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ passId: string }>;

const NO_STORE = { "Cache-Control": "no-store" };
const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

async function load(request: NextRequest, passId: string) {
  if (!(await verifyAccessKey(passId, request.nextUrl.searchParams.get("k")))) return null;
  const repo = getRepo();
  const pass = await repo.getPass(passId);
  const event = pass ? await repo.getEventById(pass.eventId) : null;
  return pass && event ? { repo, pass, event } : null;
}

const STATUS: Record<TeamError, number> = { not_allowed: 403, name: 400, name_taken: 409, already: 409, code: 404, full: 409, not_in_team: 409, blocked: 429 };

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const { passId } = await params;
  const found = await load(request, passId);
  if (!found) return notFound();
  return NextResponse.json({ state: await passTeamState(found.repo, found.event, found.pass) }, { headers: NO_STORE });
}

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { passId } = await params;
  const found = await load(request, passId);
  if (!found) return notFound();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  const { repo, event, pass } = found;
  const result =
    body.action === "create"
      ? await createTeamFor(repo, event, pass, body.name)
      : body.action === "join"
        ? await joinTeamFor(repo, event, pass, body.code)
        : body.action === "rename"
          ? await renameTeamFor(repo, event, pass, body.name)
          : body.action === "leave"
            ? await leaveTeamFor(repo, event, pass)
            : null;
  if (!result) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error], headers: NO_STORE });
  return NextResponse.json({ state: result.state }, { headers: NO_STORE });
}
