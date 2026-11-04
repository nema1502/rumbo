// La verificación pública de un certificado de asistencia: /v/<pase>?c=<código>, el enlace que lleva el
// QR del certificado (scripts/certificados.mjs). Solo lectura. Dice si esa persona entró al evento y
// cuándo, muestra el nombre que figura en el certificado para compararlo, y enlaza la entrada en el
// registro público. Sin el código correcto dice lo mismo que si el pase no existiera.
import type { Metadata } from "next";
import "../verificacion.css";
import { BotonEnlace, Chip, Pantalla, Tarjeta } from "@/components/ui.tsx";
import { formatDate } from "@/i18n/index.ts";
import { getLang, getT } from "@/i18n/server.ts";
import { formatEventWhere } from "@/server/evento/fecha.ts";
import { verifyAttendance } from "@/server/verificacion.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ passId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  // La página lleva un nombre: que ningún buscador la guarde.
  return { title: t("verificacion.titulo"), robots: { index: false, follow: false } };
}

export default async function VerificationPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { passId } = await params;
  const { c } = await searchParams;
  const result = await verifyAttendance(passId, typeof c === "string" ? c : null);
  const lang = await getLang();
  const t = await getT();

  if (!result.found || !result.checkedIn) {
    return (
      <Pantalla
        titulo={t("verificacion.noHay.titulo")}
        bajada={t("verificacion.noHay.texto")}
        accion={<BotonEnlace href="/">{t("verificacion.volver")}</BotonEnlace>}
      />
    );
  }

  const { event } = result;
  const dia = formatDate(lang, result.checkedInAt ?? event.startsAt, event.timezone, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hora = result.checkedInAt ? formatDate(lang, result.checkedInAt, event.timezone, { hour: lang === "es" ? "2-digit" : "numeric", minute: "2-digit" }) : null;

  return (
    <Pantalla
      titulo={t("verificacion.titulo")}
      bajada={t("verificacion.entro", { evento: event.name, fecha: dia })}
      accion={
        result.txUrl ? (
          <a className="boton boton-primario boton-grande" href={result.txUrl} target="_blank" rel="noopener noreferrer">
            {t("verificacion.ver")}
          </a>
        ) : undefined
      }
    >
      <Tarjeta className="verificacion-tarjeta">
        <Chip estado="listo">{t("verificacion.chip")}</Chip>
        <p className="secundario chico">{t("verificacion.nombre")}</p>
        <h2>{result.name}</h2>
        <p className="apagado chico">{t("verificacion.nombreAyuda")}</p>
        <p className="secundario chico">{t("verificacion.evento")}</p>
        <p>
          <strong>{event.name}</strong>
          <br />
          {formatEventWhere(event)}
          <br />
          {t("verificacion.organiza", { comunidad: event.organizerName })}
        </p>
        {hora && (
          <p>
            <span className="secundario chico">{t("verificacion.hora")}</span>
            <br />
            {hora}
          </p>
        )}
      </Tarjeta>
      {!result.txUrl && <p className="apagado chico">{t("verificacion.confirmando")}</p>}
      <details className="verificacion-como">
        <summary>{t("verificacion.como")}</summary>
        <p className="apagado chico">{t("verificacion.comoTexto")}</p>
      </details>
    </Pantalla>
  );
}
