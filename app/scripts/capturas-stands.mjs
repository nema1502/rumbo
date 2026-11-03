// Capturas de los stands, la ruta y la pantalla en vivo con Chrome sin interfaz, en castellano y en inglés:
// la credencial con su ruta y la pregunta de permiso, el escáner de un stand, el panel del auspiciante, la
// pantalla "Stands y ruta" de quien organiza y la pantalla en vivo (esta también en 1920x1080).
//
//   node scripts/capturas-stands.mjs [--salida data/capturas-stands] [--puerto 4571] [--cdp 9571]
//
// No usa la red de Stellar: arma su propia base con un evento de muestra sin contrato (en una carpeta nueva
// dentro de data/), levanta `next start` sobre esa carpeta y saca las capturas. Hace falta haber corrido
// `pnpm build` antes. Deja las medidas en medidas.txt: sin scroll horizontal en ningún tamaño.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR } from "./lib/env.mjs";
import { launch, sleep } from "./lib/browser.mjs";

process.chdir(APP_DIR);

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SALIDA = join(APP_DIR, option("--salida", "data/capturas-stands"));
const PUERTO = Number(option("--puerto", 4571));
const CDP_PUERTO = Number(option("--cdp", 9571));
const DATOS = join(APP_DIR, "data", "stands-muestra");
const BASE = `http://127.0.0.1:${PUERTO}`;
const SLUG = "hackaton-comunidad";

// La base de esta corrida: nueva, sin llaves de la red de prueba y sin contrato.
rmSync(DATOS, { recursive: true, force: true });
mkdirSync(DATOS, { recursive: true });
mkdirSync(SALIDA, { recursive: true });
process.env.RUMBO_DATA_DIR = DATOS;
process.env.RUMBO_REPO = "sqlite";
process.env.RUMBO_MAILER = "dev";
process.env.STELLAR_NETWORK = "testnet";
for (const name of ["STELLAR_SPONSOR_SECRET", "STELLAR_GATE_SECRET", "STELLAR_ISSUER_SECRET"]) delete process.env[name];

const { getRepo } = await import("../src/server/repo.ts");
const stands = await import("../src/server/stands.ts");
const { ensureStationCodes, getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { getOrCreateAccessKey } = await import("../src/server/evento/acceso.ts");
const { buildLiveGrant } = await import("../src/server/qr.ts");
const { getEventQrKeys } = await import("../src/server/qr-keys.ts");
const { buildLivePayload } = await import("../src/lib/qr-live.ts");
const { formatStationCode } = await import("../src/lib/station-code.ts");

// ---------- Los datos de muestra ----------

const repo = getRepo();
const hace = (min) => new Date(Date.now() - min * 60_000).toISOString();

const event = await repo.createEvent({
  slug: SLUG,
  name: "Hackatón de la comunidad",
  description: "Un día entero para construir en equipo.",
  startsAt: "2026-11-22T09:00:00-04:00",
  endsAt: "2026-11-22T19:00:00-04:00",
  place: "Santa Cruz de la Sierra",
  organizerName: "La comunidad",
  capacity: 150,
});
const conAlmuerzo = await repo.createTicketType({ eventId: event.id, name: "Con almuerzo", priceUsdc: 10, sortOrder: 1 });
const inscripcion = await repo.createTicketType({ eventId: event.id, name: "Inscripción", priceUsdc: 0, sortOrder: 0 });
const almuerzo = await repo.createBenefit({ eventId: event.id, name: "Almuerzo del sábado", kind: "lunch", station: "Mesa del almuerzo", sortOrder: 0 });
const polera = await repo.createBenefit({ eventId: event.id, name: "Polera de la comunidad", kind: "merch", station: "Stand de la comunidad", sortOrder: 1 });
const taza = await repo.createBenefit({ eventId: event.id, name: "Taza de Acme Cloud", kind: "merch", station: "Stand de Acme Cloud", sortOrder: 2 });
await repo.linkBenefit(conAlmuerzo.id, almuerzo.id, 0);
await repo.linkBenefit(conAlmuerzo.id, polera.id, 1);
await repo.linkBenefit(inscripcion.id, polera.id, 0);

const auspiciantes = [];
for (const [name, logoUrl, benefitId] of [
  ["Acme Cloud", null, taza.id],
  ["Nube Andina", "/muestra/logo-nube.svg", null],
  ["Código Abierto", null, null],
  ["Pixel Labs", "/muestra/logo-pixel.svg", null],
  ["Cooperativa de Datos", null, null],
  ["Taller del Sur", null, null],
]) {
  auspiciantes.push(await stands.createStand(event, { name, logoUrl, benefitId }, repo));
}
await stands.setRouteGoal(event, { target: 4, prizeName: "Premio de la ruta" }, repo);
const [acme, nube, codigo] = auspiciantes;

const gente = {};
async function persona(clave, nombre, { entrada = conAlmuerzo, entro = true } = {}) {
  const person = await repo.upsertPerson({ name: nombre, email: `${clave}@example.com` });
  let pass = await repo.createPass({ eventId: event.id, personId: person.id, ticketTypeId: entrada.id, status: "pending" });
  pass = await repo.updatePass(pass.id, { account: `G${clave.toUpperCase().padEnd(55, "A")}`, status: "active" });
  await repo.grantTicketBenefits(pass.id);
  if (entro) {
    await repo.updatePass(pass.id, { status: "checked_in" });
    await repo.recordCheckIn({ eventId: event.id, passId: pass.id, scannedAt: hace(120) });
  }
  gente[clave] = pass;
  return pass;
}
const nombres = [
  ["camila", "Camila Rojas"], ["mateo", "Mateo Suárez"], ["lucia", "Lucía Fernández"], ["diego", "Diego Vargas"],
  ["valentina", "Valentina Cruz"], ["joaquin", "Joaquín Mamani"], ["sofia", "Sofía Arce"], ["andres", "Andrés Quispe"],
  ["daniela", "Daniela Flores"], ["rodrigo", "Rodrigo Salvatierra"], ["fernanda", "Fernanda Justiniano"], ["gabriel", "Gabriel Ortiz"],
  ["paola", "Paola Terrazas"], ["santiago", "Santiago Peña"], ["hugo", "Hugo Ribera"], ["ximena", "Ximena Roca"],
];
const gratis = new Set(["daniela", "gabriel", "ximena"]);
for (const [i, [clave, nombre]] of nombres.entries()) await persona(clave, nombre, { entrada: gratis.has(clave) ? inscripcion : conAlmuerzo, entro: i < 14 });

// Canjes: nueve almuerzos y cinco poleras
for (const clave of ["camila", "mateo", "lucia", "diego", "valentina", "joaquin", "sofia", "andres", "rodrigo"]) {
  const r = await repo.recordRedemption({ eventId: event.id, passId: gente[clave].id, benefitId: almuerzo.id, scannedAt: hace(60) });
  await repo.markRedemption(r.id, { synced: true });
}
for (const clave of ["camila", "mateo", "lucia", "diego", "gabriel"]) {
  const r = await repo.recordRedemption({ eventId: event.id, passId: gente[clave].id, benefitId: polera.id, scannedAt: hace(50) });
  await repo.markRedemption(r.id, { synced: true });
}

// Las visitas: quién pasó por qué stand, y a qué hora (la que completó antes, primero)
const visitas = {
  mateo: [[acme, 95], [nube, 90], [codigo, 85], [auspiciantes[3], 80]],
  lucia: [[acme, 88], [nube, 70], [auspiciantes[3], 62], [auspiciantes[4], 55]],
  diego: [[acme, 75], [codigo, 60], [auspiciantes[5], 40]],
  valentina: [[acme, 66], [nube, 58], [auspiciantes[4], 30]],
  camila: [[acme, 50], [nube, 35], [codigo, 3]],
  joaquin: [[acme, 45], [nube, 20]],
  sofia: [[nube, 25], [auspiciantes[3], 15]],
  andres: [[acme, 12]],
  daniela: [[codigo, 18]],
  gabriel: [[auspiciantes[5], 9]],
};
for (const [clave, lista] of Object.entries(visitas)) {
  for (const [stand, min] of lista) await stands.recordVisit({ standId: stand.id, passId: gente[clave].id, scannedAt: hace(min) }, repo);
}
// Lo que contestó cada persona (Camila deja su última pregunta sin contestar: es la que muestra la credencial)
for (const clave of ["mateo", "lucia", "diego", "valentina", "camila"]) stands.answerConsent(gente[clave].id, acme.id, "granted");
stands.answerConsent(gente.joaquin.id, acme.id, "declined");
stands.answerConsent(gente.andres.id, acme.id, "granted");
for (const clave of ["mateo", "camila", "valentina", "lucia"]) stands.answerConsent(gente[clave].id, nube.id, "granted");
stands.answerConsent(gente.mateo.id, codigo.id, "granted");
stands.answerConsent(gente.diego.id, codigo.id, "declined");
stands.answerConsent(gente.mateo.id, auspiciantes[3].id, "granted");
stands.answerConsent(gente.lucia.id, auspiciantes[3].id, "granted");
stands.answerConsent(gente.lucia.id, auspiciantes[4].id, "declined");
stands.saveContactNote(acme.id, gente.mateo.id, { rating: 5, note: "Quiere probar el SDK con su equipo. Escribirle esta semana." });
stands.saveContactNote(acme.id, gente.lucia.id, { rating: 4, note: "Le interesa la integración de pagos." });
stands.saveContactNote(acme.id, gente.valentina.id, { rating: 3 });
stands.saveContactNote(acme.id, gente.andres.id, { rating: 2, note: "Estudiante. Pidió material para su tesis." });
// Cómo aparece cada una en la pantalla del evento
stands.setDisplay(gente.valentina.id, { alias: "Vale", hidden: false });
stands.setDisplay(gente.sofia.id, { alias: null, hidden: true });
// El premio de la ruta ya canjeado por quien lo ganó primero
const premio = stands.getRouteGoal(event.id).prizeBenefitId;
const canjePremio = await repo.recordRedemption({ eventId: event.id, passId: gente.mateo.id, benefitId: premio, scannedAt: hace(70) });
stands.claimRoutePrize(canjePremio.id);
await repo.markRedemption(canjePremio.id, { synced: true });

const codigos = await ensureStationCodes(event, repo);
const codigoDe = (stand) => formatStationCode(codigos.find((c) => c.kind === "stand" && c.standId === stand.id).code);
const claveOrganizador = getOrCreateOrganizerKey(event.id);
const qrKeys = getEventQrKeys(event.id);
const urlCredencial = (clave) => `/p/${gente[clave].id}?k=${getOrCreateAccessKey(gente[clave].id)}`;

// ---------- El servidor ----------

const servidor = spawn(process.execPath, [join(APP_DIR, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PUERTO), "-H", "127.0.0.1"], {
  cwd: APP_DIR,
  env: { ...process.env, RUMBO_DATA_DIR: DATOS, NODE_ENV: "production" },
  stdio: "ignore",
});
const cerrarServidor = () => {
  try {
    servidor.kill();
  } catch {
    /* ya cerrado */
  }
};
process.once("exit", cerrarServidor);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/`, { signal: AbortSignal.timeout(2000) })).status < 500) break;
  } catch {
    /* todavía no levantó */
  }
  if (i > 60) {
    cerrarServidor();
    throw new Error("el servidor no levantó: ¿corriste pnpm build?");
  }
  await sleep(500);
}
console.log(`Servidor en ${BASE}, base en ${DATOS}`);

// ---------- Chrome ----------

const medidas = [];
const problemas = [];
const browser = await launch({ port: CDP_PUERTO, width: 1440, height: 900, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const cdp = await browser.open("about:blank");
cdp.ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Page.javascriptDialogOpening") void cdp.send("Page.handleJavaScriptDialog", { accept: true });
});
await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

let actual = { w: 1440, h: 900 };
async function tamano(w, h) {
  actual = { w, h };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await sleep(250);
}
async function ir(url, esperar = null) {
  await cdp.send("Page.navigate", { url });
  await cdp.waitFor(`document.readyState === "complete"`, 60_000);
  if (esperar) await cdp.waitFor(esperar, 15_000);
  await cdp.eval(`document.fonts ? document.fonts.ready.then(() => true) : true`);
  await sleep(500);
}
const conLang = (ruta, lang) => `${BASE}${ruta}${ruta.includes("?") ? "&" : "?"}lang=${lang}`;
const set = (sel, value) =>
  cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
const clickTexto = (texto) =>
  cdp.eval(`(() => {
    const el = [...document.querySelectorAll("button, a")].find((e) => e.textContent.trim() === ${JSON.stringify(texto)} || e.textContent.trim().startsWith(${JSON.stringify(texto)}));
    if (!el) return false;
    el.click();
    return true;
  })()`);

/** Captura y mide: sin scroll horizontal. Con `entera`, la página de arriba abajo y no solo lo que entra en la ventana. */
async function capturar(nombre, { entera = false } = {}) {
  const m = await cdp.eval(`({ scroll: document.documentElement.scrollWidth, alto: document.documentElement.scrollHeight })`);
  const ok = m.scroll <= actual.w;
  const linea = `${nombre}: ancho ${actual.w}, contenido ${m.scroll}${ok ? ", sin scroll horizontal" : ", SCROLL HORIZONTAL"}`;
  medidas.push(linea);
  if (!ok) problemas.push(linea);
  if (!entera) return cdp.screenshot(join(SALIDA, `${nombre}.png`));
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: actual.w, height: Math.min(m.alto, 4000), scale: 1 },
  });
  writeFileSync(join(SALIDA, `${nombre}.png`), Buffer.from(data, "base64"));
}

const TAMANOS = [
  [1440, 900],
  [390, 844],
];
const IDIOMAS = ["es", "en"];

async function pantalla(nombre, ruta, { tamanos = TAMANOS, esperar = null, despues = null, entera = false } = {}) {
  for (const lang of IDIOMAS) {
    for (const [w, h] of tamanos) {
      await tamano(w, h);
      await ir(conLang(ruta, lang), esperar);
      if (despues) await despues(lang);
      await capturar(`${nombre}-${lang}-${w}x${h}`, { entera });
    }
  }
}

// La credencial de Camila: lleva 3 de 4 stands y el de Código Abierto le pregunta si comparte su contacto
await pantalla("credencial-pregunta", urlCredencial("camila"), { esperar: `document.querySelector(".ruta-pregunta")` });
// La de Mateo: completó la ruta, ganó el premio y ya lo canjeó
await pantalla("credencial-ruta-completa", urlCredencial("mateo"), { esperar: `document.querySelector(".ruta")`, entera: true });
// La de Lucía: completó la ruta y el premio espera en Premios
await pantalla("credencial-premio-listo", urlCredencial("lucia"), { esperar: `document.querySelector(".ruta")`, entera: true });

// El panel del auspiciante (con su código)
await pantalla("panel-auspiciante", `/stand/${codigoDe(acme)}`, { esperar: `document.querySelector(".contacto")`, entera: true });

// Entra quien organiza: la clave deja la cookie del panel
await ir(`${BASE}/admin/${SLUG}?k=${claveOrganizador}`);
await pantalla("organiza-stands-y-ruta", `/admin/${SLUG}/stands`, { esperar: `document.querySelector(".admin-stand")`, entera: true });
await pantalla("pantalla-en-vivo", `/vivo/${SLUG}`, { tamanos: [...TAMANOS, [1920, 1080]], esperar: `document.querySelector(".viv-ranking")` });

// El escáner del stand de Código Abierto, con la cámara de mentira: se abre el puesto con su código, se ve el
// resumen y se lee la credencial de Hugo (que todavía no pasó por ahí) para ver la visita registrada.
const T = { es: { escribir: "Escribir el código", verificar: "Verificar", abrir: "Abrir el puesto", cerrar: "Cerrar el puesto" }, en: { escribir: "Type the code", verificar: "Check", abrir: "Open the station", cerrar: "Close the station" } };
const qrDe = (clave) => buildLivePayload(buildLiveGrant(gente[clave].id, qrKeys), Date.now());
/** Cada combinación lee a alguien distinto, así ninguna ve el amarillo de "ya visitó". */
const LECTURA = { "es-1440": "hugo", "es-390": "ximena", "en-1440": "fernanda", "en-390": "paola" };
for (const lang of IDIOMAS) {
  for (const [w, h] of TAMANOS) {
    await tamano(w, h);
    await ir(conLang("/scan", lang), `document.querySelector("#esc-codigo")`);
    if (!(await set("#esc-codigo", codigoDe(codigo)))) throw new Error("el escáner no mostró el campo del código: ¿quedó un puesto abierto?");
    await clickTexto(T[lang].abrir);
    await cdp.waitFor(`document.querySelector(".esc-stand")`, 20_000);
    await sleep(800);
    await capturar(`escaner-stand-${lang}-${w}x${h}`);
    // La visita: se escribe el código de la credencial, como cuando no hay cámara
    await clickTexto(T[lang].escribir);
    await cdp.waitFor(`document.querySelector("#esc-credencial")`, 10_000);
    await set("#esc-credencial", qrDe(LECTURA[`${lang}-${w}`]));
    await clickTexto(T[lang].verificar);
    await cdp.waitFor(`document.querySelector(".esc-veredicto")`, 10_000);
    await sleep(350);
    await capturar(`escaner-stand-visita-${lang}-${w}x${h}`);
    await sleep(4000);
    // Se cierra el puesto para empezar limpio en el siguiente tamaño
    await clickTexto(T[lang].cerrar);
    await sleep(500);
  }
}

await browser.close();
cerrarServidor();
writeFileSync(join(SALIDA, "medidas.txt"), `${medidas.join("\n")}\n`);
console.log(medidas.join("\n"));
if (problemas.length) {
  console.error(`\n${problemas.length} problema(s) de medida:\n${problemas.join("\n")}`);
  process.exitCode = 1;
}
console.log(`\nCapturas en ${SALIDA}`);
