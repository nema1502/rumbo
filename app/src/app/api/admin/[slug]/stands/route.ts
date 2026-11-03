// Los stands del evento, para quien organiza (pide la clave de organizador):
//   GET  /api/admin/<evento>/stands     cada stand con su código y sus números, la meta y el resumen de la ruta
//   POST /api/admin/<evento>/stands     { action: "create", name, logoUrl?, benefitId? }
//                                       { action: "update", standId, name?, logoUrl?, benefitId? }
//                                       { action: "delete", standId }
//                                       { action: "goal", target, prizeName? }
// Cada acción devuelve el estado nuevo. Los datos que no sirven vuelven como 400 con un código estable.
import { NextResponse, type NextRequest } from "next/server";
import { ensureStationCodes } from "@/server/panel.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";
import { StandsError, createStand, deleteStand, getAdminStands, getStand, grantRoutePrizes, setRouteGoal, updateStand } from "@/server/stands.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  return NextResponse.json(await getAdminStands(auth.event), { headers: NO_STORE });
}

export async function POST(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  const event = auth.event;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  // Un stand de otro evento no se toca con la clave de este.
  const standId = typeof body.standId === "string" ? body.standId : "";
  const own = () => getStand(standId)?.eventId === event.id;

  try {
    switch (body.action) {
      case "create":
        await createStand(event, { name: body.name, logoUrl: body.logoUrl, benefitId: body.benefitId });
        await ensureStationCodes(event);
        break;
      case "update":
        if (!own()) return NextResponse.json({ error: "not_found" }, { status: 404 });
        await updateStand(standId, { name: body.name, logoUrl: body.logoUrl, benefitId: body.benefitId });
        break;
      case "delete":
        if (!own()) return NextResponse.json({ error: "not_found" }, { status: 404 });
        deleteStand(standId);
        // Con un stand menos la meta efectiva puede bajar: quien ya la cumple recibe el premio.
        await grantRoutePrizes(event.id);
        break;
      case "goal":
        await setRouteGoal(event, { target: body.target, prizeName: body.prizeName });
        break;
      default:
        return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof StandsError) return NextResponse.json({ error: error.code }, { status: 400 });
    throw error;
  }
  return NextResponse.json(await getAdminStands(event), { headers: NO_STORE });
}
