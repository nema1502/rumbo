// El flujo entero de Rumbo contra la red de prueba, con la app levantada, de punta a punta y por la API:
//   1. el evento de muestra (pnpm seed, sobre una base nueva),
//   2. una persona se inscribe gratis y otra compra la entrada con almuerzo (10 USDC de prueba: la plata
//      sale de su cuenta y llega a quien organiza y a Rumbo en la misma transacción),
//   3. cada una abre su credencial (la página, los datos y el SVG), y el enlace sin clave no abre,
//   4. el escáner, por su API: la puerta registra a las dos (y la segunda lectura dice "ya entró"), la mesa
//      del almuerzo canjea el de quien lo pagó, el segundo canje no pasa (ni en el escáner ni en el contrato)
//      y la inscripción gratis no lo incluye,
//   5. status(), attendees() e info() en la cadena, y el panel (contadores, dobles, contraste con la cadena,
//      el informe sin nombres y el CSV) dicen lo mismo.
// Deja la transcripción, con los ids de las transacciones, en demo/e2e-testnet.txt.
//
//   node scripts/e2e-testnet.mjs                  levanta su propio servidor (next dev) con una base nueva en data/e2e
//   node scripts/e2e-testnet.mjs --base http://127.0.0.1:3000 [--datos ./data]   usa un servidor ya levantado
//   --port 4410            el puerto del servidor propio
//   --salida demo/e2e-testnet.txt   dónde queda la transcripción (relativo a app/)
//   --slug hackaton-comunidad       el evento
//
// Tarda entre dos y seis minutos según la red de prueba: cada inscripción, entrada y canje es una transacción.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { APP_DIR, loadEnv } from "./lib/env.mjs";

process.chdir(APP_DIR);

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SLUG = option("--slug", "hackaton-comunidad");
const PORT = Number(option("--port", 4410));
const SALIDA = join(APP_DIR, option("--salida", "demo/e2e-testnet.txt"));
const baseDada = option("--base", null);
const servidorPropio = !baseDada;
const BASE = (baseDada ?? `http://127.0.0.1:${PORT}`).replace(/\/+$/, "");
const DATOS = option("--datos", servidorPropio ? "./data/e2e" : "./data");

// La base y los correos del servidor y los de este script tienen que ser los mismos: se fija antes de cargar nada.
process.env.RUMBO_DATA_DIR = DATOS;
process.env.NEXT_PUBLIC_BASE_URL = BASE;
loadEnv();

const { getRepo } = await import("../src/server/repo.ts");
const { getAccessKey } = await import("../src/server/evento/acceso.ts");
const { ensureStationCodes, getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { formatStationCode } = await import("../src/lib/station-code.ts");
const { decideVerdict } = await import("../src/lib/escaner-api.ts");
const { verifyQrPayload, base64urlToBytes } = await import("../src/server/qr.ts");
const { rumboPass, getBalance, getTestAsset, readDeployInfo, fromStroops } = await import("../src/server/stellar.ts");

// ---------- La transcripción ----------

const lineas = [];
const t0 = Date.now();
const segundos = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
const log = (texto = "") => {
  console.log(texto);
  lineas.push(texto);
};
const paso = (texto) => log(`\n> ${texto}  (${segundos()})`);
const fallas = [];
let comprobaciones = 0;
const check = (ok, texto) => {
  comprobaciones++;
  log(`  ${ok ? "ok   " : "FALLA"} ${texto}`);
  if (!ok) fallas.push(texto);
  return ok;
};
/** Las claves de acceso y la del panel no van a la transcripción. */
const sinClave = (url) => String(url).replace(/([?&]k=)[^&\s]+/g, "$1...");
const explorer = (hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
const transacciones = [];
const tx = (que, hash) => {
  transacciones.push({ que, hash });
  log(`  transacción: ${hash}`);
};

function guardar() {
  mkdirSync(dirname(SALIDA), { recursive: true });
  writeFileSync(SALIDA, `${lineas.join("\n")}\n`, "utf8");
}

async function pedir(ruta, init = {}, ms = 180_000) {
  const res = await fetch(`${BASE}${ruta}`, { ...init, signal: AbortSignal.timeout(ms) });
  const tipo = res.headers.get("content-type") ?? "";
  const cuerpo = tipo.includes("json") ? await res.json() : await res.text();
  return { res, cuerpo, status: res.status };
}
const json = (ruta, body, extra = {}) => pedir(ruta, { method: "POST", headers: { "content-type": "application/json", ...extra.headers }, body: JSON.stringify(body) });

// ---------- El servidor ----------

let servidor = null;

async function esperarServidor(ms = 180_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < ms) {
    if (servidor && servidor.exitCode !== null) throw new Error(`el servidor se cerró al arrancar (código ${servidor.exitCode}); ver ${relative(APP_DIR, logServidor)}`);
    try {
      const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) return;
    } catch {
      /* todavía no levantó */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`el servidor no contestó en ${BASE} después de ${ms / 1000} s`);
}

const logServidor = join(APP_DIR, DATOS, "servidor.log");

function levantarServidor() {
  const next = join(APP_DIR, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(next)) throw new Error("no encontré Next en node_modules: corré pnpm install");
  const proc = spawn(process.execPath, [next, "dev", "-p", String(PORT)], {
    cwd: APP_DIR,
    env: { ...process.env, RUMBO_DATA_DIR: DATOS, NEXT_PUBLIC_BASE_URL: BASE },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const salida = [];
  for (const stream of [proc.stdout, proc.stderr]) stream.on("data", (chunk) => salida.push(chunk.toString()));
  proc.on("exit", () => {
    try {
      writeFileSync(logServidor, salida.join(""), "utf8");
    } catch {
      /* la carpeta ya no está */
    }
  });
  return proc;
}

/** Cierra solo el servidor que levantó este script (y sus procesos hijos). */
function apagarServidor() {
  if (!servidor || servidor.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(servidor.pid), "/T", "/F"], { stdio: "ignore" });
  else servidor.kill();
}
process.on("SIGINT", () => {
  apagarServidor();
  process.exit(130);
});

// ---------- El flujo ----------

const stamp = Date.now().toString(36);
const gratis = { nombre: "Valeria Prueba", correo: `e2e-${stamp}-gratis@example.com` };
const almuerzo = { nombre: "Mateo Prueba", correo: `e2e-${stamp}-almuerzo@example.com` };

try {
  log(`Rumbo, el flujo entero contra la red de prueba de Stellar. ${new Date().toISOString()}`);
  log(`Servidor: ${BASE} (${servidorPropio ? "levantado por este script" : "ya levantado"}). Datos: ${DATOS}.`);
  const deploy = readDeployInfo();
  if (deploy) {
    log(`Red: testnet. Contratos rumbo-pass: gratis ${deploy.events.free?.contract ?? "(no hay)"}, pago ${deploy.events.paid?.contract ?? "(no hay)"}.`);
    log(`USDC de prueba: ${deploy.asset?.code}:${deploy.asset?.issuer} (contrato ${deploy.asset?.contract}).`);
  }

  if (servidorPropio) {
    paso(`Una base nueva en ${DATOS} y el servidor de desarrollo en el puerto ${PORT}`);
    rmSync(join(APP_DIR, DATOS), { recursive: true, force: true });
    mkdirSync(join(APP_DIR, DATOS), { recursive: true });
    servidor = levantarServidor();
    await esperarServidor();
    check(true, `el servidor contesta en ${BASE}`);
  }

  // 1. El evento de muestra
  paso("El evento de muestra (pnpm seed)");
  const seed = spawnSync(process.execPath, [join(APP_DIR, "scripts", "seed.mjs")], { cwd: APP_DIR, env: { ...process.env, RUMBO_DATA_DIR: DATOS }, encoding: "utf8" });
  for (const linea of `${seed.stdout}${seed.stderr}`.split(/\r?\n/).filter((l) => l.trim())) log(`  ${linea}`);
  check(seed.status === 0, "el seed terminó bien");
  const repo = getRepo();
  const event = await repo.getEventBySlug(SLUG);
  if (!event) throw new Error(`no existe el evento ${SLUG}`);
  const evento = await pedir(`/api/evento/${SLUG}`);
  check(evento.status === 200 && Array.isArray(evento.cuerpo.tickets), `GET /api/evento/${SLUG} devuelve el evento "${evento.cuerpo.event?.name}"`);
  const entradaGratis = evento.cuerpo.tickets.find((t) => t.free);
  const entradaPaga = evento.cuerpo.tickets.find((t) => !t.free);
  check(Boolean(entradaGratis && entradaPaga), `hay una entrada gratis ("${entradaGratis?.name}") y una paga ("${entradaPaga?.name}", ${entradaPaga?.priceUsdc} USDC de prueba)`);
  const tickets = await repo.listTicketTypes(event.id);
  const contratoGratis = tickets.find((t) => t.id === entradaGratis.id)?.contractId ?? event.contractId;
  const contratoPago = tickets.find((t) => t.id === entradaPaga.id)?.contractId ?? event.contractId;
  const beneficios = await repo.listBenefits(event.id);
  const lunch = beneficios.find((b) => b.kind === "lunch");
  check(Boolean(lunch), `el catálogo tiene el almuerzo ("${lunch?.name}")`);

  // 2. Las inscripciones
  const activo = getTestAsset();
  const saldo = async (cuenta) => Number((await getBalance(cuenta, activo.asset)) ?? 0);
  const organizador = deploy?.accounts.organizer ?? event.organizerAccount;
  const tesoreria = deploy?.accounts.treasury ?? null;
  const antes = { organizador: organizador ? await saldo(organizador) : null, tesoreria: tesoreria ? await saldo(tesoreria) : null };

  paso(`Inscripción gratis de ${gratis.nombre} por POST /api/evento/${SLUG}/inscripcion (crea su cuenta de prueba y la inscribe en el contrato)`);
  let inicio = Date.now();
  const r1 = await json(`/api/evento/${SLUG}/inscripcion`, { ticketTypeId: entradaGratis.id, name: gratis.nombre, email: gratis.correo, lang: "es" });
  check(r1.status === 201 && r1.cuerpo.status === "created", `se creó la credencial (${r1.status} ${JSON.stringify({ ...r1.cuerpo, url: sinClave(r1.cuerpo.url) })}) en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  const paseGratis = await repo.getPass(r1.cuerpo.passId);
  check(paseGratis?.status === "active" && Boolean(paseGratis.account), `el pase ${paseGratis?.id} quedó activo con su cuenta ${paseGratis?.account}`);
  if (paseGratis?.txHash) tx(`inscripción gratis de ${gratis.nombre} (register, pase número ${paseGratis.chainNumber})`, paseGratis.txHash);
  const claveGratis = getAccessKey(paseGratis.id);
  const correos = readdirSync(join(APP_DIR, DATOS, "correos")).filter((f) => f.includes(gratis.correo));
  const correo = correos.length ? readFileSync(join(APP_DIR, DATOS, "correos", correos.at(-1)), "utf8") : "";
  check(correo.includes(`/p/${paseGratis.id}?k=${encodeURIComponent(claveGratis)}`), `el correo con el enlace personal quedó en ${DATOS}/correos (sin llaves ni contraseñas)`);
  check(!/\bS[A-Z2-7]{55}\b/.test(correo), "el correo no lleva ninguna llave secreta");

  paso(`Entrada con almuerzo de ${almuerzo.nombre}: buy con ${entradaPaga.priceUsdc} USDC de prueba desde su cuenta`);
  inicio = Date.now();
  const r2 = await json(`/api/evento/${SLUG}/inscripcion`, { ticketTypeId: entradaPaga.id, name: almuerzo.nombre, email: almuerzo.correo, lang: "es" });
  check(r2.status === 201 && r2.cuerpo.status === "created" && r2.cuerpo.paid === true, `se pagó y se creó la credencial (${r2.status}) en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  const pasePago = await repo.getPass(r2.cuerpo.passId);
  check(pasePago?.status === "active" && Boolean(pasePago.account), `el pase ${pasePago?.id} quedó activo con su cuenta ${pasePago?.account}`);
  if (pasePago?.txHash) tx(`entrada paga de ${almuerzo.nombre} (buy, pase número ${pasePago.chainNumber})`, pasePago.txHash);
  const clavePago = getAccessKey(pasePago.id);
  const despues = { organizador: organizador ? await saldo(organizador) : null, tesoreria: tesoreria ? await saldo(tesoreria) : null, comprador: await saldo(pasePago.account) };
  const feeBps = deploy?.events.paid?.feeBps ?? 0;
  const precio = entradaPaga.priceUsdc;
  const comision = (precio * feeBps) / 10000;
  if (antes.organizador !== null) {
    check(Math.abs(despues.organizador - antes.organizador - (precio - comision)) < 1e-6, `quien organiza recibió ${precio - comision} USDC de prueba en la misma transacción (${antes.organizador} a ${despues.organizador})`);
  }
  if (antes.tesoreria !== null) {
    check(Math.abs(despues.tesoreria - antes.tesoreria - comision) < 1e-6, `Rumbo recibió la comisión de ${comision} USDC de prueba (${feeBps / 100} %) en la misma transacción (${antes.tesoreria} a ${despues.tesoreria})`);
  }
  const inicial = Number(process.env.RUMBO_INITIAL_TEST_USDC ?? "100");
  check(Math.abs(despues.comprador - (inicial - precio)) < 1e-6, `a quien compró le quedan ${despues.comprador} USDC de prueba (tenía ${inicial})`);
  const infoPago = await rumboPass.info(contratoPago);
  check(fromStroops(infoPago.price) === precio && infoPago.fee_bps === feeBps, `el contrato pago cobra ${fromStroops(infoPago.price)} USDC de prueba con ${infoPago.fee_bps / 100} % de comisión, a la vista de cualquiera`);

  paso("Otra vez con el mismo correo: no se crea otro pase y el enlace se reenvía por correo");
  const r3 = await json(`/api/evento/${SLUG}/inscripcion`, { ticketTypeId: entradaGratis.id, name: gratis.nombre, email: gratis.correo });
  check(r3.status === 200 && r3.cuerpo.status === "existing" && !r3.cuerpo.url, `la respuesta es "existing" y no muestra el enlace (${r3.status})`);

  // 3. Las credenciales
  paso("La credencial de cada persona: la página, los datos y el SVG");
  const c1 = await pedir(`/api/pase/${paseGratis.id}?k=${encodeURIComponent(claveGratis)}`);
  check(c1.status === 200 && c1.cuerpo.person?.name === gratis.nombre && c1.cuerpo.paid === false && c1.cuerpo.checkedIn === false, `GET /api/pase/${paseGratis.id}: "${c1.cuerpo.person?.name}", credencial ${c1.cuerpo.number} de ${c1.cuerpo.total}, inscripción lista`);
  const c2 = await pedir(`/api/pase/${pasePago.id}?k=${encodeURIComponent(clavePago)}`);
  check(c2.status === 200 && c2.cuerpo.paid === true && c2.cuerpo.benefits.some((b) => b.id === lunch.id && b.state === "pendiente"), `GET /api/pase/${pasePago.id}: entrada paga, lo que le toca: ${c2.cuerpo.benefits.map((b) => `${b.name} (${b.state})`).join(", ")}`);
  const qrGratis = c1.cuerpo.qr;
  const qrPago = c2.cuerpo.qr;
  log(`  QR de ${gratis.nombre}: ${qrGratis}; QR de ${almuerzo.nombre}: ${qrPago}`);
  const pagina = await pedir(`/p/${paseGratis.id}?k=${encodeURIComponent(claveGratis)}`);
  check(pagina.status === 200 && pagina.cuerpo.includes(gratis.nombre) && pagina.cuerpo.includes("Descargar en SVG"), `la página /p/${paseGratis.id} se ve con el nombre y su única acción`);
  const listo = await pedir(`/e/${SLUG}/listo?pase=${pasePago.id}&k=${encodeURIComponent(clavePago)}`);
  check(listo.status === 200 && listo.cuerpo.includes("Entrada paga") && listo.cuerpo.includes("Ver mi credencial"), `la confirmación /e/${SLUG}/listo dice "Entrada paga" y lleva a la credencial`);
  const svg = await pedir(`/api/pase/${paseGratis.id}/svg?k=${encodeURIComponent(claveGratis)}`);
  check(svg.status === 200 && svg.res.headers.get("content-type")?.startsWith("image/svg+xml") && svg.cuerpo.includes(gratis.nombre), `el SVG para imprimir baja con el nombre (${Buffer.byteLength(svg.cuerpo)} bytes)`);
  check((await pedir(`/api/pase/${paseGratis.id}?k=${"A".repeat(22)}`)).status === 404, "con otra clave la credencial da 404");
  check((await pedir(`/p/${paseGratis.id}`)).status === 404, "sin clave la página da 404 (no dice si el pase existe)");

  // 4. El panel: la clave de organizador y los códigos de puesto
  paso("El panel de quien organiza: la clave, los códigos de puesto y los contadores antes del evento");
  const clavePanel = getOrCreateOrganizerKey(event.id);
  await ensureStationCodes(event, repo);
  check((await pedir(`/api/admin/${SLUG}`)).status === 401, `GET /api/admin/${SLUG} sin clave: 401`);
  const panel0 = await pedir(`/api/admin/${SLUG}?k=${clavePanel}`);
  check(panel0.status === 200 && panel0.cuerpo.counters?.issued >= 2 && panel0.cuerpo.counters?.checkedIn === 0, `con la clave: ${panel0.cuerpo.counters?.issued} credenciales, ${panel0.cuerpo.counters?.checkedIn} entraron, almuerzos ${panel0.cuerpo.counters?.lunch?.redeemed} de ${panel0.cuerpo.counters?.lunch?.granted}`);
  const puertaCode = panel0.cuerpo.stations?.find((s) => s.kind === "gate")?.code;
  const almuerzoCode = panel0.cuerpo.stations?.find((s) => s.kind === "benefit" && s.benefitId === lunch.id)?.code;
  check(Boolean(puertaCode && almuerzoCode), `códigos de puesto: puerta ${formatStationCode(puertaCode ?? "")}, ${lunch.name} ${formatStationCode(almuerzoCode ?? "")}`);

  // 5. El escáner en la puerta
  paso("El escáner en la puerta (POST /api/scan/open con el código de la puerta): decide sin red y sincroniza");
  check((await json("/api/scan/open", { code: "ZZZZ-ZZZZ" })).status === 401, "un código que no es de ningún puesto: 401");
  const puerta = await json("/api/scan/open", { code: formatStationCode(puertaCode).toLowerCase() });
  check(puerta.status === 200 && puerta.cuerpo.station?.kind === "gate" && puerta.cuerpo.passes.length >= 2, `la puerta abre (en minúsculas y con guion) y baja la llave del evento y ${puerta.cuerpo.passes.length} pases`);
  const llave = base64urlToBytes(puerta.cuerpo.key);
  const verifica = (qr) => verifyQrPayload(qr, llave);
  const paseEn = (snapshot, id) => snapshot.passes.find((p) => p.id === id);
  check(verifica(qrGratis).ok && verifica(qrPago).ok, "las dos credenciales llevan una firma válida");
  const alterado = qrGratis.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  check(!verifica(alterado).ok && decideVerdict(verifica(alterado), puerta.cuerpo.station, undefined, undefined).kind === "no", "una credencial con una letra cambiada no corresponde");
  const v1 = decideVerdict(verifica(qrGratis), puerta.cuerpo.station, paseEn(puerta.cuerpo, paseGratis.id), undefined);
  const v2 = decideVerdict(verifica(qrPago), puerta.cuerpo.station, paseEn(puerta.cuerpo, pasePago.id), undefined);
  check(v1.kind === "ok" && v1.action === "checkin" && v1.name === gratis.nombre, `${gratis.nombre}: verde, entra`);
  check(v2.kind === "ok" && v2.action === "checkin" && v2.name === almuerzo.nombre, `${almuerzo.nombre}: verde, entra`);
  const ahora = () => new Date().toISOString();
  const local = { checkedInAt: ahora(), redeemed: {} };
  const v1b = decideVerdict(verifica(qrGratis), puerta.cuerpo.station, paseEn(puerta.cuerpo, paseGratis.id), local);
  check(v1b.kind === "already" && v1b.action === "checkin", `${gratis.nombre} otra vez, antes de sincronizar: amarillo, ya entró (lo sabe la cola local)`);

  inicio = Date.now();
  const items = [
    { clientId: `e2e-${stamp}-entrada-1`, action: "checkin", passId: paseGratis.id, benefitId: null, scannedAt: ahora(), scannerId: "e2e-puerta" },
    { clientId: `e2e-${stamp}-entrada-2`, action: "checkin", passId: pasePago.id, benefitId: null, scannedAt: ahora(), scannerId: "e2e-puerta" },
  ];
  const sync1 = await json("/api/scan/sync", { code: puertaCode, items });
  const resultados1 = sync1.cuerpo.results ?? [];
  check(sync1.status === 200 && resultados1.length === 2 && resultados1.every((r) => r.status === "synced" && r.txHash), `la cola se sincronizó: las dos entradas llegaron al contrato en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  for (const r of resultados1) {
    const item = items.find((i) => i.clientId === r.clientId);
    if (r.txHash) tx(`entrada por la puerta de ${item?.passId === paseGratis.id ? gratis.nombre : almuerzo.nombre} (check_in, firma la puerta, paga el servidor)`, r.txHash);
  }
  check(Boolean(paseEn(sync1.cuerpo.snapshot, paseGratis.id)?.checkedInAt), "la foto fresca del evento ya dice que entraron");
  const repetir = await json("/api/scan/sync", { code: puertaCode, items: [{ ...items[0], clientId: `e2e-${stamp}-entrada-1-otro-puesto` }] });
  check(repetir.cuerpo.results?.[0]?.status === "duplicate", `la misma entrada desde otro puesto que no lo sabía: el contrato la rechaza (${repetir.cuerpo.results?.[0]?.error}) y queda como "doble, revisar"`);
  const mismo = await json("/api/scan/sync", { code: puertaCode, items: [items[0]] });
  check(mismo.cuerpo.results?.[0]?.status === "synced" && mismo.cuerpo.results?.[0]?.txHash === resultados1[0].txHash, "reintentar el mismo registro (mismo clientId) no duplica nada");
  const fuera = await json("/api/scan/sync", { code: puertaCode, items: [{ clientId: `e2e-${stamp}-fuera`, action: "redeem", passId: pasePago.id, benefitId: lunch.id, scannedAt: ahora(), scannerId: "e2e-puerta" }] });
  check(fuera.cuerpo.results?.[0]?.status === "rejected", "un canje mandado con el código de la puerta se rechaza: cada puesto hace lo suyo");

  // 6. La mesa del almuerzo
  paso(`La mesa del almuerzo (código ${formatStationCode(almuerzoCode)}): canjea una sola vez`);
  const mesa = await json("/api/scan/open", { code: almuerzoCode });
  check(mesa.status === 200 && mesa.cuerpo.station?.kind === "benefit" && mesa.cuerpo.station.id === lunch.id, `la mesa abre con su puesto "${mesa.cuerpo.station?.name}"`);
  const v3 = decideVerdict(verifica(qrGratis), mesa.cuerpo.station, paseEn(mesa.cuerpo, paseGratis.id), undefined);
  check(v3.kind === "no" && v3.reason === "not_included", `${gratis.nombre} (inscripción gratis): no corresponde, la entrada no incluye el almuerzo`);
  const v4 = decideVerdict(verifica(qrPago), mesa.cuerpo.station, paseEn(mesa.cuerpo, pasePago.id), undefined);
  check(v4.kind === "ok" && v4.action === "redeem", `${almuerzo.nombre}: verde, canjea el almuerzo`);
  inicio = Date.now();
  const canje = { clientId: `e2e-${stamp}-almuerzo-1`, action: "redeem", passId: pasePago.id, benefitId: lunch.id, scannedAt: ahora(), scannerId: "e2e-mesa" };
  const sync2 = await json("/api/scan/sync", { code: almuerzoCode, items: [canje] });
  const canjeado = sync2.cuerpo.results?.[0];
  check(sync2.status === 200 && canjeado?.status === "synced" && canjeado.txHash, `el canje llegó al contrato en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  if (canjeado?.txHash) tx(`canje del almuerzo de ${almuerzo.nombre} (redeem, firma la puerta)`, canjeado.txHash);
  const v5 = decideVerdict(verifica(qrPago), sync2.cuerpo.snapshot.station, paseEn(sync2.cuerpo.snapshot, pasePago.id), undefined);
  check(v5.kind === "already" && v5.action === "redeem", `${almuerzo.nombre} otra vez: amarillo, ya canjeado (el escáner lo decide solo, sin mandar nada)`);
  const segundo = await json("/api/scan/sync", { code: almuerzoCode, items: [{ ...canje, clientId: `e2e-${stamp}-almuerzo-2` }] });
  check(segundo.cuerpo.results?.[0]?.status === "duplicate", `y si otro puesto lo manda igual, el contrato lo rechaza (${segundo.cuerpo.results?.[0]?.error})`);
  const sinAlmuerzo = await json("/api/scan/sync", { code: almuerzoCode, items: [{ ...canje, clientId: `e2e-${stamp}-almuerzo-gratis`, passId: paseGratis.id }] });
  check(sinAlmuerzo.cuerpo.results?.[0]?.status === "rejected", `un canje para quien no lo tiene se rechaza en el servidor (${sinAlmuerzo.cuerpo.results?.[0]?.error})`);

  // 7. La cadena
  paso("La cadena: status(), attendees() e info() de cada contrato");
  const s1 = await rumboPass.status(contratoGratis, paseGratis.account);
  const s2 = await rumboPass.status(contratoPago, pasePago.account);
  check(s1.has_pass && s1.number === paseGratis.chainNumber && s1.checked_in && s1.redeemed.length === 0, `${gratis.nombre}: pase ${s1.number}, entró, sin canjes (${JSON.stringify(s1)})`);
  check(s2.has_pass && s2.number === pasePago.chainNumber && s2.checked_in && s2.redeemed.length === 1, `${almuerzo.nombre}: pase ${s2.number}, entró, almuerzo canjeado (${JSON.stringify(s2)})`);
  const [a1, a2] = await Promise.all([rumboPass.attendees(contratoGratis), rumboPass.attendees(contratoPago)]);
  check(a1.includes(paseGratis.account) && a2.includes(pasePago.account), `attendees() de cada contrato incluye a quien entró (${a1.length} y ${a2.length} cuentas en total, con las de otras corridas)`);
  const infoGratis = await rumboPass.info(contratoGratis);
  log(`  info(): el contrato gratis lleva ${infoGratis.issued} pases emitidos y ${infoGratis.checked_in} entradas; el pago, ${infoPago.issued} pases emitidos (los de esta corrida incluidos)`);

  // 8. El panel después del evento
  paso("El panel después: los contadores, los dobles y el contraste con la cadena");
  const panel1 = await pedir(`/api/admin/${SLUG}?k=${clavePanel}`);
  const c = panel1.cuerpo.counters;
  const mio = (id) => panel1.cuerpo.passes.find((p) => p.id === id);
  check(mio(paseGratis.id)?.status === "checked_in" && mio(pasePago.id)?.status === "checked_in", "los dos pases figuran como que entraron");
  check(mio(pasePago.id)?.benefits.some((b) => b.benefitId === lunch.id && b.redeemed), `el almuerzo de ${almuerzo.nombre} figura canjeado`);
  check(panel1.cuerpo.duplicates.length >= 2, `dobles para revisar: ${panel1.cuerpo.duplicates.length} (la entrada repetida y el canje repetido)`);
  log(`  contadores: ${c.issued} credenciales (${c.pending} pendientes de pago), ${c.checkedIn} entraron, almuerzos ${c.lunch.redeemed} de ${c.lunch.granted}, premios ${c.prizes.redeemed} de ${c.prizes.granted}; por sincronizar ${panel1.cuerpo.pendingSync}`);
  if (servidorPropio) {
    check(c.issued === 2 && c.checkedIn === 2 && c.lunch.granted === 1 && c.lunch.redeemed === 1 && panel1.cuerpo.pendingSync === 0, "con la base nueva: 2 credenciales, 2 entraron, 1 almuerzo de 1, nada por sincronizar");
  }

  inicio = Date.now();
  const cadena = await json(`/api/admin/${SLUG}/cadena?k=${clavePanel}`, {});
  const sync = cadena.cuerpo.sync;
  check(cadena.status === 200 && sync, `POST /api/admin/${SLUG}/cadena contrastó ${sync?.passesChecked} pases en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  if (sync) {
    for (const ct of sync.contracts) log(`  ${ct.label}: ${ct.issued} pases emitidos y ${ct.checkedIn} entradas en la cadena, ${ct.knownAttendees} de este evento${ct.error ? ` (error: ${ct.error})` : ""}`);
    const misDiferencias = sync.mismatches.filter((m) => m.passId === paseGratis.id || m.passId === pasePago.id);
    check(misDiferencias.length === 0 && sync.checkInsAdded === 0 && sync.redemptionsAdded === 0, `la cadena no tenía nada que el espejo no supiera (agregó ${sync.checkInsAdded} entradas y ${sync.redemptionsAdded} canjes; diferencias en estos pases: ${misDiferencias.length})`);
    const conocidos = sync.contracts.reduce((n, ct) => n + ct.knownAttendees, 0);
    const d = cadena.cuerpo.state.counters;
    if (servidorPropio) {
      check(sync.mismatches.length === 0 && sync.pendingSync === 0 && conocidos === d.checkedIn, `los números coinciden: ${d.checkedIn} entraron según el panel y ${conocidos} cuentas de este evento entraron según la cadena; sin diferencias ni pendientes`);
    } else {
      log(`  panel: ${d.checkedIn} entraron; cadena: ${conocidos} cuentas de este evento entraron; diferencias ${sync.mismatches.length}, por sincronizar ${sync.pendingSync}`);
    }
    check(d.issued === c.issued && d.checkedIn === c.checkedIn && d.lunch.redeemed === c.lunch.redeemed, "los contadores no cambiaron al contrastar: el espejo ya decía lo mismo que la cadena");
  }

  paso("El informe para quien auspicia y el CSV para quien organiza");
  const entrar = await fetch(`${BASE}/api/admin/${SLUG}/entrar?k=${clavePanel}&next=informe`, { redirect: "manual" });
  const cookie = entrar.headers.get("set-cookie")?.split(";")[0] ?? "";
  check(entrar.status === 303 && cookie.startsWith(`rumbo.panel.${SLUG}=`), "entrar con la clave deja la cookie del panel y sigue al informe");
  const informe = await pedir(`/admin/${SLUG}/informe`, { headers: { cookie } });
  const titular = `${lunch.name}: ${c.lunch.redeemed} de ${c.lunch.granted} canjeados`;
  check(informe.status === 200 && informe.cuerpo.includes(titular), `el informe dice "${titular}"`);
  check(!informe.cuerpo.includes(gratis.nombre) && !informe.cuerpo.includes(almuerzo.nombre) && !informe.cuerpo.includes("@example.com"), "el informe no trae nombres ni correos");
  const csv = await pedir(`/api/admin/${SLUG}/csv`, { headers: { cookie } });
  check(csv.status === 200 && csv.cuerpo.includes(gratis.correo) && csv.cuerpo.includes(almuerzo.correo) && csv.cuerpo.includes("Entró"), `el CSV para quien organiza sí lleva a las ${csv.cuerpo.trim().split(/\r?\n/).length - 1} personas con su correo y su estado`);
} catch (error) {
  fallas.push(`la corrida se cortó: ${error instanceof Error ? error.message : String(error)}`);
  log(`\nLa corrida se cortó: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
} finally {
  apagarServidor();
}

log(`\n${fallas.length === 0 ? "TODO BIEN" : `${fallas.length} FALLA(S)`}: ${comprobaciones - fallas.length} de ${comprobaciones} comprobaciones en ${segundos()}.`);
for (const f of fallas) log(`  - ${f}`);
if (transacciones.length) {
  log(`\nLas transacciones de esta corrida en la red de prueba (${transacciones.length}):`);
  for (const { que, hash } of transacciones) log(`  ${que}\n    ${explorer(hash)}`);
}
guardar();
console.log(`\nTranscripción guardada en ${relative(APP_DIR, SALIDA).replace(/\\/g, "/")}`);
process.exit(fallas.length === 0 ? 0 : 1);
