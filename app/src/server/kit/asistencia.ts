// La asistencia del evento, para devolverla a donde se inscribió la gente: un CSV con la forma de una lista de
// asistentes de Bevy (nombre, apellido, correo, tipo de entrada) y una columna `Attended` (Yes o No), que es la
// que piden las ligas de hackatones a sus eventos miembros. Las columnas del final (tipo de credencial y equipo)
// son de Rumbo; las plataformas que no las conocen las ignoran. Los encabezados son en inglés porque ese es el
// idioma de esas plataformas, sin importar el de la pantalla.
//
// Forma aproximada: no se pudo comparar con una exportación real de Bevy (ver app/README.md).
import { csvCell } from "../panel.ts";
import { getRepo, type EventRecord, type Repo } from "../repo.ts";
import { nameKey } from "./csv.ts";

export const ATTENDANCE_HEADER = ["First Name", "Last Name", "Email", "Ticket Type", "Attended", "Checked In At", "Credential Type", "Team"] as const;

/** "Ana María Quiroga" → ["Ana María", "Quiroga"]; "Quiroga, Ana María" → ["Ana María", "Quiroga"]; "Ana" → ["Ana", ""]. */
export function splitName(full: string): [string, string] {
  const name = full.replace(/\s+/g, " ").trim();
  const comma = name.indexOf(",");
  if (comma > 0) return [name.slice(comma + 1).trim(), name.slice(0, comma).trim()];
  const parts = name.split(" ");
  if (parts.length < 2) return [name, ""];
  return [parts.slice(0, -1).join(" "), parts.at(-1) as string];
}

/** El CSV de asistencia: una fila por credencial emitida (las pendientes de pago no entran), con marca de orden para que Excel lo abra en UTF-8. */
export async function buildAttendanceCsv(event: EventRecord, repo: Repo = getRepo()): Promise<string> {
  const [passes, types, teams] = await Promise.all([repo.listPassesWithPerson(event.id), repo.listTicketTypes(event.id), repo.listPassTeams(event.id)]);
  const typeById = new Map(types.map((t) => [t.id, t] as const));
  const teamOf = new Map(teams.map((t) => [t.passId, t.team.name] as const));
  const rows: Array<Array<string | number>> = [];
  for (const { pass, person } of passes.filter((p) => p.pass.status !== "pending")) {
    const [first, last] = splitName(person.name);
    const type = typeById.get(pass.ticketTypeId);
    rows.push([first, last, person.email, type?.name ?? "", pass.status === "checked_in" ? "Yes" : "No", pass.checkedInAt ?? "", type?.credentialKind ?? "attendee", teamOf.get(pass.id) ?? ""]);
  }
  rows.sort((a, b) => nameKey(`${a[1]} ${a[0]}`).localeCompare(nameKey(`${b[1]} ${b[0]}`)));
  return `﻿${[ATTENDANCE_HEADER as readonly string[], ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
