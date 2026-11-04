// Lo que depende del pedido HTTP para entrar al panel: la cookie con la clave de organizador, cómo se
// lee en las páginas y en las rutas de la API, y la comprobación que usan las páginas y las rutas. Al panel
// de un evento se entra de dos maneras: con la clave del evento (el enlace ?k=, que queda en su cookie; sirve
// para compartirla con quien coorganiza y para el servidor MCP) o con la sesión de la cuenta de organizador
// que lo creó (organizador.ts).
import { cookies, headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { canManageEvent, organizerFromCookies, organizerFromRequest } from "./organizador.ts";
import { verifyOrganizerKey } from "./panel.ts";
import { getRepo, type EventRecord, type Organizer } from "./repo.ts";

/** El parámetro con el que la clave llega en el enlace: /admin/<evento>?k=... */
export const PANEL_KEY_QUERY = "k";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function panelCookieName(slug: string): string {
  return `rumbo.panel.${slug}`;
}

/** La clave que trae el pedido de una página: la cookie de ese evento. */
export async function panelKeyFromCookies(slug: string): Promise<string | null> {
  return (await cookies()).get(panelCookieName(slug))?.value ?? null;
}

/** La clave que trae un pedido a la API: ?k= o la cookie. */
export function panelKeyFromRequest(request: NextRequest, slug: string): string | null {
  return request.nextUrl.searchParams.get(PANEL_KEY_QUERY) ?? request.cookies.get(panelCookieName(slug))?.value ?? null;
}

export function setPanelCookie(response: NextResponse, request: NextRequest, slug: string, key: string): void {
  response.cookies.set(panelCookieName(slug), key, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    secure: request.nextUrl.protocol === "https:",
  });
}

/**
 * Lo mismo, desde una acción de servidor (crear un evento): ahí no hay respuesta propia donde poner la cookie y
 * una redirección a /api/.../entrar la haría el servidor por su cuenta, sin que el navegador la reciba.
 */
export async function rememberPanelKey(slug: string, key: string): Promise<void> {
  const secure = (await headers()).get("x-forwarded-proto") === "https";
  (await cookies()).set(panelCookieName(slug), key, { httpOnly: true, sameSite: "lax", path: "/", maxAge: COOKIE_MAX_AGE, secure });
}

export function clearPanelCookie(response: NextResponse, slug: string): void {
  response.cookies.set(panelCookieName(slug), "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

/**
 * A dónde puede volver /admin después de entrar como organizador (?volver=): solo una ruta propia del panel, que
 * empiece con /admin/. Nada de otro sitio ("//otro", "/\otro", "https://..."), ni caracteres de control, ni algo que
 * al resolverse salga de /admin/. Si no sirve, null y /admin muestra Mis eventos.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 300 || !raw.startsWith("/admin/")) return null;
  if (/[\\\u0000-\u001F\u007F]/.test(raw) || raw.startsWith("//")) return null;
  try {
    const url = new URL(raw, "http://rumbo.invalid");
    if (url.origin !== "http://rumbo.invalid" || !url.pathname.startsWith("/admin/")) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/** Una redirección a una ruta de la propia app. Relativa a propósito: así no depende de cómo llegue el host. */
export function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

/** Cómo se entró al panel: con la clave del evento, o con la sesión de la cuenta que lo creó. */
export type PanelVia = "key" | "organizer";

export interface PanelAccess {
  via: PanelVia;
  /** La cuenta de organizador, cuando se entró con ella. */
  organizer: Organizer | null;
}

/**
 * Para las páginas de /admin/<evento>: cómo entra este pedido al panel del evento, o null si no tiene con qué.
 * Primero la clave del evento (su cookie), después la sesión de organizador si el evento es de esa cuenta.
 */
export async function panelAccess(event: EventRecord): Promise<PanelAccess | null> {
  if (await verifyOrganizerKey(event.id, await panelKeyFromCookies(event.slug))) return { via: "key", organizer: null };
  const organizer = await organizerFromCookies();
  if (organizer && canManageEvent(organizer, event)) return { via: "organizer", organizer };
  return null;
}

type Authorized = { event: EventRecord; via: PanelVia; response?: undefined } | { event?: undefined; via?: undefined; response: NextResponse };

/** Para las rutas de la API: el evento si la clave o la sesión sirven, o la respuesta que corresponde (404 o 401). */
export async function authorizePanelRequest(request: NextRequest, slug: string): Promise<Authorized> {
  const event = await getRepo().getEventBySlug(slug);
  if (!event) return { response: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  if (await verifyOrganizerKey(event.id, panelKeyFromRequest(request, slug))) return { event, via: "key" };
  const organizer = await organizerFromRequest(request);
  if (organizer && canManageEvent(organizer, event)) return { event, via: "organizer" };
  return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
}
