// POST /api/organizador/invitacion: "Sumarme al equipo de este evento", el formulario de /admin/invitacion/<ficha>.
// Lleva la ficha de la invitación (campo token). Con la sesión de organizador, suma esa cuenta al equipo del evento
// y gasta la invitación (coorganizar.ts, acceptInvite), y lleva al panel del evento (o al borrador, si no se
// publicó). Sin sesión, a entrar como organizador, que vuelve a la invitación. Si la invitación ya se usó, venció o se
// anuló, o es la dueña, vuelve a la invitación con el motivo (?error=). Solo desde la propia app (403), con el freno
// por IP de las entradas fallidas (organizerLoginAttempts): una ficha que no existe cuenta como un intento fallido.
import { NextResponse, type NextRequest } from "next/server";
import { acceptInvite, invitePath, lookupInvite } from "@/server/coorganizar.ts";
import { clientKey, organizerLoginAttempts } from "@/server/limites.ts";
import { organizerFromRequest } from "@/server/organizador.ts";
import { seeOther } from "@/server/panel-sesion.ts";
import { fromOwnSite } from "@/server/pedido.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

async function readToken(request: NextRequest): Promise<string> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await request.json()) as { token?: unknown };
      return typeof body?.token === "string" ? body.token.slice(0, 100) : "";
    }
    const value = (await request.formData()).get("token");
    return typeof value === "string" ? value.slice(0, 100) : "";
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  if (!fromOwnSite(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const token = await readToken(request);
  const back = (error: string) => seeOther(`${invitePath(token)}?error=${error}`);
  const attempts = organizerLoginAttempts();
  const requester = clientKey(request.headers);
  if ((await attempts.blockedFor(requester)) > 0) return back("demasiados");

  const repo = getRepo();
  const organizer = await organizerFromRequest(request, repo);
  if (!organizer) return seeOther(`/admin?volver=${encodeURIComponent(invitePath(token))}`);

  const found = await lookupInvite(token);
  const event = found.eventId ? await repo.getEventById(found.eventId) : null;
  const result = await acceptInvite(token, organizer, event);
  if (!result.ok) {
    if (result.reason === "missing") await attempts.note(requester);
    return back(result.reason);
  }
  const target = `/admin/${encodeURIComponent(event!.slug)}`;
  return seeOther(event!.published ? `${target}?equipo=1` : `${target}/armar?equipo=1`);
}
