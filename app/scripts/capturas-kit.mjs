// Capturas de las pantallas del kit con Chrome sin interfaz, en 1440x900 y 390x844, en castellano y en inglés:
// elegir plantilla, los datos del evento, el borrador, importar la lista (elegir, revisar, listo), el panel con las
// comidas por franja y el tope de las poleras, la inscripción con la dieta, el equipo, la credencial del jurado
// y de un participante, y el escáner (la puerta con un jurado y la comida con una dieta). Cada captura mide que no
// haya scroll horizontal y que la acción principal quede a la vista; las medidas quedan en medidas.txt.
//
//   node scripts/capturas-kit.mjs [--salida data/capturas-kit] [--app-port 4318] [--port 9531]
//
// NO toca la red de prueba de Stellar: levanta la app adentro de este mismo proceso, con una base propia y vacía en
// una carpeta temporal, y le pone cuentas, contrato y correo de mentira (los mismos ganchos que usan las pruebas);
// las direcciones de la red apuntan a un puerto cerrado de esta máquina por si algo se escapara.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const SALIDA = option("--salida", join(APP_DIR, "data", "capturas-kit"));
const APP_PORT = Number(option("--app-port", 4318));
const CDP_PORT = Number(option("--port", 9531));
const BASE = `http://127.0.0.1:${APP_PORT}`;
mkdirSync(SALIDA, { recursive: true });

// ---------- Un entorno propio, sin llaves y sin red ----------

const datos = mkdtempSync(join(tmpdir(), "rumbo-capturas-kit-"));
Object.assign(process.env, {
  RUMBO_DATA_DIR: datos,
  RUMBO_REPO: "sqlite",
  RUMBO_MAILER: "dev",
  STELLAR_NETWORK: "testnet",
  NEXT_PUBLIC_BASE_URL: BASE,
  STELLAR_RPC_URL: "http://127.0.0.1:9",
  STELLAR_HORIZON_URL: "http://127.0.0.1:9",
  STELLAR_FRIENDBOT_URL: "http://127.0.0.1:9",
});
for (const name of ["STELLAR_SPONSOR_SECRET", "STELLAR_GATE_SECRET", "STELLAR_ISSUER_SECRET", "STELLAR_ORGANIZER_SECRET", "STELLAR_TREASURY_SECRET", "RUMBO_CREATE_KEY"]) delete process.env[name];

let registros = 0;
globalThis.__rumboAccounts = {
  kind: "dev",
  getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
  getForPerson: async () => null,
  authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
};
globalThis.__rumboMailer = { kind: "dev", send: async () => ({ id: "capturas" }) };
globalThis.__rumboKitChain = {
  register: async () => ({ hash: `captura-${++registros}`, ledger: 1, returnValue: registros, number: registros }),
  status: async () => ({ has_pass: true, number: registros, checked_in: false, redeemed: [] }),
};

const { getRepo } = await import("../src/server/repo.ts");
const { createEventFromTemplate, TEMPLATES } = await import("../src/server/kit/plantillas.ts");
const { defaultDraft, saveDraft } = await import("../src/server/kit/borrador.ts");
const { publishEvent } = await import("../src/server/kit/publicar.ts");
const { getOrCreateAccessKey } = await import("../src/server/evento/acceso.ts");
const { ensureStationCodes, getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { formatStationCode } = await import("../src/lib/station-code.ts");
const { buildQrPayload } = await import("../src/server/qr.ts");

const repo = getRepo();
let contratos = 0;
const provisor = { deploy: async () => `CCAPTURA${++contratos}` };

const NOMBRES = ["Camila Rojas", "Diego Mamani", "Lucía Fernández", "Andrés Villca", "Sofía Aguilar", "Franco Ibáñez", "Valeria Choque", "Óscar Limachi", "Paola Rivero", "Mateo Condori", "Elena Apaza", "Rodrigo Torrez"];

/** Una hackatón publicada con gente, comidas canjeadas por franja y topes. */
async function hackaton(lang) {
  const base = await createEventFromTemplate(repo, { template: "hackaton", lang, name: lang === "es" ? "Hackatón Nacional 2026" : "National Hackathon 2026", startsAtLocal: "2026-11-27T09:00", place: "Santa Cruz de la Sierra", venue: "Universidad Gabriel René Moreno", organizerName: "GDG Santa Cruz" });
  const borrador = defaultDraft(TEMPLATES.hackaton, lang);
  borrador.benefits["lunch-1"].stock = 150;
  borrador.benefits.sponsorCoffee.stock = 4;
  borrador.benefits.staffMerch.stock = 3;
  await saveDraft(repo, base, borrador, lang);
  await publishEvent(repo, await repo.getEventById(base.id), provisor);
  const event = await repo.getEventById(base.id);
  const tipos = Object.fromEntries((await repo.listTicketTypes(event.id)).map((t) => [t.templateSlot, t]));
  const beneficios = Object.fromEntries((await repo.listBenefits(event.id)).map((b) => [b.templateKey, b]));
  const pases = [];
  const crear = async (slot, name, extra = {}) => {
    const persona = await repo.upsertPerson({ name, email: `${name.toLowerCase().normalize("NFKD").replace(/[^a-z]+/g, ".")}@example.com` });
    let pass = await repo.createPass({ eventId: event.id, personId: persona.id, ticketTypeId: tipos[slot].id, status: "pending", diet: extra.diet ?? null });
    pass = await repo.updatePass(pass.id, { account: `G${pass.id.padEnd(55, "A")}`, status: "active", chainNumber: pases.length + 1 });
    await repo.grantTicketBenefits(pass.id);
    pases.push({ pass, slot, name });
    return pass;
  };
  const equipos = [(await repo.createTeam(event.id, "Los Cóndores")).team, (await repo.createTeam(event.id, "Código Selva")).team, (await repo.createTeam(event.id, "Quinoa Labs")).team];
  const participantes = [];
  for (const [i, nombre] of NOMBRES.entries()) {
    const pass = await crear("attendee", nombre, { diet: i === 9 ? "Vegetariana, alergia al maní" : null });
    await repo.setPassTeam(pass.id, equipos[i % 3].id);
    participantes.push(pass);
  }
  const jurado = await crear("judge", "Marcela Soria");
  await crear("mentor", "Gonzalo Peña");
  await crear("mentor", "Patricia Núñez");
  const voluntarias = [await crear("volunteer", "Vera Salvatierra"), await crear("volunteer", "Iván Roca")];
  // Dos más, ya adentro y sin su polera de staff: con el tope en 3 y dos entregadas, queda una.
  const faltan = [await crear("volunteer", "Cecilia Arce"), await crear("volunteer", "Tomás Vaca")];
  for (const pass of faltan) {
    await repo.updatePass(pass.id, { status: "checked_in", checkedInAt: "2026-11-27T09:25:00.000Z" });
    const ci = await repo.recordCheckIn({ eventId: event.id, passId: pass.id });
    await repo.markCheckIn(ci.id, { synced: true });
  }
  // Quienes ya entraron y lo que canjearon en cada franja.
  const entraron = [...participantes.slice(0, 10), ...voluntarias];
  for (const pass of entraron) {
    await repo.updatePass(pass.id, { status: "checked_in", checkedInAt: "2026-11-27T09:20:00.000Z" });
    const ci = await repo.recordCheckIn({ eventId: event.id, passId: pass.id });
    await repo.markCheckIn(ci.id, { synced: true });
  }
  const canjear = async (clave, quienes) => {
    for (const pass of quienes) {
      const r = await repo.recordRedemption({ eventId: event.id, passId: pass.id, benefitId: beneficios[clave].id });
      await repo.markRedemption(r.id, { synced: true });
    }
  };
  await canjear("breakfast-1", entraron.slice(0, 9));
  // La persona con dieta (la décima) ya entró y todavía no almorzó: es la que pasa por la mesa de la comida.
  await canjear("lunch-1", entraron.slice(0, 9));
  await canjear("snack-1", entraron.slice(0, 8));
  await canjear("dinner-1", entraron.slice(0, 5));
  await canjear("sponsorCoffee", participantes.slice(0, 4));
  await canjear("staffMerch", voluntarias);
  const codigos = await ensureStationCodes(event, repo);
  const codigo = (filtro) => formatStationCode(codigos.find(filtro).code);
  return {
    event,
    jurado,
    participante: participantes[9],
    qrDe: async (pass) => buildQrPayload(pass.id, await repo.getEventQrKey(event.id)),
    claveDe: (pass) => getOrCreateAccessKey(pass.id),
    puerta: codigo((c) => c.kind === "gate"),
    comida: codigo((c) => c.benefitId === beneficios["lunch-1"].id),
    merch: codigo((c) => c.benefitId === beneficios.staffMerch.id),
    faltan,
    ticketGratis: tipos.attendee,
    panelKey: getOrCreateOrganizerKey(event.id),
  };
}

/** Un DevFest publicado, con la credencial de jurado encendida, vacío: es al que se le importa la lista. */
async function devfest(lang, nombre) {
  const base = await createEventFromTemplate(repo, { template: "devfest", lang, name: nombre, startsAtLocal: "2026-12-05T09:00", place: "La Paz", organizerName: "GDG La Paz" });
  const borrador = defaultDraft(TEMPLATES.devfest, lang);
  borrador.slots.judge.included = true;
  borrador.slots.judge.benefits = ["lunch", "snack", "dinner"];
  await saveDraft(repo, base, borrador, lang);
  await publishEvent(repo, await repo.getEventById(base.id), provisor);
  const event = await repo.getEventById(base.id);
  return { event, panelKey: getOrCreateOrganizerKey(event.id) };
}

const datosEs = await hackaton("es");
const datosEn = await hackaton("en");
const devfestEs = await devfest("es", "DevFest La Paz 2026");
const devfestEn = await devfest("en", "DevFest La Paz 2026 EN");

// ---------- La app, adentro de este proceso ----------

const { default: crearApp } = await import("next");
const app = crearApp({ dev: true, dir: APP_DIR, hostname: "127.0.0.1", port: APP_PORT });
await app.prepare();
const servidor = createServer(app.getRequestHandler());
await new Promise((resolve) => servidor.listen(APP_PORT, "127.0.0.1", resolve));
console.log(`La app, con datos propios, en ${BASE} (${datos})`);

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
cdp.ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Page.javascriptDialogOpening") void cdp.send("Page.handleJavaScriptDialog", { accept: true });
});

let actual = { w: 1440, h: 900 };
async function tamano(w, h) {
  actual = { w, h };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await sleep(250);
}
async function ir(ruta, lang) {
  await cdp.send("Page.navigate", { url: `${BASE}${ruta}${ruta.includes("?") ? "&" : "?"}lang=${lang}` });
  await cdp.waitFor(`document.readyState === "complete"`, 120_000);
  await cdp.eval(`document.fonts ? document.fonts.ready.then(() => true) : true`);
  await sleep(500);
}
const set = (sel, value) =>
  cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
const clickTexto = (texto) =>
  cdp.eval(`(() => {
    const el = [...document.querySelectorAll("button, a, label")].find((e) => e.textContent.trim().startsWith(${JSON.stringify(texto)}));
    if (!el) return false;
    el.click();
    return true;
  })()`);

async function medir(nombre, selectorAccion) {
  const m = await cdp.eval(`(() => {
    const el = ${JSON.stringify(selectorAccion)} ? document.querySelector(${JSON.stringify(selectorAccion)}) : null;
    const r = el ? el.getBoundingClientRect() : null;
    const ancho = ${actual.w}, alto = ${actual.h};
    return { scroll: document.documentElement.scrollWidth, ancho, alto, accion: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), visible: r.top >= 0 && r.bottom <= alto && r.right <= ancho && r.width > 0 } : null };
  })()`);
  const sinScroll = m.scroll <= m.ancho;
  const accion = selectorAccion ? (m.accion ? (m.accion.visible ? "a la vista" : `FUERA (${m.accion.top} a ${m.accion.bottom} de ${m.alto})`) : "NO ESTÁ") : "sin acción que medir";
  const linea = `${nombre}: scroll ${sinScroll ? "ok" : `NO (${m.scroll} > ${m.ancho})`}, acción ${accion}`;
  medidas.push(linea);
  if (!sinScroll || (selectorAccion && (!m.accion || !m.accion.visible))) problemas.push(linea);
}
async function capturar(nombre, accion) {
  // La insignia de desarrollo de Next no es parte de la pantalla.
  await cdp.eval(`document.querySelectorAll("nextjs-portal").forEach((e) => e.remove())`);
  await cdp.screenshot(join(SALIDA, `${nombre}.png`));
  await medir(nombre, accion);
}
/** Captura lo que hay en pantalla en los dos tamaños, sin navegar. */
async function enDosTamanos(nombre, lang, accion) {
  for (const [w, h] of TAMANOS) {
    await tamano(w, h);
    await capturar(`${nombre}-${lang}-${w}x${h}`, accion);
  }
}
/** Navega y captura en los dos tamaños. */
async function pantalla(nombre, ruta, lang, accion, { antes = null } = {}) {
  for (const [w, h] of TAMANOS) {
    await tamano(w, h);
    await ir(ruta, lang);
    if (antes) await antes();
    await capturar(`${nombre}-${lang}-${w}x${h}`, accion);
  }
}
const ACCION = ".pantalla-accion .boton";

const T = {
  es: { revisar: "Revisar la lista", seguir: "Seguir", crear: "Crear el borrador", importar: "Importar", escribir: "Escribir el código", abrir: "Abrir el puesto", cerrar: "Cerrar el puesto", verificar: "Verificar", siguiente: "Siguiente", enviar: "Inscribir al equipo", listo: "Listo" },
  en: { revisar: "Review the list", seguir: "Continue", crear: "Create the draft", importar: "Import", escribir: "Type the code", abrir: "Open the station", cerrar: "Close the station", verificar: "Check", siguiente: "Next", enviar: "Sign up the team", listo: "Done" },
};

async function archivoElegido(ruta) {
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#archivo" });
  await cdp.send("DOM.setFileInputFiles", { files: [ruta], nodeId });
}

async function vuelta(lang) {
  const t = T[lang];
  const datosLang = lang === "es" ? datosEs : datosEn;
  const dev = lang === "es" ? devfestEs : devfestEn;
  const eventoH = datosLang.event;
  paso(`Armar el evento en ${lang}`);

  await cdp.send("Network.clearBrowserCookies");
  await pantalla("nuevo-plantillas", "/admin/nuevo", lang, ACCION);
  await pantalla("nuevo-datos", "/admin/nuevo?plantilla=hackaton", lang, ACCION);

  // Se crea de verdad, por el formulario: el borrador queda en la cookie del navegador de esta corrida.
  await tamano(1440, 900);
  await ir("/admin/nuevo?plantilla=taller", lang);
  await set("#ciudad", "Cochabamba");
  await set("#organiza", "Comunidad Tech Cochabamba");
  await clickTexto(t.crear);
  await cdp.waitFor(`location.pathname.endsWith("/armar")`, 60_000);
  await cdp.waitFor(`document.readyState === "complete"`, 30_000);
  const armar = await cdp.eval(`location.pathname`);
  await sleep(500);
  await enDosTamanos("borrador", lang, ACCION);
  // Con una credencial abierta para editar.
  await tamano(1440, 900);
  await cdp.eval(`document.querySelectorAll(".armar-tipo details")[2]?.setAttribute("open", "")`);
  await capturar(`borrador-editando-${lang}-1440x900`, ACCION);

  paso(`Importar la lista en ${lang}`);
  await ir(`/admin/${dev.event.slug}/importar?k=${dev.panelKey}`, lang);
  await enDosTamanos("importar-elegir", lang, ACCION);
  await tamano(1440, 900);
  await archivoElegido(join(APP_DIR, "tests", "fixtures", "luma-invitados.csv.txt"));
  await sleep(300);
  await clickTexto(t.revisar);
  await cdp.waitFor(`document.querySelector(".importar-estados")`, 30_000);
  await sleep(300);
  await enDosTamanos("importar-vista", lang, ACCION);
  await tamano(1440, 900);
  await clickTexto(t.importar);
  const termino = await cdp.waitFor(`document.querySelector(".importar-resumen")`, 120_000);
  if (!termino.ok) problemas.push(`importar (${lang}): no llegó al resumen`);
  await sleep(300);
  await enDosTamanos("importar-listo", lang, ACCION);

  paso(`El panel con las comidas por franja en ${lang}`);
  await ir(`/admin/${eventoH.slug}?k=${datosLang.panelKey}`, lang);
  await cdp.waitFor(`document.querySelector(".panel")`, 30_000);
  await pantalla("panel", `/admin/${eventoH.slug}`, lang, ".panel-accion .boton", { antes: () => cdp.waitFor(`document.querySelector(".panel-franjas")`, 30_000) });
  await ir(`/admin/${dev.event.slug}`, lang);
  await cdp.waitFor(`document.querySelector(".panel")`, 30_000);
  await enDosTamanos("panel-importado", lang, ".panel-accion .boton");

  paso(`La página del evento, la inscripción y el equipo en ${lang}`);
  await cdp.send("Network.clearBrowserCookies");
  await pantalla("evento-hackaton", `/e/${eventoH.slug}`, lang, ".entrada .boton");
  await pantalla("inscripcion-dieta", `/e/${eventoH.slug}/inscripcion?entrada=${datosLang.ticketGratis.id}`, lang, ACCION);
  await pantalla("equipo", `/e/${eventoH.slug}/equipo`, lang, ACCION);
  // Un error de verdad: sin nombre de equipo.
  await tamano(1440, 900);
  await ir(`/e/${eventoH.slug}/equipo`, lang);
  await set("#nombre0", "Ana Prueba");
  await set("#correo0", "ana.prueba@example.com");
  await clickTexto(t.enviar);
  await cdp.waitFor(`document.querySelector(".aviso-alerta")`, 30_000);
  await enDosTamanos("equipo-error", lang, ACCION);

  paso(`La credencial en ${lang}`);
  await pantalla("credencial-jurado", `/p/${datosLang.jurado.id}?k=${encodeURIComponent(datosLang.claveDe(datosLang.jurado))}`, lang, ACCION);
  await pantalla("credencial-participante", `/p/${datosLang.participante.id}?k=${encodeURIComponent(datosLang.claveDe(datosLang.participante))}`, lang, ACCION);

  paso(`El escáner en ${lang}`);
  await tamano(1440, 900);
  await ir("/scan", lang);
  await cdp.waitFor(`document.querySelector("#esc-codigo")`, 30_000);
  await set("#esc-codigo", datosLang.puerta);
  await clickTexto(t.abrir);
  await cdp.waitFor(`document.querySelector(".esc-puesto-titulo")`, 30_000);
  await sleep(800);
  const escribirYVerificar = async (qr, nombre) => {
    await tamano(1440, 900);
    if (!(await cdp.eval(`!!document.querySelector("#esc-credencial")`))) {
      await clickTexto(t.escribir);
      await cdp.waitFor(`document.querySelector("#esc-credencial")`, 10_000);
    }
    await set("#esc-credencial", qr);
    await clickTexto(t.verificar);
    const salio = await cdp.waitFor(`document.querySelector(".esc-veredicto")`, 15_000);
    if (!salio.ok) return void problemas.push(`${nombre} (${lang}): el veredicto no apareció`);
    await sleep(300);
    await enDosTamanos(nombre, lang, ".esc-veredicto-boton");
    await clickTexto(t.siguiente);
    await cdp.waitFor(`!document.querySelector(".esc-veredicto")`, 5_000);
  };
  await escribirYVerificar(await datosLang.qrDe(datosLang.jurado), "escaner-veredicto-jurado");
  await sleep(500);
  await clickTexto(t.cerrar);
  await cdp.waitFor(`document.querySelector("#esc-codigo")`, 20_000);
  await set("#esc-codigo", datosLang.comida);
  await clickTexto(t.abrir);
  await cdp.waitFor(`document.querySelector(".esc-puesto-titulo")`, 30_000);
  await sleep(800);
  await escribirYVerificar(await datosLang.qrDe(datosLang.participante), "escaner-veredicto-dieta");
  // El tope: la última polera de staff, y después ya no queda ninguna.
  await sleep(500);
  await clickTexto(t.cerrar);
  await cdp.waitFor(`document.querySelector("#esc-codigo")`, 20_000);
  await set("#esc-codigo", datosLang.merch);
  await clickTexto(t.abrir);
  await cdp.waitFor(`document.querySelector(".esc-puesto-titulo")`, 30_000);
  await sleep(800);
  await escribirYVerificar(await datosLang.qrDe(datosLang.faltan[0]), "escaner-veredicto-ultima");
  await escribirYVerificar(await datosLang.qrDe(datosLang.faltan[1]), "escaner-veredicto-agotado");
  void armar;
}

try {
  await vuelta("es");
  await vuelta("en");
} catch (error) {
  problemas.push(`la corrida se cortó: ${error.message}`);
  console.error(error);
} finally {
  const errores = [...cdp.exceptions, ...cdp.consoleErrors].filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|NetworkError|Failed to fetch|favicon/i.test(e));
  if (errores.length) {
    problemas.push(`${errores.length} error(es) de consola`);
    for (const e of errores.slice(0, 10)) console.log(`  consola: ${e.slice(0, 200)}`);
  }
  await browser.close();
  await new Promise((resolve) => servidor.close(resolve));
  try {
    rmSync(datos, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    /* la base puede seguir abierta en Windows: queda en la carpeta temporal */
  }
}

writeFileSync(join(SALIDA, "medidas.txt"), `${medidas.join("\n")}\n\n${problemas.length ? `PROBLEMAS (${problemas.length}):\n${problemas.join("\n")}` : "Sin problemas de medida."}\n`, "utf8");
console.log(`\n${medidas.length} capturas en ${SALIDA} (${Math.round((Date.now() - t0) / 1000)} s). ${problemas.length ? `${problemas.length} problema(s):` : "Sin problemas de medida."}`);
for (const p of problemas) console.log(`  - ${p}`);
process.exit(problemas.length ? 1 : 0);
