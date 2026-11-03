// El informe para quien auspicia: números, nunca personas. Lo abre quien organiza con su clave y lo
// imprime desde el navegador (la hoja de impresión está en ../../panel.css).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BotonImprimir } from "@/components/panel/BotonImprimir.tsx";
import { AccesoPanel } from "@/components/panel/AccesoPanel.tsx";
import { Contador } from "@/components/panel/Contador.tsx";
import { Aviso, Tarjeta } from "@/components/ui.tsx";
import { formatDate, makeT } from "@/i18n/index.ts";
import { getLang } from "@/i18n/server.ts";
import { getSponsorReport, verifyOrganizerKey } from "@/server/panel.ts";
import { PANEL_KEY_QUERY, panelKeyFromCookies } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = makeT(await getLang());
  return { title: t("panel.informe.titulo"), robots: { index: false, follow: false } };
}

const porcentaje = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : 0);

export default async function InformePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const repo = getRepo();
  const event = await repo.getEventBySlug(slug);
  if (!event) notFound();

  const key = query[PANEL_KEY_QUERY];
  if (typeof key === "string" && key) redirect(`/api/admin/${slug}/entrar?k=${encodeURIComponent(key)}&next=informe`);

  const lang = await getLang();
  const t = makeT(lang);
  if (!(await verifyOrganizerKey(event.id, await panelKeyFromCookies(slug)))) {
    return <AccesoPanel slug={slug} eventName={event.name} t={t} error={query.error === "clave"} next="informe" />;
  }

  const report = await getSponsorReport(event, repo);
  const corte = formatDate(lang, report.generatedAt, event.timezone, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const lugar = event.venue ? `${event.venue}, ${event.place}` : event.place;
  const titular = report.headline;

  return (
    <section className="informe">
      <header className="pantalla-cabecera">
        <p className="panel-sobre">{t("panel.informe.titulo")}</p>
        <h1>{event.name}</h1>
        <p className="bajada">
          {formatDate(lang, event.startsAt, event.timezone)}, {lugar}
        </p>
        <p className="secundario">{t("panel.informe.corte", { fecha: corte })}</p>
      </header>

      {titular ? (
        <div className="informe-titular">
          <strong>{t("panel.informe.titular", { beneficio: titular.name, canjeados: titular.redeemed, otorgados: titular.granted })}</strong>
          <div className="barra barra-verde" role="progressbar" aria-valuemin={0} aria-valuemax={titular.granted} aria-valuenow={titular.redeemed}>
            <span style={{ width: `${porcentaje(titular.redeemed, titular.granted)}%` }} />
          </div>
        </div>
      ) : (
        <Aviso>{t("panel.informe.sinBeneficios")}</Aviso>
      )}

      <div className="informe-cifras">
        <Contador
          etiqueta={t("panel.informe.credenciales")}
          valor={report.issued}
          total={event.capacity}
          detalle={event.capacity ? t("panel.contador.deCupo", { total: event.capacity }) : t("panel.contador.sinCupo")}
        />
        <Contador
          etiqueta={t("panel.informe.entraron")}
          valor={report.checkedIn}
          total={report.issued}
          detalle={t("panel.informe.porcentaje", { porcentaje: porcentaje(report.checkedIn, report.issued) })}
          tono="verde"
        />
      </div>

      <Tarjeta>
        <h2>{t("panel.informe.entradas")}</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">{t("panel.informe.col.entrada")}</th>
              <th scope="col" className="num">
                {t("panel.informe.col.cantidad")}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.ticketTypes.map((ticket) => (
              <tr key={ticket.id}>
                <td>{ticket.name}</td>
                <td className="num">{ticket.issued}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Tarjeta>

      <Tarjeta>
        <h2>{t("panel.informe.canjes")}</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th scope="col">{t("panel.informe.col.beneficio")}</th>
              <th scope="col" className="num">
                {t("panel.informe.col.otorgados")}
              </th>
              <th scope="col" className="num">
                {t("panel.informe.col.canjeados")}
              </th>
              <th scope="col" className="num">
                {t("panel.informe.col.porcentaje")}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.benefits.map((benefit) => (
              <tr key={benefit.id}>
                <td>{benefit.name}</td>
                <td className="num">{benefit.granted}</td>
                <td className="num">{benefit.redeemed}</td>
                <td className="num">{t("panel.informe.pct", { n: porcentaje(benefit.redeemed, benefit.granted) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Tarjeta>

      {report.duplicatesRejected > 0 && <p className="secundario chico">{t("panel.informe.dobles", { n: report.duplicatesRejected })}</p>}
      <p className="apagado chico">{t("panel.informe.nota")}</p>
      <p className="apagado chico solo-impresion">{t("panel.informe.hecho")}</p>

      <div className="panel-accion no-imprimir">
        <Link className="enlace" href={`/admin/${slug}`}>
          {t("panel.informe.volver")}
        </Link>
        <BotonImprimir>{t("panel.informe.imprimir")}</BotonImprimir>
      </div>
    </section>
  );
}
