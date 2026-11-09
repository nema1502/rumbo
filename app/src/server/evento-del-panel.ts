// El evento de una página de /admin/<evento>: por su dirección o, si quien organiza cambió la dirección del borrador,
// por una que tuvo antes, y entonces lleva a la misma página con la de ahora (con lo que traía el enlace, la clave
// incluida). Si no hay ninguno, la página de no encontrado.
import { notFound, redirect } from "next/navigation";
import { findEventBySlug } from "./kit/direccion.ts";
import { getRepo, type EventRecord } from "./repo.ts";

type Query = Record<string, string | string[] | undefined>;

function queryString(query: Query): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(name, one);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** El evento de /admin/<slug><resto>. Nunca vuelve con null: si no hay evento, notFound; si cambió la dirección, redirect. */
export async function panelEventBySlug(slug: string, rest: string, query: Query = {}): Promise<EventRecord> {
  const found = await findEventBySlug(getRepo(), slug);
  if (!found) notFound();
  if (found.moved) redirect(`/admin/${encodeURIComponent(found.event.slug)}${rest}${queryString(query)}`);
  return found.event;
}
