// El inicio: la lista de eventos. Cada uno lleva a su página pública; abajo, las puertas del
// escáner y del panel para quien organiza.
import Link from "next/link";
import { Aviso, BotonEnlace, Chip, Tarjeta } from "@/components/ui.tsx";
import { formatDate } from "@/i18n/index.ts";
import { getLang, getT } from "@/i18n/server.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const lang = await getLang();
  const t = await getT();
  const repo = getRepo();
  const events = await repo.listEvents();
  const cards = await Promise.all(events.map(async (event) => ({ event, tickets: await repo.listTicketTypes(event.id) })));

  return (
    <section className="pantalla pantalla-ancha">
      <header className="pantalla-cabecera">
        <h1>{t("inicio.titulo")}</h1>
        <p className="bajada">{t("inicio.bajada")}</p>
      </header>
      <div className="pantalla-cuerpo">
        {cards.length === 0 ? (
          <Aviso>{t("inicio.vacio")}</Aviso>
        ) : (
          <ul className="lista">
            {cards.map(({ event, tickets }) => (
              <li key={event.id}>
                <Tarjeta>
                  {tickets.some((ticket) => ticket.priceUsdc === 0) && <Chip estado="listo">{t("inicio.gratis")}</Chip>}
                  <h2>{event.name}</h2>
                  <p>{formatDate(lang, event.startsAt, event.timezone)}</p>
                  <p>{event.venue ? `${event.venue}, ${event.place}` : event.place}</p>
                  <div className="fila tarjeta-pie">
                    <BotonEnlace href={`/e/${event.slug}`}>{t("inicio.abrir")}</BotonEnlace>
                    <Link className="enlace" href={`/admin/${event.slug}`}>
                      {t("inicio.panel")}
                    </Link>
                  </div>
                </Tarjeta>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p>
        <Link className="enlace" href="/scan">
          {t("inicio.escaner")}
        </Link>
      </p>
    </section>
  );
}
