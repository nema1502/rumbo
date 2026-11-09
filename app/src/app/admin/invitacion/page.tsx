// /admin/invitacion#<ficha>: la invitación a coorganizar un evento (coorganizar.ts). La ficha va después de #, que el
// navegador nunca le manda al servidor: así no queda en los registros de pedidos. Esta página solo dice si hay una
// sesión de organizador; lo demás lo hace el navegador (Invitacion.tsx): lee la ficha, pregunta cómo está la
// invitación y la acepta, siempre con la ficha en el cuerpo de un POST.
import type { Metadata } from "next";
import "@/components/evento/evento.css";
import { Invitacion } from "@/components/panel/Invitacion.tsx";
import { getT } from "@/i18n/server.ts";
import { pollarPublishableKey } from "@/server/accounts.ts";
import { organizerFromCookies } from "@/server/organizador.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("panel.invitacion.titulo"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function InvitePage() {
  const organizer = await organizerFromCookies(getRepo());
  return <Invitacion conSesion={organizer !== null} nombre={organizer?.name ?? ""} pollarKey={pollarPublishableKey()} />;
}
