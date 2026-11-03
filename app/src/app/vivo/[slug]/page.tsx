// La pantalla en vivo, para proyectar en el evento: cuántas personas entraron, los almuerzos y la merch
// entregados, el ranking de la ruta de stands y el espacio del sorteo. La abre quien organiza con su clave
// (la misma del panel) y se actualiza sola cada tres segundos.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AccesoPanel } from "@/components/panel/AccesoPanel.tsx";
import { PantallaVivo } from "@/components/vivo/PantallaVivo.tsx";
import "@/components/vivo/vivo.css";
import "../../admin/panel.css";
import { getT } from "@/i18n/server.ts";
import { verifyOrganizerKey } from "@/server/panel.ts";
import { PANEL_KEY_QUERY, panelKeyFromCookies } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";
import { getLiveState } from "@/server/vivo.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("vivo.titulo"), robots: { index: false, follow: false } };
}

export default async function VivoPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const event = await getRepo().getEventBySlug(slug);
  if (!event) notFound();

  const key = query[PANEL_KEY_QUERY];
  if (typeof key === "string" && key) redirect(`/api/admin/${slug}/entrar?k=${encodeURIComponent(key)}&next=vivo`);

  const t = await getT();
  if (!verifyOrganizerKey(event.id, await panelKeyFromCookies(slug))) {
    return <AccesoPanel slug={slug} eventName={event.name} t={t} error={query.error === "clave"} next="vivo" />;
  }
  return <PantallaVivo slug={slug} initial={getLiveState(event)} />;
}
