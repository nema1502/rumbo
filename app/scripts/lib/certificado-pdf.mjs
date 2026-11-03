// El certificado de asistencia en PDF: de una persona que entró (su nombre, su pase, su código de
// verificación) a datos.tex para app/informes/certificado.tex, con el QR dibujado en TikZ.
import qrcode from "qrcode-generator";
import { TexData, compileTemplate } from "./latex.mjs";
import { formatos, textos } from "./informe-pdf.mjs";

/** Los módulos oscuros del QR como un camino de TikZ: un rectángulo por cada tramo seguido de una fila. */
export function qrTikzPath(text) {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const parts = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && qr.isDark(r, c)) c++;
      parts.push(`(${start},${r}) rectangle (${c},${r + 1})`);
    }
  }
  return { size: n, path: parts.join(" ") };
}

const ROLES = new Set(["attendee", "speaker", "mentor", "volunteer"]);

/** La duración del evento en horas y medias horas, si termina el mismo día. */
function duracion(t, lang, startsAt, endsAt) {
  if (!endsAt) return null;
  const hours = Math.round(((Date.parse(endsAt) - Date.parse(startsAt)) / 3_600_000) * 2) / 2;
  if (!(hours >= 1 && hours <= 16)) return null;
  const whole = Math.floor(hours);
  const half = hours !== whole;
  if (whole === 1) return half ? t("cert.horas.unaMedia") : t("cert.horas.una");
  return half ? t("cert.horas.media", { n: whole }) : t("cert.horas.varias", { n: whole });
}

/**
 * datos.tex de un certificado. `event` tiene la forma de EventReportData.event; `attendee` trae passId,
 * code, name, role (o null) y checkedInAt. `url` es la dirección de verificación.
 */
export function buildCertificadoTex({ event, attendee, url, lang, example = false, generatedAt = new Date().toISOString() }) {
  const t = textos(lang);
  const f = formatos(lang, event.timezone || "America/La_Paz");
  const d = new TexData();
  d.text("babel", lang === "en" ? "english" : "spanish");
  if (example) {
    d.flag("ejemplo");
    d.text("t.ejemplo.franja", t("ejemplo.franja"));
    d.text("cert.ejemplo.texto", t("cert.ejemplo.texto"));
  }
  d.text("pdf.titulo", `${t("cert.sobre")}: ${attendee.name}, ${event.name}`);
  d.text("pdf.asunto", t("cert.sobre"));
  d.text("cert.sobre", t("cert.sobre"));
  d.text("cert.certifica", t("cert.certifica", { comunidad: event.community }));
  d.text("cert.nombre", attendee.name);
  const largo = [...attendee.name].length;
  const [tn, in_] = largo <= 22 ? [46, 48] : largo <= 32 ? [38, 40] : largo <= 44 ? [31, 33] : [25, 27];
  d.raw("cert.tamNombre", tn).raw("cert.interNombre", in_);
  const role = ROLES.has(attendee.role) ? attendee.role : "attendee";
  d.text("cert.rol", t(`cert.rol.${role}`));
  d.text("cert.evento", event.name);
  const largoEvento = [...event.name].length;
  const [te, ie] = largoEvento <= 40 ? [24, 27] : largoEvento <= 70 ? [20, 23] : [16, 19];
  d.raw("cert.tamEvento", te).raw("cert.interEvento", ie);
  const lugar = event.venue ? `${event.venue}, ${event.place}` : event.place;
  d.text("cert.cuando", t("cert.cuando", { dia: f.dia(event.startsAt), lugar }));
  const detalle = [];
  const horas = duracion(t, lang, event.startsAt, event.endsAt);
  if (horas) detalle.push(t("cert.duracion", { horas }));
  if (attendee.checkedInAt) detalle.push(t("cert.entro", { hora: f.hora(attendee.checkedInAt) }));
  if (detalle.length > 0) d.text("cert.detalle", detalle.join(" "));

  const { size, path } = qrTikzPath(url);
  // Treinta milímetros de QR, arriba a la izquierda en (28, -152), con las filas hacia abajo.
  const modulo = (30 / size).toFixed(4);
  d.raw("cert.qr", `\\begin{scope}[shift={(28,-152)}, x=${modulo}mm, y=-${modulo}mm]\\fill[tinta] ${path};\\end{scope}`);
  d.url("cert.url", url);
  d.text("cert.url.texto", url.replace(/^https?:\/\//, ""));
  d.text("cert.verificar", t("cert.verificar"));
  d.text("cert.verificar.texto", t("cert.verificar.texto"));
  d.text("cert.organiza", t("cert.organiza", { comunidad: event.community }));
  d.text("cert.pie", t("cert.pie", { fecha: f.corta(generatedAt), codigo: attendee.passId }));
  return d;
}

/** Un certificado en PDF. Una sola pasada de XeLaTeX alcanza: no hay referencias entre páginas. */
export async function renderCertificado(options, output) {
  return compileTemplate({ template: "certificado.tex", data: buildCertificadoTex(options), output, runs: 1, keep: options.keep });
}
