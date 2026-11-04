// El inicio: la lista de eventos, cada uno con su página pública. Es para quien se inscribe; las puertas de
// operación (el panel, el escáner, armar un evento) van en una línea chica al pie, y armar solo si este
// servidor lo tiene abierto.
import Link from "next/link";
import { Aviso, BotonEnlace, Chip, Tarjeta } from "@/components/ui.tsx";
import { getLang, getT } from "@/i18n/server.ts";
import { formatEventWhen, formatEventWhere } from "@/server/evento/fecha.ts";
import { createGate } from "@/server/kit/acceso.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const lang = await getLang();
  const t = await getT();
  const repo = getRepo();
  const events = (await repo.listEvents()).filter((event) => event.published);
  const cards = await Promise.all(events.map(async (event) => ({ event, tickets: await repo.listTicketTypes(event.id) })));
  const gate = createGate();
  // La pista para quien desarrolla va a la consola del servidor, no a la pantalla de la gente.
  if (cards.length === 0 && process.env.NODE_ENV !== "production") {
    console.info("[inicio] Todavía no hay eventos. Para crear el de muestra: pnpm seed");
  }

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
            {cards.map(({ event, tickets }) => {
              const when = formatEventWhen(lang, event);
              return (
                <li key={event.id}>
                  <Tarjeta>
                    {tickets.some((ticket) => ticket.priceUsdc === 0) && <Chip estado="listo">{t("inicio.gratis")}</Chip>}
                    <h2>{event.name}</h2>
                    <p>
                      {when.date}, {when.time}
                    </p>
                    <p>{formatEventWhere(event)}</p>
                    <div className="fila tarjeta-pie">
                      <BotonEnlace href={`/e/${event.slug}`}>{t("inicio.abrir")}</BotonEnlace>
                    </div>
                  </Tarjeta>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="inicio-operacion">
        <span>{t("inicio.operacion")}</span>
        <Link className="enlace" href="/admin">
          {t("inicio.organizador")}
        </Link>
        <Link className="enlace" href="/scan">
          {t("inicio.escaner")}
        </Link>
        {gate.open && (
          <Link className="enlace" href="/admin/nuevo">
            {t("kit.inicio.armar")}
          </Link>
        )}
      </p>
    </section>
  );
}
