// Capturas de publicar rápido y de coorganizar con Chrome sin interfaz, en 1440x900 y 390x844, en castellano y en
// inglés, con el tema claro y el oscuro: el borrador con el enlace del evento y "Ver cómo va a quedar", la vista
// previa, el enlace que ya tiene otro evento, la pantalla de publicar en el medio, recién publicada (con las
// credenciales del equipo en curso) y al final, el panel con "Tu equipo" y el enlace de invitación recién creado, la
// invitación sin sesión, con sesión y vencida, y Mis eventos con un evento propio y uno coorganizado. Además
// comprueba que la vista previa de un borrador sin acceso no existe (404). Cada captura mide que no haya scroll
// horizontal y que la acción principal quede a la vista; las medidas quedan en medidas.txt.
// CAPTURAS_COMBOS=es-claro-390,en-oscuro-1440 elige combinaciones.
//
//   node scripts/capturas-publicar.mjs [--salida data/capturas-publicar] [--app-port 3500] [--port 9500]
//
// NO toca la red de prueba de Stellar: levanta la app adentro de este proceso, con una base propia y vacía, y los
// contratos los crea un desplegador de mentira (globalThis.__rumboProvisioner) que tarda unos segundos, para que se
// vea el avance. Entrar como organizador lo hace el mismo Pollar de mentira de capturas-organizador.mjs.
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
const SALIDA = option("--salida", join(APP_DIR, "data", "capturas-publicar"));
const APP_PORT = Number(option("--app-port", 3500));
const CDP_PORT = Number(option("--port", process.env.CDP_PORT || 9500));
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
const datos = mkdtempSync(join(tmpdir(), "rumbo-capturas-publicar-"));
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


const co = await import("../src/server/coorganizar.ts");

/** El desplegador de mentira: tarda `demora` por contrato, así la pantalla de publicar se ve en el medio. */
let demora = 3000;
let contratos = 0;
globalThis.__rumboProvisioner = {
  deploy: async () => {
    await sleep(demora);
    return `CCAPTURA${++contratos}`;
  },
  allow: async () => ({ ok: false, reason: "not_configured", detail: null }),
};

const TEXTOS = {
  es: { entrar: "Entrar al panel", verComo: "Ver cómo va a quedar", publicado: "Tu evento ya está publicado", equipoListo: "también están listas", tuEquipo: "Tu equipo", crearEnlace: "Crear un enlace de invitación", sumarme: "Sumarme al equipo de este evento", noSirve: "ya no sirve", coorganizas: "Coorganizás", tuCuenta: "Tu cuenta", vista: "Vista previa", entrarPrimero: "Te invitaron a coorganizar" },
  en: { entrar: "Open my panel", verComo: "See how it will look", publicado: "Your event is published", equipoListo: "ready too", tuEquipo: "Your team", crearEnlace: "Create an invitation link", sumarme: "Join this event's team", noSirve: "no longer works", coorganizas: "Co-organizer", tuCuenta: "Your account", vista: "Preview", entrarPrimero: "You were invited to co-organize" },
};
const OTRAS = { camila: { first: "Camila", last: "Rojas", mail: "camila.rojas" }, beto: { first: "Beto", last: "Prueba", mail: "beto.prueba" } };

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
const bajarA = (selector) => cdp.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({ block: "start" }); window.scrollBy(0, -16); return true; })()`);
const salirDeLaCuenta = () => cdp.eval(`fetch("/api/organizador/salir", { method: "POST", redirect: "manual" }).then((r) => r.status)`);

/** Entra como organizador con una llave nueva desde la página abierta (la puerta de /admin o la de una invitación). */
async function entrarCon(t, perfil) {
  llave = Keypair.random();
  await poner(conectada(perfil));
  await textoVisible(t.entrar);
  await sleep(200);
  // Si el primer clic llega antes de que la página termine de cargar, se vuelve a tocar.
  for (let intento = 0; intento < 3; intento++) {
    await clickTexto(t.entrar);
    await cdp.waitFor(`!document.body.innerText.includes(${JSON.stringify(t.entrar)})`, 15_000);
    for (let i = 0; i < 20; i++) {
      const organizador = await repo.getOrganizerByAccount(llave.publicKey());
      if (organizador) {
        await sleep(800);
        return organizador;
      }
      await sleep(250);
    }
  }
  return null;
}

try {
  for (const { lang, oscuro, w, h, sufijo } of elegidos) {
    const t = TEXTOS[lang];
    await tamano(w, h);
    await tema(oscuro);

    paso(`${sufijo}: la dueña entra y tiene un borrador`);
    await ir(`${BASE}/admin?lang=${lang}`);
    const dueña = await entrarCon(t, { ...PERSONAS[lang], mail: `${PERSONAS[lang].mail}.${w}@example.com` });
    if (!dueña) throw new Error("la dueña no quedó en la base");
    const nombre = lang === "es" ? `Meetup de la comunidad, ${oscuro ? "noche" : "día"} ${w}` : `Community meetup, ${oscuro ? "night" : "day"} ${w}`;
    const evento = await createEventFromTemplate(repo, plantillaDe(lang, nombre, dueña.id));

    paso(`${sufijo}: el borrador con el enlace y la vista previa`);
    await ir(`${BASE}/admin/${evento.slug}/armar?lang=${lang}`);
    await textoVisible(t.verComo);
    await capturar(`20-borrador-enlace-${sufijo}`, ".armar-vista .boton");
    await ir(`${BASE}/admin/${evento.slug}/armar?lang=${lang}&error=direccion-ocupada`);
    await bajarA("#armar-direccion");
    await sleep(200);
    await capturar(`21-borrador-enlace-ocupado-${sufijo}`, ".armar-vista .boton");
    await ir(`${BASE}/e/${evento.slug}?vista=1&lang=${lang}`);
    const vista = await textoVisible(t.vista);
    if (!vista.ok) problemas.push(`${sufijo}: la vista previa no muestra su aviso`);
    if (await cdp.eval(`!!document.querySelector('.evento a[href*="/inscripcion"]')`)) problemas.push(`${sufijo}: la vista previa deja inscribirse`);
    await capturar(`22-vista-previa-${sufijo}`, ".vista-previa a");
    const ajeno = await fetch(`${BASE}/e/${evento.slug}?vista=1`);
    if (ajeno.status !== 404) problemas.push(`${sufijo}: la vista previa sin acceso contestó ${ajeno.status}, no 404`);
    const sinVista = await fetch(`${BASE}/e/${evento.slug}`);
    if (sinVista.status !== 404) problemas.push(`${sufijo}: el borrador sin ?vista contestó ${sinVista.status}, no 404`);

    paso(`${sufijo}: publicar, con el avance a la vista`);
    demora = 3500;
    await ir(`${BASE}/admin/${evento.slug}/publicando?lang=${lang}`);
    const medio = await cdp.waitFor(`document.querySelector(".publicando-cifra")`, 20_000);
    if (!medio.ok) problemas.push(`${sufijo}: la pantalla de publicar no mostró el avance`);
    await sleep(600);
    await capturar(`23-publicando-medio-${sufijo}`, ".pantalla-accion .boton");
    const abierto = await textoVisible(t.publicado);
    if (!abierto.ok) problemas.push(`${sufijo}: la pantalla no dijo que el evento quedó publicado`);
    await cdp.waitFor(`document.querySelector(".publicando-equipo .barra")`, 10_000);
    await sleep(300);
    await capturar(`24-publicado-equipo-en-curso-${sufijo}`, ".pantalla-accion .boton-primario");
    const listo = await cdp.waitFor(`document.body.innerText.includes(${JSON.stringify(t.equipoListo)})`, 60_000);
    if (!listo.ok) problemas.push(`${sufijo}: las credenciales del equipo no terminaron`);
    await capturar(`25-publicado-final-${sufijo}`, ".pantalla-accion .boton-primario");

    paso(`${sufijo}: el panel con Tu equipo`);
    const ana = await repo.upsertOrganizer({ publicKey: Keypair.random().publicKey(), provider: "pollar", name: lang === "es" ? "Ana Quiroga" : "Ann Quiroga" });
    await co.acceptInvite((await co.createInvite(evento, dueña)).token, ana, evento);
    await co.createInvite(evento, dueña);
    await co.authorizeAccount(evento, dueña, Keypair.random().publicKey());
    await ir(`${BASE}/admin/${evento.slug}?lang=${lang}`);
    await textoVisible(t.tuEquipo);
    await bajarA(".tu-equipo");
    await sleep(300);
    await capturar(`26-panel-tu-equipo-${sufijo}`, ".tu-equipo .boton");
    await clickTexto(t.crearEnlace);
    const enlace = await cdp.waitFor(`document.querySelector(".tu-equipo .compartir-enlace input")?.value.includes("/admin/invitacion/")`, 15_000);
    if (!enlace.ok) problemas.push(`${sufijo}: Crear un enlace de invitación no mostró el enlace`);
    await bajarA(".tu-equipo");
    await sleep(300);
    await capturar(`27-panel-invitacion-creada-${sufijo}`, ".tu-equipo .compartir-enlace .boton");

    paso(`${sufijo}: la invitación, sin sesión, con sesión y vencida`);
    const invitacion = await co.createInvite(evento, dueña);
    await salirDeLaCuenta();
    await ir(`${BASE}${co.invitePath(invitacion.token)}?lang=${lang}`);
    const puerta = await textoVisible(t.entrarPrimero);
    if (!puerta.ok) problemas.push(`${sufijo}: la invitación sin sesión no ofrece entrar`);
    await capturar(`28-invitacion-sin-sesion-${sufijo}`, ".cuenta-organizador .boton-primario");
    const camila = await entrarCon(t, { ...OTRAS.camila, mail: `${OTRAS.camila.mail}.${w}@example.com` });
    if (!camila) problemas.push(`${sufijo}: la segunda cuenta no quedó en la base`);
    const sumarme = await textoVisible(t.sumarme);
    if (!sumarme.ok) problemas.push(`${sufijo}: después de entrar no volvió a la invitación con "Sumarme"`);
    await sleep(300);
    await capturar(`29-invitacion-con-sesion-${sufijo}`, ".pantalla-accion .boton-primario");
    await clickTexto(t.sumarme);
    const alPanel = await cdp.waitFor(`location.pathname === ${JSON.stringify(`/admin/${evento.slug}`)}`, 30_000);
    if (!alPanel.ok) problemas.push(`${sufijo}: aceptar no llevó al panel del evento`);
    await sleep(800);
    if (await cdp.eval(`!!document.querySelector(".tu-equipo")`)) problemas.push(`${sufijo}: quien coorganiza ve Tu equipo`);

    // Para ver "vencida" hace falta una cuenta que no esté en el equipo (a quien ya está, la invitación lo lleva al panel).
    const vieja = await co.createInvite(evento, dueña, Date.now() - co.INVITE_TTL_MS - 60_000);
    await salirDeLaCuenta();
    await ir(`${BASE}/admin?lang=${lang}`);
    const beto = await entrarCon(t, { ...OTRAS.beto, mail: `${OTRAS.beto.mail}.${w}@example.com` });
    if (!beto) throw new Error("la tercera cuenta no quedó en la base");
    await ir(`${BASE}${co.invitePath(vieja.token)}?lang=${lang}`);
    const vencida = await textoVisible(t.noSirve);
    if (!vencida.ok) problemas.push(`${sufijo}: la invitación vencida no lo dice`);
    await capturar(`30-invitacion-vencida-${sufijo}`, ".pantalla-accion .boton-primario");

    paso(`${sufijo}: Mis eventos con uno propio y uno coorganizado`);
    await createEventFromTemplate(repo, plantillaDe(lang, lang === "es" ? `Taller de Beto ${w}` : `Beto workshop ${w}`, beto.id));
    await co.acceptInvite((await co.createInvite(evento, dueña)).token, beto, evento);
    await ir(`${BASE}/admin?lang=${lang}`);
    const etiqueta = await textoVisible(t.coorganizas);
    if (!etiqueta.ok) problemas.push(`${sufijo}: Mis eventos no marca el evento coorganizado`);
    if (!(await cdp.eval(`document.body.innerText.includes(${JSON.stringify(t.tuCuenta)})`))) problemas.push(`${sufijo}: Mis eventos no muestra tu cuenta`);
    await sleep(300);
    await capturar(`31-mis-eventos-coorganizo-${sufijo}`, ".pantalla-accion .boton-primario");
    await salirDeLaCuenta();
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
