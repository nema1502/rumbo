// La página pública del evento: el afiche (nombre, fecha, lugar, qué incluye) y las entradas, cada una
// con su único botón. Primero se elige la entrada; el formulario viene después, en /e/[slug]/inscripcion.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "@/components/evento/evento.css";
import { FilaEntrada } from "@/components/evento/FilaEntrada.tsx";
import { Aviso, BotonEnlace, Chip } from "@/components/ui.tsx";
import { getLang, getT } from "@/i18n/server.ts";
import { isPublicKind } from "@/lib/credential-kinds.ts";
import { isSoldOut, readContractCapacity } from "@/server/evento/cupo.ts";
import { formatEventWhen, formatEventWhere, joinList } from "@/server/evento/fecha.ts";
import { getRepo, type TicketTypeBenefit } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

/** Hasta cuántas cosas de "Qué incluye" se muestran enteras; con más, se ven dos y el resto se despliega. */
const INCLUIDOS_ENTEROS = 4;
const INCLUIDOS_A_LA_VISTA = 2;

function Incluido({ name, detail }: { name: string; detail: string | null }) {
  return (
    <li>
      <span>{name}</span>
      {detail && <span className="detalle">{detail}</span>}
    </li>
  );
}

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
  // Si el contrato de una entrada ya no emite más, la tarjeta dice "Agotada" (se lee una vez por minuto, no en cada carga).
  const cupos = await Promise.all(tickets.map((ticket) => readContractCapacity(ticket.contractId ?? event.contractId)));

  // Qué incluye el evento y con qué entrada viene cada cosa (si no viene con todas).
  const included = catalog.map((benefit) => {
    const withTickets = tickets.filter((ticket) => benefitsByTicket.get(ticket.id)?.some((b) => b.id === benefit.id));
    let detail: string | null = null;
    if (withTickets.length === 0) detail = benefit.kind === "prize" ? t("evento.incluye.sorteo") : null;
    else if (withTickets.length < tickets.length) detail = t("evento.incluye.con", { entrada: joinList(lang, withTickets.map((ticket) => ticket.name)) });
    return { benefit, detail };
  });

  const visibles = included.length > INCLUIDOS_ENTEROS ? INCLUIDOS_A_LA_VISTA : included.length;

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
            <ul className="evento-incluye">{included.slice(0, visibles).map(({ benefit, detail }) => <Incluido key={benefit.id} name={benefit.name} detail={detail} />)}</ul>
            {included.length > visibles && (
              // Un evento de varios días lista una comida por franja: el resto se despliega, para que la entrada quede a la vista.
              <details className="evento-incluye-mas">
                <summary>{t("kit.evento.verMas", { n: included.length - visibles })}</summary>
                <ul className="evento-incluye">{included.slice(visibles).map(({ benefit, detail }) => <Incluido key={benefit.id} name={benefit.name} detail={detail} />)}</ul>
              </details>
            )}
          </div>
        )}
      </header>
      <div className="evento-entradas">
        <h2 className="evento-subtitulo">{t("evento.entradas")}</h2>
        {tickets.length === 0 ? (
          <Aviso>{t("evento.sinEntradas")}</Aviso>
        ) : (
          tickets.map((ticket, i) => (
            <FilaEntrada
              key={ticket.id}
              ticket={ticket}
              benefits={benefitsByTicket.get(ticket.id) ?? []}
              href={`/e/${encodeURIComponent(slug)}/inscripcion?entrada=${encodeURIComponent(ticket.id)}`}
              lang={lang}
              t={t}
              soldOut={isSoldOut(cupos[i] ?? null)}
              secondary={ticket.priceUsdc > 0 && hasFree}
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
