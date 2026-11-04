// "Stands y ruta": donde quien organiza define los stands de quienes auspician, la meta de la ruta y ve los
// números de cada auspiciante. Entra con la misma clave del panel.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AccesoPanel } from "@/components/panel/AccesoPanel.tsx";
import { AdminStands } from "@/components/stands/AdminStands.tsx";
import "@/components/stands/stands.css";
import { getT } from "@/i18n/server.ts";
import { pollarEnabled } from "@/server/accounts.ts";
import { PANEL_KEY_QUERY, panelAccess } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";
import { getAdminStands } from "@/server/stands.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("stands.admin.titulo"), robots: { index: false, follow: false } };
}

export default async function StandsAdminPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const repo = getRepo();
  const event = await repo.getEventBySlug(slug);
  if (!event) notFound();

  const key = query[PANEL_KEY_QUERY];
  if (typeof key === "string" && key) redirect(`/api/admin/${slug}/entrar?k=${encodeURIComponent(key)}&next=stands`);

  const t = await getT();
  if (!(await panelAccess(event))) {
    return <AccesoPanel slug={slug} eventName={event.name} t={t} error={query.error === "clave"} next="stands" conCuenta={pollarEnabled()} />;
  }
  return <AdminStands slug={slug} initial={await getAdminStands(event, repo)} />;
}
