// Capturas de la inscripción con la cuenta propia (Pollar) con Chrome sin interfaz, en 1440x900 y 390x844, en
// castellano y en inglés: entrar con Google o con el correo, el código, la pestaña de Google abierta, la cuenta que
// se está creando, el formulario ya escrito, y cada paso de la inscripción mientras pasa (la prueba de la cuenta,
// preparar, el USDC de prueba de la entrada paga, autorizar, anotarse) hasta la confirmación. Cada captura mide
// que no haya scroll horizontal y que la acción principal quede a la vista; las medidas quedan en medidas.txt.
//
//   node scripts/capturas-pollar.mjs [--salida data/capturas-pollar] [--app-port 4319] [--port 9532]
//
// NO toca la red de prueba de Stellar: levanta la app adentro de este proceso, con una base propia y vacía, y le
// pone la red de la cuenta propia, las cuentas y el correo de mentira (los ganchos de las pruebas). La primera
// pantalla carga el SDK de Pollar de verdad, con la clave publicable de .env.local, sin entrar. Las demás usan un
// cliente de Pollar de mentira en la página (window.__rumboPollarFalso, que la app mira solo en desarrollo): lo que
// firmaría Pollar lo firma acá una llave local, por un puente de DevTools, así el formulario hace el recorrido entero.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
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
const SALIDA = option("--salida", join(APP_DIR, "data", "capturas-pollar"));
const APP_PORT = Number(option("--app-port", 4319));
const CDP_PORT = Number(option("--port", 9532));
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
const CLAVE = clavePublicable() || "pk_capturas";
const datos = mkdtempSync(join(tmpdir(), "rumbo-capturas-pollar-"));
Object.assign(process.env, {
  RUMBO_DATA_DIR: datos,
  RUMBO_REPO: "sqlite",
  RUMBO_MAILER: "dev",
  RUMBO_ACCOUNTS: "pollar",
  NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY: CLAVE,
  STELLAR_NETWORK: "testnet",
  NEXT_PUBLIC_BASE_URL: BASE,
  STELLAR_RPC_URL: "http://127.0.0.1:9",
  STELLAR_HORIZON_URL: "http://127.0.0.1:9",
  STELLAR_FRIENDBOT_URL: "http://127.0.0.1:9",
});
for (const name of ["STELLAR_SPONSOR_SECRET", "STELLAR_GATE_SECRET", "STELLAR_ISSUER_SECRET", "STELLAR_ORGANIZER_SECRET", "STELLAR_TREASURY_SECRET", "RUMBO_CREATE_KEY", "POLLAR_SECRET_KEY"]) delete process.env[name];

const { Address, Keypair, Networks, StrKey, authorizeEntry, xdr } = await import("@stellar/stellar-sdk");
const { sep53Digest } = await import("../src/server/cuenta-propia.ts");

const CONTRATO = StrKey.encodeContract(randomBytes(32));
/** La autorización que pediría el contrato, sin firmar. */
function autorizacionSinFirmar(cuenta, fn) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({ address: new Address(cuenta).toScAddress(), nonce: randomBytes(8).readBigInt64BE(), signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid() }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: new Address(CONTRATO).toScAddress(), functionName: fn, args: [new Address(cuenta).toScVal()] }),
      ),
      subInvocations: [],
    }),
  });
}

// Lo que tarda la red de verdad, para que cada paso se vea en pantalla.
const DEMORA_MS = 2500;
let numero = 0;
const conLinea = new Set();
globalThis.__rumboOwnAccountChain = {
  ensureAccount: async () => false,
  // La primera vez, la cuenta de la entrada paga no acepta el USDC de prueba; después de setTrustline, sí.
  hasTestTrustline: async (cuenta) => {
    if (conLinea.has(cuenta)) return true;
    conLinea.add(cuenta);
    return false;
  },
  topUpTestUsdc: async () => undefined,
  prepare: async (_contrato, fn, cuenta) => {
    await sleep(DEMORA_MS);
    return { entryXdr: autorizacionSinFirmar(cuenta, fn).toXdr("base64"), validUntilLedger: 1060, latestLedger: 1000 };
  },
  submitSigned: async () => {
    await sleep(DEMORA_MS);
    numero++;
    return { hash: `captura-${numero}`, ledger: 1001, returnValue: numero, number: numero };
  },
  status: async () => ({ has_pass: true, number: numero, checked_in: false, redeemed: [] }),
};
globalThis.__rumboAccounts = {
  kind: "dev",
  getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
  getForPerson: async () => null,
  authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
};
globalThis.__rumboMailer = { kind: "dev", send: async () => ({ id: "capturas" }) };

const { getRepo } = await import("../src/server/repo.ts");
const repo = getRepo();
const event = await repo.createEvent({
  slug: "hackaton-comunidad",
  name: "Hackatón de la comunidad",
  description: "Un día entero para construir en equipo.",
  startsAt: "2026-11-22T09:00:00-04:00",
  endsAt: "2026-11-22T19:00:00-04:00",
  timezone: "America/La_Paz",
  place: "Santa Cruz de la Sierra",
  organizerName: "La comunidad",
  contractId: CONTRATO,
});
const gratis = await repo.createTicketType({ eventId: event.id, name: "Inscripción", priceUsdc: 0, contractId: CONTRATO, sortOrder: 0 });
const pago = await repo.createTicketType({ eventId: event.id, name: "Con almuerzo", priceUsdc: 10, contractId: CONTRATO, sortOrder: 1 });
const almuerzo = await repo.createBenefit({ eventId: event.id, name: "Almuerzo del sábado", kind: "lunch", station: "Mesa del almuerzo", sortOrder: 0 });
await repo.linkBenefit(pago.id, almuerzo.id, 0);

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

// El puente: la página pide una firma (window.rumboFirmar) y quien maneja la corrida decide cuándo contestar.
const pedidos = [];
let esperando = null;
cdp.ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method !== "Runtime.bindingCalled" || msg.params.name !== "rumboFirmar") return;
  const pedido = JSON.parse(msg.params.payload);
  if (esperando) {
    const resolver = esperando;
    esperando = null;
    resolver(pedido);
  } else pedidos.push(pedido);
});
await cdp.send("Runtime.addBinding", { name: "rumboFirmar" });
function proximoPedido(ms = 60_000) {
  if (pedidos.length) return Promise.resolve(pedidos.shift());
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("la página no pidió ninguna firma")), ms);
    esperando = (p) => {
      clearTimeout(t);
      resolve(p);
    };
  });
}
async function contestar(pedido, llave) {
  let valor;
  if (pedido.tipo === "sep53") {
    valor = { status: "signed", signature: Buffer.from(llave.sign(sep53Digest(pedido.message))).toString("base64"), signerAddress: llave.publicKey(), scheme: "sep53" };
  } else if (pedido.tipo === "autorizacion") {
    const firmada = await authorizeEntry(xdr.SorobanAuthorizationEntry.fromXdr(pedido.entryXdr, "base64"), llave, pedido.validUntilLedger, Networks.TESTNET);
    valor = { status: "signed", signedAuthEntry: firmada.toXdr("base64") };
  } else {
    valor = { status: "success" };
  }
  await cdp.eval(`window.__pollarRespuesta(${pedido.id}, ${JSON.stringify(valor)})`);
}

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
    setTrustline: () => pedir("linea", {}),
    signAuthEntry: (entryXdr, opciones) => pedir("autorizacion", { entryXdr, validUntilLedger: opciones.validUntilLedger }),
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
let falso = null;
async function conFalso(si) {
  if (si && !falso) falso = (await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: FALSO })).identifier;
  if (!si && falso) {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: falso });
    falso = null;
  }
}
const poner = (estado) => cdp.eval(`window.__pollarFalso.set(${JSON.stringify(estado)})`);

let actual = { w: 1440, h: 900 };
async function tamano(w, h) {
  actual = { w, h };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await sleep(250);
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
const textoVisible = (texto) => cdp.waitFor(`document.body.innerText.includes(${JSON.stringify(texto)})`, 30_000);

const TEXTOS = {
  es: { google: "Entrar con Google", correo: "Entrar con mi correo", confirmar: "Confirmar inscripción", pagar: "Pagar 10 USDC de prueba", entraste: "Entraste como", listo: "Inscripción lista" },
  en: { google: "Sign in with Google", correo: "Sign in with my email", confirmar: "Confirm registration", pagar: "Pay 10 test USDC", entraste: "Signed in as", listo: "You are registered" },
};
const PERSONAS = { es: { name: "Lucía Fernández", email: "lucia.fernandez" }, en: { name: "Lucy Fernandez", email: "lucy.fernandez" } };
const conectada = (llave, perfil, provisioning = "READY") => ({
  auth: { step: "authenticated", session: {}, verified: true },
  wallet: { custody: "internal", address: llave.publicKey(), provider: "google", provisioning },
  provisioning,
  profile: { mail: perfil.mail, first_name: perfil.first, last_name: perfil.last, avatar: "", providers: { email: null, google: { id: "1" }, github: null, wallet: null } },
});

try {
  for (const lang of ["es", "en"]) {
    const t = TEXTOS[lang];
    for (const [w, h] of TAMANOS) {
      const sufijo = `${lang}-${w}`;
      const url = (ticket) => `${BASE}/e/${event.slug}/inscripcion?entrada=${ticket.id}&lang=${lang}`;
      await tamano(w, h);

      paso(`${sufijo}: el SDK de Pollar de verdad, sin entrar`);
      await conFalso(false);
      await ir(url(gratis));
      const listo = await cdp.waitFor(`[...document.querySelectorAll(".pantalla-accion button")].length >= 2 && [...document.querySelectorAll(".pantalla-accion button")].every((b) => !b.disabled)`, 60_000);
      if (!listo.ok) problemas.push(`${sufijo}: el SDK de Pollar no quedó listo (los botones siguen apagados)`);
      await capturar(`01-entrar-${sufijo}`);
      await clickTexto(t.correo);
      await sleep(400);
      await capturar(`02-correo-${sufijo}`, ".cuenta-correo .boton-primario");

      paso(`${sufijo}: los estados de Pollar, con el cliente de mentira`);
      await conFalso(true);
      await ir(url(gratis));
      await poner({ auth: { step: "opening_oauth", provider: "google" } });
      await sleep(300);
      await capturar(`03-pestana-google-${sufijo}`);
      await poner({ auth: { step: "entering_code", clientSessionId: "c", email: `${PERSONAS[lang].email}@example.com` } });
      await sleep(300);
      await capturar(`04-codigo-${sufijo}`, ".cuenta-correo .boton-primario");
      await poner({ auth: { step: "error", previousStep: "verifying_email_code", message: "", errorCode: "EMAIL_CODE_INVALID" } });
      await sleep(300);
      await capturar(`05-codigo-mal-${sufijo}`, ".cuenta-correo .boton-primario");

      const perfil = { mail: `${PERSONAS[lang].email}.${w}@example.com`, first: PERSONAS[lang].name.split(" ")[0], last: PERSONAS[lang].name.split(" ")[1] };
      let llave = Keypair.random();
      await poner(conectada(llave, perfil, "CREATING"));
      await sleep(300);
      await capturar(`06-creando-cuenta-${sufijo}`, ".pantalla-accion button[type=submit]");
      await poner({ provisioning: "READY", wallet: { custody: "internal", address: llave.publicKey(), provider: "google", provisioning: "READY" } });
      await textoVisible(t.entraste);
      await sleep(300);
      await capturar(`07-entraste-${sufijo}`, ".pantalla-accion button[type=submit]");

      paso(`${sufijo}: la inscripción gratis, paso por paso`);
      await clickTexto(t.confirmar);
      const p1 = await proximoPedido();
      await sleep(300);
      await capturar(`08-paso-prueba-${sufijo}`, ".pantalla-accion button[type=submit]");
      await contestar(p1, llave);
      await sleep(900);
      await capturar(`09-paso-preparando-${sufijo}`, ".pantalla-accion button[type=submit]");
      const p2 = await proximoPedido();
      await sleep(300);
      await capturar(`10-paso-autorizando-${sufijo}`, ".pantalla-accion button[type=submit]");
      await contestar(p2, llave);
      await sleep(900);
      await capturar(`11-paso-anotando-${sufijo}`, ".pantalla-accion button[type=submit]");
      const llego = await cdp.waitFor(`location.pathname.endsWith("/listo")`, 30_000);
      if (!llego.ok) problemas.push(`${sufijo}: la inscripción gratis no llegó a la confirmación`);
      await textoVisible(t.listo);
      await sleep(600);
      await capturar(`12-listo-${sufijo}`, null);

      paso(`${sufijo}: la entrada paga, con el USDC de prueba`);
      llave = Keypair.random();
      await ir(url(pago));
      await poner(conectada(llave, { ...perfil, mail: `pago.${perfil.mail}` }));
      await textoVisible(t.entraste);
      await clickTexto(t.pagar);
      await contestar(await proximoPedido(), llave);
      const linea = await proximoPedido();
      await sleep(300);
      await capturar(`13-paso-usdc-${sufijo}`, ".pantalla-accion button[type=submit]");
      await contestar(linea, llave);
      await contestar(await proximoPedido(), llave);
      await contestar(await proximoPedido(), llave);
      const pagado = await cdp.waitFor(`location.pathname.endsWith("/listo")`, 30_000);
      if (!pagado.ok) problemas.push(`${sufijo}: la entrada paga no llegó a la confirmación`);
      await sleep(600);
      await capturar(`14-pago-listo-${sufijo}`, null);
    }
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
