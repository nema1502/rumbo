// Capturas de la cuenta de organizador con Chrome sin interfaz, en 1440x900 y 390x844, en castellano y en inglés,
// con el tema claro y el oscuro: /admin sin sesión (Entrar con Google o con mi correo), el formulario del correo,
// la cuenta que ya entró, Mis eventos vacío y con eventos, /admin/nuevo con la cuenta, el panel propio (Mis eventos
// arriba, Compartir el panel con el enlace, Cerrar sesión), el borrador, el tope alcanzado, la sesión que vence con
// el panel abierto, la puerta del panel y la vuelta después de entrar, /admin/nuevo sin sesión, el inicio, y /admin
// y el inicio con Pollar apagado. Cada captura mide que no haya scroll horizontal y que la acción principal quede a
// la vista; las medidas quedan en medidas.txt. CAPTURAS_COMBOS=es-claro-390,en-oscuro-1440 elige combinaciones.
//
//   node scripts/capturas-organizador.mjs [--salida data/capturas-organizador] [--app-port 3480] [--port 9380]
//
// NO toca la red de prueba de Stellar: levanta la app adentro de este proceso, con una base propia y vacía, Pollar
// prendido y la clave de la casa puesta (para que se vea que con la cuenta no hace falta). Entrar lo hace un cliente
// de Pollar de mentira en la página (window.__rumboPollarFalso, que la app mira solo en desarrollo): lo que firmaría
// Pollar lo firma acá una llave local, por un puente de DevTools, así la sesión se abre por la ruta real.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_DIR } from "./lib/env.mjs";
import { launch, sleep } from "./lib/browser.mjs";

process.chdir(APP_DIR);

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SALIDA = option("--salida", join(APP_DIR, "data", "capturas-organizador"));
const APP_PORT = Number(option("--app-port", 3480));
const CDP_PORT = Number(option("--port", process.env.CDP_PORT || 9380));
const BASE = `http://127.0.0.1:${APP_PORT}`;
mkdirSync(SALIDA, { recursive: true });

// ---------- Un entorno propio, sin llaves de Stellar y sin red ----------

/** Solo la clave publicable de Pollar, de .env.local: no es secreta (va al navegador) y nada más se lee de ahí. */
function clavePublicable() {
  try {
    const linea = readFileSync(join(APP_DIR, ".env.local"), "utf8").split(/\r?\n/).find((l) => l.startsWith("NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY="));
    return linea ? linea.slice(linea.indexOf("=") + 1).trim() : "";
  } catch {
    return "";
  }
}
const datos = mkdtempSync(join(tmpdir(), "rumbo-capturas-organizador-"));
Object.assign(process.env, {
  RUMBO_DATA_DIR: datos,
  RUMBO_REPO: "sqlite",
  RUMBO_MAILER: "dev",
  RUMBO_ACCOUNTS: "pollar",
  NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY: clavePublicable() || "pk_capturas",
  RUMBO_CREATE_KEY: "la-clave-de-la-casa",
  STELLAR_NETWORK: "testnet",
  NEXT_PUBLIC_BASE_URL: BASE,
  STELLAR_RPC_URL: "http://127.0.0.1:9",
  STELLAR_HORIZON_URL: "http://127.0.0.1:9",
  STELLAR_FRIENDBOT_URL: "http://127.0.0.1:9",
});
for (const name of ["STELLAR_SPONSOR_SECRET", "STELLAR_GATE_SECRET", "STELLAR_ISSUER_SECRET", "STELLAR_ORGANIZER_SECRET", "STELLAR_TREASURY_SECRET", "POLLAR_SECRET_KEY"]) delete process.env[name];

const { Keypair } = await import("@stellar/stellar-sdk");
const { sep53Digest } = await import("../src/server/cuenta-propia.ts");
const { getRepo } = await import("../src/server/repo.ts");
const { createEventFromTemplate } = await import("../src/server/kit/plantillas.ts");
const repo = getRepo();

// ---------- La app, adentro de este proceso ----------

const { default: crearApp } = await import("next");
const app = crearApp({ dev: true, dir: APP_DIR, hostname: "127.0.0.1", port: APP_PORT });
await app.prepare();
const servidor = createServer(app.getRequestHandler());
await new Promise((resolve) => servidor.listen(APP_PORT, "127.0.0.1", resolve));
console.log(`La app, con datos propios y Pollar prendido, en ${BASE} (${datos})`);

// ---------- El navegador ----------

const TAMANOS = [
  [1440, 900],
  [390, 844],
];
const medidas = [];
const problemas = [];
const t0 = Date.now();
const paso = (texto) => console.log(`\n> ${texto}  (${Math.round((Date.now() - t0) / 1000)} s)`);

const browser = await launch({ port: CDP_PORT, width: 1440, height: 900 });
const cdp = await browser.open("about:blank");
await cdp.send("Runtime.enable");
await cdp.send("Page.enable");

// El puente: la página pide una firma (window.rumboFirmar) y acá se contesta con la llave local.
let llave = Keypair.random();
cdp.ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method !== "Runtime.bindingCalled" || msg.params.name !== "rumboFirmar") return;
  const pedido = JSON.parse(msg.params.payload);
  const valor =
    pedido.tipo === "sep53"
      ? { status: "signed", signature: Buffer.from(llave.sign(sep53Digest(pedido.message))).toString("base64"), signerAddress: llave.publicKey(), scheme: "sep53" }
      : { status: "error", code: "UNSUPPORTED" };
  void cdp.eval(`window.__pollarRespuesta(${pedido.id}, ${JSON.stringify(valor)})`).catch(() => undefined);
});
await cdp.send("Runtime.addBinding", { name: "rumboFirmar" });

// El cliente de Pollar de mentira: los mismos métodos que usa la app, con el estado que pone la corrida.
const FALSO = `(() => {
  const subs = { auth: new Set(), wallet: new Set() };
  const s = { auth: { step: "idle" }, wallet: null, provisioning: null, profile: null };
  const pendientes = new Map();
  let n = 0;
  const pedir = (tipo, datos) => new Promise((resolve) => {
    const id = ++n;
    pendientes.set(id, resolve);
    window.rumboFirmar(JSON.stringify({ id, tipo, ...datos }));
  });
  window.__pollarRespuesta = (id, valor) => { const r = pendientes.get(id); pendientes.delete(id); if (r) r(valor); };
  window.__rumboPollarFalso = {
    ready: async () => undefined,
    getAuthState: () => s.auth,
    onAuthStateChange: (cb) => { subs.auth.add(cb); cb(s.auth); return () => subs.auth.delete(cb); },
    onWalletStateChange: (cb) => { subs.wallet.add(cb); if (s.provisioning) cb(s.provisioning); return () => subs.wallet.delete(cb); },
    getWallet: () => s.wallet,
    getUserProfile: () => s.profile,
    login: () => undefined,
    verifyEmailCode: () => undefined,
    cancelLogin: () => undefined,
    logout: async () => window.__pollarFalso.set({ auth: { step: "idle" }, wallet: null, profile: null }),
    setTrustline: async () => ({ status: "error" }),
    signAuthEntry: async () => ({ status: "error" }),
    stellar: { sep53: { signMessage: (message) => pedir("sep53", { message }) }, sep10: { sign: async () => ({ status: "error" }) } },
  };
  window.__pollarFalso = {
    set(patch) {
      Object.assign(s, patch);
      if ("provisioning" in patch) for (const cb of subs.wallet) cb(s.provisioning);
      for (const cb of subs.auth) cb(s.auth);
    },
  };
})()`;
await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: FALSO });
const poner = (estado) => cdp.eval(`window.__pollarFalso.set(${JSON.stringify(estado)})`);

let actual = { w: 1440, h: 900 };
async function tamano(w, h) {
  actual = { w, h };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await sleep(250);
}
async function tema(oscuro) {
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: oscuro ? "dark" : "light" }] });
}
async function ir(url) {
  await cdp.send("Page.navigate", { url });
  await cdp.waitFor(`document.readyState === "complete"`, 120_000);
  await cdp.eval(`document.fonts ? document.fonts.ready.then(() => true) : true`);
  await sleep(500);
}
const clickTexto = (texto) =>
  cdp.eval(`(() => {
  const el = [...document.querySelectorAll("button, a")].find((e) => e.textContent.trim() === ${JSON.stringify(texto)});
  if (!el) return false;
  el.click();
  return true;
})()`);
const textoVisible = (texto) => cdp.waitFor(`document.body.innerText.includes(${JSON.stringify(texto)})`, 30_000);

async function medir(nombre, selectorAccion) {
  const m = await cdp.eval(`(() => {
    const el = ${JSON.stringify(selectorAccion)} ? document.querySelector(${JSON.stringify(selectorAccion)}) : null;
    const r = el ? el.getBoundingClientRect() : null;
    const ancho = ${actual.w}, alto = ${actual.h};
    return {
      scroll: document.documentElement.scrollWidth, ancho, alto,
      accion: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), visible: r.top >= 0 && r.bottom <= alto && r.right <= ancho && r.width > 0 } : null,
    };
  })()`);
  const sinScroll = m.scroll <= m.ancho;
  const accion = selectorAccion ? (m.accion ? (m.accion.visible ? "a la vista" : `FUERA (${m.accion.top} a ${m.accion.bottom} de ${m.alto})`) : "NO ESTÁ") : "sin acción que medir";
  const linea = `${nombre}: scroll ${sinScroll ? "ok" : `NO (${m.scroll} > ${m.ancho})`}, acción ${accion}`;
  medidas.push(linea);
  if (!sinScroll || (selectorAccion && (!m.accion || !m.accion.visible))) problemas.push(linea);
}
async function capturar(nombre, accion = ".pantalla-accion .boton-primario") {
  await cdp.screenshot(join(SALIDA, `${nombre}.png`));
  await medir(nombre, accion);
}

const TEXTOS = {
  es: {
    correo: "Entrar con mi correo",
    entrar: "Entrar al panel",
    misEventos: "Mis eventos",
    vacio: "Todavía no tenés eventos",
    salir: "Cerrar sesión",
    clave: "Clave de la casa",
    aNombre: "a nombre de tu cuenta",
    compartir: "Compartir el panel",
    verEnlace: "Ver el enlace",
    vencida: "Sesión vencida",
    comoOrganizador: "Entrar como organizador",
    volver: "volver al panel de tu evento",
    tope: "el máximo por cuenta",
    paneles: "Paneles",
    panelDeQuien: "Panel de quien organiza",
  },
  en: {
    correo: "Sign in with my email",
    entrar: "Open my panel",
    misEventos: "My events",
    vacio: "You have no events yet",
    salir: "Sign out",
    clave: "House key",
    aNombre: "under your account",
    compartir: "Share the panel",
    verEnlace: "Show the link",
    vencida: "Session expired",
    comoOrganizador: "Sign in as organizer",
    volver: "get back to your event's panel",
    tope: "the most per account",
    paneles: "Panels",
    panelDeQuien: "Organizer panel",
  },
};
const PERSONAS = { es: { first: "Lucía", last: "Fernández", mail: "lucia.fernandez" }, en: { first: "Lucy", last: "Fernandez", mail: "lucy.fernandez" } };
const conectada = (perfil) => ({
  auth: { step: "authenticated", session: {}, verified: true },
  wallet: { custody: "internal", address: llave.publicKey(), provider: "google", provisioning: "READY" },
  provisioning: "READY",
  profile: { mail: perfil.mail, first_name: perfil.first, last_name: perfil.last, avatar: "", providers: { email: null, google: { id: "1" }, github: null, wallet: null } },
});

/** Las combinaciones de idioma, tema y tamaño: todas, o las que diga CAPTURAS_COMBOS ("es-claro-390,en-oscuro-1440"). */
const COMBOS = [];
for (const lang of ["es", "en"]) for (const oscuro of [false, true]) for (const [w, h] of TAMANOS) COMBOS.push({ lang, oscuro, w, h, sufijo: `${lang}-${oscuro ? "oscuro" : "claro"}-${w}` });
const pedidos = (process.env.CAPTURAS_COMBOS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const elegidos = pedidos.length ? COMBOS.filter((c) => pedidos.includes(c.sufijo)) : COMBOS;

const { getDb } = await import("../src/server/base/index.ts");
const plantillaDe = (lang, nombre, organizerId) => ({
  template: "meetup",
  lang,
  name: nombre,
  startsAtLocal: "2026-12-05T19:00",
  place: "Santa Cruz de la Sierra",
  venue: lang === "es" ? "Casa de la comunidad" : "Community house",
  organizerName: lang === "es" ? "La comunidad" : "The community",
  organizerId,
});
const bajarA = (selector) => cdp.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({ block: "center" }); return true; })()`);
const arriba = () => cdp.eval(`(() => { window.scrollTo(0, 0); return true; })()`);
const salirDeLaCuenta = () => cdp.eval(`fetch("/api/organizador/salir", { method: "POST", redirect: "manual" }).then((r) => r.status)`);

try {
  for (const { lang, oscuro, w, h, sufijo } of elegidos) {
    const t = TEXTOS[lang];
    await tamano(w, h);
    await tema(oscuro);
    llave = Keypair.random();

    paso(`${sufijo}: /admin sin sesión`);
    await ir(`${BASE}/admin?lang=${lang}`);
    await textoVisible(t.correo);
    await sleep(300);
    await capturar(`01-entrar-${sufijo}`, ".pantalla-cuerpo .boton-primario");
    await clickTexto(t.correo);
    await sleep(400);
    await capturar(`02-correo-${sufijo}`, ".cuenta-correo .boton-primario");

    paso(`${sufijo}: la cuenta entró, y abre sus eventos`);
    await ir(`${BASE}/admin?lang=${lang}`);
    const perfil = { ...PERSONAS[lang], mail: `${PERSONAS[lang].mail}.${w}@example.com` };
    await poner(conectada(perfil));
    await textoVisible(t.entrar);
    await sleep(300);
    await capturar(`03-entraste-${sufijo}`, ".pantalla-accion .boton-primario");
    await clickTexto(t.entrar);
    const vacio = await textoVisible(t.vacio);
    if (!vacio.ok) problemas.push(`${sufijo}: después de entrar no apareció Mis eventos vacío`);
    await sleep(400);
    await capturar(`04-mis-eventos-vacio-${sufijo}`, ".pantalla-accion .boton-primario");

    paso(`${sufijo}: crear con la cuenta (sin la clave de la casa)`);
    await ir(`${BASE}/admin/nuevo?plantilla=meetup&lang=${lang}`);
    await textoVisible(t.aNombre);
    const pideClave = await cdp.eval(`!!document.querySelector("#clave")`);
    if (pideClave) problemas.push(`${sufijo}: /admin/nuevo sigue pidiendo la clave de la casa con la sesión`);
    await capturar(`05-nuevo-con-cuenta-${sufijo}`, ".pantalla-accion .boton-primario");

    paso(`${sufijo}: Mis eventos con dos eventos, el panel y compartirlo`);
    const organizador = await repo.getOrganizerByAccount(llave.publicKey());
    if (!organizador) throw new Error("la cuenta de organizador no quedó en la base");
    const nombre = lang === "es" ? `Meetup de la comunidad, ${oscuro ? "noche" : "día"} ${w}` : `Community meetup, ${oscuro ? "night" : "day"} ${w}`;
    const evento = await createEventFromTemplate(repo, plantillaDe(lang, nombre, organizador.id));
    await repo.updateEvent(evento.id, { published: true });
    const borrador = await createEventFromTemplate(repo, plantillaDe(lang, lang === "es" ? `Taller en borrador ${w}` : `Draft workshop ${w}`, organizador.id));
    await ir(`${BASE}/admin?lang=${lang}`);
    await textoVisible(nombre);
    await sleep(300);
    await capturar(`06-mis-eventos-${sufijo}`, ".pantalla-accion .boton-primario");
    const primarios = await cdp.eval(`document.querySelectorAll(".boton-primario").length`);
    if (primarios !== 1) problemas.push(`${sufijo}: Mis eventos tiene ${primarios} acciones principales`);

    await ir(`${BASE}/admin/${evento.slug}?lang=${lang}`);
    const panel = await textoVisible(t.compartir);
    if (!panel.ok) problemas.push(`${sufijo}: el panel del evento propio no abrió con la sesión, o no ofrece compartirlo`);
    await sleep(500);
    await capturar(`07-panel-${sufijo}`, ".panel-mis-eventos");
    await bajarA(".compartir-panel");
    await clickTexto(t.verEnlace);
    const enlace = await cdp.waitFor(`document.querySelector(".compartir-enlace input")?.value.includes("?k=")`, 15_000);
    if (!enlace.ok) problemas.push(`${sufijo}: Compartir el panel no trajo el enlace con la clave`);
    await bajarA(".compartir-panel");
    await sleep(300);
    await capturar(`08-compartir-${sufijo}`, ".compartir-enlace .boton");
    await bajarA(".panel-salir");
    await sleep(300);
    await capturar(`09-panel-cerrar-sesion-${sufijo}`, ".panel-salir button");

    paso(`${sufijo}: el borrador, con Mis eventos arriba y compartir`);
    await ir(`${BASE}/admin/${borrador.slug}/armar?lang=${lang}`);
    await textoVisible(t.compartir);
    await sleep(300);
    await capturar(`10-armar-${sufijo}`, ".panel-mis-eventos");

    paso(`${sufijo}: el tope alcanzado`);
    await createEventFromTemplate(repo, plantillaDe(lang, lang === "es" ? `Tercer evento ${w}` : `Third event ${w}`, organizador.id));
    await ir(`${BASE}/admin/nuevo?plantilla=meetup&lang=${lang}`);
    const tope = await textoVisible(t.tope);
    if (!tope.ok) problemas.push(`${sufijo}: con el tope alcanzado /admin/nuevo no lo dice`);
    if (await cdp.eval(`!!document.querySelector("#nombre")`)) problemas.push(`${sufijo}: con el tope alcanzado sigue el formulario`);
    await capturar(`11-nuevo-tope-${sufijo}`, ".pantalla-accion .boton-primario");

    paso(`${sufijo}: la sesión vence con el panel abierto`);
    await ir(`${BASE}/admin/${evento.slug}?lang=${lang}`);
    await textoVisible(t.compartir);
    await getDb().run("DELETE FROM organizer_sessions WHERE organizer_id = ?", [organizador.id]);
    const vencio = await textoVisible(t.vencida);
    if (!vencio.ok) problemas.push(`${sufijo}: el panel no avisó que la sesión venció`);
    await arriba();
    await sleep(300);
    await capturar(`12-panel-vencida-${sufijo}`, ".panel .aviso .enlace");

    paso(`${sufijo}: la puerta del panel, y volver a entrar`);
    await ir(`${BASE}/admin/${evento.slug}?lang=${lang}`);
    await textoVisible(t.comoOrganizador);
    await sleep(300);
    await capturar(`13-puerta-${sufijo}`, ".pantalla-accion .boton-primario");
    await clickTexto(t.comoOrganizador);
    const enVolver = await textoVisible(t.volver);
    if (!enVolver.ok) problemas.push(`${sufijo}: /admin?volver= no dice que vuelve al panel`);
    await poner(conectada(perfil));
    await textoVisible(t.entrar);
    await sleep(300);
    await capturar(`14-volver-${sufijo}`, ".pantalla-accion .boton-primario");
    await clickTexto(t.entrar);
    const devuelta = await cdp.waitFor(`location.pathname === ${JSON.stringify(`/admin/${evento.slug}`)} && document.body.innerText.includes(${JSON.stringify(t.compartir)})`, 30_000);
    if (!devuelta.ok) problemas.push(`${sufijo}: después de entrar no volvió al panel del evento`);

    paso(`${sufijo}: sin sesión, crear ofrece entrar primero`);
    const salida = await salirDeLaCuenta();
    if (salida !== 0 && salida !== 303) problemas.push(`${sufijo}: cerrar sesión desde la app contestó ${salida}`);
    await ir(`${BASE}/admin/nuevo?lang=${lang}`);
    await textoVisible(t.comoOrganizador);
    await sleep(300);
    await capturar(`15-nuevo-sin-sesion-${sufijo}`, ".pantalla-accion .boton-primario");
    await ir(`${BASE}/admin/nuevo?plantilla=meetup&lang=${lang}`);
    await textoVisible(t.clave);
    await bajarA("#clave");
    await sleep(300);
    await capturar(`16-nuevo-clave-${sufijo}`, ".pantalla-accion .boton-primario");

    paso(`${sufijo}: el inicio`);
    await ir(`${BASE}/?lang=${lang}`);
    await textoVisible(t.comoOrganizador);
    await bajarA(".inicio-operacion");
    await sleep(300);
    await capturar(`17-inicio-${sufijo}`, null);
  }

  // Con Pollar apagado: /admin es la lista de paneles y el inicio vuelve a "Panel de quien organiza".
  const cuentas = process.env.RUMBO_ACCOUNTS;
  delete process.env.RUMBO_ACCOUNTS;
  try {
    for (const { lang, oscuro, w, h, sufijo } of elegidos) {
      const t = TEXTOS[lang];
      await tamano(w, h);
      await tema(oscuro);
      paso(`${sufijo}: con Pollar apagado`);
      await ir(`${BASE}/admin?lang=${lang}`);
      const paneles = await textoVisible(t.paneles);
      if (!paneles.ok) problemas.push(`${sufijo}: con Pollar apagado /admin no muestra los paneles`);
      await capturar(`18-sin-pollar-admin-${sufijo}`, ".pantalla-accion .boton-primario");
      await ir(`${BASE}/?lang=${lang}`);
      await textoVisible(t.panelDeQuien);
      if (await cdp.eval(`document.body.innerText.includes(${JSON.stringify(t.comoOrganizador)})`)) problemas.push(`${sufijo}: con Pollar apagado el inicio invita a entrar como organizador`);
      await bajarA(".inicio-operacion");
      await sleep(300);
      await capturar(`19-sin-pollar-inicio-${sufijo}`, null);
    }
  } finally {
    process.env.RUMBO_ACCOUNTS = cuentas;
  }
} catch (error) {
  problemas.push(`la corrida se cortó: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
} finally {
  if (cdp.exceptions.length) problemas.push(`errores en la página: ${cdp.exceptions.slice(0, 5).join(" | ")}`);
  writeFileSync(join(SALIDA, "medidas.txt"), `${medidas.join("\n")}\n${problemas.length ? `\nPROBLEMAS\n${problemas.join("\n")}\n` : "\nSin problemas.\n"}`, "utf8");
  console.log(`\n${medidas.join("\n")}`);
  console.log(problemas.length ? `\n${problemas.length} problema(s):\n${problemas.join("\n")}` : "\nSin problemas.");
  await browser.close();
  servidor.close();
  process.exit(problemas.length ? 1 : 0);
}
