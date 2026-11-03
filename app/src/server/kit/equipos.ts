// La inscripción por equipos de la hackatón: un nombre de equipo y sus integrantes. Cada integrante se inscribe
// con la inscripción de siempre (su cuenta, su lugar en el contrato, su credencial y su correo con el enlace) y
// queda anotado en el equipo. Nombres y correos viven en la base; a la cadena va solo la cuenta de cada persona.
import type { Lang } from "../../i18n/index.ts";
import { isPublicKind } from "../../lib/credential-kinds.ts";
import { registerForEvent, validateFields, type FailureReason } from "../evento/inscripcion.ts";
import { getRepo, normalizeEmail, type Repo, type Team } from "../repo.ts";

export interface TeamMemberInput {
  name: string;
  email: string;
}

export const TEAM_NAME_MIN = 2;
export const TEAM_NAME_MAX = 60;
/** Cuántos integrantes entran en un equipo. */
export const TEAM_MAX_MEMBERS = 5;

export interface TeamInput {
  slug: string;
  teamName: string;
  /** Las filas vacías (sin nombre ni correo) se ignoran. */
  members: TeamMemberInput[];
  lang: Lang;
  origin?: string | null;
  clientKey?: string | null;
}

export type TeamFailure = "not_found" | "no_teams" | "name" | "no_members" | "too_many_members" | "member" | "repeated" | "team_exists" | "other_team" | "no_ticket";

export type TeamResult =
  | { ok: false; reason: TeamFailure; /** La fila (desde 0) con el problema, si es de una persona. */ row?: number }
  | {
      ok: true;
      team: Team;
      /** Integrantes que ya quedaron con su credencial y anotados en el equipo. */
      registered: number;
      /** Los que no se pudieron inscribir: la fila y por qué. Se reintentan con el mismo nombre de equipo. */
      failed: Array<{ row: number; reason: FailureReason }>;
    };

const clean = (text: string): string => text.replace(/\s+/g, " ").trim();

export async function registerTeam(input: TeamInput, repo: Repo = getRepo()): Promise<TeamResult> {
  const event = await repo.getEventBySlug(input.slug);
  if (!event || !event.published) return { ok: false, reason: "not_found" };
  if (!event.teamSignup) return { ok: false, reason: "no_teams" };

  const teamName = clean(input.teamName);
  if (teamName.length < TEAM_NAME_MIN || teamName.length > TEAM_NAME_MAX) return { ok: false, reason: "name" };

  // Cada fila con algo escrito es un integrante; el resto son filas en blanco del formulario.
  const rows = input.members.map((m, row) => ({ row, name: clean(m.name), email: normalizeEmail(m.email) })).filter((m) => m.name || m.email);
  if (rows.length === 0) return { ok: false, reason: "no_members" };
  if (rows.length > TEAM_MAX_MEMBERS) return { ok: false, reason: "too_many_members" };
  const seen = new Set<string>();
  for (const member of rows) {
    if (Object.keys(validateFields(member)).length > 0) return { ok: false, reason: "member", row: member.row };
    if (seen.has(member.email)) return { ok: false, reason: "repeated", row: member.row };
    seen.add(member.email);
  }

  // Todos se inscriben a la entrada gratis del asistente (en la hackatón, "Participante").
  const types = await repo.listTicketTypes(event.id);
  const ticket = types.find((t) => isPublicKind(t.credentialKind) && t.priceUsdc === 0);
  if (!ticket) return { ok: false, reason: "no_ticket" };

  // Antes de inscribir a nadie: ninguno está ya en otro equipo, y si el nombre ya existe es el mismo equipo (un reintento).
  const existing = (await repo.listTeams(event.id)).find((t) => t.name.toLowerCase() === teamName.toLowerCase());
  const existingMembers = new Set<string>();
  if (existing) {
    for (const pass of await repo.listTeamPasses(existing.id)) {
      const person = await repo.getPersonById(pass.personId);
      if (person) existingMembers.add(person.email);
    }
  }
  const alreadyMembers = rows.filter((m) => existingMembers.has(m.email)).length;
  // Un equipo que quedó sin nadie (todas las inscripciones fallaron) se puede volver a intentar con el mismo nombre.
  if (existing && existingMembers.size > 0 && alreadyMembers === 0) return { ok: false, reason: "team_exists" };
  for (const member of rows) {
    const person = await repo.getPersonByEmail(member.email);
    const pass = person ? await repo.findPass(event.id, person.id) : null;
    const team = pass ? await repo.getPassTeam(pass.id) : null;
    if (team && team.name.toLowerCase() !== teamName.toLowerCase()) return { ok: false, reason: "other_team", row: member.row };
  }

  const { team } = await repo.createTeam(event.id, teamName);
  let registered = 0;
  const failed: Array<{ row: number; reason: FailureReason }> = [];
  for (const member of rows) {
    const result = await registerForEvent({
      slug: input.slug,
      ticketTypeId: ticket.id,
      name: member.name,
      email: member.email,
      lang: input.lang,
      origin: input.origin,
      clientKey: input.clientKey,
    });
    if (result.kind === "failed") {
      failed.push({ row: member.row, reason: result.reason });
      // Con el freno puesto, los que siguen tampoco entrarían.
      if (result.reason === "too_many") {
        for (const rest of rows.filter((m) => m.row > member.row)) failed.push({ row: rest.row, reason: "too_many" });
        break;
      }
      continue;
    }
    // Quien ya tenía su credencial (se había inscripto solo) queda anotado en el equipo; se le reenvía su enlace.
    await repo.setPassTeam(result.pass.id, team.id);
    registered++;
  }
  return { ok: true, team, registered, failed };
}
