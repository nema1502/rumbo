"use server";
// La acción de /admin/nuevo: crea el borrador del evento desde la plantilla y sigue a la pantalla de armarlo. Con
// la sesión de organizador, el evento queda a nombre de esa cuenta (sin la clave de la casa, con el tope por día) y
// el panel entra con la sesión; sin ella, pide la clave de la casa y entra con la clave del evento recién creada.
// Si algo está mal, vuelve al formulario con lo que se había escrito.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLang } from "@/i18n/server.ts";
import { checkCreateKey } from "@/server/kit/acceso.ts";
import { TemplateInputError, createEventFromTemplate, isTemplateId } from "@/server/kit/plantillas.ts";
import { clientKey } from "@/server/limites.ts";
import { createEventWithAccount, organizerFromCookies } from "@/server/organizador.ts";
import { getOrCreateOrganizerKey } from "@/server/panel.ts";
import { rememberPanelKey } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";
import { readDeployInfo } from "@/server/stellar.ts";

const FIELDS = ["nombre", "cuando", "ciudad", "lugar", "organiza", "cupo"] as const;

export async function crearBorrador(formData: FormData): Promise<void> {
  const field = (name: string) => String(formData.get(name) ?? "").trim();
  const template = field("plantilla");
  if (!isTemplateId(template)) redirect("/admin/nuevo");

  const back = (error: string, extra: Record<string, string> = {}): never => {
    const params = new URLSearchParams({ plantilla: template, error, ...extra });
    for (const name of FIELDS) if (field(name)) params.set(name, field(name));
    redirect(`/admin/nuevo?${params.toString()}`);
  };

  // Con la cuenta de organizador no hace falta la clave de la casa. Sin ella, la clave con el freno de los códigos
  // de puesto: con el freno puesto se dice eso y no "clave equivocada".
  const organizer = await organizerFromCookies();
  const requester = clientKey(await headers());
  if (!organizer) {
    const check = await checkCreateKey(field("clave"), requester);
    if (check !== "ok") back(check === "blocked" ? "frenado" : "clave");
  }

  const capacity = field("cupo") ? Number(field("cupo")) : null;
  let slug: string;
  let eventId: string;
  try {
    // En la red de prueba, los pagos van a la cuenta de quien organiza del despliegue de muestra.
    let organizerAccount: string | null = null;
    try {
      organizerAccount = readDeployInfo()?.accounts.organizer ?? null;
    } catch {
      organizerAccount = null;
    }
    const input = {
      template,
      lang: await getLang(),
      name: field("nombre"),
      startsAtLocal: field("cuando"),
      place: field("ciudad"),
      venue: field("lugar") || null,
      organizerName: field("organiza"),
      capacity: capacity === null ? null : capacity,
      organizerAccount,
    };
    let event;
    if (organizer) {
      const created = await createEventWithAccount(getRepo(), organizer, input, { requester });
      // Con el tope (de la cuenta o de la IP), la pantalla ya no muestra el formulario: dice cuándo se libera.
      if (!created.ok) return back(created.reason === "busy" ? "ocupado" : "tope");
      event = created.event;
    } else {
      event = await createEventFromTemplate(getRepo(), input);
    }
    slug = event.slug;
    eventId = event.id;
  } catch (error) {
    if (error instanceof TemplateInputError) return back(error.field);
    throw error;
  }

  // Sin cuenta, quien crea el evento entra a su panel con la clave que se acaba de armar: la cookie se pone acá
  // mismo, porque una redirección a /api/.../entrar la resuelve el servidor y el navegador nunca recibiría esa
  // cookie. Con la cuenta, el panel entra con la sesión.
  if (!organizer) await rememberPanelKey(slug, await getOrCreateOrganizerKey(eventId));
  redirect(`/admin/${encodeURIComponent(slug)}/armar`);
}
