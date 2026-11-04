// La confirmación: "Inscripción lista" o "Entrada paga", con el enlace a la credencial. Llega con
// ?pase=<id>&k=<clave>: sin la clave correcta no se muestra nada. Si el correo es de verdad, dice que el
// enlace llegó al correo; en modo de prueba (los correos quedan en disco) lo dice y ofrece copiar el enlace.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "@/components/evento/evento.css";
import { BotonCopiarEnlace } from "@/components/evento/BotonCopiarEnlace.tsx";
import { BotonEnlace, Chip, Pantalla, Tarjeta } from "@/components/ui.tsx";
import { formatAmount } from "@/i18n/index.ts";
import { getLang, getT } from "@/i18n/server.ts";
import { loadCredential } from "@/server/evento/credencial.ts";
import { formatEventWhen, formatEventWhere } from "@/server/evento/fecha.ts";
import { getMailer } from "@/server/mailer.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("evento.listo.tituloGratis"), robots: { index: false } };
}

export default async function DonePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const { pase, k } = await searchParams;
  const passId = typeof pase === "string" ? pase : "";
  const key = typeof k === "string" ? k : "";
  const view = await loadCredential(passId, key);
  if (!view || view.event.slug !== slug) notFound();

  const lang = await getLang();
  const t = await getT();
  const when = formatEventWhen(lang, view.event);
  const href = `/p/${encodeURIComponent(view.pass.id)}?k=${encodeURIComponent(key)}`;
  // Con el correo de desarrollo no sale ningún correo: no se promete lo que no llega.
  const correoReal = getMailer().kind === "resend";

  return (
    <Pantalla
      titulo={view.paid ? t("evento.listo.tituloPago") : t("evento.listo.tituloGratis")}
      bajada={correoReal ? t("evento.listo.texto", { correo: view.person.email }) : t("evento.listo.textoPrueba")}
      accion={
        <>
          <BotonEnlace href={href} grande>
            {t("evento.listo.ver")}
          </BotonEnlace>
          {!correoReal && <BotonCopiarEnlace href={href} etiqueta={t("evento.listo.copiar")} listo={t("evento.listo.copiado")} />}
        </>
      }
      nota={view.paid ? t("evento.listo.pago", { monto: formatAmount(lang, view.ticketType.priceUsdc) }) : t("evento.credencial.mostra")}
    >
      <Tarjeta>
        <Chip estado="listo">{t("evento.credencial.numero", { n: view.number, total: view.total })}</Chip>
        <h2>{view.event.name}</h2>
        <p>
          {when.date}, {when.time}
        </p>
        <p>{formatEventWhere(view.event)}</p>
        <p className="tarjeta-pie">
          <strong>{view.person.name}</strong>
          <br />
          {view.ticketType.name}
        </p>
      </Tarjeta>
    </Pantalla>
  );
}
