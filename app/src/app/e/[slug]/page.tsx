// La página pública del evento: el afiche (nombre, fecha, lugar, qué incluye) y las entradas, cada una
// con su único botón. Primero se elige la entrada; el formulario viene después, en /e/[slug]/inscripcion.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "@/components/evento/evento.css";
import { FilaEntrada } from "@/components/evento/FilaEntrada.tsx";
import { Aviso, BotonEnlace, Chip } from "@/components/ui.tsx";
import { getLang, getT } from "@/i18n/server.ts";
import { isPublicKind } from "@/lib/credential-kinds.ts";
import { formatEventWhen, formatEventWhere, joinList } from "@/server/evento/fecha.ts";
import { getRepo, type TicketTypeBenefit } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const event = await getRepo().getEventBySlug(slug);
  if (!event || !event.published) return {};
  const description = event.description || undefined;
  return { title: event.name, description, openGraph: { title: event.name, description, type: "website" } };
}

export default async function EventPage({ params }: { params: Params }) {
  const { slug } = await params;
  const repo = getRepo();
  const event = await repo.getEventBySlug(slug);
  // Un borrador (el evento recién salido de una plantilla) no se ve hasta que se publica.
  if (!event || !event.published) notFound();

  const lang = await getLang();
  const t = await getT();
  const [allTickets, catalog] = await Promise.all([repo.listTicketTypes(event.id), repo.listBenefits(event.id)]);
  // Solo el asistente se inscribe desde la página; oradores, jurado y demás reciben su credencial por invitación.
  const tickets = allTickets.filter((ticket) => isPublicKind(ticket.credentialKind));
  const benefitsByTicket = new Map<string, TicketTypeBenefit[]>();
  for (const ticket of tickets) benefitsByTicket.set(ticket.id, await repo.listTicketTypeBenefits(ticket.id));

  const when = formatEventWhen(lang, event);
  const hasFree = tickets.some((ticket) => ticket.priceUsdc === 0);

  // Qué incluye el evento y con qué entrada viene cada cosa (si no viene con todas).
  const included = catalog.map((benefit) => {
    const withTickets = tickets.filter((ticket) => benefitsByTicket.get(ticket.id)?.some((b) => b.id === benefit.id));
    let detail: string | null = null;
    if (withTickets.length === 0) detail = benefit.kind === "prize" ? t("evento.incluye.sorteo") : null;
    else if (withTickets.length < tickets.length) detail = t("evento.incluye.con", { entrada: joinList(lang, withTickets.map((ticket) => ticket.name)) });
    return { benefit, detail };
  });

  return (
    <section className="evento">
      <header className="evento-afiche">
        {hasFree && <Chip estado="listo">{t("inicio.gratis")}</Chip>}
        <h1>{event.name}</h1>
        <p className="evento-cuando">
          <strong>{when.date}</strong>
          <span>{when.time}</span>
          <span>{formatEventWhere(event)}</span>
        </p>
        {event.description && <p className="evento-descripcion">{event.description}</p>}
        <p className="evento-organiza">{t("evento.organiza", { nombre: event.organizerName })}</p>
        {included.length > 0 && (
          <div className="evento-incluye-bloque">
            <h2 className="evento-subtitulo">{t("evento.incluye")}</h2>
            <ul className="evento-incluye">
              {included.map(({ benefit, detail }) => (
                <li key={benefit.id}>
                  <span>{benefit.name}</span>
                  {detail && <span className="detalle">{detail}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>
      <div className="evento-entradas">
        <h2 className="evento-subtitulo">{t("evento.entradas")}</h2>
        {tickets.length === 0 ? (
          <Aviso>{t("evento.sinEntradas")}</Aviso>
        ) : (
          tickets.map((ticket) => (
            <FilaEntrada
              key={ticket.id}
              ticket={ticket}
              benefits={benefitsByTicket.get(ticket.id) ?? []}
              href={`/e/${encodeURIComponent(slug)}/inscripcion?entrada=${encodeURIComponent(ticket.id)}`}
              lang={lang}
              t={t}
            />
          ))
        )}
        {event.teamSignup && tickets.length > 0 && (
          <BotonEnlace variante="secundario" href={`/e/${encodeURIComponent(slug)}/equipo`}>
            {t("kit.equipo.boton")}
          </BotonEnlace>
        )}
      </div>
    </section>
  );
}
