// Guardar el borrador con el turno de publicar y la huella de lo que se mostró: lo que hace la acción de
// /admin/<evento>/armar una vez que sabe que quien manda el formulario puede editar ese evento. Separado de la acción
// (que lee cookies y redirige) para que se pueda probar entero.
import type { Lang } from "../../i18n/index.ts";
import { BUSY } from "../compartido.ts";
import type { EventRecord, Repo } from "../repo.ts";
import { DraftError, draftVersion, parseDraftForm, saveDraft } from "./borrador.ts";
import { changeEventSlug, type SlugProblem } from "./direccion.ts";
import type { TemplateSpec } from "./plantillas.ts";
import { withPublishTurn } from "./publicar.ts";

export type SavedDraft = { ok: true; slug: string; moved: boolean } | { ok: false; slug: string; error: string; tried?: string };

interface FormLike {
  get(name: string): unknown;
}

/**
 * Guarda lo que trae el formulario si el borrador sigue como se mostró (`shown`, su huella). Si alguien del equipo
 * guardó en el medio, no pisa lo suyo: devuelve el error "cambiado". La dirección va al final: si cambia, lo demás
 * ya quedó guardado con el evento.
 */
export async function saveDraftForm(repo: Repo, event: EventRecord, spec: TemplateSpec, form: FormLike, shown: string, lang: Lang): Promise<SavedDraft | typeof BUSY> {
  // Con el turno de publicar: si un paso está desplegando un contrato, el borrador no cambia debajo de él.
  return withPublishTurn(event.id, async (): Promise<SavedDraft> => {
    const fresh = (await repo.getEventById(event.id)) ?? event;
    if (fresh.published) return { ok: false, slug: fresh.slug, error: "yaPublicado" };
    if (shown !== (await draftVersion(repo, fresh))) return { ok: false, slug: fresh.slug, error: "cambiado" };
    try {
      await saveDraft(repo, fresh, parseDraftForm(form, spec), lang);
    } catch (error) {
      if (error instanceof DraftError) return { ok: false, slug: fresh.slug, error: error.code };
      console.error("[armar]", error);
      return { ok: false, slug: fresh.slug, error: "general" };
    }
    const wanted = form.get("direccion");
    if (typeof wanted !== "string" || wanted.trim() === "" || wanted.trim().toLowerCase() === fresh.slug) return { ok: true, slug: fresh.slug, moved: false };
    const changed = await changeEventSlug(fresh, wanted);
    if (!changed.ok) return { ok: false, slug: fresh.slug, error: `direccion-${changed.problem satisfies SlugProblem}`, tried: wanted.trim().slice(0, 80) };
    return { ok: true, slug: changed.slug, moved: changed.slug !== fresh.slug };
  });
}
