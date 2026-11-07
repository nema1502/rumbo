// El panel de quien organiza. Entra con la clave del evento (la primera vez en el enlace ?k=..., que
// /api/admin/<evento>/entrar guarda en una cookie; después, con la cookie) o con la sesión de la cuenta de
// organizador que creó el evento (/admin).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccesoPanel } from "@/components/panel/AccesoPanel.tsx";
import { PanelCliente } from "@/components/panel/PanelCliente.tsx";
import { getT } from "@/i18n/server.ts";
import { pollarEnabled, pollarPublishableKey } from "@/server/accounts.ts";
import { listTeam } from "@/server/coorganizar.ts";
import { ensureStationCodes, getPanelState } from "@/server/panel.ts";
import { PANEL_KEY_QUERY, panelAccess } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";
import { panelEventBySlug } from "@/server/evento-del-panel.ts";

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
  const event = await panelEventBySlug(slug, "", query);

  const key = query[PANEL_KEY_QUERY];
  if (typeof key === "string" && key) redirect(`/api/admin/${slug}/entrar?k=${encodeURIComponent(key)}`);

  const t = await getT();
  const access = await panelAccess(event);
  if (!access) return <AccesoPanel slug={slug} eventName={event.name} t={t} error={query.error === "clave"} conCuenta={pollarEnabled()} />;

  // Un borrador todavía no tiene panel: se arma primero (kit/borrador.ts).
  if (!event.published) redirect(`/admin/${encodeURIComponent(slug)}/armar`);

  await ensureStationCodes(event, repo);
  // Si se cerró la pestaña de publicar con credenciales del equipo por preparar, el panel lo dice (con sus nombres) y la retoma.
  const pending = event.contractId ? [] : (await repo.listTicketTypes(event.id)).filter((type) => !type.contractId).map((type) => type.name);
  return (
    <PanelCliente
      slug={slug}
      initial={await getPanelState(event, repo)}
      publicado={query.publicado === "1"}
      porPreparar={pending}
      recienSumado={query.equipo === "1"}
      via={access.via}
      pollarKey={access.via === "organizer" ? pollarPublishableKey() : null}
      equipo={access.role === "owner" ? await listTeam(event) : null}
    />
  );
}
