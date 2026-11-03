// La credencial para imprimir, como SVG de 100 por 150 milímetros: el evento arriba, el QR grande con su
// margen blanco, el nombre legible a dos metros y lo que le toca a la persona. Las fuentes son las de la
// marca si están instaladas; si no, la sans serif del sistema, y se lee igual.
import { makeT } from "../../i18n/index.ts";
import type { Lang } from "../../i18n/types.ts";
import { renderQrMatrix } from "../../lib/qr-svg.ts";
import type { BenefitState, CredentialView } from "./credencial.ts";
import { formatEventWhen, formatEventWhere } from "./fecha.ts";

/** Una unidad es un cuarto de milímetro: 400 por 600 son 100 por 150 milímetros. */
const W = 400;
const H = 600;
const MARGIN = 12;
const BAND_H = 112;
const QR_SIZE = 200;

const FONT_DISPLAY = "'Bricolage Grotesque', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
const FONT_TEXT = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Los colores del tema día (docs/marca.md): el papel se imprime. */
const COLOR = {
  papel: "#F7F2E8",
  blanco: "#FFFFFF",
  tinta: "#0F1C2E",
  tinta2: "#3D4B5F",
  apagado: "#5B6675",
  acento: "#E8541E",
  acentoChip: "#B43A0A",
  verde: "#0A7060",
  amarillo: "#F5C451",
  linea: "#DDD7CC",
};

const STATE_COLOR: Record<BenefitState, string> = {
  pendiente: COLOR.acentoChip,
  canjeado: COLOR.verde,
  pagada: COLOR.verde,
  paraRetirar: COLOR.acentoChip,
  sorteo: COLOR.apagado,
  ganado: COLOR.tinta,
  entregado: COLOR.verde,
};

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
}

/** Corta un texto en líneas de hasta maxChars, por palabras. La última lleva puntos suspensivos si no entra. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1] ?? "";
    kept[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
    return kept;
  }
  return lines.map((line) => (line.length > maxChars ? `${line.slice(0, maxChars - 1).trimEnd()}…` : line));
}

/** El QR como un solo trazo, con quiet módulos de margen blanco alrededor (la marca pide al menos dos). */
function qrPath(payload: string, x: number, y: number, size: number, quiet = 2): string {
  const matrix = renderQrMatrix(payload);
  const n = matrix.length;
  const cell = size / (n + quiet * 2);
  const parts: string[] = [];
  for (let r = 0; r < n; r++) {
    const row = matrix[r] ?? [];
    for (let c = 0; c < n; c++) {
      if (!row[c]) continue;
      const px = (x + (c + quiet) * cell).toFixed(2);
      const py = (y + (r + quiet) * cell).toFixed(2);
      parts.push(`M${px} ${py}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`);
    }
  }
  return parts.join("");
}

function compass(x: number, y: number, size: number, color: string): string {
  const s = size / 64;
  return `<g transform="translate(${x} ${y}) scale(${s.toFixed(4)})" aria-hidden="true">
    <circle cx="32" cy="32" r="29" fill="none" stroke="${color}" stroke-width="3" opacity="0.5"/>
    <g transform="rotate(35 32 32)">
      <path d="M32 4 L41 32 L32 28 L23 32 Z" fill="${COLOR.acento}"/>
      <path d="M32 60 L23 32 L32 36 L41 32 Z" fill="${color}" opacity="0.85"/>
    </g>
    <circle cx="32" cy="32" r="4" fill="${color}"/>
  </g>`;
}

function text(x: number, y: number, content: string, attrs: string): string {
  return `<text x="${x}" y="${y}" ${attrs}>${escapeXml(content)}</text>`;
}

/** El nombre, a dos metros: una línea grande si entra, dos más chicas si no. */
function nameLines(name: string): { lines: string[]; size: number; lineHeight: number } {
  const clean = name.trim();
  if (clean.length <= 16) return { lines: [clean], size: 32, lineHeight: 36 };
  if (clean.length <= 22) return { lines: [clean], size: 26, lineHeight: 30 };
  const two = wrapText(clean, 22, 2);
  if (two.every((line) => line.length <= 22)) return { lines: two, size: 24, lineHeight: 28 };
  return { lines: wrapText(clean, 30, 2), size: 18, lineHeight: 22 };
}

export function renderCredentialSvg(view: CredentialView, lang: Lang): string {
  const t = makeT(lang);
  const when = formatEventWhen(lang, view.event);
  const where = formatEventWhere(view.event);
  const left = MARGIN + 20;
  const right = W - MARGIN - 20;
  const center = W / 2;

  const eventLines = wrapText(view.event.name, 30, 2);
  const eventY = eventLines.length === 1 ? MARGIN + 84 : MARGIN + 74;
  const eventText = eventLines
    .map((line, i) => text(left, eventY + i * 22, line, `font-family="${FONT_DISPLAY}" font-weight="800" font-size="18" letter-spacing="-0.4" fill="${COLOR.papel}"`))
    .join("\n  ");

  const qrX = center - QR_SIZE / 2;
  const qrY = MARGIN + BAND_H + 62;

  const name = nameLines(view.person.name);
  const nameTop = qrY + QR_SIZE + 44;
  const nameText = name.lines
    .map((line, i) => text(center, nameTop + i * name.lineHeight, line, `font-family="${FONT_DISPLAY}" font-weight="800" font-size="${name.size}" letter-spacing="-0.6" text-anchor="middle" fill="${COLOR.tinta}"`))
    .join("\n  ");
  const afterName = nameTop + (name.lines.length - 1) * name.lineHeight;

  // La entrada y, si hay algo que decir, el estado: "Con almuerzo. Entrada paga." Para una inscripción
  // gratis sin entrar todavía, el nombre de la entrada alcanza.
  const status = view.checkedIn ? t("estado.entro") : view.paid ? t("evento.credencial.paga") : null;
  const ticketLine = status ? `${view.ticketType.name}. ${status}.` : view.ticketType.name;
  const ticketY = afterName + 24;
  const dividerY = ticketY + 16;

  const rows = view.benefits.slice(0, 4);
  const extra = view.benefits.length - rows.length;
  const rowStart = dividerY + 26;
  const rowH = 24;
  const benefitRows = rows
    .map((b, i) => {
      const y = rowStart + i * rowH;
      const label = t(`evento.beneficio.${b.state}`);
      const pill =
        b.state === "ganado"
          ? `<rect x="${right - label.length * 6.4 - 14}" y="${y - 12}" width="${label.length * 6.4 + 14}" height="17" rx="8.5" fill="${COLOR.amarillo}"/>`
          : "";
      return (
        `${pill}\n  ` +
        text(left, y, wrapText(b.name, 34, 1)[0] ?? "", `font-family="${FONT_TEXT}" font-weight="500" font-size="12" fill="${COLOR.tinta}"`) +
        "\n  " +
        text(right - (b.state === "ganado" ? 7 : 0), y, label, `font-family="${FONT_TEXT}" font-weight="700" font-size="11" text-anchor="end" fill="${STATE_COLOR[b.state]}"`)
      );
    })
    .join("\n  ");
  const extraText = extra > 0 ? text(left, rowStart + rows.length * rowH, `+${extra}`, `font-family="${FONT_TEXT}" font-weight="500" font-size="12" fill="${COLOR.apagado}"`) : "";
  const noBenefits = view.benefits.length === 0 ? text(left, rowStart, t("evento.credencial.sinBeneficios"), `font-family="${FONT_TEXT}" font-size="12" fill="${COLOR.apagado}"`) : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="150mm" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(`${t("evento.credencial.titulo")}: ${view.person.name}, ${view.event.name}`)}">
  <title>${escapeXml(`${view.person.name}, ${view.event.name}`)}</title>
  <rect width="${W}" height="${H}" fill="${COLOR.papel}"/>
  <rect x="${MARGIN}" y="${MARGIN}" width="${W - MARGIN * 2}" height="${H - MARGIN * 2}" rx="20" fill="${COLOR.blanco}" stroke="${COLOR.linea}"/>
  <clipPath id="band"><rect x="${MARGIN}" y="${MARGIN}" width="${W - MARGIN * 2}" height="${H - MARGIN * 2}" rx="20"/></clipPath>
  <rect x="${MARGIN}" y="${MARGIN}" width="${W - MARGIN * 2}" height="${BAND_H}" fill="${COLOR.tinta}" clip-path="url(#band)"/>
  ${compass(left, MARGIN + 18, 26, COLOR.papel)}
  ${text(left + 34, MARGIN + 38, "Rumbo", `font-family="${FONT_DISPLAY}" font-weight="800" font-size="19" letter-spacing="-0.4" fill="${COLOR.papel}"`)}
  ${text(right, MARGIN + 37, t("evento.credencial.numero", { n: view.number, total: view.total }), `font-family="${FONT_TEXT}" font-weight="600" font-size="11.5" text-anchor="end" fill="${COLOR.papel}" opacity="0.9"`)}
  ${eventText}
  ${text(left, MARGIN + BAND_H + 26, `${when.date}, ${when.time}`, `font-family="${FONT_TEXT}" font-weight="600" font-size="12" fill="${COLOR.tinta2}"`)}
  ${text(left, MARGIN + BAND_H + 44, where, `font-family="${FONT_TEXT}" font-weight="500" font-size="12" fill="${COLOR.tinta2}"`)}
  <rect x="${qrX - 1}" y="${qrY - 1}" width="${QR_SIZE + 2}" height="${QR_SIZE + 2}" rx="12" fill="${COLOR.blanco}" stroke="${COLOR.linea}"/>
  <path d="${qrPath(view.qrPayload, qrX, qrY, QR_SIZE)}" fill="${COLOR.tinta}"/>
  ${nameText}
  ${text(center, ticketY, ticketLine, `font-family="${FONT_TEXT}" font-weight="600" font-size="12" text-anchor="middle" fill="${COLOR.tinta2}"`)}
  <line x1="${left}" y1="${dividerY}" x2="${right}" y2="${dividerY}" stroke="${COLOR.linea}"/>
  ${benefitRows}
  ${extraText}
  ${noBenefits}
  ${text(center, H - MARGIN - 16, t("evento.credencial.mostra"), `font-family="${FONT_TEXT}" font-size="10.5" text-anchor="middle" fill="${COLOR.apagado}"`)}
</svg>
`;
}
