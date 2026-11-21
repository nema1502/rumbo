// El equipo de la hackatón desde la credencial. Quien ya tiene su credencial arma su equipo con un nombre, o se suma
// al de otra persona con el código del equipo, hasta cinco. No hace falta cuenta: la clave de la credencial es el
// acceso, igual que para abrirla. Tampoco inscribe a nadie, así que vale también en un evento que entra solo por
// lista: junta credenciales que ya existen.
//
// El código del equipo no se guarda en ningún lado: sale de una huella del id del equipo con la llave de datos de la
// app. Seis letras de un alfabeto sin las que se confunden (sin I, L, O, 0 ni 1).
//
// Solo arman equipo las credenciales de participante (no mentoras, jurado, voluntarias ni auspicio), activas, de un
// evento con inscripción por equipos (la plantilla de hackatón la trae).
import { createHmac } from "node:crypto";
import { getEnv } from "../env.ts";
import { TEAM_MAX_MEMBERS, TEAM_NAME_MAX, TEAM_NAME_MIN } from "../kit/equipos.ts";
import { teamCodeAttempts } from "../limites.ts";
import type { EventRecord, Pass, Repo, Team } from "../repo.ts";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TEAM_CODE_LENGTH = 6;

export function teamCode(teamId: string): string {
  const secret = getEnv("RUMBO_DATA_KEY", "") || "rumbo-equipos-sin-llave";
  const digest = createHmac("sha256", secret).update(`equipo:${teamId}`).digest();
  let code = "";
  for (let i = 0; i < TEAM_CODE_LENGTH; i++) code += CODE_ALPHABET[digest[i] % CODE_ALPHABET.length];
  return code;
}

/** Lo que alguien escribe como código: sin espacios ni guiones y en mayúsculas. */
export function normalizeTeamCode(text: unknown): string {
  return typeof text === "string" ? text.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

/** El nombre de un equipo, limpio: sin espacios de más, de 2 a 60 letras. null si no sirve. */
export function cleanTeamName(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const name = text.replace(/\s+/g, " ").trim();
  return name.length >= TEAM_NAME_MIN && name.length <= TEAM_NAME_MAX ? name : null;
}

/** El nombre de pila y la inicial del apellido: alcanza para que el equipo se reconozca. */
export function shortName(full: string | null | undefined): string {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0]?.toUpperCase() ?? ""}.`;
}

export interface TeamMemberView {
  name: string;
  you: boolean;
}

export interface TeamView {
  id: string;
  name: string;
  code: string;
  members: TeamMemberView[];
  max: number;
  full: boolean;
}

export interface PassTeamState {
  /** Si esta credencial puede armar o sumarse a un equipo. */
  allowed: boolean;
  team: TeamView | null;
}

export type TeamError = "not_allowed" | "name" | "name_taken" | "already" | "code" | "full" | "not_in_team" | "blocked";
export type TeamResult = { ok: true; state: PassTeamState } | { ok: false; error: TeamError };

async function allowed(repo: Repo, event: EventRecord, pass: Pass): Promise<boolean> {
  if (!event.teamSignup || pass.eventId !== event.id || pass.status === "pending") return false;
  const type = await repo.getTicketType(pass.ticketTypeId);
  return type?.credentialKind === "attendee";
}

async function view(repo: Repo, team: Team, youPassId: string | null): Promise<TeamView> {
  const passes = await repo.listTeamPasses(team.id);
  const members: TeamMemberView[] = [];
  for (const p of passes) members.push({ name: shortName((await repo.getPersonById(p.personId))?.name), you: p.id === youPassId });
  return { id: team.id, name: team.name, code: teamCode(team.id), members, max: TEAM_MAX_MEMBERS, full: passes.length >= TEAM_MAX_MEMBERS };
}

export async function passTeamState(repo: Repo, event: EventRecord, pass: Pass): Promise<PassTeamState> {
  if (!(await allowed(repo, event, pass))) return { allowed: false, team: null };
  const team = await repo.getPassTeam(pass.id);
  return { allowed: true, team: team && team.eventId === event.id ? await view(repo, team, pass.id) : null };
}

const done = async (repo: Repo, event: EventRecord, pass: Pass): Promise<TeamResult> => ({ ok: true, state: await passTeamState(repo, event, pass) });

/** Arma un equipo nuevo con esta credencial adentro. Si el nombre ya es de otro equipo del evento, no la suma a ese. */
export async function createTeamFor(repo: Repo, event: EventRecord, pass: Pass, rawName: unknown): Promise<TeamResult> {
  if (!(await allowed(repo, event, pass))) return { ok: false, error: "not_allowed" };
  if (await repo.getPassTeam(pass.id)) return { ok: false, error: "already" };
  const name = cleanTeamName(rawName);
  if (!name) return { ok: false, error: "name" };
  const { team, created } = await repo.createTeam(event.id, name);
  if (!created) return { ok: false, error: "name_taken" };
  await repo.setPassTeam(pass.id, team.id);
  return done(repo, event, pass);
}

/** Suma esta credencial al equipo de ese código, si es de este evento y tiene lugar. */
export async function joinTeamFor(repo: Repo, event: EventRecord, pass: Pass, rawCode: unknown): Promise<TeamResult> {
  if (!(await allowed(repo, event, pass))) return { ok: false, error: "not_allowed" };
  if (await repo.getPassTeam(pass.id)) return { ok: false, error: "already" };
  const attempts = teamCodeAttempts();
  if ((await attempts.blockedFor(pass.id)) > 0) return { ok: false, error: "blocked" };
  const code = normalizeTeamCode(rawCode);
  const team = code.length === TEAM_CODE_LENGTH ? (await repo.listTeams(event.id)).find((t) => teamCode(t.id) === code) : undefined;
  if (!team) {
    await attempts.note(pass.id);
    return { ok: false, error: "code" };
  }
  if ((await repo.listTeamPasses(team.id)).length >= TEAM_MAX_MEMBERS) return { ok: false, error: "full" };
  await repo.setPassTeam(pass.id, team.id);
  // Dos que se suman a la vez al último lugar: la segunda se baja.
  if ((await repo.listTeamPasses(team.id)).length > TEAM_MAX_MEMBERS) {
    await repo.removePassTeam(pass.id);
    return { ok: false, error: "full" };
  }
  return done(repo, event, pass);
}

/** Saca la credencial de su equipo. El equipo que queda vacío se borra, y su nombre vuelve a estar libre. */
export async function leaveTeamFor(repo: Repo, event: EventRecord, pass: Pass): Promise<TeamResult> {
  const team = await repo.getPassTeam(pass.id);
  if (!team || team.eventId !== event.id) return { ok: false, error: "not_in_team" };
  await repo.removePassTeam(pass.id);
  if ((await repo.listTeamPasses(team.id)).length === 0) await repo.deleteTeam(team.id);
  return done(repo, event, pass);
}

/** Cambia el nombre del equipo de esta credencial. Cualquiera del equipo lo puede cambiar. */
export async function renameTeamFor(repo: Repo, event: EventRecord, pass: Pass, rawName: unknown): Promise<TeamResult> {
  if (!(await allowed(repo, event, pass))) return { ok: false, error: "not_allowed" };
  const team = await repo.getPassTeam(pass.id);
  if (!team || team.eventId !== event.id) return { ok: false, error: "not_in_team" };
  const name = cleanTeamName(rawName);
  if (!name) return { ok: false, error: "name" };
  if (name !== team.name) {
    const taken = (await repo.listTeams(event.id)).some((t) => t.id !== team.id && t.name.toLowerCase() === name.toLowerCase());
    if (taken) return { ok: false, error: "name_taken" };
    try {
      await repo.renameTeam(team.id, name);
    } catch {
      // Otro equipo tomó ese nombre recién: la base lo rechaza por el índice único.
      return { ok: false, error: "name_taken" };
    }
  }
  return done(repo, event, pass);
}

/** Desde el panel: saca a una persona de su equipo (por ejemplo, alguien que se sumó a uno que no era el suyo). */
export async function removeFromTeamByPanel(repo: Repo, event: EventRecord, passId: string): Promise<boolean> {
  const pass = await repo.getPass(passId);
  if (!pass || pass.eventId !== event.id) return false;
  const team = await repo.getPassTeam(pass.id);
  if (!team || team.eventId !== event.id) return false;
  await repo.removePassTeam(pass.id);
  if ((await repo.listTeamPasses(team.id)).length === 0) await repo.deleteTeam(team.id);
  return true;
}

export type PrizeGrantResult = { ok: true; granted: number } | { ok: false; error: "not_found" | "not_prize" };

/**
 * Desde el panel: le da un premio (un canje de tipo premio, sumado para los equipos que ganan) a cada integrante del
 * equipo. Solo a las credenciales activas cuyo tipo tiene lugar para ese premio en su contrato, así cada una lo retira
 * en la mesa como cualquier canje y queda en la red. Darlo dos veces no lo duplica.
 */
export async function grantPrizeToTeam(repo: Repo, event: EventRecord, teamId: string, benefitId: string): Promise<PrizeGrantResult> {
  const team = await repo.getTeam(teamId);
  const benefit = await repo.getBenefit(benefitId);
  if (!team || team.eventId !== event.id || !benefit || benefit.eventId !== event.id) return { ok: false, error: "not_found" };
  if (benefit.kind !== "prize") return { ok: false, error: "not_prize" };
  let granted = 0;
  for (const pass of await repo.listTeamPasses(team.id)) {
    if (pass.status === "pending") continue;
    const linked = (await repo.listTicketTypeBenefits(pass.ticketTypeId)).some((b) => b.id === benefit.id);
    if (!linked) continue;
    if ((await repo.listPassBenefits(pass.id)).some((b) => b.id === benefit.id)) continue;
    await repo.grantBenefit(pass.id, benefit.id, "manual");
    granted++;
  }
  return { ok: true, granted };
}
