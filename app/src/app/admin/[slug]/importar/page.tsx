// Importar la lista de invitados de Luma o de Bevy al evento. Hay que haber entrado al panel de ese evento
// (la clave del organizador) y el evento tiene que estar publicado: las credenciales llevan el contrato de su entrada.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Importador } from "@/components/kit/Importador.tsx";
import { AccesoPanel } from "@/components/panel/AccesoPanel.tsx";
import { getT } from "@/i18n/server.ts";
import { verifyOrganizerKey } from "@/server/panel.ts";
import { PANEL_KEY_QUERY, panelKeyFromCookies } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("kit.importar.titulo"), robots: { index: false, follow: false } };
}

export default async function ImportPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const event = await getRepo().getEventBySlug(slug);
  if (!event) notFound();

  const key = query[PANEL_KEY_QUERY];
  if (typeof key === "string" && key) redirect(`/api/admin/${encodeURIComponent(slug)}/entrar?k=${encodeURIComponent(key)}&next=importar`);

  const t = await getT();
  if (!(await verifyOrganizerKey(event.id, await panelKeyFromCookies(slug)))) {
    return <AccesoPanel slug={slug} eventName={event.name} t={t} error={query.error === "clave"} next="importar" />;
  }
  if (!event.published) redirect(`/admin/${encodeURIComponent(slug)}/armar`);

  return <Importador slug={slug} volverA={`/admin/${encodeURIComponent(slug)}`} />;
}
