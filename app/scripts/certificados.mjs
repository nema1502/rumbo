// Los certificados de asistencia verificables: un PDF por persona que entró al evento, con su nombre,
// el evento, la fecha, la duración, la hora en que entró y un QR que lleva a /v/<pase>?c=<código>, la
// página pública que dice si esa persona entró y enlaza su transacción de entrada en Stellar.
// El nombre va en el certificado y en esa página; nunca en la cadena.
//
// Uso:
//   node scripts/certificados.mjs --evento <slug> [--lang es|en] [--salida <carpeta>] [--base https://rum.bo]
//   node scripts/certificados.mjs --datos informes/ejemplo-certificados.json --lang es --salida <carpeta>
//   --solo <pase>                      uno solo (para probar)
//   --fuente-respaldo <nombre>         la fuente del sistema para los nombres que Bricolage Grotesque no puede
//                                      escribir (no es latina). Sin esta opción se busca sola: Segoe UI o Arial en
//                                      Windows; Noto Sans, DejaVu Sans, Liberation Sans o Arial con fontconfig.
//   --fuente-respaldo-archivo <.ttf>   el archivo de esa fuente, para saber qué letras cubre antes de compilar
// Sin --salida, quedan en data/certificados/<slug>/ (fuera del repositorio: llevan nombres), con un
// indice.csv (pase, nombre, archivo) para mandarlos. --base es la dirección pública de la app: el QR
// apunta ahí (por defecto NEXT_PUBLIC_BASE_URL).
import { availableParallelism } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { APP_DIR } from "./lib/env.mjs";
import { renderCertificado } from "./lib/certificado-pdf.mjs";
import { chooseNameFonts, findFallbackFont, readFontCoverage } from "./lib/fuentes.mjs";
import { openEvent, reportFromFile } from "./lib/informe-datos.mjs";
import { INFORMES_DIR, mapLimit } from "./lib/latex.mjs";

const { values } = parseArgs({
  options: {
    evento: { type: "string" },
    datos: { type: "string" },
    lang: { type: "string", default: "es" },
    salida: { type: "string" },
    base: { type: "string" },
    solo: { type: "string" },
    "fuente-respaldo": { type: "string" },
    "fuente-respaldo-archivo": { type: "string" },
  },
});

/** Una celda de CSV sin fórmulas (lo mismo que hace el CSV del panel). */
const cell = (value) => {
  const text = /^[=+\-@\t\r]/.test(String(value)) ? `'${value}` : String(value);
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** La fuente del nombre en el certificado (certificado.tex usa \rumboCifra: Bricolage Grotesque 96pt Bold). */
const NAME_FONT_FILE = join(INFORMES_DIR, "fuentes", "BricolageGrotesque96pt-Bold.ttf");

try {
  const lang = values.lang;
  if (lang !== "es" && lang !== "en") throw new Error("--lang tiene que ser es o en");
  if (!values.evento === !values.datos) throw new Error("Pasá --evento <slug> (desde la base) o --datos <archivo.json>, uno de los dos.");
  const salidaArg = values.salida ? resolve(values.salida) : null;
  const respaldoArchivo = values["fuente-respaldo-archivo"] ? resolve(values["fuente-respaldo-archivo"]) : undefined;

  let event;
  let attendees;
  let example = false;
  let generatedAt = new Date().toISOString();
  let urlFor;
  if (values.datos) {
    const data = reportFromFile(values.datos);
    event = data.event;
    attendees = data.attendees ?? [];
    example = Boolean(data.example);
    if (example && data.generatedAt) generatedAt = data.generatedAt;
    const base = (values.base ?? data.baseUrl ?? "https://rum.bo").replace(/\/+$/, "");
    urlFor = (a) => `${base}/v/${encodeURIComponent(a.passId)}?c=${encodeURIComponent(a.code)}`;
  } else {
    const { repo, event: record } = await openEvent(values.evento);
    const { listCertificateAttendees, verificationUrl } = await import("../src/server/verificacion.ts");
    const { baseUrl } = await import("../src/server/env.ts");
    const base = values.base ?? baseUrl();
    if (/localhost|127\.0\.0\.1/.test(base)) console.warn(`Ojo: el QR apunta a ${base}. Para los certificados de verdad, pasá --base con la dirección pública de la app.`);
    event = { slug: record.slug, name: record.name, community: record.organizerName, startsAt: record.startsAt, endsAt: record.endsAt, timezone: record.timezone, place: record.place, venue: record.venue };
    attendees = await listCertificateAttendees(record, repo);
    urlFor = (a) => verificationUrl(a.passId, a.code, base);
  }
  if (values.solo) attendees = attendees.filter((a) => a.passId === values.solo.toUpperCase());
  if (attendees.length === 0) throw new Error("No hay nadie que haya entrado al evento: no hay certificados para hacer.");

  // Los nombres que Bricolage Grotesque no puede escribir van en una fuente de respaldo del sistema.
  const ownCoverage = readFontCoverage(NAME_FONT_FILE);
  const needsFallback = attendees.some((a) => ownCoverage.missing(a.name).length > 0);
  const fallback = needsFallback ? findFallbackFont({ name: values["fuente-respaldo"], file: respaldoArchivo }) : null;
  const fallbackCoverage = fallback?.file ? readFontCoverage(fallback.file) : null;
  const { fonts, unwritable } = chooseNameFonts(attendees, { ownCoverage, fallback, fallbackCoverage });
  if (needsFallback && fallback) console.log(`Algunos nombres llevan letras que Bricolage Grotesque no tiene: van en ${fallback.name}${fallback.file ? ` (${fallback.file})` : ""}.`);

  const dir = salidaArg ?? join(APP_DIR, "data", "certificados", event.slug || "evento");
  mkdirSync(dir, { recursive: true });
  const started = Date.now();
  const limit = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
  const warnings = [];
  const files = await mapLimit(attendees, limit, async (a) => {
    const file = `certificado-${a.passId}-${lang}.pdf`;
    const { problems } = await renderCertificado({ event, attendee: a, url: urlFor(a), lang, example, generatedAt, nameFont: fonts.get(a.passId) ?? null }, join(dir, file));
    for (const p of problems) warnings.push(`${a.passId} (${a.name}): ${p}`);
    return file;
  });
  const header = lang === "en" ? ["pass", "name", "file"] : ["pase", "nombre", "archivo"];
  const rows = attendees.map((a, i) => [a.passId, a.name, files[i]]);
  writeFileSync(join(dir, `indice-${lang}.csv`), `﻿${[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`);
  console.log(`${files.length} certificados en ${dir} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  if (unwritable.length > 0) {
    console.warn(
      fallback
        ? `${unwritable.length} nombre(s) llevan letras que ni Bricolage Grotesque ni ${fallback.name} tienen: salen incompletos. Pasá --fuente-respaldo <nombre> (y --fuente-respaldo-archivo <ruta.ttf>) con una fuente que las tenga.`
        : `${unwritable.length} nombre(s) llevan letras que Bricolage Grotesque no tiene y no encontré una fuente de respaldo en el sistema: salen en blanco. Pasá --fuente-respaldo <nombre> (y --fuente-respaldo-archivo <ruta.ttf>).`,
    );
    for (const u of unwritable) console.warn(`  ${u.passId}: ${u.name} (letras: ${u.letters.join(" ")})`);
    process.exitCode = 2;
  }
  if (warnings.length > 0) {
    console.warn(`XeLaTeX avisó ${warnings.length} cosas para revisar:`);
    for (const w of warnings.slice(0, 20)) console.warn(`  ${w}`);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// Con Postgres el pool deja las conexiones abiertas un rato: se cierra, así el script termina enseguida.
const { closeDb } = await import("../src/server/base/index.ts");
await closeDb();
