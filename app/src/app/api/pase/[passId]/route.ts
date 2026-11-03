// GET /api/pase/<id>?k=<clave>: la credencial como datos (el estado, lo que le toca y el contenido de los QR).
// Sin la clave correcta, 404, sin decir si el pase existe.
import { NextResponse, type NextRequest } from "next/server";
import { loadCredential } from "@/server/evento/credencial.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ passId: string }>;

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const { passId } = await params;
  const view = await loadCredential(passId, request.nextUrl.searchParams.get("k"));
  if (!view) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(
    {
      passId: view.pass.id,
      event: { slug: view.event.slug, name: view.event.name, startsAt: view.event.startsAt, timezone: view.event.timezone, place: view.event.place, venue: view.event.venue },
      person: { name: view.person.name },
      ticketType: { id: view.ticketType.id, name: view.ticketType.name, priceUsdc: view.ticketType.priceUsdc },
      number: view.number,
      total: view.total,
      paid: view.paid,
      checkedIn: view.checkedIn,
      benefits: view.benefits.map((b) => ({ id: b.id, name: b.name, kind: b.kind, state: b.state, redeemed: b.redeemed, inDraw: b.inDraw })),
      // El QR fijo de la credencial impresa, y lo que el celular necesita para armar el que rota cada 20 segundos.
      qr: view.qrPayload,
      live: view.live,
      chainChecked: view.chainChecked,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
