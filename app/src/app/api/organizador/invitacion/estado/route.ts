// POST /api/organizador/invitacion/estado { token }: cómo está una invitación, para /admin/invitacion#<ficha>, que
// la lee en el navegador y la manda en el cuerpo (la ficha nunca va en la dirección). Contesta { signedIn, state,
// eventName, ownerName, role, panelPath } (coorganizar.ts, describeInvite) sin gastarla. Solo desde la propia app
// (403), con el mismo freno por IP que aceptar: una ficha que no existe cuenta como un intento fallido.
import { NextResponse, type NextRequest } from "next/server";
import { describeInvite } from "@/server/coorganizar.ts";
import { clientKey, organizerLoginAttempts } from "@/server/limites.ts";
import { organizerFromRequest } from "@/server/organizador.ts";
import { fromOwnSite, readJsonText } from "@/server/pedido.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!fromOwnSite(request)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  const attempts = organizerLoginAttempts();
  const requester = clientKey(request.headers);
  if ((await attempts.blockedFor(requester)) > 0) return NextResponse.json({ error: "demasiados" }, { status: 429, headers: NO_STORE });
  const token = await readJsonText(request, "token", 100);
  const repo = getRepo();
  const organizer = await organizerFromRequest(request, repo);
  const view = await describeInvite(repo, token, organizer);
  if (view.state === "missing") await attempts.note(requester);
  return NextResponse.json({ signedIn: organizer !== null, ...view }, { headers: NO_STORE });
}
