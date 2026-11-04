// La inscripción por equipos de la hackatón: el nombre del equipo y sus integrantes, en una sola acción. Solo
// existe en los eventos que se inscriben por equipos y ya están publicados.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import "@/components/evento/evento.css";
import "@/components/kit/kit.css";
import { FormularioEquipo } from "@/components/kit/FormularioEquipo.tsx";
import { getT } from "@/i18n/server.ts";
import { TEAM_MAX_MEMBERS } from "@/server/kit/equipos.ts";
import { getRepo } from "@/server/repo.ts";
import { registerTeamAction } from "./actions.ts";

export const dynamic = "force-dynamic";
// La acción inscribe a cada integrante en la red de prueba, de a uno: tarda. Con Fluid en Vercel el tope por omisión alcanza; se declara igual.
export const maxDuration = 300;

type Params = Promise<{ slug: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("kit.equipo.titulo"), robots: { index: false } };
}

export default async function TeamPage({ params }: { params: Params }) {
  const { slug } = await params;
  const event = await getRepo().getEventBySlug(slug);
  if (!event || !event.published) notFound();
  if (!event.teamSignup) redirect(`/e/${encodeURIComponent(slug)}`);
  return <FormularioEquipo action={registerTeamAction} slug={slug} eventName={event.name} rows={TEAM_MAX_MEMBERS} />;
}
