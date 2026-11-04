// La puerta de quien organiza: sin sesión, "Entrar como organizador" (con Google o con el correo, por Pollar);
// con sesión, "Mis eventos" y "Crear evento". Si llega con ?volver=/admin/<evento> (la sesión venció en el panel,
// o el panel pidió entrar), después de entrar vuelve ahí; solo a una ruta propia que empiece con /admin/. Con
// Pollar apagado no hay cuenta de organizador: la lista de paneles, que se abren con la clave de cada evento.
import type { Metadata } from "next";
import Link from "next/link";
import "@/components/evento/evento.css";
import { EntrarOrganizador } from "@/components/panel/EntrarOrganizador.tsx";
import { BotonEnlace, Chip, Pantalla, Tarjeta, Aviso } from "@/components/ui.tsx";
import { getLang, getT } from "@/i18n/server.ts";
import { pollarPublishableKey } from "@/server/accounts.ts";
import { formatEventWhen, formatEventWhere } from "@/server/evento/fecha.ts";
import { organizerFromCookies } from "@/server/organizador.ts";
import { safeReturnPath } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: pollarPublishableKey() ? t("panel.cuenta.titulo") : t("panel.cuenta.paneles"), robots: { index: false, follow: false } };
}

export default async function OrganizerHomePage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const t = await getT();
  const lang = await getLang();
  const repo = getRepo();
  const organizer = await organizerFromCookies(repo);

  if (!organizer) {
    const pollarKey = pollarPublishableKey();
    if (pollarKey) return <EntrarOrganizador pollarKey={pollarKey} volver={safeReturnPath(query.volver)} />;
    const events = (await repo.listEvents()).filter((event) => event.published);
    return (
      <Pantalla titulo={t("panel.cuenta.paneles")} accion={<BotonEnlace href="/">{t("noEncontrado.volver")}</BotonEnlace>}>
        <p>{t("panel.cuenta.panelesAyuda")}</p>
        <ul className="lista">
          {events.map((event) => (
            <li key={event.id}>
              <Link className="enlace" href={`/admin/${event.slug}`}>
                {t("inicio.panelDe", { evento: event.name })}
              </Link>
            </li>
          ))}
        </ul>
      </Pantalla>
    );
  }

  const events = await repo.listEventsByOrganizer(organizer.id);
  return (
    <section className="pantalla pantalla-ancha mis-eventos">
      <header className="pantalla-cabecera">
        <p className="panel-sobre">{organizer.name ? t("panel.cuenta.quien", { nombre: organizer.name }) : t("panel.cuenta.quienSinNombre")}</p>
        <h1>{t("panel.cuenta.misEventos")}</h1>
        <p className="bajada">{t("panel.cuenta.misEventosBajada")}</p>
      </header>
      <div className="pantalla-cuerpo">
        {events.length === 0 ? (
          <Aviso>{t("panel.cuenta.vacio")}</Aviso>
        ) : (
          <ul className="lista">
            {events.map((event) => {
              const when = formatEventWhen(lang, event);
              const panel = `/admin/${encodeURIComponent(event.slug)}`;
              return (
                <li key={event.id}>
                  <Tarjeta>
                    <Chip estado={event.published ? "listo" : "pendiente"}>{event.published ? t("panel.cuenta.publicado") : t("panel.cuenta.borrador")}</Chip>
                    <h2>{event.name}</h2>
                    <p>
                      {when.date}, {when.time}
                    </p>
                    <p>{formatEventWhere(event)}</p>
                    {/* Una sola acción principal en la pantalla ("Crear evento"): el panel de cada uno es secundario. */}
                    <div className="fila tarjeta-pie">
                      <BotonEnlace href={event.published ? panel : `${panel}/armar`} variante="secundario">
                        {event.published ? t("panel.cuenta.abrirPanel") : t("panel.cuenta.seguirArmando")}
                      </BotonEnlace>
                    </div>
                  </Tarjeta>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="pantalla-accion">
        <BotonEnlace href="/admin/nuevo" grande>
          {t("panel.cuenta.crear")}
        </BotonEnlace>
        <form className="panel-salir" method="post" action="/api/organizador/salir">
          <span className="apagado chico">{t("panel.cuenta.salirAyuda")}</span>
          <button type="submit" className="enlace">
            {t("panel.cuenta.salir")}
          </button>
        </form>
      </div>
    </section>
  );
}
