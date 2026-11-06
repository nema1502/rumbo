"use server";
// La acción de /admin/<evento>/armar: guarda el borrador (y su dirección, si cambió) y, si se pidió publicar, lleva a
// /admin/<evento>/publicando, que prepara las credenciales de a una con el avance a la vista. Hay que haber entrado
// al panel de ese evento (la cookie con su clave, o la sesión de la dueña o de quien coorganiza). Siempre termina en
// una redirección: de vuelta al borrador con el aviso que corresponda, o a la pantalla de publicar.
import { redirect } from "next/navigation";
import { getLang } from "@/i18n/server.ts";
import { BUSY } from "@/server/compartido.ts";
import { DraftError, parseDraftForm, saveDraft } from "@/server/kit/borrador.ts";
import { changeEventSlug, type SlugProblem } from "@/server/kit/direccion.ts";
import { getTemplate } from "@/server/kit/plantillas.ts";
import { withPublishTurn } from "@/server/kit/publicar.ts";
import { panelAccess, panelKeyFromCookies, rememberPanelKey } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";

type Saved = { ok: true; slug: string } | { ok: false; error: string };

export async function guardarBorrador(formData: FormData): Promise<void> {
  const slug = String(formData.get("evento") ?? "");
  const action = String(formData.get("accion") ?? "guardar");
  const repo = getRepo();
  const event = await repo.getEventBySlug(slug);
  if (!event) redirect("/");
  const access = await panelAccess(event);
  if (!access) redirect(`/admin/${encodeURIComponent(slug)}/armar`);
  const base = `/admin/${encodeURIComponent(slug)}`;
  if (event.published) redirect(base);
  const spec = getTemplate(event.template);
  if (!spec) redirect(base);

  const lang = await getLang();
  // Con el turno de publicar: si un paso está desplegando un contrato, el borrador no cambia debajo de él.
  const saved = await withPublishTurn(event.id, async (): Promise<Saved> => {
    const fresh = (await repo.getEventById(event.id)) ?? event;
    if (fresh.published) return { ok: false, error: "yaPublicado" };
    try {
      await saveDraft(repo, fresh, parseDraftForm(formData, spec), lang);
    } catch (error) {
      if (error instanceof DraftError) return { ok: false, error: error.code };
      console.error("[armar]", error);
      return { ok: false, error: "general" };
    }
    // La dirección, al final: si cambia, lo demás ya quedó guardado con el evento.
    const wanted = formData.get("direccion");
    if (typeof wanted !== "string" || wanted.trim() === "" || wanted.trim().toLowerCase() === fresh.slug) return { ok: true, slug: fresh.slug };
    const changed = await changeEventSlug(fresh, wanted);
    if (!changed.ok) return { ok: false, error: `direccion-${changed.problem satisfies SlugProblem}` };
    return { ok: true, slug: changed.slug };
  });

  if (saved === BUSY) redirect(`${base}/armar?error=publicando`);
  if (!saved.ok) redirect(saved.error === "yaPublicado" ? base : `${base}/armar?error=${saved.error}`);
  if (saved.slug !== slug && access.via === "key") {
    // La clave del panel vive en una cookie con el nombre del evento: con la dirección nueva, se guarda con la nueva.
    const key = await panelKeyFromCookies(slug);
    if (key) await rememberPanelKey(saved.slug, key);
  }
  const next = `/admin/${encodeURIComponent(saved.slug)}`;
  if (action === "vista") redirect(`/e/${encodeURIComponent(saved.slug)}?vista=1`);
  if (action !== "publicar") redirect(`${next}/armar?guardado=1`);
  redirect(`${next}/publicando`);
}
