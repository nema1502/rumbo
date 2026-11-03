// El panel de quien organiza. Entra con la clave del evento: la primera vez en el enlace (?k=...),
// que /api/admin/<evento>/entrar guarda en una cookie; después, con la cookie.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AccesoPanel } from "@/components/panel/AccesoPanel.tsx";
import { PanelCliente } from "@/components/panel/PanelCliente.tsx";
import { getT } from "@/i18n/server.ts";
import { ensureStationCodes, getPanelState, verifyOrganizerKey } from "@/server/panel.ts";
import { PANEL_KEY_QUERY, panelKeyFromCookies } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("panel.titulo"), robots: { index: false, follow: false } };
}

export default async function AdminPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const repo = getRepo();
  const event = await repo.getEventBySlug(slug);
  if (!event) notFound();

  const key = query[PANEL_KEY_QUERY];
  if (typeof key === "string" && key) redirect(`/api/admin/${slug}/entrar?k=${encodeURIComponent(key)}`);

  const t = await getT();
  if (!verifyOrganizerKey(event.id, await panelKeyFromCookies(slug))) {
    return <AccesoPanel slug={slug} eventName={event.name} t={t} error={query.error === "clave"} />;
  }

  // Un borrador todavía no tiene panel: se arma primero (kit/borrador.ts).
  if (!event.published) redirect(`/admin/${encodeURIComponent(slug)}/armar`);

  await ensureStationCodes(event, repo);
  return <PanelCliente slug={slug} initial={await getPanelState(event, repo)} publicado={query.publicado === "1"} />;
}
