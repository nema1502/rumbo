// Lo que el programa de embajadores de Stellar le pide a un evento para que cuente, y el sí o el no de cada
// requisito a partir de los números del informe. Lo usan el paquete para el capítulo (scripts/paquete-embajadores.mjs,
// por scripts/lib/informe-pdf.mjs) y la herramienta chapter_package_summary del servidor MCP. Números, nunca
// personas: de los contactos que aceptaron que el capítulo les escriba, solo cuántos.
import type { EventReportData } from "./informe.ts";

/** Asistentes verificados como mínimo (entraron por la puerta, una vez cada uno). */
export const CHAPTER_MIN_ATTENDEES = 20;
/** Minutos de contenido de Stellar en la agenda, como mínimo. */
export const CHAPTER_MIN_STELLAR_MINUTES = 20;
/** El tope de comida por persona, en dólares. */
export const CHAPTER_FOOD_CAP_USD = 25;

export interface ChapterSummary {
  attendees: { verified: number; required: number; ok: boolean };
  /** Lo informa quien organiza; sin el dato, `ok` es null. */
  stellarMinutes: { value: number | null; required: number; ok: boolean | null };
  /** El gasto en comida lo informa quien organiza; por persona sale de dividirlo por quienes entraron. */
  food: { spendUsd: number | null; perPersonUsd: number | null; capUsd: number; ok: boolean | null };
  /** Personas que aceptaron que el capítulo les escriba: cuántas, nunca quiénes. */
  contactsShared: number;
  /** true si los tres requisitos se cumplen, false si alguno no, null si falta algún dato y los demás se cumplen. */
  allChecksPass: boolean | null;
}

export interface ChapterInput {
  stellarMinutes?: number | null;
  foodSpendUsd?: number | null;
  contactsShared: number;
}

/** El sí o el no de cada requisito, con los números al lado para que se entienda por qué. */
export function chapterSummary(data: Pick<EventReportData, "checkedIn">, input: ChapterInput): ChapterSummary {
  const minutes = input.stellarMinutes ?? null;
  const spend = input.foodSpendUsd ?? null;
  const perPerson = spend === null || data.checkedIn === 0 ? null : Math.round((spend / data.checkedIn) * 100) / 100;
  const attendeesOk = data.checkedIn >= CHAPTER_MIN_ATTENDEES;
  const minutesOk = minutes === null ? null : minutes >= CHAPTER_MIN_STELLAR_MINUTES;
  const foodOk = perPerson === null ? null : perPerson <= CHAPTER_FOOD_CAP_USD;
  const checks = [attendeesOk, minutesOk, foodOk];
  return {
    attendees: { verified: data.checkedIn, required: CHAPTER_MIN_ATTENDEES, ok: attendeesOk },
    stellarMinutes: { value: minutes, required: CHAPTER_MIN_STELLAR_MINUTES, ok: minutesOk },
    food: { spendUsd: spend, perPersonUsd: perPerson, capUsd: CHAPTER_FOOD_CAP_USD, ok: foodOk },
    contactsShared: input.contactsShared,
    allChecksPass: checks.includes(false) ? false : checks.includes(null) ? null : true,
  };
}
