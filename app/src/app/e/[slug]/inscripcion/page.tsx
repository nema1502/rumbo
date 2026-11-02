// El formulario para una entrada: nombre y correo. Se llega desde el botón de la entrada, con ?entrada=<id>.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import "@/components/evento/evento.css";
import { FormularioInscripcion } from "@/components/evento/FormularioInscripcion.tsx";
import { formatAmount } from "@/i18n/index.ts";
import { getLang, getT } from "@/i18n/server.ts";
import { formatEventWhen, joinList } from "@/server/evento/fecha.ts";
import { getRepo } from "@/server/repo.ts";
import { registerAction } from "./actions.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("evento.form.tituloGratis"), robots: { index: false } };
}

export default async function RegistrationPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const { entrada } = await searchParams;
  const repo = getRepo();
  const event = await repo.getEventBySlug(slug);
  if (!event) notFound();
  const ticket = typeof entrada === "string" ? await repo.getTicketType(entrada) : null;
  if (!ticket || ticket.eventId !== event.id) redirect(`/e/${encodeURIComponent(slug)}`);

  const lang = await getLang();
  const t = await getT();
  const benefits = await repo.listTicketTypeBenefits(ticket.id);
  const when = formatEventWhen(lang, event);
  const paid = ticket.priceUsdc > 0;
  const monto = formatAmount(lang, ticket.priceUsdc);

  return (
    <FormularioInscripcion
      action={registerAction}
      slug={slug}
      eventName={event.name}
      when={`${when.date}, ${when.time}`}
      paid={paid}
      monto={monto}
      ticket={{
        id: ticket.id,
        name: ticket.name,
        price: paid ? t("pago.precio", { monto }) : t("pago.gratis"),
        includes: benefits.length > 0 ? t("evento.entrada.incluye", { lista: joinList(lang, benefits.map((b) => b.name)) }) : null,
      }}
    />
  );
}
