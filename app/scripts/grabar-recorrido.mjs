// Graba el video del MVP andando de verdad contra la red de prueba de Stellar, en castellano y en inglés, para
// la landing (site/assets/mvp-es.mp4 y mvp-en.mp4, con sus carteles .jpg). Nada se simula: Chrome sin interfaz
// abre la app real en tres pestañas (el celular de quien asiste, el de quien escanea y una ventana de escritorio)
// y las filma con el screencast del protocolo de DevTools mientras hace el recorrido entero:
//   1. la página del evento y la inscripción gratis de una persona inventada (@example.com), hasta "Inscripción lista",
//   2. su credencial, hasta que el QR cambia (rota cada 20 segundos),
//   3. el escáner abre la Puerta con su código y la cámara lee ese QR: "Entró", y la segunda vez "Ya entró",
//   4. la mesa de la polera (la entrada gratis la incluye) con la red cortada: "Canjeado" y "Ya canjeado",
//   5. vuelve la red y la cola se vacía sola,
//   6. el panel de quien organiza con lo que pasó, y
//   7. la transacción de la inscripción en stellar.expert, con el hash que quedó en la base.
// La cámara del escáner es la de mentira de Chrome (--use-file-for-fake-video-capture) leyendo un .y4m que este
// script reescribe en el lugar: cuando el voluntario "apunta", el archivo pasa a tener una captura del QR que la
// credencial muestra en ese momento, y el escáner lo decodifica con jsQR como con una cámara de verdad. Cada
// veredicto se lee de la pantalla y, si no es el esperado, la corrida se corta: no se arma ningún resultado.
// Después compone cada cuadro (los dos celulares sobre el fondo de la marca, o la ventana, con un título por
// escena) en un Chrome aparte y lo codifica con ffmpeg. Las esperas largas (crear la cuenta, que rote el QR, que
// la cola llegue al contrato) se aceleran con un cartel que dice cuánto. Los avisos del escáner (sin conexión, 1
// por sincronizar, todo sincronizado) se leen de su pantalla con la hora y se repiten en grande junto al celular,
// y los toques se marcan con un círculo donde de verdad se tocó.
//
//   node scripts/grabar-recorrido.mjs --base http://127.0.0.1:3000 [--lang es,en] [--port 9481]
//        [--salida ../site/assets] [--trabajo data/recorrido] [--fase todo|grabar|componer] [--crf 28]
//        [--nombre-es "Valentina Rojas"] [--nombre-en "Lucía Vargas"]
//
// Hace falta el servidor levantado (next start) con la misma carpeta de datos que este script, el evento de
// muestra (pnpm seed) y ffmpeg (FFMPEG=<ruta>, o en el PATH). Tarda unos dos minutos por idioma en grabar (cada
// paso por la cadena es una transacción) y otros dos o tres en componer. Con --fase componer se rearma el
// video con lo ya grabado en --trabajo, sin tocar la red.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { APP_DIR, loadEnv } from "./lib/env.mjs";
import { findChrome, sleep } from "./lib/browser.mjs";

process.chdir(APP_DIR);
loadEnv();

const argv = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = argv.indexOf(nombre);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : porDefecto;
};
const BASE = opcion("--base", process.env.NEXT_PUBLIC_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const IDIOMAS = opcion("--lang", "es,en").split(",").map((l) => l.trim()).filter((l) => l === "es" || l === "en");
const PORT = Number(opcion("--port", process.env.CDP_PORT || 9481));
const SALIDA = resolve(opcion("--salida", join(APP_DIR, "..", "site", "assets")));
const TRABAJO = resolve(opcion("--trabajo", join(APP_DIR, "data", "recorrido")));
const FASE = opcion("--fase", "todo");
const CRF = Number(opcion("--crf", 28));
const SLUG = opcion("--slug", "hackaton-comunidad");
const NOMBRES = { es: opcion("--nombre-es", "Valentina Rojas"), en: opcion("--nombre-en", "Lucía Vargas") };
const FPS = 30;
// Los cuadros llegan en JPEG (rango completo, matriz BT.601): el video sale en rango limitado y BT.709, con
// las marcas puestas, que es lo que todos los navegadores (también Safari en el celular) muestran igual.
const RANGO = "scale=in_range=full:out_range=limited:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p";
const COLOR = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const FUENTES = join(APP_DIR, "informes", "fuentes");

function buscarFfmpeg() {
  const candidatos = [process.env.FFMPEG, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "ffmpeg", "bin", "ffmpeg.exe")].filter(Boolean);
  return candidatos.find((c) => existsSync(c)) ?? "ffmpeg";
}
const FFMPEG = buscarFfmpeg();

const t0 = Date.now();
const paso = (texto) => console.log(`\n> ${texto}  (${Math.round((Date.now() - t0) / 1000)} s)`);

/** Corre ffmpeg con lo que se le pase por la entrada y devuelve lo que escribe en la salida. */
function ffmpeg(args, entrada = null) {
  return new Promise((res, rej) => {
    const proc = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["pipe", "pipe", "pipe"] });
    const partes = [];
    let error = "";
    proc.stdout.on("data", (d) => partes.push(d));
    proc.stderr.on("data", (d) => (error += d));
    proc.on("error", rej);
    proc.on("close", (code) => (code === 0 ? res(Buffer.concat(partes)) : rej(new Error(`ffmpeg salió con ${code}: ${error.slice(0, 400)}`))));
    if (entrada) proc.stdin.end(entrada);
    else proc.stdin.end();
  });
}

// ---------- Chrome por el protocolo de DevTools, con una sesión por pestaña ----------

class Navegador {
  static async abrir(port, extra = []) {
    const perfil = mkdtempSync(join(tmpdir(), "rumbo-recorrido-"));
    const proc = spawn(
      findChrome(),
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--mute-audio",
        "--autoplay-policy=no-user-gesture-required",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${perfil}`,
        "--window-size=1440,900",
        ...extra,
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    const salio = new Promise((r) => proc.once("exit", r));
    const matar = () => {
      try {
        proc.kill();
      } catch {
        /* ya cerrado */
      }
    };
    process.once("exit", matar);
    for (let i = 0; ; i++) {
      if (proc.exitCode !== null) throw new Error(`Chrome se cerró al arrancar (¿el puerto ${port} está tomado?)`);
      try {
        const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        const ws = new WebSocket(info.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res);
          ws.addEventListener("error", rej);
        });
        return new Navegador(ws, proc, perfil, salio, matar);
      } catch {
        if (i > 100) throw new Error("Chrome no expuso DevTools");
        await sleep(200);
      }
    }
  }

  constructor(ws, proc, perfil, salio, matar) {
    Object.assign(this, { ws, proc, perfil, salio, matar });
    this.id = 0;
    this.pendientes = new Map();
    this.oyentes = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pendientes.has(msg.id)) {
        const { resolve: ok, reject: mal } = this.pendientes.get(msg.id);
        this.pendientes.delete(msg.id);
        msg.error ? mal(new Error(msg.error.message)) : ok(msg.result);
      } else if (msg.method) {
        for (const oyente of this.oyentes) oyente(msg);
      }
    });
  }

  send(method, params = {}, sessionId, ms = 120_000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((ok, mal) => {
      const t = setTimeout(() => {
        this.pendientes.delete(id);
        mal(new Error(`${method}: sin respuesta en ${ms / 1000} s`));
      }, ms);
      this.pendientes.set(id, {
        resolve: (v) => (clearTimeout(t), ok(v)),
        reject: (e) => (clearTimeout(t), mal(e)),
      });
    });
  }

  /** Una pestaña en su propia ventana (así todas quedan visibles y se dibujan a la vez). */
  async pagina(nombre, { ancho, alto, dpr = 1, celular = false }) {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank", newWindow: true });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const p = new Pagina(this, sessionId, nombre, { ancho, alto, dpr });
    await p.send("Runtime.enable");
    await p.send("Page.enable");
    await p.send("Network.enable");
    await p.send("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: dpr, mobile: celular });
    if (!celular) await p.send("Emulation.setScrollbarsHidden", { hidden: true });
    return p;
  }

  async cerrar() {
    process.removeListener("exit", this.matar);
    try {
      this.ws.close();
    } catch {
      /* ya cerrado */
    }
    this.matar();
    await Promise.race([this.salio, sleep(5000)]);
    try {
      rmSync(this.perfil, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch {
      /* queda en la carpeta temporal */
    }
  }
}

class Pagina {
  constructor(nav, sessionId, nombre, medidas) {
    Object.assign(this, { nav, sessionId, nombre, medidas });
    this.errores = [];
    this.grabando = null;
    nav.oyentes.push((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.exceptionThrown") this.errores.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      if (msg.method === "Page.javascriptDialogOpening") void this.send("Page.handleJavaScriptDialog", { accept: true });
      if (msg.method === "Page.screencastFrame") {
        void this.send("Page.screencastFrameAck", { sessionId: msg.params.sessionId }).catch(() => {});
        const g = this.grabando;
        if (!g) return;
        const n = g.cuadros.length;
        writeFileSync(join(g.dir, `${n}.jpg`), Buffer.from(msg.params.data, "base64"));
        g.cuadros.push({ t: Date.now(), n });
      }
    });
  }
  send(method, params) {
    return this.nav.send(method, params, this.sessionId);
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async waitFor(expression, ms = 20_000) {
    const inicio = Date.now();
    while (Date.now() - inicio < ms) {
      try {
        if (await this.eval(`!!(${expression})`)) return true;
      } catch {
        /* navegando */
      }
      await sleep(150);
    }
    return false;
  }
  async ir(url) {
    await this.send("Page.navigate", { url });
    await sleep(300);
    await this.waitFor(`document.readyState === "complete"`, 60_000);
    await this.eval(`document.fonts ? document.fonts.ready.then(() => true) : true`).catch(() => {});
  }
  /** Empieza a filmar la pestaña: cada cuadro que Chrome dibuja queda en disco con la hora en que llegó. */
  async grabar(dir, pista) {
    mkdirSync(dir, { recursive: true });
    this.grabando = pista ?? { dir, cuadros: [] };
    this.grabando.dir = dir;
    const { ancho, alto, dpr } = this.medidas;
    await this.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: Math.round(ancho * dpr), maxHeight: Math.round(alto * dpr), everyNthFrame: 1 });
    return this.grabando;
  }
  async parar() {
    await this.send("Page.stopScreencast").catch(() => {});
    const g = this.grabando;
    this.grabando = null;
    return g;
  }
  /** El rectángulo de un elemento, en píxeles CSS de la pantalla. */
  rect(expresion) {
    return this.eval(`(() => { const el = ${expresion}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  }
  /** Un toque de verdad (mouse apretado y soltado en el centro del elemento), anotado para dibujarlo. */
  async tocar(expresion, toques) {
    await this.eval(`(() => { const el = ${expresion}; if (!el) return false; const r = el.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) el.scrollIntoView({ block: "center" }); return true; })()`);
    await sleep(120);
    const r = await this.rect(expresion);
    if (!r) throw new Error(`${this.nombre}: no encontré ${expresion}`);
    const x = r.x + r.w / 2;
    const y = r.y + r.h / 2;
    toques?.push({ pista: this.nombre, x, y, t: Date.now() });
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await sleep(70);
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  /** Escribe letra por letra en el campo que tiene el foco, como un teclado. */
  async escribir(texto, ms = 70) {
    for (const letra of texto) {
      await this.send("Input.insertText", { text: letra });
      await sleep(ms);
    }
  }
  offline(flag) {
    return this.send("Network.emulateNetworkConditions", { offline: flag, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
}

/** Un elemento por su texto exacto (el primero que está a la vista). */
const porTexto = (texto, selector = "button, a") =>
  `[...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.textContent.trim() === ${JSON.stringify(texto)}).sort((a, b) => { const v = (e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight ? 0 : 1; }; return v(a) - v(b); })[0]`;

// ---------- La cámara de mentira ----------

/**
 * El .y4m que Chrome usa como cámara. Chrome lo lee en el lugar (lo mapea en memoria) y lo repite cuadro a
 * cuadro, así que reescribir sus bytes sin cambiar el largo cambia lo que la cámara "ve" en el momento.
 */
class CamaraFalsa {
  constructor(dir) {
    this.dir = dir;
    this.archivo = join(dir, "camara.y4m");
    this.fondo = join(dir, "camara-fondo.png");
  }
  async preparar() {
    mkdirSync(this.dir, { recursive: true });
    // Una mesa en penumbra, con algo de grano: lo que ve un celular que no apunta a nada.
    await ffmpeg(["-f", "lavfi", "-i", "color=c=0x3b352e:s=1280x720:d=1", "-vf", "noise=alls=10:allf=u,vignette=PI/3.2", "-frames:v", "1", this.fondo]);
    const vacio = await this.armar(null);
    writeFileSync(this.archivo, vacio);
    this.largo = vacio.length;
  }
  armar(png) {
    if (!png) return ffmpeg(["-i", this.fondo, "-vf", "format=yuv420p", "-frames:v", "1", "-f", "yuv4mpegpipe", "pipe:1"]);
    return ffmpeg(
      ["-i", this.fondo, "-f", "png_pipe", "-i", "pipe:0", "-filter_complex", "[1]scale=-2:520:flags=lanczos[q];[0][q]overlay=(W-w)/2:(H-h)/2,format=yuv420p", "-frames:v", "1", "-f", "yuv4mpegpipe", "pipe:1"],
      png,
    );
  }
  /** Lo que ve la cámara: la imagen de un QR (PNG), o nada. */
  async mostrar(png) {
    const y4m = await this.armar(png);
    if (y4m.length !== this.largo) throw new Error(`la cámara cambió de tamaño (${y4m.length} y ${this.largo})`);
    const fd = openSync(this.archivo, "r+");
    try {
      writeSync(fd, y4m, 0, y4m.length, 0);
    } finally {
      closeSync(fd);
    }
  }
}

// ---------- Los textos ----------

const TEXTOS = {
  es: {
    asiste: "Quien asiste",
    escanea: "Quien escanea",
    enEscaner: "En el escáner:",
    acelerado: (x) => `Acelerado x${x}`,
    portada: ["El MVP real, grabado en la", "red de prueba de Stellar."],
    portadaSub: "Sin maquetas: es la app de verdad, paso a paso.",
    escenas: {
      1: { paso: "Paso 1", titulo: ["Inscribite", "gratis"], sub: "Nombre y correo. Nada más.", espera: "Mientras, se crea su cuenta en Stellar y se registra la credencial." },
      2: { paso: "Paso 2", titulo: ["Tu credencial,", "con un QR que cambia"], sub: "Cada 20 segundos: una captura de pantalla no sirve." },
      3: { paso: "Paso 3", titulo: ["En la puerta,", "un celular escanea"], sub: "El voluntario abre la Puerta con un código. Sin instalar nada.", segunda: "La segunda vez, el escáner lo dice en grande." },
      4: { paso: "Paso 4", titulo: ["Sin conexión,", "el canje sigue"], sub: "Ahora atiende la mesa de la polera.", corte: "Se corta la red y la fila no para.", segunda: "Una sola polera por persona." },
      5: { paso: "Paso 5", titulo: ["Vuelve la red", "y se sincroniza sola"], sub: "Lo pendiente llega al contrato sin tocar nada." },
      6: { paso: "Paso 6", titulo: "El panel lo cuenta en vivo", sub: (n) => `Quien organiza ve que ${n} entró y retiró su polera.` },
      7: { paso: "Paso 7", titulo: "Y queda en Stellar", sub: (n) => `La inscripción de ${n} en stellar.expert, en la red de prueba.` },
    },
    lema: ["Tu evento entero ", "en un QR."],
  },
  en: {
    asiste: "Attendee",
    escanea: "Volunteer",
    enEscaner: "On the scanner:",
    acelerado: (x) => `Sped up x${x}`,
    portada: ["The real MVP, recorded on", "the Stellar testnet."],
    portadaSub: "No mockups: it is the actual app, step by step.",
    escenas: {
      1: { paso: "Step 1", titulo: ["Sign up", "for free"], sub: "Name and email. That is all.", espera: "Meanwhile, her account is created on Stellar and the pass is registered." },
      2: { paso: "Step 2", titulo: ["Your pass,", "with a QR that changes"], sub: "Every 20 seconds, so a screenshot will not work." },
      3: { paso: "Step 3", titulo: ["At the door,", "a phone scans"], sub: "The volunteer opens the Gate with a code. Nothing to install.", segunda: "The second time, the scanner says so, big." },
      4: { paso: "Step 4", titulo: ["Offline,", "redeeming still works"], sub: "Now at the T-shirt table.", corte: "The network drops and the line keeps moving.", segunda: "One T-shirt per person." },
      5: { paso: "Step 5", titulo: ["Back online,", "it syncs by itself"], sub: "What was pending reaches the contract on its own." },
      6: { paso: "Step 6", titulo: "The dashboard counts it live", sub: (n) => `The organizer sees that ${n} checked in and got her T-shirt.` },
      7: { paso: "Step 7", titulo: "And it is on Stellar", sub: (n) => `${n}'s sign-up on stellar.expert, on the testnet.` },
    },
    lema: ["Your whole event ", "in one QR."],
  },
};

// ---------- La grabación ----------

async function grabar(lang) {
  const { getRepo } = await import("../src/server/repo.ts");
  const { ensureStationCodes, getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
  const { formatStationCode } = await import("../src/lib/station-code.ts");
  const { makeT } = await import("../src/i18n/index.ts");
  const stellar = await import("../src/server/stellar.ts");
  const t = makeT(lang);

  const repo = getRepo();
  const event = await repo.getEventBySlug(SLUG);
  if (!event) throw new Error(`No existe el evento ${SLUG}: corré pnpm seed`);
  const tickets = await repo.listTicketTypes(event.id);
  const gratis = tickets.find((x) => x.priceUsdc === 0);
  const incluidos = gratis ? await repo.listTicketTypeBenefits(gratis.id) : [];
  const polera = incluidos.find((b) => b.kind === "merch") ?? incluidos[0];
  if (!gratis || !polera) throw new Error("El evento de muestra necesita una entrada gratis que incluya un beneficio: corré pnpm seed");
  const codigos = await ensureStationCodes(event, repo);
  const codigoPuerta = formatStationCode(codigos.find((c) => c.kind === "gate").code);
  const codigoPolera = formatStationCode(codigos.find((c) => c.kind === "benefit" && c.benefitId === polera.id).code);
  const clavePanel = await getOrCreateOrganizerKey(event.id);

  const nombre = NOMBRES[lang];
  const base = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, ".");
  let correo = `${base}@example.com`;
  for (let i = 2; await repo.getPersonByEmail(correo); i++) correo = `${base}${i}@example.com`;

  const dir = join(TRABAJO, lang);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const camara = new CamaraFalsa(dir);
  await camara.preparar();

  paso(`Grabando en ${lang}: ${nombre} <${correo}>, Puerta ${codigoPuerta}, ${polera.name} ${codigoPolera}`);
  const nav = await Navegador.abrir(PORT, [
    `--lang=${lang === "es" ? "es-BO" : "en-US"}`,
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${camara.archivo}`,
  ]);
  const m = {};
  const marca = (k) => (m[k] = Date.now());
  const toques = [];
  const avisos = [];
  const pistas = {};
  const datos = { lang, nombre, correo, evento: event.name, polera: polera.name };
  let swSesion = null;

  try {
    const asiste = await nav.pagina("asiste", { ancho: 390, alto: 844, dpr: 2, celular: true });
    const escanea = await nav.pagina("escanea", { ancho: 390, alto: 844, dpr: 2, celular: true });
    const escritorio = await nav.pagina("escritorio", { ancho: 1200, alto: 675, dpr: 1.14 });

    const chips = () => escanea.eval(`[...document.querySelectorAll(".esc-chips .chip")].map((c) => c.textContent.trim())`);
    const veredicto = () =>
      escanea.eval(`(() => { const v = document.querySelector(".esc-veredicto"); if (!v) return null;
        return { kind: [...v.classList].find((c) => c.startsWith("esc-veredicto-") && c !== "esc-veredicto")?.replace("esc-veredicto-", ""),
          titulo: v.querySelector(".esc-veredicto-titulo")?.textContent.trim() ?? null,
          nombre: v.querySelector(".esc-veredicto-nombre")?.textContent.trim() ?? null,
          detalle: v.querySelector(".esc-veredicto-detalle")?.textContent.trim() ?? null }; })()`);
    const sincronizado = () => escanea.waitFor(`(() => { const c = [...document.querySelectorAll(".esc-chips .chip")].map((x) => x.textContent.trim()); return c.includes(${JSON.stringify(t("escaner.alDia"))}) && !document.querySelector(".esc-chips .apagado"); })()`, 180_000);
    async function sinRed(flag) {
      await escanea.offline(flag);
      if (!swSesion) {
        const { targetInfos } = await nav.send("Target.getTargets");
        const sw = targetInfos.find((x) => x.type === "service_worker" && x.url.endsWith("/sw.js"));
        if (sw) {
          ({ sessionId: swSesion } = await nav.send("Target.attachToTarget", { targetId: sw.targetId, flatten: true }));
          await nav.send("Network.enable", {}, swSesion);
        }
      }
      if (swSesion) await nav.send("Network.emulateNetworkConditions", { offline: flag, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, swSesion);
      return Boolean(swSesion);
    }
    /** El voluntario apunta la cámara a la credencial: la cámara pasa a ver el QR que la credencial muestra ahora. */
    async function apuntar() {
      await asiste.eval(`window.scrollTo(0, 0)`);
      const r = await asiste.rect(`document.querySelector(".credencial-qr")`);
      if (!r) throw new Error("la credencial no muestra el QR");
      const margen = 14;
      const { data } = await asiste.send("Page.captureScreenshot", { format: "png", clip: { x: r.x - margen, y: r.y - margen, width: r.w + 2 * margen, height: r.h + 2 * margen, scale: 1 } });
      await camara.mostrar(Buffer.from(data, "base64"));
    }
    async function esperarVeredicto(esperado, texto) {
      if (!(await escanea.waitFor(`document.querySelector(".esc-veredicto")`, 20_000))) throw new Error(`la cámara no leyó la credencial (esperaba "${texto}")`);
      const v = await veredicto();
      console.log(`  veredicto: ${JSON.stringify(v)}`);
      if (v.kind !== esperado || v.titulo !== texto || v.nombre !== nombre) throw new Error(`el veredicto no es el esperado ("${texto}" para ${nombre}): ${JSON.stringify(v)}`);
      return v;
    }

    /** El voluntario baja el celular y toca "Siguiente". */
    async function siguiente() {
      await camara.mostrar(null);
      await escanea.tocar(`document.querySelector(".esc-veredicto-boton")`, toques);
      if (!(await escanea.waitFor(`!document.querySelector(".esc-veredicto")`, 8000))) throw new Error("el veredicto no se cerró");
    }

    // Lo que no se ve: el escáner listo en la pantalla del código, y la página del evento cargada.
    await escanea.ir(`${BASE}/scan?lang=${lang}`);
    if (!(await escanea.waitFor(`document.querySelector("#esc-codigo")`, 60_000))) throw new Error("el escáner no cargó");
    await asiste.ir(`${BASE}/e/${SLUG}?lang=${lang}`);
    const botonGratis = `document.querySelector('a[href*="entrada=${gratis.id}"]')`;
    if (!(await asiste.waitFor(botonGratis, 30_000))) throw new Error("la página del evento no muestra la entrada gratis");
    const visibles = await Promise.all([asiste, escanea, escritorio].map((p) => p.eval(`document.visibilityState`)));
    console.log(`  pestañas: ${visibles.join(", ")}`);
    pistas.asiste = await asiste.grabar(join(dir, "asiste"));
    pistas.escanea = await escanea.grabar(join(dir, "escanea"));
    await sleep(600);

    // 1. La inscripción gratis
    paso("1. La página del evento y la inscripción gratis");
    marca("s1");
    await sleep(1300);
    await asiste.eval(`window.scrollTo({ top: Math.max(0, ${botonGratis}.getBoundingClientRect().bottom + scrollY - innerHeight + 90), behavior: "smooth" })`);
    await sleep(900);
    await asiste.tocar(botonGratis, toques);
    if (!(await asiste.waitFor(`document.querySelector("#nombre")`, 30_000))) throw new Error("no abrió el formulario");
    await asiste.eval(`window.scrollTo(0, 0)`);
    await sleep(600);
    await asiste.tocar(`document.querySelector("#nombre")`, toques);
    await asiste.escribir(nombre, 50);
    await sleep(200);
    await asiste.tocar(`document.querySelector("#correo")`, toques);
    await asiste.escribir(correo, 36);
    await sleep(400);
    await asiste.tocar(`document.querySelector('button[type="submit"]')`, toques);
    marca("envio");
    if (!(await asiste.waitFor(`location.pathname.endsWith("/listo")`, 240_000))) throw new Error("la inscripción no terminó");
    await asiste.waitFor(`document.readyState === "complete"`, 20_000);
    marca("listo");
    const tituloListo = await asiste.eval(`document.querySelector("h1")?.textContent.trim()`);
    console.log(`  ${tituloListo} (${Math.round((m.listo - m.envio) / 1000)} s)`);
    if (tituloListo !== t("evento.listo.tituloGratis")) throw new Error(`la confirmación dice "${tituloListo}"`);
    await sleep(1900);
    const verCredencial = `document.querySelector('a[href^="/p/"]')`;
    await asiste.tocar(verCredencial, toques);
    marca("tocaVer");
    const passId = decodeURIComponent((await asiste.eval(`${verCredencial}?.getAttribute("href") ?? ""`)).split("/p/")[1]?.split("?")[0] ?? "");
    await sleep(350);
    marca("s1fin");

    // 2. La credencial y el QR que rota
    paso("2. La credencial, hasta que cambie el QR");
    if (!(await asiste.waitFor(`document.querySelector(".credencial-qr svg")`, 30_000))) throw new Error("la credencial no mostró el QR");
    await sleep(500);
    marca("s2");
    const qrAntes = await asiste.eval(`document.querySelector(".credencial-qr").innerHTML`);
    await sleep(1600);
    if (!(await asiste.waitFor(`document.querySelector(".credencial-qr").innerHTML !== ${JSON.stringify(qrAntes)}`, 30_000))) throw new Error("el QR no cambió en 30 s");
    marca("qrCambio");
    datos.qrRect = await asiste.rect(`document.querySelector(".credencial-qr")`);
    await sleep(2300);
    marca("s2fin");

    // 3. La puerta
    paso("3. La puerta: Entró y Ya entró, leyendo el QR con la cámara");
    // Lo que dicen los avisos del escáner (sin conexión, por sincronizar, todo sincronizado), con su hora:
    // el montaje los repite en grande al lado del celular, tal cual.
    let sondeando = true;
    const sondeo = (async () => {
      while (sondeando) {
        try {
          const lista = await escanea.eval(`[...document.querySelectorAll(".esc-chips > *")].map((e) => e.textContent.trim()).filter(Boolean)`);
          if (lista.join("|") !== avisos.at(-1)?.lista.join("|")) avisos.push({ t: Date.now(), lista });
        } catch {
          /* navegando */
        }
        await sleep(150);
      }
    })();
    marca("s3");
    await sleep(700);
    await escanea.tocar(`document.querySelector("#esc-codigo")`, toques);
    await escanea.escribir(codigoPuerta, 60);
    await sleep(300);
    await escanea.tocar(porTexto(t("escaner.abrir")), toques);
    if (!(await escanea.waitFor(`document.querySelector(".esc-puesto-titulo")?.textContent.trim() === ${JSON.stringify(t("escaner.puerta"))} && document.querySelector(".esc-camara video")?.readyState >= 2`, 30_000)))
      throw new Error("no se abrió la Puerta con la cámara andando");
    await sleep(1100);
    marca("apunta1");
    await apuntar();
    await esperarVeredicto("ok", t("escaner.entro"));
    marca("v1");
    await sleep(1700);
    await siguiente();
    marca("v1fin");
    await sleep(800);
    marca("apunta2");
    await apuntar();
    datos.yaEntro = await esperarVeredicto("already", t("escaner.yaEntro"));
    marca("v2");
    await sleep(2300);
    marca("s3fin");
    await siguiente();
    if (!(await sincronizado())) throw new Error(`la entrada no llegó al servidor: ${(await chips()).join(" | ")}`);
    marca("s3sync");

    // 4. La polera sin red
    paso(`4. ${polera.name} sin red: Canjeado y Ya canjeado`);
    marca("s4");
    await sleep(500);
    await escanea.tocar(porTexto(t("escaner.salir")), toques);
    if (!(await escanea.waitFor(`document.querySelector("#esc-codigo")`, 20_000))) throw new Error("no se cerró la Puerta");
    await sleep(400);
    await escanea.tocar(`document.querySelector("#esc-codigo")`, toques);
    await escanea.escribir(codigoPolera, 55);
    await sleep(250);
    await escanea.tocar(porTexto(t("escaner.abrir")), toques);
    if (!(await escanea.waitFor(`document.querySelector(".esc-puesto-titulo")?.textContent.trim() === ${JSON.stringify(polera.name)} && document.querySelector(".esc-camara video")?.readyState >= 2`, 30_000)))
      throw new Error(`no se abrió ${polera.name}`);
    if (!(await escanea.waitFor(`navigator.serviceWorker.controller !== null`, 20_000))) throw new Error("el service worker no tomó el escáner");
    await sleep(700);
    marca("offline");
    if (!(await sinRed(true))) throw new Error("no encontré el service worker para cortarle la red");
    if (!(await escanea.waitFor(`[...document.querySelectorAll(".esc-chips .chip")].some((c) => c.textContent.trim() === ${JSON.stringify(t("estado.sinConexion"))})`, 15_000)))
      throw new Error("el escáner no avisó que no hay conexión");
    marca("offlineVisto");
    await sleep(1000);
    marca("apunta3");
    await apuntar();
    const canje = await esperarVeredicto("ok", t("escaner.canjeado"));
    if (canje.detalle !== polera.name) throw new Error(`el canje dice "${canje.detalle}"`);
    marca("v3");
    await sleep(1700);
    await siguiente();
    marca("v3fin");
    const pendiente = await chips();
    console.log(`  sin red: ${pendiente.join(" | ")}`);
    if (!pendiente.includes(t("escaner.pendiente1"))) throw new Error(`no quedó 1 por sincronizar: ${pendiente.join(" | ")}`);
    await sleep(800);
    marca("apunta4");
    await apuntar();
    await esperarVeredicto("already", t("escaner.yaCanjeado"));
    marca("v4");
    await sleep(2300);
    marca("s4fin");
    await siguiente();
    await sleep(400);

    // 5. Vuelve la red
    paso("5. Vuelve la red y la cola se vacía");
    marca("s5");
    await sleep(700);
    await sinRed(false);
    marca("online");
    if (!(await sincronizado())) throw new Error(`la cola no se vació: ${(await chips()).join(" | ")}`);
    marca("sync");
    console.log(`  con red: ${(await chips()).join(" | ")} (${Math.round((m.sync - m.online) / 1000)} s)`);
    await sleep(2000);
    marca("s5fin");
    sondeando = false;
    await sondeo;
    await asiste.parar();
    await escanea.parar();

    // Lo que quedó en la base y en la cadena
    const pase = await repo.getPass(passId);
    const entradas = await repo.listCheckInsForPass(passId);
    const canjes = await repo.listRedemptionsForPass(passId);
    const contrato = gratis.contractId ?? event.contractId;
    const enCadena = await stellar.rumboPass.status(contrato, pase.account);
    datos.hashes = { inscripcion: pase.txHash, entrada: entradas[0]?.txHash ?? null, canje: canjes[0]?.txHash ?? null };
    datos.cadena = { entro: enCadena.checked_in, canjeados: enCadena.redeemed, numero: enCadena.number };
    console.log(`  pase ${passId}: ${JSON.stringify(datos.hashes)}; en la cadena ${JSON.stringify(datos.cadena)}`);
    if (!pase.txHash || !enCadena.checked_in || !enCadena.redeemed.length) throw new Error("la cadena no tiene la entrada o el canje");

    // 6. El panel
    paso("6. El panel de quien organiza");
    await escritorio.ir(`${BASE}/admin/${SLUG}?k=${encodeURIComponent(clavePanel)}&lang=${lang}`);
    if (!(await escritorio.waitFor(`document.querySelector(".panel")`, 30_000))) throw new Error("el panel no cargó");
    await sleep(1500);
    datos.urlPanel = await escritorio.eval(`location.host + location.pathname`);
    pistas.escritorio = await escritorio.grabar(join(dir, "escritorio"));
    await sleep(300);
    marca("s6");
    await sleep(2400);
    const buscador = `document.querySelector(${JSON.stringify(`input[placeholder="${t("panel.pases.buscar")}"]`)})`;
    await escritorio.eval(`(() => { const el = ${buscador}; const arriba = document.querySelector("header")?.getBoundingClientRect().height ?? 70; window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - arriba - 28, behavior: "smooth" }); })()`);
    await sleep(1400);
    await escritorio.tocar(buscador, toques);
    await escritorio.escribir(nombre.split(" ").slice(-1)[0], 90);
    await sleep(500);
    const filas = await escritorio.eval(`document.body.innerText.includes(${JSON.stringify(nombre)})`);
    if (!filas) throw new Error("el panel no muestra a la persona");
    await sleep(2500);
    marca("s6fin");
    await escritorio.parar();

    // 7. stellar.expert
    paso("7. La inscripción en stellar.expert");
    const { userAgent } = await nav.send("Browser.getVersion");
    await escritorio.send("Network.setUserAgentOverride", { userAgent: userAgent.replace("HeadlessChrome", "Chrome") });
    const hash = pase.txHash;
    datos.urlExpert = `stellar.expert/explorer/testnet/tx/${hash}`;
    await escritorio.ir(`https://${datos.urlExpert}`);
    const cargo = await escritorio.waitFor(`document.body.innerText.includes("Transaction ${hash}") && /Successful/.test(document.body.innerText) && /register\\(/.test(document.body.innerText)`, 90_000);
    if (!cargo) {
      await escritorio.send("Page.captureScreenshot", { format: "png" }).then(({ data }) => writeFileSync(join(dir, "expert-fallo.png"), Buffer.from(data, "base64")));
      throw new Error("stellar.expert no mostró la transacción (ver expert-fallo.png)");
    }
    await sleep(1200);
    pistas.escritorio = await escritorio.grabar(join(dir, "escritorio"), pistas.escritorio);
    await sleep(300);
    marca("s7");
    await sleep(4500);
    marca("s7fin");
    await escritorio.parar();
    const { data } = await escritorio.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(dir, "expert.png"), Buffer.from(data, "base64"));

    const errores = [asiste, escanea].flatMap((p) => p.errores);
    if (errores.length) console.log(`  errores de la página: ${errores.slice(0, 5).join(" | ")}`);
  } finally {
    await nav.cerrar();
  }

  const grabacion = {
    ...datos,
    marcas: m,
    toques,
    avisos,
    sinConexion: t("estado.sinConexion"),
    alDia: t("escaner.alDia"),
    pistas: Object.fromEntries(Object.entries(pistas).map(([k, v]) => [k, v.cuadros])),
  };
  writeFileSync(join(dir, "grabacion.json"), JSON.stringify(grabacion, null, 1));
  console.log(`  cuadros: ${Object.entries(grabacion.pistas).map(([k, v]) => `${k} ${v.length}`).join(", ")}`);
  return grabacion;
}

// ---------- El montaje ----------

/** Las escenas, con sus tramos de tiempo real (y cuáles se aceleran), a partir de las marcas de la grabación. */
function montar(g) {
  const T = TEXTOS[g.lang];
  const m = g.marcas;
  const E = T.escenas;
  /** Un tramo de espera: se acelera para que dure unos `objetivo` ms, y lo dice. */
  const rapido = (de, a, extra = {}, objetivo = 2600) => {
    const largo = a - de;
    const x = largo / objetivo;
    if (x < 1.6) return [{ de, a, x: 1, ...extra }];
    return [{ de, a, x: Math.round(x), cartel: T.acelerado(Math.round(x)), ...extra }];
  };
  const tramos = (lista) => lista.filter((c) => c.a > c.de);
  return [
    { tipo: "portada", dur: 3000 },
    {
      tipo: "uno",
      ...E[1],
      clips: tramos([{ de: m.s1, a: m.envio + 700 }, ...rapido(m.envio + 700, m.listo - 400, { sub: E[1].espera }, 2800), { de: m.listo - 400, a: m.s1fin }]),
    },
    {
      tipo: "uno",
      ...E[2],
      anillo: { t: m.qrCambio, rect: g.qrRect },
      clips: tramos([{ de: m.s2, a: m.s2 + 1600 }, ...rapido(m.s2 + 1600, m.qrCambio - 1400, {}, 1800), { de: m.qrCambio - 1400, a: m.s2fin }]),
    },
    {
      tipo: "dos",
      ...E[3],
      clips: tramos([
        { de: m.s3, a: m.v1fin + 300 },
        { de: m.v1fin + 300, a: m.s3fin, sub: E[3].segunda },
      ]),
    },
    {
      tipo: "dos",
      avisos: true,
      ...E[4],
      clips: tramos([
        { de: m.s4, a: m.offline },
        { de: m.offline, a: m.v3fin + 300, sub: E[4].corte },
        { de: m.v3fin + 300, a: m.s4fin, sub: E[4].segunda },
      ]),
    },
    {
      tipo: "dos",
      avisos: true,
      ...E[5],
      clips: tramos([{ de: m.s5, a: m.online + 1400 }, ...rapido(m.online + 1400, m.sync - 700, {}, 2400), { de: m.sync - 700, a: m.s5fin }]),
    },
    { tipo: "escritorio", ...E[6], sub: E[6].sub(g.nombre.split(" ")[0]), url: g.urlPanel, clips: [{ de: m.s6, a: m.s6fin }] },
    { tipo: "escritorio", ...E[7], sub: E[7].sub(g.nombre.split(" ")[0]), url: g.urlExpert, clips: [{ de: m.s7, a: m.s7fin }] },
    { tipo: "cierre", dur: 4000 },
  ]
    .map((e) => ({ ...e, clips: e.clips?.map((c) => ({ x: 1, ...c })) }))
    .map((e) => ({ ...e, dur: e.dur ?? e.clips.reduce((s, c) => s + (c.a - c.de) / c.x, 0) }));
}

/** El cuadro más reciente de una pista a esa hora (o el primero, si todavía no había ninguno). */
function cuadroEn(cuadros, t) {
  let lo = 0;
  let hi = cuadros.length - 1;
  if (!cuadros.length) return null;
  if (t < cuadros[0].t) return cuadros[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cuadros[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return cuadros[lo];
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="3" opacity=".5"/><g transform="rotate(35 32 32)"><path d="M32 4 L41 32 L32 28 L23 32 Z" fill="#E8541E"/><path d="M32 60 L23 32 L32 36 L41 32 Z" fill="currentColor" opacity=".85"/></g><circle cx="32" cy="32" r="4" fill="currentColor"/></svg>`;

function paginaMontaje() {
  const fuente = (archivo) => pathToFileURL(join(FUENTES, archivo)).href;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Bricolage"; src: url("${fuente("BricolageGrotesque96pt-ExtraBold.ttf")}"); font-weight: 800; }
@font-face { font-family: "Bricolage"; src: url("${fuente("BricolageGrotesque96pt-Bold.ttf")}"); font-weight: 700; }
@font-face { font-family: "Inter"; src: url("${fuente("Inter-Regular.ttf")}"); font-weight: 400; }
@font-face { font-family: "Inter"; src: url("${fuente("Inter-SemiBold.ttf")}"); font-weight: 600; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }
body { background: #0B1626; color: #F4EFE6; font-family: "Inter", sans-serif; position: relative; }
#fondo { position: absolute; inset: 0; background: radial-gradient(900px 700px at 72% 48%, rgba(40, 70, 120, 0.42), transparent 70%), radial-gradient(700px 500px at 8% 100%, rgba(232, 84, 30, 0.10), transparent 70%), #0B1626; }
.capa { position: absolute; display: none; }
#logo { left: 96px; top: 54px; align-items: center; gap: 16px; font: 800 48px/1 "Bricolage"; letter-spacing: -0.02em; }
#logo svg { width: 58px; height: 58px; color: #F4EFE6; }
#texto { left: 96px; top: 0; height: 1080px; width: 770px; flex-direction: column; justify-content: center; }
.paso { margin: 0; font: 600 44px/1.2 "Inter"; color: #FF7A45; display: flex; align-items: center; gap: 18px; }
.paso::before { content: ""; width: 46px; height: 5px; border-radius: 3px; background: #FF7A45; }
h1 { margin: 22px 0 30px; font: 800 84px/1.04 "Bricolage"; letter-spacing: -0.02em; }
h1 .acento { color: #FF7A45; }
.sub { margin: 0; font: 400 44px/1.32 "Inter"; color: #C9C2B5; }
.cartel { display: none; align-self: flex-start; margin-top: 30px; padding: 10px 28px 10px 22px; border-radius: 999px; background: #F5C451; color: #0F1C2E; font: 600 44px/1.2 "Inter"; align-items: center; gap: 12px; }
.cartel svg { width: 42px; height: 42px; }
.avisos { display: none; margin-top: 30px; }
.avisos-rotulo { margin: 0 0 14px; font: 600 44px/1.2 "Inter"; color: #C9C2B5; }
.avisos-lista { display: flex; flex-wrap: wrap; gap: 14px; }
.aviso { display: inline-flex; align-items: center; gap: 12px; padding: 10px 28px 10px 20px; border-radius: 999px; font: 600 44px/1.2 "Inter"; color: #0F1C2E; white-space: nowrap; }
.aviso svg { width: 42px; height: 42px; flex: none; }
.aviso.sin-red { background: #FF7A45; }
.aviso.pendiente { background: #F5C451; }
.aviso.al-dia { color: #F4EFE6; box-shadow: inset 0 0 0 3px #2FBFA6; }
.aviso.al-dia svg { color: #2FBFA6; }
.tel { top: 50px; width: 434px; }
.tel figcaption { height: 70px; display: flex; align-items: center; gap: 14px; font: 600 44px/1 "Inter"; color: #C9C2B5; white-space: nowrap; }
.marco { position: relative; width: 434px; height: 906px; padding: 14px; border-radius: 64px; background: #050b14; box-shadow: 0 40px 90px rgba(0, 0, 0, 0.5), inset 0 0 0 2px #22344f; }
.marco img { display: block; width: 406px; height: 878px; border-radius: 50px; background: #F7F2E8; }
.toque { position: absolute; border-radius: 50%; border: 6px solid rgba(255, 122, 69, 0.95); background: rgba(255, 122, 69, 0.22); pointer-events: none; }
.anillo { position: absolute; border: 7px solid #F5C451; border-radius: 18px; pointer-events: none; }
#tel-a { left: 908px; }
#tel-b { left: 1390px; }
body[data-tipo="uno"] #tel-a { left: 1149px; }
#arriba { left: 276px; top: 40px; width: 1368px; flex-direction: column; gap: 6px; }
#arriba .fila { display: flex; align-items: baseline; gap: 26px; }
#arriba h2 { margin: 0; font: 800 72px/1.1 "Bricolage"; letter-spacing: -0.02em; }
#arriba .sub { font-size: 44px; }
#logo-chico { right: 276px; top: 52px; align-items: center; gap: 12px; font: 800 44px/1 "Bricolage"; letter-spacing: -0.02em; }
#logo-chico svg { width: 52px; height: 52px; color: #F4EFE6; }
#ventana { left: 276px; top: 222px; width: 1368px; border-radius: 18px; overflow: hidden; background: #fff; box-shadow: 0 40px 90px rgba(0, 0, 0, 0.5); }
#ventana .barra { height: 50px; background: #1B2A42; display: flex; align-items: center; gap: 12px; padding: 0 20px; }
#ventana .punto { width: 15px; height: 15px; border-radius: 50%; background: #3D4B5F; }
#ventana .url { margin-left: 14px; flex: 1; height: 34px; border-radius: 10px; background: #0F1C2E; color: #C9C2B5; font: 500 22px/34px "Inter"; padding: 0 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ventana img { display: block; width: 1368px; height: 770px; }
#centro { inset: 0; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
#centro .grande { display: flex; align-items: center; gap: 30px; font: 800 150px/1 "Bricolage"; letter-spacing: -0.02em; }
#centro .grande svg { width: 160px; height: 160px; color: #F4EFE6; }
#centro .linea { margin: 54px 0 0; font: 800 64px/1.15 "Bricolage"; letter-spacing: -0.02em; }
#centro .linea .acento { color: #FF7A45; }
#centro .chica { margin: 26px 0 0; font: 400 46px/1.35 "Inter"; color: #C9C2B5; }
#centro .enlaces { margin-top: 56px; display: flex; flex-direction: column; gap: 18px; font: 600 54px/1.2 "Inter"; color: #F4EFE6; }
body[data-tipo="uno"] #logo, body[data-tipo="dos"] #logo { display: flex; }
body[data-tipo="uno"] #texto, body[data-tipo="dos"] #texto { display: flex; }
body[data-tipo="uno"] #tel-a, body[data-tipo="dos"] #tel-a, body[data-tipo="dos"] #tel-b { display: block; }
body[data-tipo="escritorio"] #arriba, body[data-tipo="escritorio"] #logo-chico { display: flex; }
body[data-tipo="escritorio"] #ventana { display: block; }
body[data-tipo="portada"] #centro, body[data-tipo="cierre"] #centro { display: flex; }
</style></head><body data-tipo="">
<div id="fondo"></div>
<div id="logo" class="capa">${LOGO}<span>Rumbo</span></div>
<div id="texto" class="capa"><p class="paso"></p><h1></h1><p class="sub"></p><span class="cartel cartel-rapido"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 6v12l8.5-6zM12.5 6v12L21 12z"/></svg><span></span></span><div class="avisos"><p class="avisos-rotulo"></p><div class="avisos-lista"></div></div></div>
<figure id="tel-a" class="capa tel" style="margin:0"><figcaption><span class="rotulo"></span></figcaption><div class="marco"><img alt=""></div></figure>
<figure id="tel-b" class="capa tel" style="margin:0"><figcaption><span class="rotulo"></span></figcaption><div class="marco"><img alt=""></div></figure>
<div id="arriba" class="capa"><div class="fila"><p class="paso"></p><h2></h2></div><p class="sub"></p></div>
<div id="logo-chico" class="capa">${LOGO}<span>Rumbo</span></div>
<div id="ventana" class="capa"><div class="barra"><span class="punto"></span><span class="punto"></span><span class="punto"></span><span class="url"></span></div><img alt=""></div>
<div id="centro" class="capa"></div>
<script>
const $ = (s) => document.querySelector(s);
const ESCALA = 406 / 390;
const ICONOS = {
  "sin-red": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12.2a10 10 0 0 1 13 0M9 15.8a5 5 0 0 1 6 0"/><circle cx="12" cy="19.3" r="1.1" fill="currentColor"/><path d="M3 3l18 18"/></svg>',
  pendiente: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  "al-dia": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>',
};
let ultimoCentro = "";
async function poner(img, src) {
  if (!src || img.dataset.src === src) return;
  img.dataset.src = src;
  img.src = src;
  try { await img.decode(); } catch {}
}
function dibujar(marco, toques, anillo) {
  marco.querySelectorAll(".toque, .anillo").forEach((e) => e.remove());
  for (const t of toques) {
    const r = 34 + 46 * t.edad;
    const d = document.createElement("div");
    d.className = "toque";
    Object.assign(d.style, { left: 14 + t.x * ESCALA - r + "px", top: 14 + t.y * ESCALA - r + "px", width: 2 * r + "px", height: 2 * r + "px", opacity: String(1 - t.edad) });
    marco.appendChild(d);
  }
  if (anillo) {
    const d = document.createElement("div");
    d.className = "anillo";
    const pad = 10 + 10 * anillo.edad;
    Object.assign(d.style, { left: 14 + anillo.rect.x * ESCALA - pad + "px", top: 14 + anillo.rect.y * ESCALA - pad + "px", width: anillo.rect.w * ESCALA + 2 * pad + "px", height: anillo.rect.h * ESCALA + 2 * pad + "px", opacity: String(Math.min(1, 2.2 * (1 - anillo.edad))) });
    marco.appendChild(d);
  }
}
window.render = async (s) => {
  document.body.dataset.tipo = s.tipo;
  if (s.tipo === "portada" || s.tipo === "cierre") {
    if (ultimoCentro !== s.centro) { $("#centro").innerHTML = s.centro; ultimoCentro = s.centro; }
    return true;
  }
  if (s.tipo === "escritorio") {
    $("#arriba .paso").textContent = s.paso;
    $("#arriba h2").textContent = s.titulo;
    $("#arriba .sub").textContent = s.sub;
    $("#ventana .url").textContent = s.url;
    await poner($("#ventana img"), s.img.escritorio);
    return true;
  }
  $("#texto .paso").textContent = s.paso;
  $("#texto h1").innerHTML = s.titulo;
  $("#texto .sub").textContent = s.sub;
  const cartel = $("#texto .cartel-rapido");
  cartel.style.display = s.cartel ? "inline-flex" : "none";
  cartel.querySelector("span").textContent = s.cartel || "";
  const avisos = $("#texto .avisos");
  avisos.style.display = s.avisos ? "block" : "none";
  avisos.querySelector(".avisos-rotulo").textContent = s.avisosRotulo || "";
  const html = (s.avisos || []).map((a) => '<span class="aviso ' + a.tono + '">' + ICONOS[a.tono] + "<span>" + a.texto.replace(/[&<>]/g, "") + "</span></span>").join("");
  const lista = avisos.querySelector(".avisos-lista");
  if (lista.innerHTML !== html) lista.innerHTML = html;
  const telefonos = [["#tel-a", "asiste"], ["#tel-b", "escanea"]];
  for (const [sel, pista] of telefonos) {
    const tel = $(sel);
    tel.querySelector(".rotulo").textContent = s.rotulos[pista];
    await poner(tel.querySelector("img"), s.img[pista]);
    dibujar(tel.querySelector(".marco"), s.toques.filter((t) => t.pista === pista), pista === "asiste" ? s.anillo : null);
  }
  return true;
};
</script></body></html>`;
}

async function componer(lang) {
  const dir = join(TRABAJO, lang);
  const g = JSON.parse(readFileSync(join(dir, "grabacion.json"), "utf8"));
  const T = TEXTOS[lang];
  const { makeT } = await import("../src/i18n/index.ts");
  g.sinConexion ??= makeT(lang)("estado.sinConexion");
  g.alDia ??= makeT(lang)("escaner.alDia");
  const escenas = montar(g);
  const total = escenas.reduce((s, e) => s + e.dur, 0);
  paso(`Componiendo ${lang}: ${escenas.length} escenas, ${(total / 1000).toFixed(1)} s`);
  for (const e of escenas) console.log(`  ${e.tipo.padEnd(10)} ${(e.dur / 1000).toFixed(1).padStart(5)} s  ${(e.clips ?? []).map((c) => `${((c.a - c.de) / 1000).toFixed(1)} s x${c.x}`).join(", ")}`);

  const archivoUrl = (pista, n) => pathToFileURL(join(dir, pista, `${n}.jpg`)).href;
  const titulo = (t) => (Array.isArray(t) ? `${esc(t[0])}<br><span class="acento">${esc(t[1])}</span>` : esc(t));
  const portada = `<div class="grande">${LOGO}<span>Rumbo</span></div><p class="linea">${esc(T.portada[0])}<br><span class="acento">${esc(T.portada[1])}</span></p><p class="chica">${esc(T.portadaSub)}</p>`;
  const cierre = `<div class="grande">${LOGO}<span>Rumbo</span></div><p class="linea">${esc(T.lema[0])}<span class="acento">${esc(T.lema[1])}</span></p><div class="enlaces"><span>rumbo-eventos.vercel.app</span><span>github.com/nema1502/rumbo</span></div>`;

  /** Los avisos del escáner a esa hora, tal cual los muestra su pantalla, cada uno con su tono. */
  function avisosEn(t) {
    const a = cuadroEn(g.avisos ?? [], t);
    if (!a || !a.lista.length) return null;
    return a.lista.map((texto) => ({ texto, tono: texto === g.sinConexion ? "sin-red" : texto === g.alDia ? "al-dia" : "pendiente" }));
  }

  /** El estado de la pantalla en el milisegundo `t` del video. */
  function estado(t) {
    let inicio = 0;
    for (const e of escenas) {
      if (t < inicio + e.dur || e === escenas[escenas.length - 1]) {
        const local = t - inicio;
        if (e.tipo === "portada") return { tipo: "portada", centro: portada };
        if (e.tipo === "cierre") return { tipo: "cierre", centro: cierre };
        let acumulado = 0;
        let clip = e.clips[e.clips.length - 1];
        let fuente = clip.a;
        for (const c of e.clips) {
          const largo = (c.a - c.de) / c.x;
          if (local < acumulado + largo) {
            clip = c;
            fuente = c.de + (local - acumulado) * c.x;
            break;
          }
          acumulado += largo;
        }
        const img = {};
        for (const pista of e.tipo === "escritorio" ? ["escritorio"] : e.tipo === "uno" ? ["asiste"] : ["asiste", "escanea"]) {
          const cuadro = cuadroEn(g.pistas[pista], fuente);
          img[pista] = cuadro ? archivoUrl(pista, cuadro.n) : null;
        }
        if (e.tipo === "escritorio") return { tipo: e.tipo, paso: e.paso, titulo: e.titulo, sub: e.sub, url: e.url, img };
        const toques = g.toques
          .filter((x) => x.pista !== "escritorio" && fuente >= x.t && fuente - x.t < 520)
          .map((x) => ({ pista: x.pista, x: Math.round(x.x), y: Math.round(x.y), edad: Math.round(((fuente - x.t) / 520) * 12) / 12 }));
        const anillo = e.anillo && fuente >= e.anillo.t && fuente - e.anillo.t < 2000 ? { rect: e.anillo.rect, edad: Math.round(((fuente - e.anillo.t) / 2000) * 30) / 30 } : null;
        const m = g.marcas;
        return {
          tipo: e.tipo,
          paso: e.paso,
          titulo: titulo(e.titulo),
          sub: clip.sub ?? e.sub,
          cartel: clip.cartel ?? null,
          rotulos: { asiste: T.asiste, escanea: T.escanea },
          avisos: e.avisos && fuente >= m.offline ? avisosEn(fuente) : null,
          avisosRotulo: T.enEscaner,
          img,
          toques,
          anillo,
          // Para ubicar el cartel del video: el primer veredicto verde de la puerta.
          poster: fuente >= m.v1 + 600 && fuente < m.v1 + 700,
        };
      }
      inicio += e.dur;
    }
    return null;
  }

  const montaje = join(dir, "montaje.html");
  writeFileSync(montaje, paginaMontaje());
  const nav = await Navegador.abrir(PORT + 1, ["--allow-file-access-from-files", "--force-color-profile=srgb"]);
  const maestro = join(dir, "maestro.mp4");
  try {
    const p = await nav.pagina("montaje", { ancho: 1920, alto: 1080, dpr: 1 });
    await p.ir(pathToFileURL(montaje).href);
    await p.eval(`document.fonts.load('800 88px "Bricolage"').then(() => document.fonts.load('400 44px "Inter"')).then(() => document.fonts.load('600 44px "Inter"')).then(() => document.fonts.load('700 44px "Bricolage"')).then(() => document.fonts.ready).then(() => true)`);
    const enc = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0", "-vf", RANGO, ...COLOR, "-c:v", "libx264", "-preset", "medium", "-crf", "14", maestro], { stdio: ["pipe", "ignore", "inherit"] });
    const termino = new Promise((ok, mal) => enc.on("close", (c) => (c === 0 ? ok() : mal(new Error(`ffmpeg salió con ${c}`)))));
    const cuadros = Math.round((total / 1000) * FPS);
    let anterior = "";
    let jpeg = null;
    let tPoster = null;
    let distintos = 0;
    for (let n = 0; n < cuadros; n++) {
      const s = estado((n * 1000) / FPS);
      if (s.poster && tPoster === null) tPoster = n / FPS;
      const { poster, ...visible } = s;
      const clave = JSON.stringify(visible);
      if (clave !== anterior) {
        await p.eval(`window.render(${JSON.stringify(visible)})`);
        jpeg = Buffer.from((await p.send("Page.captureScreenshot", { format: "jpeg", quality: 93 })).data, "base64");
        anterior = clave;
        distintos++;
      }
      if (!enc.stdin.write(jpeg)) await new Promise((r) => enc.stdin.once("drain", r));
      if (n % 300 === 0) console.log(`  cuadro ${n} de ${cuadros}`);
    }
    enc.stdin.end();
    await termino;
    console.log(`  ${cuadros} cuadros (${distintos} distintos)`);
    g.tPoster = tPoster ?? 20;
  } finally {
    await nav.cerrar();
  }

  // El video final, chico para la landing, y su cartel.
  mkdirSync(SALIDA, { recursive: true });
  const final = join(SALIDA, `mvp-${lang}.mp4`);
  for (let crf = CRF; ; crf++) {
    await ffmpeg(["-i", maestro, "-an", "-c:v", "libx264", "-preset", "veryslow", "-tune", "animation", "-crf", String(crf), "-pix_fmt", "yuv420p", ...COLOR, "-movflags", "+faststart", "-map_metadata", "-1", final]);
    const peso = readFileSync(final).length;
    console.log(`  crf ${crf}: ${(peso / 1e6).toFixed(2)} MB`);
    if (peso <= 3_000_000 || crf >= 36) break;
  }
  await ffmpeg(["-ss", String(g.tPoster), "-i", maestro, "-frames:v", "1", "-vf", "scale=1280:720:flags=lanczos", "-q:v", "4", "-map_metadata", "-1", join(SALIDA, `mvp-${lang}.jpg`)]);
  console.log(`  listo: ${final} y mvp-${lang}.jpg (cartel en ${g.tPoster.toFixed(1)} s)`);
}

try {
  for (const lang of IDIOMAS) {
    if (FASE === "todo" || FASE === "grabar") await grabar(lang);
    if (FASE === "todo" || FASE === "componer") await componer(lang);
  }
  paso("Terminado");
  process.exit(0);
} catch (error) {
  console.error(`\nFALLA: ${error.stack ?? error.message}`);
  process.exit(1);
}
