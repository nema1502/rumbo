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

const HOUR: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatEventWhen(lang: Lang, event: EventTimes): EventWhen {
  const t = makeT(lang);
  const date = capitalize(formatDate(lang, event.startsAt, event.timezone, { weekday: "long", day: "numeric", month: "long" }));
  const start = formatDate(lang, event.startsAt, event.timezone, HOUR);
  const end = event.endsAt ? formatDate(lang, event.endsAt, event.timezone, HOUR) : null;
  return { date, time: end ? t("evento.horario", { desde: start, hasta: end }) : start };
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
