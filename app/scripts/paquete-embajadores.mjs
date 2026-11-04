// El paquete para el programa de embajadores de Stellar: una carpeta con lo que el capítulo necesita
// para documentar un evento que cuenta.
//   informe-<slug>-<lang>.pdf   el informe del evento (scripts/informe.mjs)
//   airtable.csv                la fila para el Airtable del capítulo: evento, fecha, ciudad, asistentes
//                               verificados, minutos de contenido de Stellar, enlace del contrato y del informe
//   contactos-capitulo.csv      nombre y correo, solo de quienes marcaron que la comunidad les escriba
//   resumen.txt                 si el evento cumple lo que pide el programa
//
// Uso:
//   node scripts/paquete-embajadores.mjs --evento <slug> --minutos-stellar <n> --gasto-comida <USD>
//        [--lang en|es] [--salida <carpeta>] [--enlace-informe <url>]
//        [--auspiciante <nombre>] [--beneficio-auspiciante <beneficio>] [--contactos-auspiciante <n>]
//        [--comprobante-sorteo <enlace>]
// Sin --salida, queda en data/paquetes/<slug>/ (fuera del repositorio: el CSV de contactos lleva correos).
// --lang es el idioma del informe y del resumen (en por defecto: lo lee el programa). La fila del Airtable
// va con los encabezados en inglés. El paquete oficial de la SDF no es público: los campos se ajustan
// cuando el programa le pase al capítulo la plantilla oficial.
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { APP_DIR } from "./lib/env.mjs";
import { ORGANIZER_OPTIONS, organizerInputFromArgs, reportFromDb } from "./lib/informe-datos.mjs";
import { FOOD_CAP_USD, MIN_ATTENDEES, MIN_STELLAR_MINUTES, applyOrganizerInput, formatos, renderInforme, textos } from "./lib/informe-pdf.mjs";

const { values } = parseArgs({
  options: {
    evento: { type: "string" },
    lang: { type: "string", default: "en" },
    salida: { type: "string" },
    "enlace-informe": { type: "string" },
    ...ORGANIZER_OPTIONS,
  },
});

/** Una celda de CSV sin fórmulas (src/server/panel.ts hace lo mismo con el CSV del panel). */
const cell = (value) => {
  const text = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",;\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows) => `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
const explorer = (network, id) => `https://stellar.expert/explorer/${network === "public" ? "public" : "testnet"}/contract/${id}`;

try {
  const lang = values.lang;
  if (lang !== "es" && lang !== "en") throw new Error("--lang tiene que ser es o en");
  if (!values.evento) throw new Error("Falta --evento <slug>.");
  const salidaArg = values.salida ? resolve(values.salida) : null;
  const input = organizerInputFromArgs(values);
  if (input.stellarMinutes === undefined) console.warn("Ojo: falta --minutos-stellar. El resumen lo marca como sin dato y el informe deja el campo para completar a mano.");
  if (input.foodSpendUsd === undefined) console.warn("Ojo: falta --gasto-comida. El resumen no puede comparar la comida con el tope.");

  const { repo, event, data: raw } = await reportFromDb(values.evento);
  const { buildChapterContactsCsv, listChapterContacts } = await import("../src/server/panel.ts");
  const data = applyOrganizerInput(raw, input);
  const dir = salidaArg ?? join(APP_DIR, "data", "paquetes", event.slug);
  mkdirSync(dir, { recursive: true });

  // El informe
  const informe = join(dir, `informe-${event.slug}-${lang}.pdf`);
  const { problems } = await renderInforme(data, lang, informe);

  // La fila del Airtable del capítulo, con los encabezados en inglés.
  const dateIso = new Intl.DateTimeFormat("en-CA", { timeZone: event.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(event.startsAt));
  const contracts = data.contracts.map((c) => explorer(data.network, c.id)).join(" ");
  const reportLink = values["enlace-informe"] ?? basename(informe);
  writeFileSync(
    join(dir, "airtable.csv"),
    csv([
      ["Event name", "Date", "City", "Verified attendees", "Stellar content (minutes)", "Contract link", "Report link"],
      [event.name, dateIso, event.place, data.verifiedAttendees ?? data.checkedIn, data.stellarMinutes ?? "", contracts, reportLink],
    ]),
  );

  // Los contactos: solo quienes marcaron la casilla.
  const contacts = await listChapterContacts(event, repo);
  writeFileSync(join(dir, "contactos-capitulo.csv"), await buildChapterContactsCsv(event, lang, repo));

  // El resumen
  const t = textos(lang);
  const fl = formatos(lang, event.timezone);
  const yesNo = (ok) => (ok ? t("paquete.si") : t("paquete.no"));
  const lines = [t("paquete.titulo"), ""];
  lines.push(`${t("paquete.evento")}: ${event.name}`);
  lines.push(`${t("paquete.fecha")}: ${fl.dia(event.startsAt)}`);
  lines.push(`${t("paquete.ciudad")}: ${event.place}`);
  for (const c of data.contracts) lines.push(`${t("paquete.contrato")}: ${explorer(data.network, c.id)}`);
  lines.push("", `${t("paquete.requisitos")}:`);
  // Para el mínimo cuentan solo las credenciales de asistente (el programa deja afuera a oradores, voluntarios y organización).
  const verified = data.verifiedAttendees ?? data.checkedIn;
  lines.push(`- ${t("paquete.asistentes")}: ${yesNo(verified >= MIN_ATTENDEES)} (${fl.n(verified)})`);
  lines.push(
    `- ${t("paquete.minutos")}: ${data.stellarMinutes == null ? t("paquete.sinDato", { opcion: "minutos-stellar" }) : `${yesNo(data.stellarMinutes >= MIN_STELLAR_MINUTES)} (${fl.n(data.stellarMinutes)})`}`,
  );
  if (data.foodSpendUsd == null || data.checkedIn === 0) {
    lines.push(`- ${t("paquete.comida")}: ${t("paquete.sinDato", { opcion: "gasto-comida" })}`);
  } else {
    const perPerson = Math.round((data.foodSpendUsd / data.checkedIn) * 100) / 100;
    const monto = fl.usd(perPerson).replace(/ /g, " ");
    lines.push(`- ${t("paquete.comida")}: ${perPerson <= FOOD_CAP_USD ? t("paquete.comidaDentro", { monto }) : t("paquete.comidaFuera", { monto })}`);
  }
  lines.push(`- ${t("paquete.contactos")}: ${fl.n(contacts.length)}`);
  lines.push("", `${t("paquete.archivos")}:`);
  lines.push(`- ${basename(informe)}: ${t("paquete.archivo.informe")}`);
  lines.push(`- airtable.csv: ${t("paquete.archivo.airtable")}`);
  lines.push(`- contactos-capitulo.csv: ${t("paquete.archivo.contactos")}`);
  lines.push("", t("paquete.nota"), "");
  writeFileSync(join(dir, "resumen.txt"), lines.join("\r\n").replace(/ /g, " "));

  console.log(`Paquete listo en ${dir}`);
  console.log(lines.join("\n"));
  if (problems.length > 0) {
    console.warn(`XeLaTeX avisó ${problems.length} cosas para revisar en el informe:`);
    for (const p of problems.slice(0, 20)) console.warn(`  ${p}`);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// Con Postgres el pool deja las conexiones abiertas un rato: se cierra, así el script termina enseguida.
const { closeDb } = await import("../src/server/base/index.ts");
await closeDb();
