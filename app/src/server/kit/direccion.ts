// La dirección del evento: el final de /e/<evento>, que es también el de /admin/<evento>. Sale del nombre al crear
// el borrador (plantillas.ts, slugify) y quien organiza la puede cambiar mientras sea un borrador. Después de
// publicar no se cambia: los enlaces y los QR ya repartidos dejarían de abrir. Solo minúsculas, números y guiones,
// de 3 a 60, sin chocar con otro evento ni con una palabra que la app usa en sus propias rutas. La dirección vieja
// queda anotada (event_slug_aliases): /admin/<vieja>, y el enlace para compartir el panel que se pasó con ella, llevan
// a la nueva, y ningún otro evento la puede tomar.
import { getDb } from "../base/index.ts";
import type { EventRecord, Repo } from "../repo.ts";

export const SLUG_MIN = 3;
export const SLUG_MAX = 60;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Lo que no puede ser la dirección de un evento: las rutas de la app que viven al lado de /admin/<evento> y de
 * /e/<evento> (/admin/nuevo, /admin/invitacion/...) y las palabras que se confunden con una pantalla de Rumbo.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "armar",
  "e",
  "equipo",
  "importar",
  "informe",
  "inscripcion",
  "invitacion",
  "invitaciones",
  "listo",
  "login",
  "new",
  "nuevo",
  "p",
  "panel",
  "publicando",
  "publicar",
  "rumbo",
  "scan",
  "stand",
  "stands",
  "v",
  "vivo",
]);

export type SlugProblem = "formato" | "reservada" | "ocupada" | "publicado";

export type SlugCheck = { ok: true; slug: string } | { ok: false; problem: SlugProblem };

/** La dirección como la escribió quien organiza, limpia (sin espacios alrededor, en minúsculas) y revisada sin la base. */
export function checkSlugFormat(raw: unknown): SlugCheck {
  if (typeof raw !== "string") return { ok: false, problem: "formato" };
  const slug = raw.trim().toLowerCase();
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX || !SLUG_RE.test(slug)) return { ok: false, problem: "formato" };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, problem: "reservada" };
  return { ok: true, slug };
}

/** Si un slug lo puede tomar un evento nuevo (crear desde una plantilla): no reservado. */
export const isReservedSlug = (slug: string): boolean => RESERVED_SLUGS.has(slug);

const isUniqueViolation = (error: unknown): boolean => /unique|duplicate|23505/i.test(error instanceof Error ? `${error.message} ${(error as { code?: unknown }).code ?? ""}` : String(error));

/**
 * Cambia la dirección de un borrador. Devuelve la que quedó (igual que antes si no cambió), o el problema: el
 * formato, una palabra reservada, que ya la tiene otro evento, o que el evento ya está publicado. Que dos cambios a
 * la vez elijan la misma lo decide la restricción única de la base: el segundo recibe "ocupada".
 */
export async function changeEventSlug(event: EventRecord, raw: unknown): Promise<SlugCheck> {
  const check = checkSlugFormat(raw);
  if (!check.ok) return check;
  if (check.slug === event.slug) return check;
  if (event.published) return { ok: false, problem: "publicado" };
  const db = getDb();
  if (await db.one("SELECT 1 AS yes FROM events WHERE slug = ? AND id <> ?", [check.slug, event.id])) return { ok: false, problem: "ocupada" };
  if (await db.one("SELECT 1 AS yes FROM event_slug_aliases WHERE slug = ? AND event_id <> ?", [check.slug, event.id])) return { ok: false, problem: "ocupada" };
  try {
    // Solo si sigue siendo un borrador: si se publicó entre que se leyó y ahora, no se toca.
    const changed = await db.run("UPDATE events SET slug = ? WHERE id = ? AND published = ?", [check.slug, event.id, false]);
    if (changed !== 1) return { ok: false, problem: "publicado" };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: "ocupada" };
    throw error;
  }
  // La vieja queda de este evento; si la nueva era una vieja suya (volvió a la de antes), deja de ser vieja.
  await db.run("DELETE FROM event_slug_aliases WHERE slug = ? AND event_id = ?", [check.slug, event.id]);
  await db.run("INSERT INTO event_slug_aliases (slug, event_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", [event.slug, event.id, new Date().toISOString()]);
  return check;
}

/** Si la dirección la tiene un evento o la tuvo un borrador antes de cambiarla: un evento nuevo no la puede tomar. */
export async function isSlugTaken(repo: Repo, slug: string): Promise<boolean> {
  if (await repo.getEventBySlug(slug)) return true;
  return Boolean(await getDb().one("SELECT 1 AS yes FROM event_slug_aliases WHERE slug = ?", [slug]));
}

/** Las direcciones que tuvo el evento antes de la de ahora. */
export async function oldSlugsOf(eventId: string): Promise<string[]> {
  const rows = await getDb().all("SELECT slug FROM event_slug_aliases WHERE event_id = ? ORDER BY created_at DESC", [eventId]);
  return rows.map((row) => String(row.slug));
}

/** El evento por su dirección, o por una que tuvo antes (con moved en true: quien llama lleva a la de ahora). */
export async function findEventBySlug(repo: Repo, slug: string): Promise<{ event: EventRecord; moved: boolean } | null> {
  const event = await repo.getEventBySlug(slug);
  if (event) return { event, moved: false };
  const row = await getDb().one("SELECT event_id FROM event_slug_aliases WHERE slug = ?", [slug]);
  const moved = row ? await repo.getEventById(String(row.event_id)) : null;
  return moved ? { event: moved, moved: true } : null;
}
