"use server";
// La acción de /admin/nuevo: crea el borrador del evento desde la plantilla y entra al panel de ese evento con su
// clave, directo a la pantalla de armarlo. Si algo está mal, vuelve al formulario con lo que se había escrito.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLang } from "@/i18n/server.ts";
import { checkCreateKey } from "@/server/kit/acceso.ts";
import { TemplateInputError, createEventFromTemplate, isTemplateId } from "@/server/kit/plantillas.ts";
import { clientKey } from "@/server/limites.ts";
import { getOrCreateOrganizerKey } from "@/server/panel.ts";
import { rememberPanelKey } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";
import { readDeployInfo } from "@/server/stellar.ts";

const FIELDS = ["nombre", "cuando", "ciudad", "lugar", "organiza", "cupo"] as const;

export async function crearBorrador(formData: FormData): Promise<void> {
  const field = (name: string) => String(formData.get(name) ?? "").trim();
  const template = field("plantilla");
  if (!isTemplateId(template)) redirect("/admin/nuevo");

  const back = (error: string): never => {
    const params = new URLSearchParams({ plantilla: template, error });
    for (const name of FIELDS) if (field(name)) params.set(name, field(name));
    redirect(`/admin/nuevo?${params.toString()}`);
  };

  // La clave de la casa, con el freno de los códigos de puesto: con el freno puesto se dice eso y no "clave equivocada".
  const check = await checkCreateKey(field("clave"), clientKey(await headers()));
  if (check !== "ok") back(check === "blocked" ? "frenado" : "clave");

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
    const event = await createEventFromTemplate(getRepo(), {
      template,
      lang: await getLang(),
      name: field("nombre"),
      startsAtLocal: field("cuando"),
      place: field("ciudad"),
      venue: field("lugar") || null,
      organizerName: field("organiza"),
      capacity: capacity === null ? null : capacity,
      organizerAccount,
    });
    slug = event.slug;
    eventId = event.id;
  } catch (error) {
    if (error instanceof TemplateInputError) return back(error.field);
    throw error;
  }

  // Quien crea el evento entra a su panel con la clave que se acaba de armar: la cookie se pone acá mismo, porque una
  // redirección a /api/.../entrar la resuelve el servidor y el navegador nunca recibiría esa cookie.
  await rememberPanelKey(slug, await getOrCreateOrganizerKey(eventId));
  redirect(`/admin/${encodeURIComponent(slug)}/armar`);
}
