// Lo que las rutas de la API leen del pedido: el idioma (?lang=, o la cookie que deja el middleware) y de dónde
// se pidió (para que en desarrollo los enlaces de los correos y de las respuestas abran en el mismo servidor).
import type { NextRequest } from "next/server";
import { DEFAULT_LANG, LANG_COOKIE, LANG_QUERY, isLang, type Lang } from "../i18n/index.ts";

export function langOfRequest(request: NextRequest): Lang {
  const fromQuery = request.nextUrl.searchParams.get(LANG_QUERY);
  const fromCookie = request.cookies.get(LANG_COOKIE)?.value;
  return isLang(fromQuery) ? fromQuery : isLang(fromCookie) ? fromCookie : DEFAULT_LANG;
}

/** "http://localhost:3000" o "https://<host>": lo que puso la plataforma, o lo que dice el pedido. */
export function originOfRequest(request: NextRequest): string | null {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return null;
  const proto = request.headers.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Si un POST viene de la propia app y no de un formulario de otro sitio. Las rutas que ponen o borran una cookie de
 * sesión lo piden: SameSite=Lax frena que el navegador mande las cookies de Rumbo desde otro sitio, no que guarde
 * la que trae la respuesta. Con Origin, tiene que ser el de la app: el del pedido (como lo resuelve
 * originOfRequest, o la URL que vio el servidor) o el de NEXT_PUBLIC_BASE_URL. Sin Origin (curl, las pruebas, un
 * navegador viejo), vale si Sec-Fetch-Site dice same-origin o no viene.
 */
export function fromOwnSite(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    const site = request.headers.get("sec-fetch-site");
    return site === null || site === "same-origin";
  }
  let claimed: string;
  try {
    claimed = new URL(origin).origin;
  } catch {
    return false;
  }
  const own = new Set<string>([request.nextUrl.origin]);
  const fromHeaders = originOfRequest(request);
  if (fromHeaders) own.add(fromHeaders);
  const base = process.env.NEXT_PUBLIC_BASE_URL;
  if (base) {
    try {
      own.add(new URL(base).origin);
    } catch {
      /* una NEXT_PUBLIC_BASE_URL mal escrita no abre nada */
    }
  }
  return own.has(claimed);
}
