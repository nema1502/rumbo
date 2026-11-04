// Une los diccionarios de las áreas y da el helper t(clave) a partir de un idioma.
// En el servidor se usa getT() de ./server.ts; en el cliente, useT() de ./client.tsx.
import { comun } from "./comun.ts";
import { evento } from "./evento.ts";
import { escaner } from "./escaner.ts";
import { kit } from "./kit.ts";
import { panel } from "./panel.ts";
import { stands } from "./stands.ts";
import { vivo } from "./vivo.ts";
import { verificacion } from "./verificacion.ts";
import { DEFAULT_LANG, type Lang, type Messages } from "./types.ts";

export { LANGS, DEFAULT_LANG, LANG_COOKIE, LANG_HEADER, LANG_QUERY, isLang } from "./types.ts";
export type { Lang, Messages, AreaDictionary } from "./types.ts";

export const dictionaries: Record<Lang, Messages> = {
  es: { ...comun.es, ...evento.es, ...escaner.es, ...panel.es, ...stands.es, ...vivo.es, ...verificacion.es, ...kit.es },
  en: { ...comun.en, ...evento.en, ...escaner.en, ...panel.en, ...stands.en, ...vivo.en, ...verificacion.en, ...kit.en },
};

/** Variables para los textos con huecos: "{monto} USDC de prueba" con { monto: 10 }. */
export type Vars = Record<string, string | number>;
export type T = (key: string, vars?: Vars) => string;

/** Rellena los huecos {nombre} de un texto. */
export function fill(raw: string, vars?: Vars): string {
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (hole, name: string) => (name in vars ? String(vars[name]) : hole));
}

/** Traduce una clave. Si falta en el idioma pedido cae al castellano, y si falta ahí devuelve la clave. */
export function translate(lang: Lang, key: string, vars?: Vars): string {
  return fill(dictionaries[lang][key] ?? dictionaries[DEFAULT_LANG][key] ?? key, vars);
}

export function makeT(lang: Lang): T {
  return (key, vars) => translate(lang, key, vars);
}

export function otherLang(lang: Lang): Lang {
  return lang === "es" ? "en" : "es";
}

const LOCALES: Record<Lang, string> = { es: "es-BO", en: "en-US" };

/**
 * La fecha de un evento, en su zona horaria, como la lee la gente: "domingo, 22 de noviembre, 09:00" y
 * "Sunday, November 22, 9:00 AM". En castellano, con reloj de 24 horas y en minúscula, como la escribe Intl
 * (sirve dentro de una frase: "hasta el domingo"); la pantalla que abre con la fecha la pone con mayúscula
 * (formatEventWhen, en src/server/evento/fecha.ts). En inglés, la hora sin cero adelante aunque se pida
 * "2-digit": "09:00 AM" no se escribe.
 */
export function formatDate(
  lang: Lang,
  iso: string,
  timeZone = "America/La_Paz",
  options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" },
): string {
  const hour: Intl.DateTimeFormatOptions = lang === "en" && options.hour === "2-digit" ? { hour: "numeric" } : {};
  const hourCycle: Intl.DateTimeFormatOptions = lang === "es" ? { hourCycle: "h23" } : {};
  return new Intl.DateTimeFormat(LOCALES[lang], { ...options, ...hour, ...hourCycle, timeZone }).format(new Date(iso));
}

/** Si dos instantes caen el mismo día en esa zona horaria. */
export function sameDay(a: string | number | Date, b: string | number | Date, timeZone = "America/La_Paz"): boolean {
  const day = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric", timeZone });
  return day.format(new Date(a)) === day.format(new Date(b));
}

/** Un monto en USDC de prueba: "10" o "10,50", según el idioma. */
export function formatAmount(lang: Lang, amount: number): string {
  return new Intl.NumberFormat(LOCALES[lang], { maximumFractionDigits: 2 }).format(amount);
}
