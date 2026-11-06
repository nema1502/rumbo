// /api/admin/<evento>/equipo: "Tu equipo", solo para la dueña del evento (la cuenta que lo creó). Quien coorganiza o
// entró con la clave recibe 403 owner_only: sumar o sacar personas es de la dueña.
//   GET   el equipo: quienes coorganizan, las invitaciones abiertas y las cuentas autorizadas que no entraron.
//   POST  { accion: "invitar" }                     un enlace de invitación nuevo: { path, invite }. La ficha va en path
//                                                     y se muestra una sola vez; en la base queda su huella.
//         { accion: "autorizar", cuenta: "G..." }   autoriza una cuenta de Stellar.
//         { accion: "sacar", organizador: "<id>" }  saca a alguien del equipo.
//         { accion: "anular", invitacion: "<id>" }  anula una invitación abierta.
//         { accion: "anular", cuenta: "G..." }      anula una cuenta autorizada que todavía no entró.
// Cada POST contesta además el equipo como queda. Solo desde la propia app. Errores: 409 limit (veinte abiertas como
// mucho), 422 invalid, self o already al autorizar, 404 si lo que se quiere sacar o anular no existe.
import { NextResponse, type NextRequest } from "next/server";
import { authorizeAccount, createInvite, invitePath, listTeam, removeCoorganizer, revokeGrant, revokeInvite } from "@/server/coorganizar.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";
import { fromOwnSite } from "@/server/pedido.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };
const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function ownerOf(request: NextRequest, slug: string) {
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return { response: auth.response };
  if (auth.role !== "owner" || !auth.organizer) return { response: json({ error: "owner_only" }, 403) };
  return { event: auth.event, owner: auth.organizer };
}

export async function GET(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await ownerOf(request, slug);
  if (auth.response) return auth.response;
  return json({ team: await listTeam(auth.event) });
}

export async function POST(request: NextRequest, { params }: Context) {
  if (!fromOwnSite(request)) return json({ error: "forbidden" }, 403);
  const { slug } = await params;
  const auth = await ownerOf(request, slug);
  if (auth.response) return auth.response;
  const { event, owner } = auth;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_json" }, 400);

  const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 120) : "");
  switch (body.accion) {
    case "invitar": {
      const created = await createInvite(event, owner);
      if (!created.ok) return json({ error: created.reason }, 409);
      return json({ path: invitePath(created.token), invite: created.invite, team: await listTeam(event) }, 201);
    }
    case "autorizar": {
      const result = await authorizeAccount(event, owner, body.cuenta);
      if (!result.ok) return json({ error: result.reason }, result.reason === "limit" ? 409 : 422);
      return json({ publicKey: result.publicKey, team: await listTeam(event) }, 201);
    }
    case "sacar": {
      if (!(await removeCoorganizer(event, text(body.organizador)))) return json({ error: "not_found" }, 404);
      return json({ team: await listTeam(event) });
    }
    case "anular": {
      const done = body.invitacion !== undefined ? await revokeInvite(event, text(body.invitacion)) : await revokeGrant(event, text(body.cuenta).toUpperCase());
      if (!done) return json({ error: "not_found" }, 404);
      return json({ team: await listTeam(event) });
    }
    default:
      return json({ error: "invalid_action" }, 400);
  }
}
