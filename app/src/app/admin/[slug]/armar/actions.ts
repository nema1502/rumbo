"use server";
// La acción de /admin/<evento>/armar: guarda el borrador y, si se pidió, lo publica. Hay que haber entrado al
// panel de ese evento (la cookie con su clave). Siempre termina en una redirección: de vuelta al borrador con
// el aviso que corresponda, o al panel del evento ya publicado.
import { redirect } from "next/navigation";
import { getLang } from "@/i18n/server.ts";
import { DraftError, parseDraftForm, saveDraft } from "@/server/kit/borrador.ts";
import { getTemplate } from "@/server/kit/plantillas.ts";
import { publishEvent } from "@/server/kit/publicar.ts";
import { verifyOrganizerKey } from "@/server/panel.ts";
import { panelKeyFromCookies } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";

export async function guardarBorrador(formData: FormData): Promise<void> {
  const slug = String(formData.get("evento") ?? "");
  const action = String(formData.get("accion") ?? "guardar");
  const repo = getRepo();
  const event = await repo.getEventBySlug(slug);
  if (!event) redirect("/");
  if (!(await verifyOrganizerKey(event.id, await panelKeyFromCookies(slug)))) redirect(`/admin/${encodeURIComponent(slug)}/armar`);
  const base = `/admin/${encodeURIComponent(slug)}`;
  if (event.published) redirect(base);
  const spec = getTemplate(event.template);
  if (!spec) redirect(base);

  const lang = await getLang();
  try {
    await saveDraft(repo, event, parseDraftForm(formData, spec), lang);
  } catch (error) {
    if (error instanceof DraftError) redirect(`${base}/armar?error=${error.code}`);
    console.error("[armar]", error);
    redirect(`${base}/armar?error=general`);
  }
  if (action !== "publicar") redirect(`${base}/armar?guardado=1`);

  const result = await publishEvent(repo, (await repo.getEventById(event.id)) ?? event);
  if (result.ok) redirect(`${base}?publicado=1`);
  if (result.reason === "deploy_failed") console.error(`[armar] No se pudo publicar ${slug}: ${result.detail ?? ""}`);
  // "busy": otra pestaña (o el mismo botón dos veces) ya está publicando este evento.
  redirect(`${base}/armar?error=${result.reason === "no_capacity" ? "cupo" : result.reason === "busy" ? "publicando" : "publicar"}`);
}
