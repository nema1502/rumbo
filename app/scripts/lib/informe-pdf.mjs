// El informe del evento en PDF: de los datos agregados (src/server/informe.ts, o un JSON con la misma
// forma) a datos.tex, en el idioma pedido, y de ahí a app/informes/informe.tex compilado con XeLaTeX.
// Lo usan scripts/informe.mjs y scripts/paquete-embajadores.mjs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INFORMES_DIR, TexData, compileTemplate, tex } from "./latex.mjs";

const TEXTOS = JSON.parse(readFileSync(join(INFORMES_DIR, "textos.json"), "utf8"));
const LOCALES = { es: "es-BO", en: "en-US" };

/** Lo que pide el programa de embajadores de Stellar a cada evento que cuenta. */
export const MIN_ATTENDEES = 20;
export const MIN_STELLAR_MINUTES = 20;
/** El tope de comida por persona del programa, en dólares. */
export const FOOD_CAP_USD = 25;

const NBSP = "\u00A0";

/** Los textos de app/informes/textos.json en un idioma, con sus huecos {nombre} rellenos. */
export function textos(lang) {
  const dict = TEXTOS[lang] ?? TEXTOS.es;
  return (key, vars = {}) => {
    const raw = dict[key] ?? TEXTOS.es[key];
    if (raw === undefined) throw new Error(`Falta el texto "${key}" en app/informes/textos.json`);
    return raw.replace(/\{(\w+)\}/g, (hole, name) => (name in vars ? String(vars[name]) : hole));
  };
}

/** Números, plata, porcentajes y fechas como se leen en cada idioma. */
export function formatos(lang, timeZone = "America/La_Paz") {
  const locale = LOCALES[lang] ?? LOCALES.es;
  const h23 = lang === "es" ? { hourCycle: "h23" } : {};
  const entero = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: "always" });
  const decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
  const fecha = (options) => new Intl.DateTimeFormat(locale, { ...options, ...h23, timeZone });
  const dia = fecha({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const corta = fecha({ day: "numeric", month: "long", year: "numeric" });
  const hora = fecha({ hour: lang === "es" ? "2-digit" : "numeric", minute: "2-digit" });
  const conHora = fecha({ day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return {
    n: (x) => entero.format(x),
    pct: (parte, total) => `${entero.format(total > 0 ? Math.round((parte / total) * 100) : 0)}${lang === "es" ? `${NBSP}%` : "%"}`,
    usd: (x) => `US$${lang === "es" ? NBSP : ""}${Number.isInteger(x) ? entero.format(x) : decimal.format(x)}`,
    dia: (iso) => dia.format(new Date(iso)),
    corta: (iso) => corta.format(new Date(iso)),
    hora: (iso) => hora.format(new Date(iso)).replace(/\u202F/g, NBSP),
    conHora: (iso) => conHora.format(new Date(iso)).replace(/\u202F/g, NBSP),
  };
}

const mayuscula = (s) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);
/** Un hash largo, corto para leer: los primeros diez y los últimos seis caracteres. */
export const shortHash = (hash) => (hash.length > 20 ? `${hash.slice(0, 10)}\u2026${hash.slice(-6)}` : hash);
const explorer = (network, kind, id) => `https://stellar.expert/explorer/${network === "public" ? "public" : "testnet"}/${kind}/${encodeURIComponent(id)}`;

/** Un nombre para comparar: sin tildes, sin mayúsculas, sin espacios de más. */
const fold = (text) => String(text ?? "").normalize("NFD").replace(/\p{M}+/gu, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();

/**
 * Lo que el informe necesita saber y no viene en los datos: lo informa quien organiza. Si el auspiciante es un
 * stand del evento (mismo nombre), sus números salen de los stands (las visitas, los contactos que aceptaron, su
 * regalo); lo que se pasa por la línea de comandos manda sobre eso.
 */
export function applyOrganizerInput(data, { foodSpendUsd, stellarMinutes, sponsor, sponsorBenefit, sponsorContacts, raffleProof } = {}) {
  const out = structuredClone(data);
  if (foodSpendUsd !== undefined && foodSpendUsd !== null) out.foodSpendUsd = foodSpendUsd;
  if (stellarMinutes !== undefined && stellarMinutes !== null) out.stellarMinutes = stellarMinutes;
  if (sponsor) {
    const stand = (Array.isArray(out.stands) ? out.stands : []).find((s) => fold(s?.name) === fold(sponsor)) ?? null;
    out.sponsor = {
      name: sponsor,
      benefit: sponsorBenefit ?? stand?.benefit?.name ?? out.sponsor?.benefit ?? null,
      contactsShared: sponsorContacts ?? stand?.contactsAccepted ?? out.sponsor?.contactsShared ?? null,
      visits: stand?.visits ?? out.sponsor?.visits ?? null,
    };
  } else if (out.sponsor && (sponsorBenefit || sponsorContacts !== undefined)) {
    out.sponsor = { ...out.sponsor, benefit: sponsorBenefit ?? out.sponsor.benefit, contactsShared: sponsorContacts ?? out.sponsor.contactsShared };
  }
  if (raffleProof) out.raffle = { proofUrl: raffleProof };
  return out;
}

/** Revisa que el JSON tenga la forma de EventReportData antes de armar nada. */
export function validateReportData(data) {
  const fail = (what) => {
    throw new Error(`Los datos del informe no tienen la forma esperada: ${what}`);
  };
  if (!data || typeof data !== "object") fail("no es un objeto");
  if (data.version !== 1) fail("version tiene que ser 1");
  if (!data.event?.name || !data.event?.startsAt) fail("falta event.name o event.startsAt");
  for (const key of ["issued", "checkedIn"]) if (!Number.isFinite(data[key]) || data[key] < 0) fail(`${key} tiene que ser un número`);
  if (!Array.isArray(data.benefits)) fail("benefits tiene que ser una lista");
  if (data.foodSpendUsd != null && !(Number.isFinite(data.foodSpendUsd) && data.foodSpendUsd >= 0)) fail("foodSpendUsd tiene que ser un número");
  if (data.stellarMinutes != null && !(Number.isInteger(data.stellarMinutes) && data.stellarMinutes >= 0)) fail("stellarMinutes tiene que ser un número entero");
  return data;
}

/** Arma datos.tex para app/informes/informe.tex. */
export function buildInformeTex(data, lang, { now = new Date().toISOString() } = {}) {
  validateReportData(data);
  const t = textos(lang);
  const ev = data.event;
  const f = formatos(lang, ev.timezone || "America/La_Paz");
  const d = new TexData();
  const example = Boolean(data.example);
  // En un ejemplo, la fecha de generación es la del corte: el informe se ve como si se hubiera generado ese día.
  const generado = example ? data.generatedAt : now;
  const issued = data.issued;
  const checkedIn = data.checkedIn;
  const benefits = data.benefits ?? [];
  const network = data.network === "public" ? "public" : "testnet";
  const red = t(`red.${network}`);

  d.text("babel", lang === "en" ? "english" : "spanish");
  if (example) d.flag("ejemplo");
  d.text("pdf.titulo", `${t("portada.sobre")}: ${ev.name}`);
  d.text("pdf.asunto", t("pdf.asunto"));
  for (const key of ["ejemplo.franja", "ejemplo.titulo", "ejemplo.texto", "portada.sobre"]) d.text(`t.${key}`, t(key));
  d.raw("t.pagina.antes", `${tex(t("pagina.antes"))}\\ `);
  d.raw("t.pagina.de", `\\ ${tex(t("pagina.de"))}\\ `);
  d.text("t.pie", t("pie", { fecha: f.corta(generado) }));
  // En la cabecera, un nombre muy largo se corta: entero está en la portada.
  const nombreCorto = [...ev.name].length > 64 ? `${[...ev.name].slice(0, 62).join("").trimEnd()}\u2026` : ev.name;
  d.text("t.cabecera", `${nombreCorto}, ${f.corta(ev.startsAt)}`);

  // La portada
  const desde = f.hora(ev.startsAt);
  const dia = mayuscula(f.dia(ev.startsAt));
  const sameDay = ev.endsAt && f.dia(ev.endsAt) === f.dia(ev.startsAt);
  d.text("evento.nombre", ev.name);
  d.text("evento.fecha", sameDay ? t("fecha.rango", { dia, desde, hasta: f.hora(ev.endsAt) }) : t("fecha.inicio", { dia, desde }));
  d.text("evento.lugar", ev.venue ? `${ev.venue}, ${ev.place}` : ev.place);
  d.text("t.portada.organiza", t("portada.organiza", { comunidad: ev.community }));
  d.text("t.portada.corte", t("portada.corte", { fecha: f.conHora(data.generatedAt) }));
  const largo = [...ev.name].length;
  const [tam, interlinea] = largo <= 22 ? [46, 47] : largo <= 34 ? [40, 41] : largo <= 52 ? [33, 35] : [27, 29];
  d.raw("portada.tam", tam).raw("portada.interlinea", interlinea);
  d.raw(
    "portada.cifras",
    [
      [22, f.n(issued), t("portada.inscritos"), "crema"],
      [80, f.n(checkedIn), t("portada.entraron"), "crema"],
      [138, f.pct(checkedIn, issued), t("portada.tasa"), "naranja"],
    ]
      .map(([x, n, label, color]) => `\\rumboCifraPortada{${x}}{${tex(n)}}{${tex(label)}}{${color}}`)
      .join(""),
  );

  // Resumen en números
  const redeemable = benefits.filter((b) => b.kind !== "prize");
  const prizes = benefits.filter((b) => b.kind === "prize");
  const totalRedeemed = benefits.reduce((acc, b) => acc + b.redeemed, 0);
  const prizesGranted = prizes.reduce((acc, b) => acc + b.granted, 0);
  const prizesDelivered = prizes.reduce((acc, b) => acc + b.redeemed, 0);
  const duplicates = (data.duplicates?.checkIns ?? 0) + (data.duplicates?.redemptions ?? 0);
  d.text("t.resumen.titulo", t("resumen.titulo"));
  d.text("t.resumen.bajada", t("resumen.bajada", { evento: ev.name }));
  const cifra = (n, label, detail) => `\\rumboCifraTarjeta{${tex(n)}}{${tex(label)}}{${tex(detail)}}`;
  d.raw(
    "resumen.cifras",
    [
      cifra(f.n(issued), t("cifra.emitidas"), ev.capacity ? t("cifra.emitidas.cupo", { cupo: f.n(ev.capacity) }) : t("cifra.emitidas.sinCupo")),
      cifra(f.n(checkedIn), t("cifra.entraron"), t("cifra.entraron.detalle")),
      cifra(f.pct(checkedIn, issued), t("cifra.tasa"), t("cifra.tasa.detalle")),
      cifra(f.n(totalRedeemed), t("cifra.canjes"), benefits.length === 0 ? t("cifra.canjes.ninguno") : benefits.length === 1 ? t("cifra.canjes.uno") : t("cifra.canjes.varios", { n: f.n(benefits.length) })),
      cifra(f.n(prizesDelivered), t("cifra.premios"), prizesGranted > 0 ? t("cifra.premios.detalle", { n: f.n(prizesGranted) }) : t("cifra.premios.ninguno")),
      cifra(f.n(duplicates), t("cifra.dobles"), t("cifra.dobles.detalle")),
    ].join("\n"),
  );

  // De la inscripción a la mesa
  if (issued > 0) {
    d.flag("seccion.barras");
    d.text("t.barras.titulo", t("barras.titulo"));
    d.text("t.barras.nota", t("barras.nota"));
    const max = Math.max(issued, checkedIn, ...redeemable.map((b) => b.redeemed), 1);
    const barra = (label, value, color, note) => `\\rumboBarra{${tex(label)}}{${tex(f.n(value))}}{${(value / max).toFixed(4)}}{${color}}{${tex(note)}}`;
    d.raw(
      "barras",
      [
        barra(t("barras.inscritos"), issued, "barraContexto", ""),
        barra(t("barras.entraron"), checkedIn, "tinta", t("barras.notaEntraron", { pct: f.pct(checkedIn, issued) })),
        ...redeemable.map((b) => barra(b.name, b.redeemed, "verde", t("barras.notaBeneficio", { pct: f.pct(b.redeemed, checkedIn) }))),
      ].join("\n"),
    );
  }

  // La llegada por hora
  const arrivals = (data.arrivals ?? []).filter((a) => Number.isFinite(a.count));
  if (arrivals.length > 0 && arrivals.some((a) => a.count > 0)) {
    d.flag("seccion.llegadas");
    const top = Math.max(...arrivals.map((a) => a.count));
    const peak = arrivals.find((a) => a.count === top);
    d.text("t.llegadas.titulo", t("llegadas.titulo"));
    d.text("t.llegadas.nota", t("llegadas.nota", { hora: peak.hour, n: f.n(top) }));
    d.raw("llegadas.n", arrivals.length);
    d.raw("llegadas.columnas", arrivals.map((a, i) => `\\rumboColumna{${i}}{${tex(a.hour)}}{${tex(f.n(a.count))}}{${(a.count / top).toFixed(4)}}`).join(""));
  }

  // Asistencia verificada
  d.flag("seccion.asistencia");
  d.text("t.asistencia.titulo", t("asistencia.titulo"));
  d.text("t.asistencia.bajada", t("asistencia.bajada"));
  d.text("t.asistencia.verificados", t("asistencia.verificados"));
  d.text("asistencia.verificados", f.n(checkedIn));
  d.raw("asistencia.chip", checkedIn >= MIN_ATTENDEES ? `\\rumboChipListo{${tex(t("asistencia.cumple"))}}` : `\\rumboChipPendiente{${tex(t("asistencia.noCumple", { n: f.n(MIN_ATTENDEES - checkedIn) }))}}`);
  d.text("t.asistencia.minimo", t("asistencia.minimo"));
  if (!example && data.pendingSync > 0) d.text("asistencia.pendientes", t("asistencia.pendientes", { n: f.n(data.pendingSync) }));
  d.text("t.minutos.titulo", t("minutos.titulo"));
  d.text("t.minutos.unidad", t("minutos.unidad"));
  if (data.stellarMinutes != null) {
    const m = data.stellarMinutes;
    d.text("minutos.valor", t("minutos.valor", { n: f.n(m) }).replace(" ", NBSP));
    d.raw("minutos.chip", m >= MIN_STELLAR_MINUTES ? `\\rumboChipListo{${tex(t("minutos.cumple"))}}` : `\\rumboChipPendiente{${tex(t("minutos.noCumple", { n: f.n(MIN_STELLAR_MINUTES - m) }))}}`);
    d.text("t.minutos.nota", t("minutos.nota"));
  } else {
    d.text("t.minutos.nota", t("minutos.notaVacia"));
  }
  d.text("t.asistencia.como.titulo", t("asistencia.como.titulo"));
  d.text("t.asistencia.como", t("asistencia.como"));
  const contracts = data.contracts ?? [];
  if (example) {
    d.raw("contratos", `\\leavevmode{\\fontsize{9.4}{14}\\selectfont\\color{tinta2}${tex(t("contrato.ejemplo"))}\\par}`);
  } else if (contracts.length > 0) {
    d.raw(
      "contratos",
      contracts
        .map((c, i) => {
          d.url(`contrato.${i}`, explorer(network, "contract", c.id));
          const label = contracts.length > 1 && c.label ? t("contrato.etiquetaDe", { entradas: c.label, red }) : t("contrato.etiqueta", { red });
          return `{\\fontsize{8.8}{11}\\selectfont\\bfseries ${tex(label)}\\par}\\vspace{1.6mm}\\rumboCodigo{${tex(c.id)}}\\par\\vspace{1.4mm}{\\fontsize{8.8}{11}\\selectfont\\rumboEnlaceVisible{contrato.${i}}{${tex(t("contrato.ver"))}}\\par}`;
        })
        .join("\\vspace{4.5mm}"),
    );
  }
  if (!example && data.chainCheck) {
    d.text("asistencia.contraste", t("asistencia.contraste", { fecha: f.conHora(data.chainCheck.at), n: f.n(data.chainCheck.checkedIn) }));
  }
  const sample = data.checkInTxs?.sample ?? [];
  if (example || sample.length > 0) {
    d.flag("seccion.transacciones");
    d.text("t.tx.titulo", t("tx.titulo"));
    const head = [t("tx.col.n"), t("tx.col.tx"), t("tx.col.enlace"), t("tx.col.hora")].map((h) => `\\rumboEncabezado{${tex(h)}}`).join(" & ");
    let rows;
    if (example) {
      rows = `\\multicolumn{4}{@{}p{150mm}@{}}{\\leavevmode\\color{apagado}${tex(t("tx.ejemplo"))}} \\\\ \\rumboEntreFilas`;
      d.text("t.tx.nota", t("tx.ejemploNota"));
    } else {
      rows = sample
        .map((s, i) => {
          d.url(`tx.${i}`, explorer(network, "tx", s.hash));
          return `${f.n(i + 1)} & \\rumboCodigo{${tex(shortHash(s.hash))}} & \\rumboEnlaceVisible{tx.${i}}{${tex(t("tx.ver"))}} & ${tex(f.hora(s.at))} \\\\ \\rumboEntreFilas`;
        })
        .join("\n");
      d.text("t.tx.nota", t("tx.nota", { n: f.n(sample.length), total: f.n(Math.max(checkedIn, data.checkInTxs?.recorded ?? 0)) }));
    }
    d.raw("transacciones", `\\begin{rumboTabla}{N{10mm} T{52mm} L N{18mm}}\n\\rumboArriba ${head} \\\\ \\rumboEntreFilas\n${rows}\n\\end{rumboTabla}`);
  }

  // La comida y lo que se entregó
  if (benefits.length > 0) {
    d.flag("seccion.comida");
    d.text("t.comida.titulo", t("comida.titulo"));
    d.text("t.comida.bajada", t("comida.bajada"));
    const head = ["comida.col.beneficio", "comida.col.otorgados", "comida.col.canjeados", "comida.col.inscritos", "comida.col.entraron"].map((k) => `\\rumboEncabezado{${tex(t(k))}}`).join(" & ");
    // Los premios van juntos en una fila: uno por uno están en la sección del sorteo.
    const lines = redeemable.map((b) => ({ name: b.name, kind: t(`tipo.${b.kind}`), granted: b.granted, redeemed: b.redeemed }));
    if (prizes.length > 0) lines.push({ name: t("comida.premios"), kind: prizes.length === 1 ? t("comida.premios.detalleUno") : t("comida.premios.detalle", { n: f.n(prizes.length) }), granted: prizesGranted, redeemed: prizesDelivered });
    const rows = lines
      .map((b) => `{\\bfseries ${tex(b.name)}}\\newline{\\fontsize{7.8}{10}\\selectfont\\color{apagado}${tex(b.kind)}} & ${tex(f.n(b.granted))} & ${tex(f.n(b.redeemed))} & ${tex(f.pct(b.redeemed, issued))} & ${tex(f.pct(b.redeemed, checkedIn))} \\\\ \\rumboEntreFilas`)
      .join("\n");
    d.raw("comida.tabla", `\\begin{rumboTabla}{L N{22mm} N{20mm} N{22mm} N{30mm}}\n\\rumboArriba ${head} \\\\ \\rumboEntreFilas\n${rows}\n\\end{rumboTabla}`);
  }
  if (data.foodSpendUsd != null && checkedIn > 0) {
    d.flag("seccion.gasto");
    const perPerson = Math.round((data.foodSpendUsd / checkedIn) * 100) / 100;
    const within = perPerson <= FOOD_CAP_USD;
    const scale = Math.max(FOOD_CAP_USD * 1.6, perPerson * 1.1);
    d.text("t.gasto.total", t("gasto.total"));
    d.text("t.gasto.persona", t("gasto.persona"));
    d.text("t.gasto.tope", t("gasto.tope"));
    d.text("gasto.total", f.usd(data.foodSpendUsd));
    d.text("gasto.persona", f.usd(perPerson));
    d.text("gasto.tope", f.usd(FOOD_CAP_USD));
    d.raw("gasto.fraccion", (perPerson / scale).toFixed(4));
    d.raw("gasto.fracciontope", (FOOD_CAP_USD / scale).toFixed(4));
    d.raw("gasto.color", within ? "verde" : "naranja");
    d.text("t.gasto.marca", t("gasto.marca", { tope: f.usd(FOOD_CAP_USD) }));
    d.raw("gasto.chip", within ? `\\rumboChipListo{${tex(t("gasto.dentro", { tope: f.usd(FOOD_CAP_USD) }))}}` : `\\rumboChipPendiente{${tex(t("gasto.fuera", { tope: f.usd(FOOD_CAP_USD) }))}}`);
    d.text("t.gasto.nota", t("gasto.nota", { n: f.n(checkedIn) }));
  }

  // Los stands y la ruta (src/server/stands.ts): un renglón por auspiciante, solo números.
  const stands = (Array.isArray(data.stands) ? data.stands : []).filter((s) => s && typeof s.name === "string");
  if (stands.length > 0) {
    d.flag("seccion.stands");
    const route = data.route ?? null;
    d.text("t.stands.titulo", t("stands.titulo"));
    d.text("t.stands.bajada", t("stands.bajada"));
    d.text(
      "t.stands.ruta",
      route && route.target !== null && route.target !== undefined
        ? t("stands.ruta", { meta: f.n(route.target), total: f.n(route.standCount), participan: f.n(route.participants), completaron: f.n(route.completed) })
        : t("stands.sinMeta", { participan: f.n(route?.participants ?? 0) }),
    );
    const head = ["stands.col.stand", "stands.col.visitas", "stands.col.contactos", "stands.col.ruta", "stands.col.canjes"].map((k) => `\\rumboEncabezado{${tex(t(k))}}`).join(" & ");
    const rows = stands
      .map(
        (s) =>
          `{\\bfseries ${tex(s.name)}}\\newline{\\fontsize{7.8}{10}\\selectfont\\color{apagado}${tex(s.benefit ? s.benefit.name : t("stands.sinRegalo"))}} & ${tex(f.n(s.visits ?? 0))} & ${tex(f.n(s.contactsAccepted ?? 0))} & ${tex(f.n(s.routeCompleted ?? 0))} & ${s.benefit ? tex(f.n(s.benefit.redeemed ?? 0)) : "\\textendash"} \\\\ \\rumboEntreFilas`,
      )
      .join("\n");
    d.raw("stands.tabla", `\\begin{rumboTabla}{L N{18mm} N{22mm} N{26mm} N{18mm}}\n\\rumboArriba ${head} \\\\ \\rumboEntreFilas\n${rows}\n\\end{rumboTabla}`);
    d.text("t.stands.nota", t("stands.nota"));
  }

  // Para quien auspicia
  if (data.sponsor?.name) {
    d.flag("seccion.auspicio");
    const sp = data.sponsor;
    const wanted = sp.benefit ? sp.benefit.trim().toLocaleLowerCase() : null;
    const benefit = wanted ? benefits.find((b) => b.name.trim().toLocaleLowerCase() === wanted) : null;
    d.text("t.auspicio.titulo", t("auspicio.titulo", { auspiciante: sp.name }));
    d.text("t.auspicio.bajada", t("auspicio.bajada", { evento: ev.name }));
    d.text("t.auspicio.nota", t("auspicio.nota"));
    const tiles = [];
    if (benefit) tiles.push(cifra(f.n(benefit.redeemed), t("auspicio.canjes", { beneficio: benefit.name }), t("auspicio.canjes.detalle", { pct: f.pct(benefit.redeemed, checkedIn) })));
    if (sp.visits != null) tiles.push(cifra(f.n(sp.visits), t("auspicio.visitas"), t("auspicio.visitas.detalle")));
    tiles.push(cifra(f.n(issued), t("auspicio.alcance"), t("auspicio.alcance.detalle", { n: f.n(checkedIn) })));
    if (!benefit && sp.visits == null) tiles.push(cifra(f.n(checkedIn), t("auspicio.entraron"), t("auspicio.entraron.detalle", { pct: f.pct(checkedIn, issued) })));
    if (sp.contactsShared != null) tiles.push(cifra(f.n(sp.contactsShared), t("auspicio.contactos"), t("auspicio.contactos.detalle")));
    d.raw("auspicio.cifras", tiles.join("\n"));
  }

  // El sorteo
  if (data.raffle || prizesGranted > 0) {
    d.flag("seccion.sorteo");
    d.text("t.sorteo.titulo", t("sorteo.titulo"));
    d.text("t.sorteo.bajada", t("sorteo.bajada"));
    d.raw(
      "sorteo.cifras",
      [
        cifra(f.n(checkedIn), t("sorteo.entre"), t("sorteo.entre.detalle")),
        cifra(f.n(prizesGranted), t("sorteo.premios"), prizesDelivered === 1 ? t("sorteo.premios.detalleUno") : t("sorteo.premios.detalle", { n: f.n(prizesDelivered) })),
      ].join("\n"),
    );
    const won = prizes.filter((p) => p.granted > 0);
    if (won.length > 0) {
      const rows = won
        .map((p) => {
          const chip = p.redeemed >= p.granted ? `\\rumboChipListo{${tex(t("sorteo.entregado"))}}` : `\\rumboChipGanado{${tex(t("sorteo.ganado"))}}`;
          const count = p.granted > 1 ? ` {\\leavevmode\\color{apagado}(${tex(f.n(p.redeemed))}/${tex(f.n(p.granted))})}` : "";
          return `{\\bfseries ${tex(p.name)}}${count} & ${chip} \\\\ \\rumboEntreFilas`;
        })
        .join("\n");
      d.raw("sorteo.premios", `\\begin{rumboTabla}{L >{\\raggedleft\\arraybackslash}p{40mm}}\n\\rumboArriba ${rows}\n\\end{rumboTabla}`);
    }
    const proof = data.raffle?.proofUrl;
    if (example || proof) {
      d.text("t.sorteo.como.titulo", t("sorteo.como.titulo"));
      d.text("t.sorteo.como", t("sorteo.como"));
      if (example) {
        d.raw("sorteo.comprobante", `\\begin{rumboTarjeta}\\leavevmode{\\fontsize{9.4}{14}\\selectfont\\color{apagado}${tex(t("sorteo.ejemplo"))}\\par}\\end{rumboTarjeta}`);
      } else {
        d.url("sorteo.url", proof);
        const shown = proof.length > 90 ? `${proof.slice(0, 87)}\u2026` : proof;
        d.raw("sorteo.comprobante", `\\begin{rumboTarjeta}\\leavevmode{\\fontsize{9.4}{12}\\selectfont\\rumboEnlaceVisible{sorteo.url}{${tex(t("sorteo.ver"))}}\\par}\\vspace{1.4mm}\\rumboCodigo{${tex(shown)}}\\end{rumboTarjeta}`);
      }
    }
  }

  // Cómo verificar este informe
  d.text("t.verificar.titulo", t("verificar.titulo"));
  d.text("t.verificar.texto", example ? `${t("verificar.texto")} ${t("verificar.ejemplo")}` : t("verificar.texto"));
  d.text("t.verificar.corte", t("verificar.corte", { fecha: f.conHora(data.generatedAt), generado: f.corta(generado) }));
  return d;
}

/** El informe en PDF. Devuelve lo que el registro de XeLaTeX marcó como problema. */
export async function renderInforme(data, lang, output, options = {}) {
  const tex = buildInformeTex(data, lang, options);
  return compileTemplate({ template: "informe.tex", data: tex, output, runs: 2, keep: options.keep });
}
