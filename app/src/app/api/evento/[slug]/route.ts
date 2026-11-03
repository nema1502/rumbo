// GET /api/evento/<slug>: lo público del evento, sus entradas (con lo que incluye cada una) y su catálogo
// de beneficios. Sin cuentas ni contratos: eso vive en el servidor.
import { NextResponse, type NextRequest } from "next/server";
import { isPublicKind } from "@/lib/credential-kinds.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function GET(_request: NextRequest, { params }: { params: Params }) {
  const { slug } = await params;
  const repo = getRepo();
  const event = await repo.getEventBySlug(slug);
  if (!event || !event.published) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [allTickets, benefits] = await Promise.all([repo.listTicketTypes(event.id), repo.listBenefits(event.id)]);
  const tickets = allTickets.filter((ticket) => isPublicKind(ticket.credentialKind));
  const ticketsOut = await Promise.all(
    tickets.map(async (ticket) => ({
      id: ticket.id,
      name: ticket.name,
      priceUsdc: ticket.priceUsdc,
      free: ticket.priceUsdc === 0,
      benefits: (await repo.listTicketTypeBenefits(ticket.id)).map((b) => ({ id: b.id, name: b.name, kind: b.kind })),
    })),
  );

  return NextResponse.json({
    event: {
      slug: event.slug,
      name: event.name,
      description: event.description,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      place: event.place,
      venue: event.venue,
      organizerName: event.organizerName,
      capacity: event.capacity,
    },
    tickets: ticketsOut,
    benefits: benefits.map((b) => ({ id: b.id, name: b.name, kind: b.kind, station: b.station })),
  });
}
