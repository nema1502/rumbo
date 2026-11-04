// Qué letras cubre una fuente TrueType u OpenType, leído de su tabla cmap (formatos 4 y 12), y qué fuente del
// sistema puede servir de respaldo. Bricolage Grotesque, la del nombre en el certificado, es solo latina: un
// nombre en cirílico, griego, árabe o chino saldría en blanco. Antes de compilar se mira letra por letra.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Lo que cubre una fuente: `has(códigoDeLetra)` y las letras de un texto que le faltan. */
export function readFontCoverage(file) {
  const set = parseCmap(readFileSync(file), file);
  return {
    file,
    size: set.size,
    has: (codePoint) => set.has(codePoint),
    /** Las letras de `text` que la fuente no tiene, sin repetir. Los espacios y los controles no cuentan. */
    missing(text) {
      const out = new Set();
      for (const char of String(text ?? "")) {
        const cp = char.codePointAt(0);
        if (cp <= 0x20 || (cp >= 0x7f && cp <= 0xa0) || /\p{M}|\p{Cf}/u.test(char)) continue;
        if (!set.has(cp)) out.add(char);
      }
      return [...out];
    },
  };
}

/** Los puntos de código que la fuente sabe dibujar, según su mejor subtabla unicode. */
function parseCmap(buf, file) {
  const notAFont = () => new Error(`${file} no tiene tabla cmap: no es una fuente TrueType u OpenType`);
  if (buf.length < 12) throw notAFont();
  // Una colección (.ttc): se toma la primera fuente.
  const base = buf.toString("latin1", 0, 4) === "ttcf" ? buf.readUInt32BE(12) : 0;
  if (base + 12 > buf.length) throw notAFont();
  const numTables = buf.readUInt16BE(base + 4);
  if (numTables === 0 || numTables > 512 || base + 12 + numTables * 16 > buf.length) throw notAFont();
  let cmap = -1;
  for (let i = 0; i < numTables; i++) {
    const record = base + 12 + i * 16;
    if (buf.toString("latin1", record, record + 4) === "cmap") {
      cmap = buf.readUInt32BE(record + 8);
      break;
    }
  }
  if (cmap < 0 || cmap + 4 > buf.length) throw notAFont();
  const subtables = buf.readUInt16BE(cmap + 2);
  let best = null;
  for (let i = 0; i < subtables; i++) {
    const record = cmap + 4 + i * 8;
    const platform = buf.readUInt16BE(record);
    const encoding = buf.readUInt16BE(record + 2);
    const offset = cmap + buf.readUInt32BE(record + 4);
    const format = buf.readUInt16BE(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode || (format !== 4 && format !== 12)) continue;
    // El formato 12 cubre más allá del plano básico (los emojis, el chino menos común): es el que se prefiere.
    if (!best || (format === 12 && best.format !== 12)) best = { format, offset };
  }
  if (!best) throw new Error(`${file} no tiene una tabla cmap unicode de formato 4 o 12`);
  const set = new Set();
  if (best.format === 12) {
    const groups = buf.readUInt32BE(best.offset + 12);
    for (let g = 0; g < groups; g++) {
      const p = best.offset + 16 + g * 12;
      const start = buf.readUInt32BE(p);
      const end = Math.min(buf.readUInt32BE(p + 4), 0x10ffff);
      for (let c = start; c <= end; c++) set.add(c);
    }
    return set;
  }
  const segCountX2 = buf.readUInt16BE(best.offset + 6);
  const ends = best.offset + 14;
  const starts = ends + segCountX2 + 2;
  const deltas = starts + segCountX2;
  const rangeOffsets = deltas + segCountX2;
  for (let s = 0; s < segCountX2 / 2; s++) {
    const end = buf.readUInt16BE(ends + s * 2);
    const start = buf.readUInt16BE(starts + s * 2);
    const delta = buf.readInt16BE(deltas + s * 2);
    const rangeOffset = buf.readUInt16BE(rangeOffsets + s * 2);
    if (start === 0xffff) continue;
    for (let c = start; c <= end; c++) {
      let glyph;
      if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
      else {
        const address = rangeOffsets + s * 2 + rangeOffset + (c - start) * 2;
        if (address + 2 > buf.length) continue;
        glyph = buf.readUInt16BE(address);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) set.add(c);
    }
  }
  return set;
}

/** Las fuentes de Windows que sirven de respaldo, en orden, con su archivo (para saber qué cubren) y su negrita. */
const WINDOWS_FALLBACKS = [
  { name: "Segoe UI", file: "segoeui.ttf", bold: "segoeuib.ttf" },
  { name: "Arial", file: "arial.ttf", bold: "arialbd.ttf" },
];
/** En los demás sistemas se pregunta a fontconfig por estas familias, en orden. */
const FONTCONFIG_FALLBACKS = ["Noto Sans", "DejaVu Sans", "Liberation Sans", "Arial", "Helvetica Neue"];

/**
 * La fuente de respaldo para un nombre que Bricolage Grotesque no puede escribir: la que diga `name` (y `file`, si
 * se sabe), o una del sistema (Segoe UI o Arial en Windows; con fontconfig, Noto Sans, DejaVu Sans, Liberation
 * Sans, Arial). Null si no hay ninguna. `file` y `bold` son rutas, o null; con la ruta XeLaTeX la carga por archivo.
 */
export function findFallbackFont({ name, file } = {}) {
  if (name) return { name, file: file && existsSync(file) ? file : null, bold: null };
  if (process.platform === "win32") {
    const dir = join(process.env.WINDIR ?? "C:\\Windows", "Fonts");
    for (const candidate of WINDOWS_FALLBACKS) {
      const regular = join(dir, candidate.file);
      if (!existsSync(regular)) continue;
      const bold = join(dir, candidate.bold);
      return { name: candidate.name, file: regular, bold: existsSync(bold) ? bold : null };
    }
    return null;
  }
  let listed = "";
  try {
    listed = execFileSync("fc-list", [":", "family", "file", "style"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
  // Cada línea: /ruta/al/archivo.ttf: Familia,Otra familia:style=Regular
  const lines = listed.split("\n").map((line) => {
    const match = /^(.+?\.(?:ttf|otf|ttc)):\s*([^:]*)(?::style=(.*))?$/i.exec(line.trim());
    return match ? { file: match[1], families: match[2].split(",").map((f) => f.trim()), style: match[3] ?? "" } : null;
  });
  for (const family of FONTCONFIG_FALLBACKS) {
    const own = lines.filter((l) => l && l.families.includes(family));
    if (own.length === 0) continue;
    const regular = own.find((l) => /^(Regular|Book|Normal)$/i.test(l.style)) ?? own[0];
    const bold = own.find((l) => /^Bold$/i.test(l.style)) ?? null;
    return { name: family, file: regular.file, bold: bold?.file ?? null };
  }
  return null;
}

/**
 * Qué fuente lleva el nombre de cada persona: la propia (null) si la cubre entera; si no, la de respaldo. Devuelve
 * además a quiénes ninguna fuente escribe bien, con las letras que faltan, para decirlo con claridad.
 */
export function chooseNameFonts(attendees, { ownCoverage, fallback, fallbackCoverage }) {
  const fonts = new Map();
  const unwritable = [];
  for (const a of attendees) {
    const missing = ownCoverage.missing(a.name);
    if (missing.length === 0) {
      fonts.set(a.passId, null);
      continue;
    }
    if (!fallback) {
      fonts.set(a.passId, null);
      unwritable.push({ passId: a.passId, name: a.name, letters: missing });
      continue;
    }
    // Con la de respaldo igual, aunque tampoco la cubra entera: escribe más letras que la propia.
    fonts.set(a.passId, fallback);
    const still = fallbackCoverage ? fallbackCoverage.missing(a.name) : [];
    if (still.length > 0) unwritable.push({ passId: a.passId, name: a.name, letters: still });
  }
  return { fonts, unwritable };
}

/** La línea de fontspec que declara la fuente de respaldo como \rumboNombreRespaldo: por archivo si se sabe, si no por nombre. */
export function fallbackFontLine(font) {
  const safeName = (text) => /^[A-Za-z0-9 ._\-]+$/.test(text);
  if (font.file) {
    const dir = dirname(font.file).replace(/\\/g, "/");
    const file = basename(font.file);
    if (!safeName(file) || /[{}%#\\~^]/.test(dir)) throw new Error(`La ruta de la fuente de respaldo no se puede escribir en LaTeX: ${font.file}`);
    const sameDir = font.bold && dirname(font.bold) === dirname(font.file) && safeName(basename(font.bold));
    const bold = sameDir ? `, BoldFont={${basename(font.bold)}}` : "";
    return `\\newfontfamily\\rumboNombreRespaldo[Path={${dir}/}${bold}]{${file}}`;
  }
  if (!safeName(font.name)) throw new Error(`El nombre de la fuente de respaldo no se puede escribir en LaTeX: ${font.name}`);
  return `\\newfontfamily\\rumboNombreRespaldo{${font.name}}`;
}
