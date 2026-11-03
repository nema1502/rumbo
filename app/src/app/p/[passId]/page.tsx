// La credencial: el evento, el nombre, "Credencial N de M", el estado, el QR grande y lo que le toca a
// la persona. Se abre con el enlace personal (/p/<pase>?k=<clave>); la única acción es descargarla en SVG.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "@/components/evento/evento.css";
import { Credencial } from "@/components/evento/Credencial.tsx";
import { RutaCredencial } from "@/components/stands/RutaCredencial.tsx";
import "@/components/stands/stands.css";
import { getLang, getT } from "@/i18n/server.ts";
import { renderQrSvg } from "@/lib/qr-svg.ts";
import { loadCredential } from "@/server/evento/credencial.ts";
import { formatEventWhen, formatEventWhere } from "@/server/evento/fecha.ts";
import { getPassRoute } from "@/server/stands.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ passId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("evento.credencial.titulo"), robots: { index: false, follow: false } };
}

export default async function PassPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { passId } = await params;
  const { k } = await searchParams;
  const key = typeof k === "string" ? k : "";
  const view = await loadCredential(passId, key);
  if (!view) notFound();

  const lang = await getLang();
  const t = await getT();
  const when = formatEventWhen(lang, view.event);
  const qrSvg = renderQrSvg(view.qrPayload, { cellSize: 4, margin: 2 });
  const download = `/api/pase/${encodeURIComponent(view.pass.id)}/svg?k=${encodeURIComponent(key)}&lang=${lang}`;
  // La ruta de stands, si el evento tiene stands: la credencial recibe ahí la pregunta de permiso de cada uno.
  const route = await getPassRoute(view.pass.id);

  return (
    <section className="pantalla credencial-pantalla">
      <header className="pantalla-cabecera credencial-titulo">
        <p className="credencial-ante">{t("evento.credencial.titulo")}</p>
        <h1>{view.event.name}</h1>
        <p className="bajada">
          {when.date}, {when.time}. {formatEventWhere(view.event)}.
        </p>
      </header>
      <div className="pantalla-cuerpo">
        <Credencial view={view} t={t} qrSvg={qrSvg} />
        <p className="apagado chico credencial-ayuda">{t("evento.credencial.mostra")}</p>
        {route && <RutaCredencial passId={view.pass.id} accessKey={key} initial={route} />}
      </div>
      <div className="pantalla-accion">
        <a className="boton boton-primario boton-grande" href={download} download={`credencial-${view.pass.id}.svg`}>
          {t("evento.credencial.descargar")}
        </a>
        <p className="nota">{t("evento.credencial.imprimir")}</p>
      </div>
    </section>
  );
}
