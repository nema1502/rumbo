// El informe del evento en PDF, para quien organiza, para quien auspicia y para el programa de
// embajadores de Stellar. Lee los números con el mismo código del panel (src/server/informe.ts) o
// de un JSON con la misma forma, y compila app/informes/informe.tex con XeLaTeX.
//
// Uso:
//   node scripts/informe.mjs --evento <slug> [--lang es|en] [--salida <archivo.pdf>]
//        [--gasto-comida <USD>] [--minutos-stellar <n>]
//        [--auspiciante <nombre>] [--beneficio-auspiciante <beneficio>] [--contactos-auspiciante <n>]
//        [--comprobante-sorteo <enlace>]
//   node scripts/informe.mjs --datos informes/ejemplo.json --lang es --salida informes/ejemplo-es.pdf
//   --json <archivo>  además deja el JSON con los agregados (el mismo que acepta --datos)
//   --conservar       no borra la carpeta de trabajo de XeLaTeX (para mirar el .log)
// Sin --salida, el PDF queda en data/informes/<slug>-<lang>.pdf.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { APP_DIR } from "./lib/env.mjs";
import { ORGANIZER_OPTIONS, organizerInputFromArgs, reportFromDb, reportFromFile } from "./lib/informe-datos.mjs";
import { applyOrganizerInput, renderInforme } from "./lib/informe-pdf.mjs";

const { values } = parseArgs({
  options: {
    evento: { type: "string" },
    datos: { type: "string" },
    lang: { type: "string", default: "es" },
    salida: { type: "string" },
    json: { type: "string" },
    conservar: { type: "boolean", default: false },
    ...ORGANIZER_OPTIONS,
  },
});

try {
  const lang = values.lang;
  if (lang !== "es" && lang !== "en") throw new Error("--lang tiene que ser es o en");
  if (!values.evento === !values.datos) throw new Error("Pasá --evento <slug> (desde la base) o --datos <archivo.json>, uno de los dos.");
  // Las rutas relativas se leen desde donde se corrió el comando, antes de que abrir la base cambie a app/.
  const salida = values.salida ? resolve(values.salida) : null;
  const json = values.json ? resolve(values.json) : null;
  const input = organizerInputFromArgs(values);

  const raw = values.datos ? reportFromFile(values.datos) : (await reportFromDb(values.evento)).data;
  const data = applyOrganizerInput(raw, input);
  const slug = data.event?.slug || values.evento || "evento";
  const output = salida ?? join(APP_DIR, "data", "informes", `${slug}-${lang}.pdf`);
  if (json) {
    mkdirSync(dirname(json), { recursive: true });
    writeFileSync(json, `${JSON.stringify(data, null, 2)}\n`);
  }

  const started = Date.now();
  const { problems, work } = await renderInforme(data, lang, output, { keep: values.conservar });
  console.log(`Informe listo: ${output} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  if (values.conservar) console.log(`Carpeta de trabajo: ${work}`);
  if (problems.length > 0) {
    console.warn(`XeLaTeX avisó ${problems.length} cosas para revisar:`);
    for (const p of problems.slice(0, 20)) console.warn(`  ${p}`);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
