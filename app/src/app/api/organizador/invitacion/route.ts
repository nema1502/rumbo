// POST /api/organizador/invitacion { token }: "Sumarme al equipo de este evento", desde /admin/invitacion#<ficha>.
// La ficha llega en el cuerpo, nunca en la dirección (coorganizar.ts). Con la sesión de organizador, suma esa cuenta
// al equipo del evento y gasta la invitación (acceptInvite) y contesta { ok: true, path } con el panel del evento (o
// el borrador, si no se publicó) y ?equipo=1 para el aviso. Sin sesión, 401 { error: "sesion" }. Si la invitación ya
// se usó, venció o se anuló, o es la dueña, { ok: false, error: <motivo> }. Solo desde la propia app (403), con el
// freno por IP de las entradas fallidas (organizerLoginAttempts): una ficha que no existe cuenta como un intento.
import { NextResponse, type NextRequest } from "next/server";
import { acceptInvite, lookupInvite, teamLandingPath } from "@/server/coorganizar.ts";
import { clientKey, organizerLoginAttempts } from "@/server/limites.ts";
import { organizerFromRequest } from "@/server/organizador.ts";
import { fromOwnSite, readJsonText } from "@/server/pedido.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(request: NextRequest) {
  if (!fromOwnSite(request)) return json({ error: "forbidden" }, 403);
  const token = await readJsonText(request, "token", 100);
  const attempts = organizerLoginAttempts();
  const requester = clientKey(request.headers);
  if ((await attempts.blockedFor(requester)) > 0) return json({ ok: false, error: "demasiados" }, 429);

  const repo = getRepo();
  const organizer = await organizerFromRequest(request, repo);
  if (!organizer) return json({ ok: false, error: "sesion" }, 401);

  const found = await lookupInvite(token);
  const event = found.eventId ? await repo.getEventById(found.eventId) : null;
  const result = await acceptInvite(token, organizer, event);
  if (!result.ok) {
    if (result.reason === "missing") await attempts.note(requester);
    return json({ ok: false, error: result.reason });
  }
  return json({ ok: true, path: `${teamLandingPath(event!)}?equipo=1` });
}
