// Lo que depende del pedido HTTP para entrar al panel: la cookie con la clave de organizador, cómo se
// lee en las páginas y en las rutas de la API, y la comprobación que usan las rutas.
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { verifyOrganizerKey } from "./panel.ts";
import { getRepo, type EventRecord } from "./repo.ts";

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

export function clearPanelCookie(response: NextResponse, slug: string): void {
  response.cookies.set(panelCookieName(slug), "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

/** Una redirección a una ruta de la propia app. Relativa a propósito: así no depende de cómo llegue el host. */
export function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

type Authorized = { event: EventRecord; response?: undefined } | { event?: undefined; response: NextResponse };

/** Para las rutas de la API: el evento si la clave sirve, o la respuesta que corresponde (404 o 401). */
export async function authorizePanelRequest(request: NextRequest, slug: string): Promise<Authorized> {
  const event = await getRepo().getEventBySlug(slug);
  if (!event) return { response: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  if (!verifyOrganizerKey(event.id, panelKeyFromRequest(request, slug))) {
    return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { event };
}
