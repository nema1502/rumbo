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
