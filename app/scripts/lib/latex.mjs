// Lo que comparten los documentos que se imprimen con LaTeX (el informe del evento, los certificados):
// escapar el texto, escribir datos.tex y compilar con XeLaTeX en una carpeta temporal.
import { spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** La carpeta de las plantillas: app/informes. */
export const INFORMES_DIR = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "informes");

const SPECIAL = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "[": "{[}",
  "]": "{]}",
  "`": "\\textasciigrave{}",
};

/**
 * Un texto cualquiera (el nombre de un evento, de una persona, de un beneficio) listo para ir dentro
 * de LaTeX: los caracteres especiales se escriben como texto, los saltos de línea se vuelven espacios
 * y las ligaduras de TeX ("--", "''", "!`") no se forman.
 */
export function tex(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF]/g, "")
    .replace(/[\t\n\v\f\r ]+/g, " ")
    .trim()
    .replace(/[\\{}&%$#_~^[\]`]/g, (c) => SPECIAL[c])
    .replace(/([-'!?,<>])(?=[-',<>])/g, "$1{}");
}

/**
 * Un enlace para \rumbourl{clave}|enlace|: solo http y https, y con los caracteres que LaTeX o la barra
 * vertical no aguantan ya codificados (los espacios, las llaves, la barra invertida, la barra vertical).
 * Lo demás (#, %, &, ~, _) lo lee la clase como letras.
 */
export function safeUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`El enlace tiene que ser http o https: ${value}`);
  return url.href.replace(/[\s{}\\|^`"<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/** Arma datos.tex: valores (ya en LaTeX) y enlaces. */
export class TexData {
  constructor() {
    this.lines = ["% Escrito por el generador. No se edita a mano."];
  }
  /** Un valor que ya es LaTeX (piezas armadas con texto escapado). */
  raw(key, value) {
    if (!/^[a-z0-9.]+$/i.test(key)) throw new Error(`Clave inválida para datos.tex: ${key}`);
    const body = String(value);
    if (/\n\s*\n/.test(body)) throw new Error(`El valor de ${key} tiene un párrafo vacío`);
    this.lines.push(`\\rumboset{${key}}{${body}}`);
    return this;
  }
  /** Un texto común: se escapa. */
  text(key, value) {
    return this.raw(key, tex(value));
  }
  /** Una marca: la sección existe. */
  flag(key, on = true) {
    if (on) this.raw(key, "1");
    return this;
  }
  url(key, value) {
    if (!/^[a-z0-9.]+$/i.test(key)) throw new Error(`Clave inválida para datos.tex: ${key}`);
    this.lines.push(`\\rumbourl{${key}}|${safeUrl(value)}|`);
    return this;
  }
  toString() {
    return `${this.lines.join("\n")}\n`;
  }
}

/** Dónde está xelatex: XELATEX, o el que esté en el PATH. */
export function xelatexCommand() {
  return process.env.XELATEX || "xelatex";
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (error) => reject(error.code === "ENOENT" ? new Error(`No encuentro ${cmd}. Hace falta TeX Live (o TinyTeX) con XeLaTeX en el PATH, o la variable XELATEX con su ruta.`) : error));
    child.on("close", (code) => resolve({ code, out }));
  });
}

/** Lo que el registro de XeLaTeX dice que salió mal o raro: errores, fuentes, letras que faltan, cajas que se pasan. */
export function logProblems(log) {
  const problems = [];
  for (const line of log.split(/\r?\n/)) {
    if (/^! /.test(line) || /^[^:]+:\d+: /.test(line)) problems.push(line);
    else if (/Missing character/i.test(line)) problems.push(line);
    else if (/Font shape .* undefined|font .* not found|fontspec (error|warning)/i.test(line)) problems.push(line);
    else if (/^Overfull \\[hv]box/.test(line)) problems.push(line);
    else if (/LaTeX Warning: (Reference|There were undefined)/.test(line)) problems.push(line);
  }
  return problems;
}

/**
 * Compila una plantilla de app/informes en una carpeta temporal: copia la clase, la plantilla, las
 * fuentes y la marca, escribe datos.tex, corre XeLaTeX las veces pedidas y deja el PDF en `salida`.
 * Devuelve lo que el registro marcó como problema (vacío si salió limpio).
 */
export async function compileTemplate({ template, data, output, runs = 2, extraFiles = {}, keep = false }) {
  const work = mkdtempSync(join(tmpdir(), "rumbo-latex-"));
  try {
    for (const file of ["rumbo-informe.cls", template]) copyFileSync(join(INFORMES_DIR, file), join(work, file));
    cpSync(join(INFORMES_DIR, "fuentes"), join(work, "fuentes"), { recursive: true });
    cpSync(join(INFORMES_DIR, "marca"), join(work, "marca"), { recursive: true });
    writeFileSync(join(work, "datos.tex"), String(data), "utf8");
    for (const [name, content] of Object.entries(extraFiles)) writeFileSync(join(work, name), content, "utf8");
    const base = template.replace(/\.tex$/, "");
    let last = { code: 0, out: "" };
    for (let i = 0; i < runs; i++) {
      last = await run(xelatexCommand(), ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", template], work);
      if (last.code !== 0) break;
    }
    const logFile = join(work, `${base}.log`);
    const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : last.out;
    if (last.code !== 0 || !existsSync(join(work, `${base}.pdf`))) {
      const problems = logProblems(log);
      throw new Error(`XeLaTeX no pudo compilar ${template} (código ${last.code}).\n${problems.slice(0, 12).join("\n") || last.out.slice(-2000)}\nCarpeta de trabajo: ${work}`);
    }
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(join(work, `${base}.pdf`), output);
    return { problems: logProblems(log), log, work };
  } finally {
    if (!keep) {
      try {
        rmSync(work, { recursive: true, force: true });
      } catch {
        /* en Windows el antivirus a veces retiene un archivo: queda en la carpeta temporal */
      }
    }
  }
}

/** Corre tareas con un tope de cuántas a la vez. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
