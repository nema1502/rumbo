// De dónde salen los datos del informe en los scripts: la base (con el código del panel, en
// src/server/informe.ts) o un JSON con la misma forma; y lo que quien organiza pasa por la línea de
// comandos (el gasto en comida, los minutos de Stellar, quien auspicia, el comprobante del sorteo).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_DIR, loadEnv } from "./env.mjs";

/** Las opciones que entiende el informe, para parseArgs. */
export const ORGANIZER_OPTIONS = {
  "gasto-comida": { type: "string" },
  "minutos-stellar": { type: "string" },
  auspiciante: { type: "string" },
  "beneficio-auspiciante": { type: "string" },
  "contactos-auspiciante": { type: "string" },
  "comprobante-sorteo": { type: "string" },
};

export function parseNumber(value, name, { integer = false } = {}) {
  if (value === undefined) return undefined;
  const n = Number(String(value).trim().replace(",", "."));
  if (String(value).trim() === "" || !Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) {
    throw new Error(`--${name} tiene que ser un número${integer ? " entero" : ""} mayor o igual a cero (llegó "${value}")`);
  }
  return n;
}

/** Lo que quien organiza pasa por la línea de comandos, listo para applyOrganizerInput. */
export function organizerInputFromArgs(values) {
  return {
    foodSpendUsd: parseNumber(values["gasto-comida"], "gasto-comida"),
    stellarMinutes: parseNumber(values["minutos-stellar"], "minutos-stellar", { integer: true }),
    sponsor: values.auspiciante?.trim() || undefined,
    sponsorBenefit: values["beneficio-auspiciante"]?.trim() || undefined,
    sponsorContacts: parseNumber(values["contactos-auspiciante"], "contactos-auspiciante", { integer: true }),
    raffleProof: values["comprobante-sorteo"]?.trim() || undefined,
  };
}

/** Abre la base de la app (carga .env.local, corre desde app/) y devuelve el repo y el evento. */
export async function openEvent(slug) {
  process.chdir(APP_DIR);
  loadEnv();
  const { getRepo } = await import("../../src/server/repo.ts");
  const repo = getRepo();
  const event = await repo.getEventBySlug(slug);
  if (!event) throw new Error(`No hay ningún evento con slug "${slug}" en la base. Para crear el de muestra: pnpm seed`);
  return { repo, event };
}

/** Los datos del informe de un evento, desde la base. */
export async function reportFromDb(slug) {
  const { repo, event } = await openEvent(slug);
  const { buildEventReportData } = await import("../../src/server/informe.ts");
  return { repo, event, data: await buildEventReportData(event, repo) };
}

/** Los datos del informe desde un JSON (la forma de EventReportData). */
export function reportFromFile(file) {
  return JSON.parse(readFileSync(resolve(file), "utf8"));
}
