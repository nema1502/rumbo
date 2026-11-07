"use server";
// La acción de /admin/<evento>/armar: guarda el borrador (y su dirección, si cambió) y, si se pidió publicar, lleva a
// /admin/<evento>/publicando, que prepara las credenciales de a una con el avance a la vista. Hay que haber entrado
// al panel de ese evento (la cookie con su clave, o la sesión de la dueña o de quien coorganiza). Siempre termina en
// una redirección: de vuelta al borrador con el aviso que corresponda, o a la pantalla de publicar.
//
// El evento se busca por su id (evento_id), no por la dirección: si alguien del equipo la cambió mientras otra
// persona editaba, guardar no se pierde. Y el formulario trae la huella del borrador como se mostró (version): si
// alguien guardó en el medio, no se pisa lo suyo y se vuelve al borrador con el aviso.
import { redirect } from "next/navigation";
import { getLang } from "@/i18n/server.ts";
import { BUSY } from "@/server/compartido.ts";
import { DraftError, draftVersion, parseDraftForm, saveDraft } from "@/server/kit/borrador.ts";
import { changeEventSlug, type SlugProblem } from "@/server/kit/direccion.ts";
import { getTemplate } from "@/server/kit/plantillas.ts";
import { withPublishTurn } from "@/server/kit/publicar.ts";
import { PUBLISH_INTENT_COOKIE } from "@/server/kit/publicar-pedido.ts";
import { panelAccess, panelKeyFromCookies, rememberPanelKey } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";
import { cookies, headers } from "next/headers";

type Saved = { ok: true; slug: string; moved: boolean } | { ok: false; slug: string; error: string; tried?: string };

export async function guardarBorrador(formData: FormData): Promise<void> {
  const id = String(formData.get("evento_id") ?? "");
  const shown = String(formData.get("version") ?? "");
  const action = String(formData.get("accion") ?? "guardar");
  const repo = getRepo();
  const event = id ? await repo.getEventById(id) : null;
  // Un evento que ya no existe: a Mis eventos, nunca a la portada pública.
  if (!event) redirect("/admin");
  const base = `/admin/${encodeURIComponent(event.slug)}`;
  const access = await panelAccess(event);
  if (!access) redirect(`${base}/armar`);
  if (event.published) redirect(base);
  const spec = getTemplate(event.template);
  if (!spec) redirect(base);

  const lang = await getLang();
  // Con el turno de publicar: si un paso está desplegando un contrato, el borrador no cambia debajo de él.
  const saved = await withPublishTurn(event.id, async (): Promise<Saved> => {
    const fresh = (await repo.getEventById(event.id)) ?? event;
    if (fresh.published) return { ok: false, slug: fresh.slug, error: "yaPublicado" };
    if (shown !== (await draftVersion(repo, fresh, lang))) return { ok: false, slug: fresh.slug, error: "cambiado" };
    try {
      await saveDraft(repo, fresh, parseDraftForm(formData, spec), lang);
    } catch (error) {
      if (error instanceof DraftError) return { ok: false, slug: fresh.slug, error: error.code };
      console.error("[armar]", error);
      return { ok: false, slug: fresh.slug, error: "general" };
    }
    // La dirección, al final: si cambia, lo demás ya quedó guardado con el evento.
    const wanted = formData.get("direccion");
    if (typeof wanted !== "string" || wanted.trim() === "" || wanted.trim().toLowerCase() === fresh.slug) return { ok: true, slug: fresh.slug, moved: false };
    const changed = await changeEventSlug(fresh, wanted);
    if (!changed.ok) return { ok: false, slug: fresh.slug, error: `direccion-${changed.problem satisfies SlugProblem}`, tried: wanted.trim().slice(0, 80) };
    return { ok: true, slug: changed.slug, moved: changed.slug !== fresh.slug };
  });

  if (saved === BUSY) redirect(`${base}/armar?error=publicando`);
  const now = `/admin/${encodeURIComponent(saved.slug)}`;
  if (!saved.ok) {
    if (saved.error === "yaPublicado") redirect(now);
    // Con un problema de la dirección, el campo vuelve con lo que se probó, no con la de antes.
    const tried = saved.tried ? `&direccion=${encodeURIComponent(saved.tried)}` : "";
    redirect(`${now}/armar?error=${saved.error}${tried}`);
  }
  if (saved.moved && access.via === "key") {
    // La clave del panel vive en una cookie con el nombre del evento: con la dirección nueva, se guarda con la nueva.
    const key = await panelKeyFromCookies(event.slug);
    if (key) await rememberPanelKey(saved.slug, key);
  }
  if (action === "vista") redirect(`/e/${encodeURIComponent(saved.slug)}?vista=1`);
  if (action !== "publicar") redirect(`${now}/armar?guardado=1${saved.moved ? "&movida=1" : ""}`);
  // La pantalla de publicar arranca sola solo si viene de acá: un enlace de otro sitio no publica nada.
  const secure = (await headers()).get("x-forwarded-proto") === "https";
  (await cookies()).set(PUBLISH_INTENT_COOKIE, event.id, { httpOnly: true, sameSite: "strict", path: "/", maxAge: 120, secure });
  redirect(`${now}/publicando`);
}
