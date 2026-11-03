// La fecha, la hora y el lugar de un evento como los lee la gente, en su zona horaria.
import { formatDate, makeT } from "../../i18n/index.ts";
import type { Lang } from "../../i18n/types.ts";

export interface EventWhen {
  /** "Domingo, 22 de noviembre" */
  date: string;
  /** "09:00 a 19:00", o solo la hora de inicio si no hay fin */
  time: string;
}

interface EventTimes {
  startsAt: string;
  endsAt: string | null;
  timezone: string;
}

/** "09:00" en castellano (reloj de 24 horas); "9:00 AM" en inglés. */
function hourOptions(lang: Lang): Intl.DateTimeFormatOptions {
  return { hour: lang === "es" ? "2-digit" : "numeric", minute: "2-digit" };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatEventWhen(lang: Lang, event: EventTimes): EventWhen {
  const t = makeT(lang);
  const date = capitalize(formatDate(lang, event.startsAt, event.timezone, { weekday: "long", day: "numeric", month: "long" }));
  const start = formatDate(lang, event.startsAt, event.timezone, hourOptions(lang));
  const end = event.endsAt ? formatDate(lang, event.endsAt, event.timezone, hourOptions(lang)) : null;
  if (!end || !event.endsAt) return { date, time: start };
  // Un evento de varios días (la hackatón) termina otro día: se dice cuál, no solo la hora.
  const day = (iso: string) => formatDate(lang, iso, event.timezone, { year: "numeric", month: "numeric", day: "numeric" });
  if (day(event.startsAt) !== day(event.endsAt)) {
    return { date, time: t("kit.cuando.hasta", { desde: start, hasta: formatDate(lang, event.endsAt, event.timezone, { weekday: "long", day: "numeric", month: "long", ...hourOptions(lang) }) }) };
  }
  return { date, time: t("evento.horario", { desde: start, hasta: end }) };
}

export function formatEventWhere(event: { place: string; venue: string | null }): string {
  return event.venue ? `${event.venue}, ${event.place}` : event.place;
}

/** Una lista como frase: "el almuerzo, la polera y el premio". */
export function joinList(lang: Lang, items: string[]): string {
  if (items.length === 0) return "";
  const formatter = new Intl.ListFormat(lang === "es" ? "es-BO" : "en-US", { style: "long", type: "conjunction" });
  return formatter.format(items);
}
