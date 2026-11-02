// Elige el idioma de cada pedido: ?lang=es|en manda, si no la cookie, si no castellano.
// Lo deja en una cabecera para el servidor y lo recuerda en la cookie.
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANG, LANG_COOKIE, LANG_HEADER, LANG_QUERY, isLang } from "./i18n/types.ts";

export function middleware(request: NextRequest) {
  const fromQuery = request.nextUrl.searchParams.get(LANG_QUERY);
  const fromCookie = request.cookies.get(LANG_COOKIE)?.value;
  const lang = isLang(fromQuery) ? fromQuery : isLang(fromCookie) ? fromCookie : DEFAULT_LANG;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LANG_HEADER, lang);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (fromCookie !== lang) {
    response.cookies.set(LANG_COOKIE, lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  return response;
}

export const config = {
  // Todo menos los archivos estáticos y lo interno de Next
  matcher: ["/((?!_next/|api/|.*\\..*).*)"],
};
