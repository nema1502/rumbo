"use server";
// La acción del formulario del equipo: valida, inscribe a cada integrante y devuelve el resultado, con los textos
// ya traducidos al idioma del pedido.
import { headers } from "next/headers";
import { makeT } from "@/i18n/index.ts";
import { getLang } from "@/i18n/server.ts";
import { clientKey } from "@/server/limites.ts";
import { registerTeam, TEAM_MAX_MEMBERS, type TeamFailure } from "@/server/kit/equipos.ts";

export interface TeamFormState {
  /** Un error general, ya traducido. */
  error?: string;
  /** El problema de una fila (desde 0), ya traducido. */
  rowError?: { row: number; message: string };
  /** Lo que se escribió, para no perderlo. */
  values?: { team: string; members: Array<{ name: string; email: string }> };
  /** Terminó: el equipo y cuántos quedaron, y cuántos no. */
  done?: { team: string; registered: number; failed: number };
}

const FAILURE_KEYS: Record<TeamFailure, string> = {
  not_found: "kit.equipo.errorGeneral",
  no_teams: "kit.equipo.errorSinEquipos",
  name: "kit.equipo.errorNombre",
  no_members: "kit.equipo.errorSinIntegrantes",
  too_many_members: "kit.equipo.errorGeneral",
  member: "kit.equipo.errorFila",
  repeated: "kit.equipo.errorRepetido",
  team_exists: "kit.equipo.errorNombreEnUso",
  other_team: "kit.equipo.errorOtro",
  no_ticket: "kit.equipo.errorGeneral",
};

/** De dónde llegó el pedido, para que el enlace del correo abra en el mismo servidor en desarrollo. */
async function requestOrigin(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export async function registerTeamAction(_prev: TeamFormState, formData: FormData): Promise<TeamFormState> {
  const lang = await getLang();
  const t = makeT(lang);
  const field = (name: string) => String(formData.get(name) ?? "");
  const slug = field("evento").trim();
  const members = Array.from({ length: TEAM_MAX_MEMBERS }, (_, i) => ({ name: field(`nombre${i}`), email: field(`correo${i}`) }));
  const values = { team: field("equipo"), members };

  let result;
  try {
    result = await registerTeam({ slug, teamName: values.team, members, lang, origin: await requestOrigin(), clientKey: clientKey(await headers()) });
  } catch (error) {
    console.error("[equipo]", error);
    return { error: t("kit.equipo.errorGeneral"), values };
  }

  if (!result.ok) {
    const message = t(FAILURE_KEYS[result.reason]);
    return result.row !== undefined ? { rowError: { row: result.row, message }, values } : { error: message, values };
  }
  if (result.registered === 0) {
    const tooMany = result.failed.some((f) => f.reason === "too_many");
    return { error: t(tooMany ? "kit.equipo.errorDemasiados" : "kit.equipo.errorGeneral"), values };
  }
  return { done: { team: result.team.name, registered: result.registered, failed: result.failed.length } };
}
