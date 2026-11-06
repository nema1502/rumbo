// La puerta de quien organiza: sin sesión, "Entrar como organizador" (con Google o con el correo, por Pollar);
// con sesión, "Mis eventos" (los propios y los que coorganiza, con su etiqueta, y arriba su cuenta para pasársela a
// quien lo tiene que sumar) y "Crear evento". Si llega con ?volver=/admin/<evento> (la sesión venció en el panel,
// o el panel pidió entrar), después de entrar vuelve ahí; solo a una ruta propia que empiece con /admin/. Con
// Pollar apagado no hay cuenta de organizador: la lista de paneles, que se abren con la clave de cada evento.
import type { Metadata } from "next";
import Link from "next/link";
import "@/components/evento/evento.css";
import { BotonCopiar } from "@/components/panel/BotonCopiar.tsx";
import { CerrarSesion } from "@/components/panel/CerrarSesion.tsx";
import { EntrarOrganizador } from "@/components/panel/EntrarOrganizador.tsx";
import { BotonEnlace, Chip, Pantalla, Tarjeta, Aviso } from "@/components/ui.tsx";
import { getLang, getT } from "@/i18n/server.ts";
import { pollarPublishableKey } from "@/server/accounts.ts";
import { claimAccountGrants, listCoorganizedEventIds, shortAccount } from "@/server/coorganizar.ts";
import { formatEventWhen, formatEventWhere } from "@/server/evento/fecha.ts";
import { organizerFromCookies } from "@/server/organizador.ts";
import { safeReturnPath } from "@/server/panel-sesion.ts";
import { getRepo, type EventRecord } from "@/server/repo.ts";

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

  // Si alguna dueña autorizó esta cuenta desde que entró, ese evento aparece ya.
  await claimAccountGrants(organizer);
  const own = await repo.listEventsByOrganizer(organizer.id);
  const shared = (await Promise.all((await listCoorganizedEventIds(organizer.id)).map((id) => repo.getEventById(id)))).filter((e): e is EventRecord => e !== null);
  const events = [...own.map((event) => ({ event, coorganizo: false })), ...shared.map((event) => ({ event, coorganizo: true }))].sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt));
  return (
    <section className="pantalla pantalla-ancha mis-eventos">
      <header className="pantalla-cabecera">
        <p className="panel-sobre">{organizer.name ? t("panel.cuenta.quien", { nombre: organizer.name }) : t("panel.cuenta.quienSinNombre")}</p>
        <h1>{t("panel.cuenta.misEventos")}</h1>
        <p className="bajada">{t("panel.cuenta.misEventosBajada")}</p>
      </header>
      <div className="pantalla-cuerpo">
        <div className="mi-cuenta">
          <span>
            {t("panel.cuenta.tuCuenta")} <code title={organizer.publicKey}>{shortAccount(organizer.publicKey)}</code>
          </span>
          <BotonCopiar texto={organizer.publicKey} etiqueta={t("panel.cuenta.copiarCuenta")} listo={t("panel.puestos.copiado")} />
          <span className="chico apagado">{t("panel.cuenta.copiarCuentaAyuda")}</span>
        </div>
        {events.length === 0 ? (
          <Aviso>{t("panel.cuenta.vacio")}</Aviso>
        ) : (
          <ul className="lista">
            {events.map(({ event, coorganizo }) => {
              const when = formatEventWhen(lang, event);
              const panel = `/admin/${encodeURIComponent(event.slug)}`;
              return (
                <li key={event.id}>
                  <Tarjeta>
                    <p className="fila">
                      <Chip estado={event.published ? "listo" : "pendiente"}>{event.published ? t("panel.cuenta.publicado") : t("panel.cuenta.borrador")}</Chip>
                      {coorganizo && <Chip estado="neutro">{t("panel.cuenta.coorganizas")}</Chip>}
                    </p>
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
        {/* Lo que viene para los capítulos de Stellar, dicho como promesa: todavía no existe. */}
        <Tarjeta className="proximamente">
          <Chip estado="neutro">{t("panel.cuenta.proximamente")}</Chip>
          <h2>{t("panel.cuenta.cierreTitulo")}</h2>
          <p>{t("panel.cuenta.cierreTexto")}</p>
        </Tarjeta>
      </div>
      <div className="pantalla-accion">
        <BotonEnlace href="/admin/nuevo" grande>
          {t("panel.cuenta.crear")}
        </BotonEnlace>
        <CerrarSesion pollarKey={pollarPublishableKey()} />
      </div>
    </section>
  );
}
