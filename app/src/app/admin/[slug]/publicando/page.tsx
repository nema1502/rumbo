// /admin/<evento>/publicando: la pantalla de publicar. Pide los pasos a /api/admin/<evento>/publicar uno tras otro
// (src/components/kit/Publicando.tsx) y muestra el avance; apenas el evento abre, da el enlace para compartir. Si se
// cierra la pestaña, el panel ofrece "Terminar de preparar", que trae de vuelta acá y sigue desde donde quedó. Un
// borrador solo empieza a publicarse solo si se llegó desde "Publicar el evento"; si no, con el botón.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccesoPanel } from "@/components/panel/AccesoPanel.tsx";
import { Publicando } from "@/components/kit/Publicando.tsx";
import { getT } from "@/i18n/server.ts";
import { pollarEnabled } from "@/server/accounts.ts";
import { publishProgress } from "@/server/kit/publicar.ts";
import { PUBLISH_INTENT_COOKIE, shouldAutoStart } from "@/server/kit/publicar-pedido.ts";
import { PANEL_KEY_QUERY, panelAccess } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";
import { panelEventBySlug } from "@/server/evento-del-panel.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("kit.publicando.titulo"), robots: { index: false, follow: false } };
}

export default async function PublishingPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const repo = getRepo();
  const event = await panelEventBySlug(slug, "/publicando", query);
  const key = query[PANEL_KEY_QUERY];
  if (typeof key === "string" && key) redirect(`/api/admin/${encodeURIComponent(slug)}/entrar?k=${encodeURIComponent(key)}`);

  const t = await getT();
  const access = await panelAccess(event);
  if (!access) return <AccesoPanel slug={slug} eventName={event.name} t={t} conCuenta={pollarEnabled()} />;
  // Solo arranca sola si viene de "Publicar el evento" en el borrador, o si ya está publicado (publicar-pedido.ts).
  const autoStart = shouldAutoStart(event, (await cookies()).get(PUBLISH_INTENT_COOKIE)?.value);
  return <Publicando slug={event.slug} eventName={event.name} initial={await publishProgress(repo, event)} autoStart={autoStart} />;
}
