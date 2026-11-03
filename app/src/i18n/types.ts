// Lo que comparten los diccionarios, el middleware, el servidor y el cliente.
// Sin dependencias: este archivo también corre en el middleware (sin Node).

export const LANGS = ["es", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "es";

/** La cookie donde se recuerda el idioma y la cabecera con la que el middleware se lo pasa al servidor. */
export const LANG_COOKIE = "rumbo.lang";
export const LANG_HEADER = "x-rumbo-lang";
export const LANG_QUERY = "lang";

/** Un diccionario plano: clave con puntos ("inicio.titulo") y texto. */
export type Messages = Record<string, string>;
/** Cada área (comun, evento, escaner, panel) trae sus textos en los dos idiomas. */
export type AreaDictionary = Record<Lang, Messages>;

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}
