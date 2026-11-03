// El idioma del pedido, en el servidor: la cabecera que deja el middleware, si no la cookie, si no castellano.
import { cookies, headers } from "next/headers";
import { DEFAULT_LANG, LANG_COOKIE, LANG_HEADER, isLang, type Lang } from "./types.ts";
import { makeT, type T } from "./index.ts";

export async function getLang(): Promise<Lang> {
  const fromHeader = (await headers()).get(LANG_HEADER);
  if (isLang(fromHeader)) return fromHeader;
  const fromCookie = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(fromCookie)) return fromCookie;
  return DEFAULT_LANG;
}

/** El t(clave) para componentes de servidor: `const t = await getT();`. */
export async function getT(): Promise<T> {
  return makeT(await getLang());
}
