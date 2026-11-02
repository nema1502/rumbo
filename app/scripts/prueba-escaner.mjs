// Prueba de punta a punta del escáner del voluntario, contra la red de prueba y con Chrome sin interfaz:
//   1. crea cuatro personas con su pase y su cuenta de prueba: una inscripción gratis, una entrada con
//      almuerzo (buy), una tercera que ya entró en el contrato sin pasar por la app (para provocar un "doble")
//      y una cuarta para el cambio de puesto con pendientes,
//   2. abre /scan con el código de la puerta (primero uno equivocado) y escribe las credenciales a mano,
//   3. con red: entró, ya entró, y en la mesa del almuerzo "no corresponde" (sin entrar, y entrada que no lo incluye),
//   4. sin red (Network.emulateNetworkConditions offline, también en el service worker): entró, ya entró,
//      credencial inválida, y la página vuelve a abrir sin red con la sesión y la cola intactas,
//   5. con red otra vez: la cola se vacía, el doble queda marcado, y el canje del almuerzo (con y sin red, dos veces);
//      una entrada que quedó pendiente en la puerta llega con el código de la puerta aunque se haya abierto la mesa,
//   6. comprueba en la cadena con status() que la entrada y el canje quedaron, y en la base el espejo,
//   7. mide las tres pantallas en 1440x900, 973x700 y 390x844 (sin scroll horizontal, acción a la vista).
// Tarda unos minutos (cada registro es una transacción). Deja capturas en --capturas (por defecto data/capturas-escaner).
//   node scripts/prueba-escaner.mjs [--base http://127.0.0.1:3000] [--port 9445] [--capturas carpeta]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_DIR, loadEnv } from "./lib/env.mjs";
import { findChrome, sleep } from "./lib/browser.mjs";

process.chdir(APP_DIR);
loadEnv();

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg("--base", process.env.NEXT_PUBLIC_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const PORT = Number(arg("--port", process.env.CDP_PORT || 9445));
const CAPTURAS = arg("--capturas", join(APP_DIR, "data", "capturas-escaner"));
mkdirSync(CAPTURAS, { recursive: true });

const { getRepo } = await import("../src/server/repo.ts");
const { getAccountProvider } = await import("../src/server/accounts.ts");
const stellar = await import("../src/server/stellar.ts");
const { buildQrPayload } = await import("../src/server/qr.ts");
const { ensureStationCodes } = await import("../src/server/panel.ts");
const { formatStationCode } = await import("../src/lib/station-code.ts");

const fallas = [];
const t0 = Date.now();
const paso = (texto) => console.log(`\n> ${texto}  (${Math.round((Date.now() - t0) / 1000)} s)`);
const check = (ok, texto) => {
  console.log(`  ${ok ? "ok  " : "FALLA"} ${texto}`);
  if (!ok) fallas.push(texto);
  return ok;
};

// ---------- 1. Los pases en la red de prueba ----------

const repo = getRepo();
const event = (await repo.getEventBySlug("hackaton-comunidad")) ?? (await repo.listEvents())[0];
if (!event) {
  console.error("No hay eventos: corré pnpm seed primero.");
  process.exit(1);
}
const tickets = await repo.listTicketTypes(event.id);
const freeTicket = tickets.find((t) => t.priceUsdc === 0);
const paidTicket = tickets.find((t) => t.priceUsdc > 0);
const benefits = await repo.listBenefits(event.id);
const lunch = benefits.find((b) => b.kind === "lunch");
if (!freeTicket || !paidTicket || !lunch) {
  console.error("El evento de muestra necesita una entrada gratis, una paga y el almuerzo: corré pnpm seed.");
  process.exit(1);
}
const key = await repo.getEventQrKey(event.id);
const codes = await ensureStationCodes(event, repo);
const gateCode = codes.find((c) => c.kind === "gate")?.code;
const lunchCode = codes.find((c) => c.kind === "benefit" && c.benefitId === lunch.id)?.code;
if (!gateCode || !lunchCode) {
  console.error("El evento no tiene códigos de puesto para la puerta y el almuerzo.");
  process.exit(1);
}
const accounts = getAccountProvider(repo);
const stamp = Date.now().toString(36);

/**
 * La red de prueba a veces pide esperar (TRY_AGAIN_LATER cuando la misma cuenta tiene otra transacción
 * en vuelo, por ejemplo si otro proceso usa la patrocinadora a la vez): se vuelve a intentar unas veces.
 */
async function conReintentos(fn, intentos = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i >= intentos || !/TRY_AGAIN_LATER|BAD_SEQ|no se confirmó|timeout|fetch failed/i.test(error.message)) throw error;
      console.log(`  la red pidió esperar (${error.message.slice(0, 80)}); intento ${i + 1} en 6 s`);
      await sleep(6000);
    }
  }
}

async function crearPase(nombre, ticket, fn) {
  const person = await repo.upsertPerson({ name: nombre, email: `escaner-${stamp}-${nombre.split(" ")[0].toLowerCase()}@example.com` });
  let pass = await repo.createPass({ eventId: event.id, personId: person.id, ticketTypeId: ticket.id, status: "pending" });
  await repo.grantTicketBenefits(pass.id);
  const account = await conReintentos(() => accounts.getOrCreateForPerson(person.id));
  const contract = ticket.contractId ?? event.contractId;
  const result = await conReintentos(async () => stellar.rumboPass[fn](contract, account, await accounts.authSigner(person.id)));
  pass = await repo.updatePass(pass.id, { account, status: "active", txHash: result.hash, chainNumber: result.number });
  return { nombre, person, pass, account, contract, qr: buildQrPayload(pass.id, key) };
}

paso(`El evento "${event.name}": puerta ${formatStationCode(gateCode)}, almuerzo ${formatStationCode(lunchCode)}. Creando tres pases en la red de prueba (de a uno, tarda)...`);
const gratis = await crearPase("Valentina Prueba", freeTicket, "register");
const almuerzo = await crearPase("Mateo Prueba", paidTicket, "buy");
const doble = await crearPase("Sofia Prueba", freeTicket, "register");
const cambio = await crearPase("Lucia Prueba", freeTicket, "register");
for (const p of [gratis, almuerzo, doble, cambio]) console.log(`  ${p.nombre}: pase ${p.pass.id} número ${p.pass.chainNumber}, QR ${p.qr}`);
paso("La tercera persona entra directo en el contrato, sin pasar por la app (así el escáner no lo sabe)");
await conReintentos(() => stellar.rumboPass.checkIn(doble.contract, doble.account));

// ---------- Chrome, por el protocolo de DevTools ----------

class Navegador {
  static async abrir(port) {
    const profile = mkdtempSync(join(tmpdir(), "rumbo-escaner-"));
    const proc = spawn(
      findChrome(),
      [
        "--headless=new",
        "--disable-gpu",
        "--lang=es-BO",
        "--no-first-run",
        "--no-default-browser-check",
        "--mute-audio",
        // Una cámara de mentira, con permiso dado: así la pantalla de la cámara se ve y se mide
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        "--window-size=1440,900",
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    const salio = new Promise((r) => proc.once("exit", r));
    for (let i = 0; ; i++) {
      if (proc.exitCode !== null) throw new Error(`Chrome se cerró al arrancar (¿el puerto ${port} está tomado?)`);
      try {
        const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        const ws = new WebSocket(info.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res);
          ws.addEventListener("error", rej);
        });
        return new Navegador(ws, proc, profile, salio);
      } catch {
        if (i > 100) throw new Error("Chrome no expuso DevTools");
        await sleep(200);
      }
    }
  }

  constructor(ws, proc, profile, salio) {
    this.ws = ws;
    this.proc = proc;
    this.profile = profile;
    this.salio = salio;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message}`)) : resolve(msg.result);
      } else if (msg.method) {
        for (const listener of this.listeners) listener(msg);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: sin respuesta en 60 s`));
      }, 60_000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  async cerrar() {
    try {
      this.ws.close();
    } catch {
      /* ya cerrado */
    }
    try {
      this.proc.kill();
    } catch {
      /* ya cerrado */
    }
    await Promise.race([this.salio, sleep(5000)]);
    try {
      rmSync(this.profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch {
      /* queda para la próxima */
    }
  }
}

// Lo que la prueba necesita tocar en la página. Se inyecta en cada documento nuevo.
const AYUDANTES = `
window.__esc = {
  set(sel, value) {
    const el = document.querySelector(sel);
    if (!el) return false;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    return true;
  },
  clickText(text) {
    const el = [...document.querySelectorAll("button, a, label")].find((e) => e.textContent.trim() === text || e.textContent.trim().startsWith(text));
    if (!el) return false;
    el.click();
    return true;
  },
  text(sel) { return document.querySelector(sel)?.textContent?.trim() ?? null; },
  chips() { return [...document.querySelectorAll(".esc-chips .chip")].map((c) => c.textContent.trim()); },
  veredicto() {
    const v = document.querySelector(".esc-veredicto");
    if (!v) return null;
    const kind = [...v.classList].find((c) => c.startsWith("esc-veredicto-") && c !== "esc-veredicto")?.replace("esc-veredicto-", "");
    return {
      kind,
      titulo: v.querySelector(".esc-veredicto-titulo")?.textContent.trim() ?? null,
      nombre: v.querySelector(".esc-veredicto-nombre")?.textContent.trim() ?? null,
      detalle: v.querySelector(".esc-veredicto-detalle")?.textContent.trim() ?? null,
    };
  },
  medir() {
    const accion = document.querySelector(".pantalla-accion .boton, .esc-texto .boton-primario, .esc-camara, .esc-veredicto-boton");
    const r = accion?.getBoundingClientRect();
    return {
      scrollAncho: document.documentElement.scrollWidth,
      ancho: innerWidth,
      alto: innerHeight,
      accion: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), visible: r.top >= 0 && r.bottom <= innerHeight } : null,
    };
  },
};`;

class Pagina {
  constructor(nav, sessionId) {
    this.nav = nav;
    this.sessionId = sessionId;
    this.errores = [];
    nav.listeners.push((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.exceptionThrown") this.errores.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") this.errores.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
      // Un diálogo (el aviso al cerrar con pendientes) se acepta, para que la prueba no se quede esperando.
      if (msg.method === "Page.javascriptDialogOpening") void this.send("Page.handleJavaScriptDialog", { accept: true });
    });
  }
  static async nueva(nav) {
    const { targetId } = await nav.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await nav.send("Target.attachToTarget", { targetId, flatten: true });
    const pagina = new Pagina(nav, sessionId);
    await pagina.send("Runtime.enable");
    await pagina.send("Page.enable");
    await pagina.send("Network.enable");
    await pagina.send("Page.addScriptToEvaluateOnNewDocument", { source: AYUDANTES });
    return pagina;
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
      await sleep(250);
    }
    return false;
  }
  /**
   * Navega y espera la página. Si el servidor de desarrollo contesta 404 o 500 porque está
   * recompilando (pasa cuando varios procesos comparten la carpeta .next), vuelve a intentar.
   */
  async ir(url, intentos = 4) {
    for (let i = 1; ; i++) {
      await this.send("Page.navigate", { url });
      await this.waitFor(`document.readyState === "complete" && window.__esc`, 60_000);
      const esNuestra = await this.eval(`!!document.querySelector(".pantalla") && !/^(404|500)/.test(document.title)`).catch(() => false);
      if (esNuestra || i >= intentos) return;
      console.log(`  (la página no cargó bien, intento ${i + 1} en 3 s)`);
      await sleep(3000);
    }
  }
  async tamano(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await sleep(300);
  }
  async captura(nombre) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(CAPTURAS, `${nombre}.png`), Buffer.from(data, "base64"));
  }
  offline(flag) {
    return this.send("Network.emulateNetworkConditions", { offline: flag, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
}

/** Abre un puesto con su código desde la pantalla de elegir. */
async function abrirPuesto(pagina, code) {
  await pagina.waitFor(`document.querySelector("#esc-codigo")`, 20_000);
  await pagina.eval(`__esc.set("#esc-codigo", ${JSON.stringify(code)})`);
  await pagina.eval(`__esc.clickText("Abrir el puesto")`);
}

/** Cierra el puesto abierto (acepta el aviso si hay pendientes) y abre otro con su código. */
async function cambiarPuesto(pagina, code, nombre) {
  await pagina.eval(`__esc.clickText("Cerrar el puesto")`);
  await abrirPuesto(pagina, code);
  return pagina.waitFor(`__esc.text(".esc-puesto-titulo") === ${JSON.stringify(nombre)}`, 30_000);
}

/** Pasa a escribir el código a mano, si la cámara está en pantalla. */
async function modoEscribir(pagina) {
  if (!(await pagina.eval(`!!document.querySelector("#esc-credencial")`))) await pagina.eval(`__esc.clickText("Escribir el código")`);
  return pagina.waitFor(`document.querySelector("#esc-credencial")`, 10_000);
}

/** Escribe una credencial en el campo y devuelve el veredicto que apareció. */
async function escanear(pagina, qr) {
  await modoEscribir(pagina);
  await pagina.eval(`__esc.set("#esc-credencial", ${JSON.stringify(qr)})`);
  await pagina.eval(`__esc.clickText("Verificar")`);
  const aparecio = await pagina.waitFor(`document.querySelector(".esc-veredicto")`, 15_000);
  if (!aparecio) return null;
  const veredicto = await pagina.eval(`__esc.veredicto()`);
  await pagina.eval(`__esc.clickText("Siguiente")`);
  await pagina.waitFor(`!document.querySelector(".esc-veredicto")`, 5_000);
  return veredicto;
}

/** Deja un veredicto en pantalla (para la captura) y lo cierra después. */
async function capturarVeredicto(pagina, qr, nombre) {
  await modoEscribir(pagina);
  await pagina.eval(`__esc.set("#esc-credencial", ${JSON.stringify(qr)})`);
  await pagina.eval(`__esc.clickText("Verificar")`);
  await pagina.waitFor(`document.querySelector(".esc-veredicto")`, 10_000);
  await sleep(400); // que termine de aparecer
  await pagina.captura(nombre);
  await pagina.eval(`__esc.clickText("Siguiente")`);
  await pagina.waitFor(`!document.querySelector(".esc-veredicto")`, 5_000);
}

async function esperarSincronizado(pagina, ms = 120_000) {
  const ok = await pagina.waitFor(`__esc.chips().some((c) => c.startsWith("Todo sincronizado")) && !__esc.chips().some((c) => c.includes("por sincronizar") || c.includes("Sincronizando"))`, ms);
  return { ok, chips: await pagina.eval(`__esc.chips()`) };
}

const nav = await Navegador.abrir(PORT);
let swSession = null;
let pagina;

async function offlineTotal(flag) {
  await pagina.offline(flag);
  if (!swSession) {
    const { targetInfos } = await nav.send("Target.getTargets");
    const sw = targetInfos.find((t) => t.type === "service_worker" && t.url.endsWith("/sw.js"));
    if (sw) {
      const { sessionId } = await nav.send("Target.attachToTarget", { targetId: sw.targetId, flatten: true });
      swSession = sessionId;
      await nav.send("Network.enable", {}, swSession);
    }
  }
  if (swSession) await nav.send("Network.emulateNetworkConditions", { offline: flag, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, swSession);
  return Boolean(swSession);
}

try {
  pagina = await Pagina.nueva(nav);
  await pagina.tamano(1440, 900);

  // ---------- 2. Abrir el puesto ----------
  paso("Abrir /scan con el código de la puerta");
  await pagina.ir(`${BASE}/scan?lang=es`);
  check(await pagina.waitFor(`document.querySelector("#esc-codigo")`, 60_000), "la pantalla del código carga");
  await abrirPuesto(pagina, "ZZZZ-ZZZZ");
  check(await pagina.waitFor(`document.querySelector("#esc-codigo-error")`, 15_000), "un código equivocado avisa y no abre");
  await pagina.captura("elegir-1440x900");
  await abrirPuesto(pagina, formatStationCode(gateCode).toLowerCase());
  check(await pagina.waitFor(`__esc.text(".esc-puesto-titulo") === "Puerta"`, 30_000), "con el código de la puerta (en minúsculas y con guion) se abre la puerta");
  check(await pagina.waitFor(`document.querySelector(".esc-camara video")`, 10_000), "la cámara arranca (una de mentira, en esta prueba)");
  check(await pagina.waitFor(`navigator.serviceWorker.controller !== null`, 20_000), "el service worker toma la página");
  await sleep(2500);
  await pagina.captura("puerta-camara-1440x900");

  // ---------- 3. Con red ----------
  paso("Con red: la credencial gratis entra, y la segunda vez ya entró");
  let v = await escanear(pagina, gratis.qr);
  check(v?.kind === "ok" && v.titulo === "Entró" && v.nombre === gratis.nombre, `entró: ${JSON.stringify(v)}`);
  let sync = await esperarSincronizado(pagina);
  check(sync.ok, `la cola se vació con red: ${sync.chips.join(" | ")}`);
  const enCadena1 = await stellar.rumboPass.status(gratis.contract, gratis.account);
  check(enCadena1.checked_in === true, `en la cadena, ${gratis.nombre} figura como entrada (status.checked_in)`);
  const espejo1 = await repo.listCheckInsForPass(gratis.pass.id);
  check(espejo1.length === 1 && espejo1[0].synced && !espejo1[0].duplicate && Boolean(espejo1[0].txHash), "el espejo tiene el check-in sincronizado con su transacción");
  v = await escanear(pagina, gratis.qr);
  check(v?.kind === "already" && v.titulo === "Ya entró" && /a las \d{2}:\d{2}/.test(v.detalle ?? ""), `segunda vez, ya entró con la hora: ${JSON.stringify(v)}`);
  await pagina.tamano(390, 844);
  await capturarVeredicto(pagina, gratis.qr, "veredicto-ya-entro-390x844");
  await pagina.tamano(1440, 900);

  paso("En la mesa del almuerzo: sin haber entrado no corresponde, y la entrada gratis no lo incluye");
  check(await cambiarPuesto(pagina, lunchCode, lunch.name), "se cierra la puerta y se abre la mesa del almuerzo con su código");
  v = await escanear(pagina, almuerzo.qr);
  check(v?.kind === "no" && v.detalle === "Primero tiene que pasar por la puerta.", `canje sin entrar, no corresponde: ${JSON.stringify(v)}`);
  v = await escanear(pagina, gratis.qr);
  check(v?.kind === "no" && v.detalle === `La entrada no incluye ${lunch.name}.`, `entrada sin almuerzo, no corresponde: ${JSON.stringify(v)}`);
  check(await cambiarPuesto(pagina, gateCode, "Puerta"), "de vuelta a la puerta");

  // ---------- 4. Sin red ----------
  paso("Sin red (la página y el service worker): entra, repite, una credencial falsa, y la página vuelve a abrir");
  const conSw = await offlineTotal(true);
  check(conSw, "el service worker está activo y también quedó sin red");
  check(await pagina.waitFor(`__esc.chips().includes("Sin conexión")`, 10_000), "la pantalla avisa que no hay conexión");
  v = await escanear(pagina, almuerzo.qr);
  check(v?.kind === "ok" && v.titulo === "Entró" && v.nombre === almuerzo.nombre, `sin red, entró igual: ${JSON.stringify(v)}`);
  check(await pagina.waitFor(`__esc.chips().some((c) => c === "1 por sincronizar")`, 5_000), "queda 1 por sincronizar");
  v = await escanear(pagina, almuerzo.qr);
  check(v?.kind === "already" && v.titulo === "Ya entró", `sin red, la segunda vez ya entró: ${JSON.stringify(v)}`);
  v = await escanear(pagina, doble.qr);
  check(v?.kind === "ok" && v.titulo === "Entró", `sin red, la persona que ya entró por otro lado parece entrar (el contrato lo va a marcar doble): ${JSON.stringify(v)}`);
  v = await escanear(pagina, "AAAAAAAA.BBBBBBBBBBBBBBBB");
  check(v?.kind === "no" && v.detalle === "Esta credencial no es de este evento.", `una credencial falsa no corresponde: ${JSON.stringify(v)}`);
  v = await escanear(pagina, "cualquier cosa");
  check(v?.kind === "no", `un texto cualquiera no corresponde: ${JSON.stringify(v)}`);
  await pagina.tamano(390, 844);
  await capturarVeredicto(pagina, "AAAAAAAA.BBBBBBBBBBBBBBBB", "veredicto-no-corresponde-390x844");
  await pagina.captura("puerta-sin-red-390x844");

  await pagina.ir(`${BASE}/scan`);
  const reabrio = await pagina.waitFor(`__esc.text(".esc-puesto-titulo") === "Puerta"`, 30_000);
  check(reabrio, "sin red, la página vuelve a abrir desde el service worker con el puesto abierto");
  if (reabrio) {
    check(await pagina.waitFor(`__esc.chips().some((c) => c === "2 por sincronizar")`, 10_000), `la cola sobrevivió a la recarga: ${(await pagina.eval(`__esc.chips()`)).join(" | ")}`);
  }

  // ---------- 5. Vuelve la red ----------
  paso("Vuelve la red: la cola se vacía y el doble queda marcado");
  await pagina.tamano(1440, 900);
  await offlineTotal(false);
  sync = await esperarSincronizado(pagina, 180_000);
  check(sync.ok && sync.chips.includes("1 doble, revisar"), `la cola se vació y hay un doble a revisar: ${sync.chips.join(" | ")}`);
  const enCadena2 = await stellar.rumboPass.status(almuerzo.contract, almuerzo.account);
  check(enCadena2.checked_in === true, `en la cadena, ${almuerzo.nombre} figura como entrada`);
  const espejoDoble = await repo.listCheckInsForPass(doble.pass.id);
  check(espejoDoble.length === 1 && espejoDoble[0].duplicate === true && !espejoDoble[0].synced, "el espejo marcó el check-in de la tercera persona como doble");
  const paseDoble = await repo.getPass(doble.pass.id);
  check(paseDoble.status === "checked_in", "y su pase quedó como entrado igual");

  paso("El canje del almuerzo: con red, y sin red la segunda vez");
  check(await cambiarPuesto(pagina, lunchCode, lunch.name), "la mesa del almuerzo, otra vez con su código");
  v = await escanear(pagina, almuerzo.qr);
  check(v?.kind === "ok" && v.titulo === "Canjeado" && v.detalle === lunch.name, `canjeado: ${JSON.stringify(v)}`);
  sync = await esperarSincronizado(pagina);
  check(sync.ok, `el canje llegó al servidor: ${sync.chips.join(" | ")}`);
  const enCadena3 = await stellar.rumboPass.status(almuerzo.contract, almuerzo.account);
  check(enCadena3.redeemed.includes(0), `en la cadena, el almuerzo (beneficio 0) figura canjeado: ${JSON.stringify(enCadena3.redeemed)}`);
  const espejoCanje = await repo.listRedemptionsForPass(almuerzo.pass.id);
  check(espejoCanje.length === 1 && espejoCanje[0].synced && espejoCanje[0].benefitId === lunch.id, "el espejo tiene el canje sincronizado");
  await offlineTotal(true);
  await pagina.waitFor(`__esc.chips().includes("Sin conexión")`, 10_000);
  v = await escanear(pagina, almuerzo.qr);
  check(v?.kind === "already" && v.titulo === "Ya canjeado", `sin red, el segundo intento dice ya canjeado: ${JSON.stringify(v)}`);
  await pagina.tamano(390, 844);
  await capturarVeredicto(pagina, almuerzo.qr, "veredicto-ya-canjeado-390x844");
  await pagina.tamano(1440, 900);
  await offlineTotal(false);

  paso("Pendientes de un puesto al abrir otro: la entrada de la puerta viaja con el código de la puerta, no con el de la mesa");
  check(await cambiarPuesto(pagina, gateCode, "Puerta"), "la puerta otra vez");
  await offlineTotal(true);
  await pagina.waitFor(`__esc.chips().includes("Sin conexión")`, 10_000);
  v = await escanear(pagina, cambio.qr);
  check(v?.kind === "ok" && v.titulo === "Entró", `sin red, ${cambio.nombre} entra: ${JSON.stringify(v)}`);
  check(await pagina.waitFor(`__esc.chips().some((c) => c === "1 por sincronizar")`, 5_000), "queda 1 por sincronizar");
  await pagina.eval(`__esc.clickText("Cerrar el puesto")`);
  check(await pagina.waitFor(`document.querySelector("#esc-codigo")`, 20_000), "el voluntario cierra la puerta con la entrada pendiente (acepta el aviso)");
  await offlineTotal(false);
  await abrirPuesto(pagina, lunchCode);
  check(await pagina.waitFor(`__esc.text(".esc-puesto-titulo") === ${JSON.stringify(lunch.name)}`, 30_000), "y abre la mesa del almuerzo, ya con red");
  sync = await esperarSincronizado(pagina, 120_000);
  check(sync.ok && !sync.chips.some((c) => c.includes("sin registrar")), `la entrada pendiente de la puerta se sincronizó desde la mesa, sin rechazos: ${sync.chips.join(" | ")}`);
  const espejoCambio = await repo.listCheckInsForPass(cambio.pass.id);
  check(espejoCambio.length === 1 && espejoCambio[0].synced && !espejoCambio[0].duplicate, "el espejo tiene la entrada de la puerta sincronizada");
  const enCadenaCambio = await stellar.rumboPass.status(cambio.contract, cambio.account);
  check(enCadenaCambio.checked_in === true, `en la cadena, ${cambio.nombre} figura como entrada`);

  paso("El interruptor de simular sin conexión: solo con ?demo=1; frena la sincronización y al apagarlo vuelve");
  check(await cambiarPuesto(pagina, gateCode, "Puerta"), "la puerta otra vez");
  const hayInterruptor = `[...document.querySelectorAll("label")].some((l) => l.textContent.includes("Simular sin conexión"))`;
  check(!(await pagina.eval(hayInterruptor)), "sin ?demo=1 el voluntario no ve el interruptor");
  await pagina.ir(`${BASE}/scan?lang=es&demo=1`);
  check(await pagina.waitFor(`__esc.text(".esc-puesto-titulo") === "Puerta"`, 30_000), "con ?demo=1 la página vuelve con el puesto abierto");
  await modoEscribir(pagina);
  check(await pagina.eval(hayInterruptor), "y con ?demo=1 el interruptor aparece");
  await pagina.eval(`__esc.clickText("Simular sin conexión")`);
  check(await pagina.waitFor(`__esc.chips().includes("Sin conexión")`, 5_000), "con el interruptor la pantalla dice sin conexión");
  v = await escanear(pagina, gratis.qr);
  check(v?.kind === "already", "y los veredictos siguen saliendo");
  await pagina.eval(`__esc.clickText("Simular sin conexión")`);
  sync = await esperarSincronizado(pagina, 30_000);
  check(sync.ok, `al apagarlo vuelve a sincronizar: ${sync.chips.join(" | ")}`);

  // ---------- 7. Las tres pantallas ----------
  paso("Las medidas: sin scroll horizontal y la acción a la vista en 1440x900, 973x700 y 390x844");
  const TAMANOS = [
    [1440, 900],
    [973, 700],
    [390, 844],
  ];
  await modoEscribir(pagina);
  for (const [w, h] of TAMANOS) {
    await pagina.tamano(w, h);
    const m = await pagina.eval(`__esc.medir()`);
    check(m.scrollAncho <= m.ancho && m.accion?.visible, `puerta (escribir el código) ${w}x${h}: scroll ${m.scrollAncho}/${m.ancho}, acción ${JSON.stringify(m.accion)}`);
    await pagina.captura(`puerta-texto-${w}x${h}`);
  }
  await pagina.eval(`__esc.clickText("Usar la cámara")`);
  await pagina.waitFor(`document.querySelector(".esc-camara")`, 10_000);
  for (const [w, h] of TAMANOS) {
    await pagina.tamano(w, h);
    const m = await pagina.eval(`__esc.medir()`);
    check(m.scrollAncho <= m.ancho && m.accion?.visible, `puerta (cámara) ${w}x${h}: scroll ${m.scrollAncho}/${m.ancho}, cámara ${JSON.stringify(m.accion)}`);
    await pagina.captura(`puerta-camara-${w}x${h}`);
  }
  await pagina.eval(`__esc.clickText("Cerrar el puesto")`);
  await pagina.waitFor(`document.querySelector("#esc-codigo")`, 20_000);
  for (const [w, h] of TAMANOS) {
    await pagina.tamano(w, h);
    const m = await pagina.eval(`__esc.medir()`);
    check(m.scrollAncho <= m.ancho && m.accion?.visible, `el código del puesto ${w}x${h}: scroll ${m.scrollAncho}/${m.ancho}, acción ${JSON.stringify(m.accion)}`);
    await pagina.captura(`elegir-${w}x${h}`);
  }

  paso("En inglés");
  await pagina.tamano(1440, 900);
  await pagina.ir(`${BASE}/scan?lang=en`);
  check(await pagina.waitFor(`__esc.text("h1") === "Scanner"`, 30_000), "la pantalla del código sale en inglés");
  check(await pagina.waitFor(`__esc.text(".pantalla-accion .boton") === "Open the station"`, 5_000), "y el botón también");

  const erroresReales = pagina.errores.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|Failed to load resource|NetworkError|Load failed/i.test(e));
  check(erroresReales.length === 0, `sin errores de consola fuera de los de red cortada (${pagina.errores.length} en total, ${erroresReales.length} reales)`);
  if (erroresReales.length) for (const e of erroresReales.slice(0, 10)) console.log(`    ${e.slice(0, 200)}`);
} catch (error) {
  fallas.push(`la prueba se cortó: ${error.message}`);
  console.error(error);
} finally {
  await nav.cerrar();
}

console.log(`\n${fallas.length === 0 ? "TODO BIEN" : `${fallas.length} FALLA(S)`} en ${Math.round((Date.now() - t0) / 1000)} s. Capturas en ${CAPTURAS}`);
for (const f of fallas) console.log(`  - ${f}`);
process.exit(fallas.length === 0 ? 0 : 1);
