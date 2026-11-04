// Capturas de cada pantalla de la app con Chrome sin interfaz, en 1440x900, 973x700 y 390x844, en castellano
// y en inglés (y de noche, las principales), con una medida por captura: que no haya scroll horizontal y que la
// acción principal quede a la vista. Inscribe a una persona por idioma contra la red de prueba para tener una
// credencial nueva, la pasa por la puerta del escáner (verde, amarillo) y la lleva a la mesa del almuerzo (no
// corresponde). Las medidas quedan en medidas.txt dentro de la carpeta de salida.
//
//   node scripts/capturas.mjs --base http://127.0.0.1:3000 --salida data/capturas [--port 9480] [--slug hackaton-comunidad]
//
// Hace falta el servidor levantado con la misma carpeta de datos que este script (RUMBO_DATA_DIR) y el evento
// de muestra (pnpm seed). Tarda unos minutos: las dos inscripciones y la entrada son transacciones.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR, loadEnv } from "./lib/env.mjs";
import { launch, sleep } from "./lib/browser.mjs";

process.chdir(APP_DIR);
loadEnv();

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = option("--base", process.env.NEXT_PUBLIC_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const SALIDA = option("--salida", join(APP_DIR, "data", "capturas"));
const PORT = Number(option("--port", process.env.CDP_PORT || 9480));
const SLUG = option("--slug", "hackaton-comunidad");
/** Con --solo <prefijo> se capturan solo las pantallas cuyo nombre empieza así (por ejemplo, --solo informe). */
const SOLO = option("--solo", null)?.split(",") ?? null;
const quiero = (nombre) => !SOLO || SOLO.some((prefijo) => nombre.startsWith(prefijo));
mkdirSync(SALIDA, { recursive: true });

const { getRepo } = await import("../src/server/repo.ts");
const { getOrCreateAccessKey } = await import("../src/server/evento/acceso.ts");
const { ensureStationCodes, getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { formatStationCode } = await import("../src/lib/station-code.ts");
const { buildLiveGrant } = await import("../src/server/qr.ts");
const { getEventQrKeys } = await import("../src/server/qr-keys.ts");
const { buildLivePayload } = await import("../src/lib/qr-live.ts");

const TAMANOS = [
  [1440, 900],
  [973, 700],
  [390, 844],
];
const medidas = [];
const problemas = [];
const t0 = Date.now();
const paso = (texto) => console.log(`\n> ${texto}  (${Math.round((Date.now() - t0) / 1000)} s)`);

// ---------- Los datos ----------

const repo = getRepo();
const event = await repo.getEventBySlug(SLUG);
if (!event) {
  console.error(`No existe el evento ${SLUG}: corré pnpm seed`);
  process.exit(1);
}
const tickets = await repo.listTicketTypes(event.id);
const freeTicket = tickets.find((t) => t.priceUsdc === 0);
const paidTicket = tickets.find((t) => t.priceUsdc > 0);
const benefits = await repo.listBenefits(event.id);
const lunch = benefits.find((b) => b.kind === "lunch");
const codes = await ensureStationCodes(event, repo);
const gateCode = formatStationCode(codes.find((c) => c.kind === "gate").code);
const lunchCode = lunch ? formatStationCode(codes.find((c) => c.kind === "benefit" && c.benefitId === lunch.id)?.code ?? "") : "";
const panelKey = await getOrCreateOrganizerKey(event.id);
const qrKeys = await getEventQrKeys(event.id);

/** Una persona nueva con su credencial, por la API, como desde el formulario. */
async function inscribir(nombre, lang) {
  const email = `captura-${Date.now().toString(36)}-${lang}@example.com`;
  const res = await fetch(`${BASE}/api/evento/${SLUG}/inscripcion`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticketTypeId: freeTicket.id, name: nombre, email, lang }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await res.json();
  if (res.status !== 201) throw new Error(`no pude inscribir a ${nombre}: ${res.status} ${JSON.stringify(body)}`);
  const pass = await repo.getPass(body.passId);
  return { pass, key: new URL(body.url).searchParams.get("k"), qr: () => buildLivePayload(buildLiveGrant(pass.id, qrKeys), Date.now()), nombre };
}

/** Un pase del evento que ya entró y ya canjeó algo, para la credencial con sus chips. */
async function paseConCanjes() {
  for (const pass of await repo.listPasses(event.id)) {
    if (pass.status !== "checked_in") continue;
    const canjes = await repo.listRedemptionsForPass(pass.id);
    if (canjes.some((r) => r.synced && !r.duplicate)) return { pass, key: await getOrCreateAccessKey(pass.id) };
  }
  return null;
}

// Las pantallas que necesitan una credencial nueva. Con --solo de otra cosa, no se inscribe a nadie.
const necesitaPersona = !SOLO || ["confirmacion", "credencial", "escaner"].some((p) => SOLO.some((s) => p.startsWith(s) || s.startsWith(p)));
let personaEs = null;
let personaEn = null;
if (necesitaPersona) {
  paso("Dos personas nuevas (una por idioma) en la red de prueba, para la credencial y el escáner");
  personaEs = await inscribir("Camila Rojas", "es");
  console.log(`  ${personaEs.nombre}: pase ${personaEs.pass.id}`);
  personaEn = await inscribir("Lucía Fernández", "en");
  console.log(`  ${personaEn.nombre}: pase ${personaEn.pass.id}`);
}
const conCanjes = quiero("credencial-con-canjes") ? await paseConCanjes() : null;

// ---------- El navegador ----------

const browser = await launch({ port: PORT, width: 1440, height: 900, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const cdp = await browser.open("about:blank");
// Los diálogos (el aviso al cerrar un puesto con pendientes) se aceptan, para no quedarse esperando.
cdp.ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Page.javascriptDialogOpening") void cdp.send("Page.handleJavaScriptDialog", { accept: true });
});

let noche = false;
async function tema(oscuro) {
  noche = oscuro;
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: oscuro ? "dark" : "light" }] });
}
async function tamano(w, h) {
  actual = { w, h };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await sleep(250);
}
async function ir(url) {
  await cdp.send("Page.navigate", { url });
  await cdp.waitFor(`document.readyState === "complete"`, 60_000);
  await cdp.eval(`document.fonts ? document.fonts.ready.then(() => true) : true`);
  await sleep(400);
}
const conLang = (ruta, lang) => `${BASE}${ruta}${ruta.includes("?") ? "&" : "?"}lang=${lang}`;

/** Fija el valor de un input de React y avisa el cambio. */
const set = (sel, value) => cdp.eval(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
const clickTexto = (texto) => cdp.eval(`(() => {
  const el = [...document.querySelectorAll("button, a, label")].find((e) => e.textContent.trim() === ${JSON.stringify(texto)} || e.textContent.trim().startsWith(${JSON.stringify(texto)}));
  if (!el) return false;
  el.click();
  return true;
})()`);

/** El tamaño emulado ahora: contra eso se mide, porque en celular el navegador agranda su viewport cuando algo desborda. */
let actual = { w: 1440, h: 900 };

/** Mide la pantalla: sin scroll horizontal y con la acción principal a la vista. */
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

async function capturar(nombre, { accion = null } = {}) {
  const archivo = join(SALIDA, `${nombre}${noche ? "-noche" : ""}.png`);
  await cdp.screenshot(archivo);
  await medir(`${nombre}${noche ? "-noche" : ""}`, accion);
}

/** Navega y captura en los tres tamaños. */
async function pantalla(nombre, ruta, lang, { accion = null, tamanos = TAMANOS, antes = null } = {}) {
  if (!quiero(nombre)) return;
  for (const [w, h] of tamanos) {
    await tamano(w, h);
    await ir(conLang(ruta, lang));
    if (antes) await antes();
    await capturar(`${nombre}-${lang}-${w}x${h}`, { accion });
  }
}

/** Captura lo que hay en pantalla (sin navegar) en los tres tamaños, rápido: para los veredictos, que se cierran solos. */
async function capturarTamanos(nombre, lang, accion) {
  for (const [w, h] of TAMANOS) {
    actual = { w, h };
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await sleep(120);
    await capturar(`${nombre}-${lang}-${w}x${h}`, { accion });
  }
}

const T = {
  es: { escribir: "Escribir el código", verificar: "Verificar", siguiente: "Siguiente", abrir: "Abrir el puesto", cerrar: "Cerrar el puesto", puerta: "Puerta", alDia: "Todo sincronizado" },
  en: { escribir: "Type the code", verificar: "Check", siguiente: "Next", abrir: "Open the station", cerrar: "Close the station", puerta: "Gate", alDia: "All synced" },
};

async function escaner(lang, persona) {
  const t = T[lang];
  await tamano(1440, 900);
  await ir(conLang("/scan", lang));
  // Si quedó un puesto abierto de la vuelta anterior, se cierra.
  if (await cdp.eval(`!!document.querySelector(".esc-puesto-titulo")`)) {
    await clickTexto(t.cerrar);
    await cdp.waitFor(`document.querySelector("#esc-codigo")`, 20_000);
  }
  await cdp.waitFor(`document.querySelector("#esc-codigo")`, 30_000);
  for (const [w, h] of TAMANOS) {
    await tamano(w, h);
    await capturar(`escaner-codigo-${lang}-${w}x${h}`, { accion: ".pantalla-accion .boton" });
  }
  await tamano(1440, 900);
  await set("#esc-codigo", gateCode);
  await clickTexto(t.abrir);
  await cdp.waitFor(`document.querySelector(".esc-puesto-titulo") && document.querySelector(".esc-puesto-titulo").textContent.trim() === ${JSON.stringify(t.puerta)}`, 30_000);
  await cdp.waitFor(`document.querySelector(".esc-camara video")`, 10_000);
  await sleep(1500);
  for (const [w, h] of TAMANOS) {
    await tamano(w, h);
    await capturar(`escaner-puerta-camara-${lang}-${w}x${h}`, { accion: ".esc-camara" });
  }
  await tamano(1440, 900);
  await clickTexto(t.escribir);
  await cdp.waitFor(`document.querySelector("#esc-credencial")`, 10_000);
  for (const [w, h] of TAMANOS) {
    await tamano(w, h);
    await capturar(`escaner-puerta-escribir-${lang}-${w}x${h}`, { accion: ".esc-texto .boton-primario" });
  }

  const veredicto = async (qr, nombre) => {
    await tamano(1440, 900);
    if (!(await cdp.eval(`!!document.querySelector("#esc-credencial")`))) {
      await clickTexto(t.escribir);
      await cdp.waitFor(`document.querySelector("#esc-credencial")`, 10_000);
    }
    await set("#esc-credencial", typeof qr === "function" ? await qr() : qr);
    await clickTexto(t.verificar);
    const salio = await cdp.waitFor(`document.querySelector(".esc-veredicto")`, 15_000);
    if (!salio.ok) {
      problemas.push(`${nombre} (${lang}): el veredicto no apareció`);
      return;
    }
    await sleep(250);
    await capturarTamanos(nombre, lang, ".esc-veredicto-boton");
    await clickTexto(t.siguiente);
    await cdp.waitFor(`!document.querySelector(".esc-veredicto")`, 5_000);
  };
  await veredicto(persona.qr, "escaner-veredicto-entro");
  await veredicto(persona.qr, "escaner-veredicto-ya-entro");
  await veredicto("AAAAAAAA.BBBBBBBBBBBBBBBB", "escaner-veredicto-no-corresponde");

  if (lunchCode && lunch) {
    // La entrada llega al contrato antes de cambiar de puesto, para que no haya pendientes al cerrarlo.
    await cdp.waitFor(`[...document.querySelectorAll(".esc-chips .chip")].some((c) => c.textContent.trim().startsWith(${JSON.stringify(t.alDia)}))`, 120_000);
    await clickTexto(t.cerrar);
    await cdp.waitFor(`document.querySelector("#esc-codigo")`, 20_000);
    await set("#esc-codigo", lunchCode);
    await clickTexto(t.abrir);
    await cdp.waitFor(`document.querySelector(".esc-puesto-titulo") && document.querySelector(".esc-puesto-titulo").textContent.trim() === ${JSON.stringify(lunch.name)}`, 30_000);
    await veredicto(persona.qr, "escaner-veredicto-no-incluye");
  }
}

try {
  for (const lang of ["es", "en"]) {
    const persona = lang === "es" ? personaEs : personaEn;
    paso(`Las pantallas en ${lang === "es" ? "castellano" : "inglés"}`);
    await pantalla("inicio", "/", lang, { accion: ".tarjeta .boton" });
    await pantalla("evento", `/e/${SLUG}`, lang, { accion: ".entrada .boton" });
    await pantalla("formulario-gratis", `/e/${SLUG}/inscripcion?entrada=${freeTicket.id}`, lang, { accion: ".pantalla-accion .boton" });
    if (paidTicket) await pantalla("formulario-pago", `/e/${SLUG}/inscripcion?entrada=${paidTicket.id}`, lang, { accion: ".pantalla-accion .boton" });
    if (persona) {
      await pantalla("confirmacion", `/e/${SLUG}/listo?pase=${persona.pass.id}&k=${encodeURIComponent(persona.key)}`, lang, { accion: ".pantalla-accion .boton" });
      await pantalla("credencial", `/p/${persona.pass.id}?k=${encodeURIComponent(persona.key)}`, lang, { accion: ".pantalla-accion .boton" });
      if (conCanjes) await pantalla("credencial-con-canjes", `/p/${conCanjes.pass.id}?k=${encodeURIComponent(conCanjes.key)}`, lang, { accion: ".pantalla-accion .boton" });
      await pantalla("credencial-no-abre", `/p/${persona.pass.id}`, lang, { accion: ".pantalla-accion .boton" });
    }

    if (persona && quiero("escaner")) {
      paso(`El escáner en ${lang}`);
      await escaner(lang, persona);
    }

    paso(`El panel y el informe en ${lang}`);
    // Primero sin la clave (la puerta con llave), después con ella: la cookie queda puesta por la redirección.
    // La cookie del idioma anterior se borra para ver la puerta de nuevo.
    await cdp.send("Network.clearBrowserCookies");
    await pantalla("panel-acceso", `/admin/${SLUG}`, lang, { accion: ".pantalla-accion .boton", tamanos: [TAMANOS[0], TAMANOS[2]] });
    if (quiero("panel") || quiero("informe")) {
      await ir(conLang(`/admin/${SLUG}?k=${panelKey}`, lang));
      await cdp.waitFor(`document.querySelector(".panel")`, 30_000);
    }
    // La acción del panel (verificar el registro del evento) va al pie sin fijar: no se mide que quede a la vista.
    await pantalla("panel", `/admin/${SLUG}`, lang, { accion: null, antes: () => cdp.waitFor(`document.querySelector(".panel")`, 30_000) });
    await pantalla("informe", `/admin/${SLUG}/informe`, lang, { accion: ".panel-accion .boton" });
  }

  paso("De noche, las principales en castellano");
  await tema(true);
  const nocturnas = [TAMANOS[0], TAMANOS[2]];
  await pantalla("evento", `/e/${SLUG}`, "es", { accion: ".entrada .boton", tamanos: nocturnas });
  await pantalla("formulario-gratis", `/e/${SLUG}/inscripcion?entrada=${freeTicket.id}`, "es", { accion: ".pantalla-accion .boton", tamanos: nocturnas });
  if (personaEs) await pantalla("credencial", `/p/${personaEs.pass.id}?k=${encodeURIComponent(personaEs.key)}`, "es", { accion: ".pantalla-accion .boton", tamanos: nocturnas });
  await pantalla("panel", `/admin/${SLUG}`, "es", { accion: null, tamanos: nocturnas, antes: () => cdp.waitFor(`document.querySelector(".panel")`, 30_000) });
  await pantalla("informe", `/admin/${SLUG}/informe`, "es", { accion: ".panel-accion .boton", tamanos: nocturnas });
  if (quiero("escaner-codigo")) {
    await tamano(1440, 900);
    await ir(conLang("/scan", "es"));
    if (await cdp.eval(`!!document.querySelector(".esc-puesto-titulo")`)) {
      await clickTexto(T.es.cerrar);
      await cdp.waitFor(`document.querySelector("#esc-codigo")`, 20_000);
    }
    for (const [w, h] of nocturnas) {
      await tamano(w, h);
      await capturar(`escaner-codigo-es-${w}x${h}`, { accion: ".pantalla-accion .boton" });
    }
  }
  await tema(false);
} catch (error) {
  problemas.push(`la corrida se cortó: ${error.message}`);
  console.error(error);
} finally {
  const errores = [...cdp.exceptions, ...cdp.consoleErrors].filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|NetworkError|Failed to fetch/i.test(e));
  if (errores.length) {
    problemas.push(`${errores.length} error(es) de consola`);
    for (const e of errores.slice(0, 10)) console.log(`  consola: ${e.slice(0, 200)}`);
  }
  await browser.close();
}

writeFileSync(join(SALIDA, "medidas.txt"), `${medidas.join("\n")}\n\n${problemas.length ? `PROBLEMAS (${problemas.length}):\n${problemas.join("\n")}` : "Sin problemas de medida."}\n`, "utf8");
console.log(`\n${medidas.length} capturas en ${SALIDA} (${Math.round((Date.now() - t0) / 1000)} s). ${problemas.length ? `${problemas.length} problema(s):` : "Sin problemas de medida."}`);
for (const p of problemas) console.log(`  - ${p}`);
process.exit(problemas.length ? 1 : 0);
