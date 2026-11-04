// El flujo entero de Rumbo contra la red de prueba, con la app levantada, de punta a punta y por la API:
//   1. el evento de muestra (pnpm seed, sobre una base nueva),
//   2. una persona se inscribe gratis y otra compra la entrada con almuerzo (10 USDC de prueba: la plata
//      sale de su cuenta y llega a quien organiza y a Rumbo en la misma transacción),
//   3. cada una abre su credencial (la página, los datos y el SVG), y el enlace sin clave no abre,
//   4. el escáner, por su API: la puerta registra a las dos (y la segunda lectura dice "ya entró"), la mesa
//      del almuerzo canjea el de quien lo pagó, el segundo canje no pasa (ni en el escáner ni en el contrato)
//      y la inscripción gratis no lo incluye,
//   5. status(), attendees() e info() en la cadena, y el panel (contadores, dobles, contraste con la cadena,
//      el informe sin nombres y el CSV) dicen lo mismo,
//   6. la cuenta propia (Pollar): una llave local hace de la billetera de Pollar, sin cuenta en la red todavía.
//      Pide el desafío, lo firma según SEP-53, se inscribe gratis (la patrocinadora crea la cuenta), firma la
//      autorización de register en su "dispositivo" y el servidor la manda pagando la comisión; otra compra la
//      entrada con almuerzo (acepta el USDC de prueba, recibe saldo de prueba y autoriza buy), y la puerta deja
//      entrar a la primera. Un desafío, una autorización de otra llave y un pedido de firma usado no sirven.
// Deja la transcripción, con los ids de las transacciones, en demo/e2e-testnet.txt.
//
//   node scripts/e2e-testnet.mjs                  levanta su propio servidor (next dev) con una base nueva en data/e2e
//   node scripts/e2e-testnet.mjs --base http://127.0.0.1:3000 [--datos ./data]   usa un servidor ya levantado
//   --port 4410            el puerto del servidor propio
//   --salida demo/e2e-testnet.txt   dónde queda la transcripción (relativo a app/)
//   --slug hackaton-comunidad       el evento
//   --motor postgres       la base en Postgres en vez de SQLite: levanta un Postgres local (scripts/postgres-local.mjs,
//                          PGlite servido por la red), lo migra con pnpm db:migrate y corre el servidor, el seed y este
//                          script con RUMBO_REPO=postgres y el driver de producción. Con --base, el servidor ya levantado
//                          tiene que usar la misma DATABASE_URL.
//   --puerto-pg 4411       el puerto de ese Postgres local
//   --contratos nuevos     despliega para la corrida un contrato gratis y uno pago con el mismo WASM, las mismas cuentas y
//                          el mismo USDC de prueba que el despliegue de muestra, y apunta las entradas a esos: por si los de
//                          muestra (contracts/rumbo-pass/deploy/testnet.json, lo de siempre) se llenan, porque cada corrida
//                          gasta cupo. Solo con el servidor propio (con --base, el evento es el del servidor que ya está).
//
// Tarda entre dos y seis minutos según la red de prueba: cada inscripción, entrada y canje es una transacción.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const MOTOR = option("--motor", "sqlite");
const PUERTO_PG = Number(option("--puerto-pg", PORT + 1));
const CONTRATOS = servidorPropio ? option("--contratos", "muestra") : "muestra";
if (MOTOR !== "sqlite" && MOTOR !== "postgres") throw new Error(`--motor ${MOTOR}: tiene que ser sqlite o postgres`);
if (CONTRATOS !== "nuevos" && CONTRATOS !== "muestra") throw new Error(`--contratos ${CONTRATOS}: tiene que ser nuevos o muestra`);

// La base y los correos del servidor y los de este script tienen que ser los mismos: se fija antes de cargar nada.
process.env.RUMBO_DATA_DIR = DATOS;
process.env.NEXT_PUBLIC_BASE_URL = BASE;
if (MOTOR === "postgres") process.env.RUMBO_REPO = "postgres";
loadEnv();

const { getRepo } = await import("../src/server/repo.ts");
const { getAccessKey } = await import("../src/server/evento/acceso.ts");
const { ensureStationCodes, getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { formatStationCode } = await import("../src/lib/station-code.ts");
const { decideVerdict } = await import("../src/lib/escaner-api.ts");
const { verifyQrPayload, base64urlToBytes, bytesToBase64url, buildPrintedPayload } = await import("../src/server/qr.ts");
const { getEventQrKeys } = await import("../src/server/qr-keys.ts");
const { buildLivePayload } = await import("../src/lib/qr-live.ts");
const { WINDOW_SECONDS } = await import("../src/lib/qr-codec.ts");
const { rumboPass, getBalance, getTestAsset, readDeployInfo, fromStroops, accountExists, submitClassic } = await import("../src/server/stellar.ts");
const { sep53Digest } = await import("../src/server/cuenta-propia.ts");
const { Keypair, Networks, Operation, authorizeEntry, inspectAuthEntry, xdr } = await import("@stellar/stellar-sdk");

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
/** Un código de puesto o el texto de un QR, tapados: las primeras cuatro letras y nada más (la transcripción es pública). */
const tapado = (texto) => `${String(texto ?? "").slice(0, 4)}...`;
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
  // Se escribe mientras corre: al apagarlo con taskkill /F el proceso no llega a avisar que terminó.
  writeFileSync(logServidor, "", "utf8");
  for (const stream of [proc.stdout, proc.stderr]) {
    stream.on("data", (chunk) => {
      try {
        appendFileSync(logServidor, chunk.toString(), "utf8");
      } catch {
        /* la carpeta ya no está */
      }
    });
  }
  return proc;
}

/** Cierra solo el servidor que levantó este script (y sus procesos hijos). */
function apagarServidor() {
  for (const proc of [servidor, postgres]) {
    if (!proc || proc.exitCode !== null) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    else proc.kill();
  }
}
process.on("SIGINT", () => {
  apagarServidor();
  process.exit(130);
});

// ---------- La base en Postgres (--motor postgres) ----------

let postgres = null;

/**
 * Levanta el Postgres local en su propio proceso (este script espera al seed con spawnSync, y un servidor en este
 * mismo proceso quedaría congelado mientras tanto), deja su DATABASE_URL y una RUMBO_DATA_KEY nueva (la base es
 * nueva) en el entorno que heredan el servidor y el seed, y lo migra con pnpm db:migrate, como a Supabase.
 */
async function levantarPostgres() {
  const proc = spawn(process.execPath, [join(APP_DIR, "scripts", "postgres-local.mjs"), "--datos", join(DATOS, "postgres"), "--puerto", String(PUERTO_PG)], {
    cwd: APP_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  postgres = proc;
  const url = await new Promise((resolve, reject) => {
    let salida = "";
    const plazo = setTimeout(() => reject(new Error(`el Postgres local no arrancó: ${salida.slice(-300)}`)), 60_000);
    for (const stream of [proc.stdout, proc.stderr]) {
      stream.on("data", (chunk) => {
        salida += chunk.toString();
        const match = /DATABASE_URL=(\S+)/.exec(salida);
        if (match) {
          clearTimeout(plazo);
          resolve(match[1]);
        }
      });
    }
    proc.on("exit", (code) => reject(new Error(`el Postgres local se cerró (código ${code}): ${salida.slice(-300)}`)));
  });
  process.env.DATABASE_URL = url;
  process.env.RUMBO_DATA_KEY = randomBytes(32).toString("base64");
  const migrar = spawnSync(process.execPath, [join(APP_DIR, "scripts", "db-migrate.mjs")], { cwd: APP_DIR, env: process.env, encoding: "utf8" });
  for (const linea of `${migrar.stdout}${migrar.stderr}`.split(/\r?\n/).filter((l) => l.trim())) log(`  ${linea}`);
  check(migrar.status === 0, "pnpm db:migrate aplicó las migraciones de Postgres");
  return url;
}

// ---------- El flujo ----------

const stamp = Date.now().toString(36);
const gratis = { nombre: "Valeria Prueba", correo: `e2e-${stamp}-gratis@example.com` };
const almuerzo = { nombre: "Mateo Prueba", correo: `e2e-${stamp}-almuerzo@example.com` };

try {
  log(`Rumbo, el flujo entero contra la red de prueba de Stellar. ${new Date().toISOString()}`);
  log(`Servidor: ${BASE} (${servidorPropio ? "levantado por este script" : "ya levantado"}). Datos: ${DATOS}.`);
  log(`Base: ${MOTOR === "postgres" ? "Postgres (RUMBO_REPO=postgres, el driver de producción con prepare: false)" : "SQLite (RUMBO_REPO=sqlite)"}.`);
  const deploy = readDeployInfo();
  if (deploy) {
    log(`Red: testnet. Contratos rumbo-pass: gratis ${deploy.events.free?.contract ?? "(no hay)"}, pago ${deploy.events.paid?.contract ?? "(no hay)"}.`);
    log(`USDC de prueba: ${deploy.asset?.code}:${deploy.asset?.issuer} (contrato ${deploy.asset?.contract}).`);
  }

  if (servidorPropio) {
    paso(`Una base nueva en ${DATOS} y el servidor de desarrollo en el puerto ${PORT}`);
    rmSync(join(APP_DIR, DATOS), { recursive: true, force: true });
    mkdirSync(join(APP_DIR, DATOS), { recursive: true });
    if (MOTOR === "postgres") {
      const url = await levantarPostgres();
      check(true, `el Postgres local contesta en ${new URL(url).host}`);
    }
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
  let event = await repo.getEventBySlug(SLUG);
  if (!event) throw new Error(`no existe el evento ${SLUG}`);

  if (CONTRATOS === "nuevos") {
    paso("Dos contratos nuevos para esta corrida: el mismo WASM, las mismas cuentas y el mismo USDC de prueba que el despliegue de muestra");
    const { networkProvisioner } = await import("../src/server/kit/publicar.ts");
    const muestra = { gratis: deploy?.events.free, pago: deploy?.events.paid };
    const nuevos = {
      gratis: await networkProvisioner.deploy({ price: 0, capacity: 50, benefits: muestra.gratis?.benefits ?? 1, organizerAccount: event.organizerAccount }),
      pago: await networkProvisioner.deploy({ price: fromStroops(muestra.pago?.price ?? "100000000"), capacity: 50, benefits: muestra.pago?.benefits ?? 2, organizerAccount: event.organizerAccount }),
    };
    for (const ticket of await repo.listTicketTypes(event.id)) {
      const nuevo = ticket.contractId === muestra.gratis?.contract ? nuevos.gratis : ticket.contractId === muestra.pago?.contract ? nuevos.pago : null;
      if (nuevo) await repo.updateTicketType(ticket.id, { contractId: nuevo });
    }
    if (event.contractId === muestra.gratis?.contract) event = await repo.updateEvent(event.id, { contractId: nuevos.gratis });
    check(true, `contrato gratis ${nuevos.gratis} y pago ${nuevos.pago}; las entradas del evento apuntan a esos`);
  }
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
  const claveGratis = await getAccessKey(paseGratis.id);
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
  const clavePago = await getAccessKey(pasePago.id);
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
  // Quien se inscribió gratis muestra el QR que rota (lo arma su celular con lo que le dio la credencial); quien pagó, la credencial impresa.
  const qrGratis = () => buildLivePayload(c1.cuerpo.live, Date.now());
  const qrPago = c2.cuerpo.qr;
  log(`  QR del celular de ${gratis.nombre} (cambia cada ${WINDOW_SECONDS} s, ${(await qrGratis()).length} letras): ${tapado(await qrGratis())}`);
  log(`  QR fijo de la credencial impresa de ${almuerzo.nombre} (${qrPago.length} letras): ${tapado(qrPago)}`);
  check(c1.cuerpo.live?.passId === paseGratis.id && !("privateKey" in c1.cuerpo.live), "la credencial entrega la llave de ese pase y nada más");
  const pagina = await pedir(`/p/${paseGratis.id}?k=${encodeURIComponent(claveGratis)}`);
  check(pagina.status === 200 && pagina.cuerpo.includes(gratis.nombre) && pagina.cuerpo.includes("Descargar en SVG"), `la página /p/${paseGratis.id} se ve con el nombre y su única acción`);
  const listo = await pedir(`/e/${SLUG}/listo?pase=${pasePago.id}&k=${encodeURIComponent(clavePago)}`);
  check(listo.status === 200 && listo.cuerpo.includes("Entrada paga") && listo.cuerpo.includes("Ver mi credencial"), `la confirmación /e/${SLUG}/listo dice "Entrada paga" y lleva a la credencial`);
  const svg = await pedir(`/api/pase/${paseGratis.id}/svg?k=${encodeURIComponent(claveGratis)}`);
  check(svg.status === 200 && svg.res.headers.get("content-type")?.startsWith("image/svg+xml") && svg.cuerpo.includes(gratis.nombre) && svg.cuerpo.includes("CREDENCIAL IMPRESA"), `el SVG para imprimir baja con el nombre y marcado como impreso (${Buffer.byteLength(svg.cuerpo)} bytes)`);
  check((await pedir(`/api/pase/${paseGratis.id}?k=${"A".repeat(22)}`)).status === 404, "con otra clave la credencial da 404");
  check((await pedir(`/p/${paseGratis.id}`)).status === 404, "sin clave la página da 404 (no dice si el pase existe)");

  // 4. El panel: la clave de organizador y los códigos de puesto
  paso("El panel de quien organiza: la clave, los códigos de puesto y los contadores antes del evento");
  const clavePanel = await getOrCreateOrganizerKey(event.id);
  await ensureStationCodes(event, repo);
  check((await pedir(`/api/admin/${SLUG}`)).status === 401, `GET /api/admin/${SLUG} sin clave: 401`);
  const panel0 = await pedir(`/api/admin/${SLUG}?k=${clavePanel}`);
  check(panel0.status === 200 && panel0.cuerpo.counters?.issued >= 2 && panel0.cuerpo.counters?.checkedIn === 0, `con la clave: ${panel0.cuerpo.counters?.issued} credenciales, ${panel0.cuerpo.counters?.checkedIn} entraron, almuerzos ${panel0.cuerpo.counters?.lunch?.redeemed} de ${panel0.cuerpo.counters?.lunch?.granted}`);
  const puertaCode = panel0.cuerpo.stations?.find((s) => s.kind === "gate")?.code;
  const almuerzoCode = panel0.cuerpo.stations?.find((s) => s.kind === "benefit" && s.benefitId === lunch.id)?.code;
  check(Boolean(puertaCode && almuerzoCode), `códigos de puesto: puerta ${tapado(puertaCode)}, ${lunch.name} ${tapado(almuerzoCode)} (doce letras cada uno; acá, tapados)`);

  // 5. El escáner en la puerta
  paso("El escáner en la puerta (POST /api/scan/open con el código de la puerta): decide sin red y sincroniza");
  check((await json("/api/scan/open", { code: "ZZZZ-ZZZZ" })).status === 401, "un código que no es de ningún puesto: 401");
  const puerta = await json("/api/scan/open", { code: formatStationCode(puertaCode).toLowerCase() });
  check(puerta.status === 200 && puerta.cuerpo.station?.kind === "gate" && puerta.cuerpo.passes.length >= 2, `la puerta abre (en minúsculas y con guion) y baja la llave del evento y ${puerta.cuerpo.passes.length} pases`);
  check(puerta.cuerpo.key === undefined && typeof puerta.cuerpo.publicKey === "string", "el escáner recibe una clave pública, no una llave compartida");
  const clavePublica = base64urlToBytes(puerta.cuerpo.publicKey);
  const llavesDelEvento = await getEventQrKeys(event.id);
  check(clavePublica.length === 32 && bytesToBase64url(llavesDelEvento.publicKey) === puerta.cuerpo.publicKey, "es la clave pública del evento (32 bytes)");
  const textoPuerta = JSON.stringify(puerta.cuerpo);
  check(
    !textoPuerta.includes(bytesToBase64url(llavesDelEvento.privateKey)) && !textoPuerta.includes(bytesToBase64url(llavesDelEvento.credentialRoot)),
    "nada de lo que baja el escáner sirve para fabricar credenciales: ni la llave privada del evento ni la raíz de las credenciales",
  );
  const verifica = (qr, ahora = Date.now()) => verifyQrPayload(qr, clavePublica, ahora);
  const paseEn = (snapshot, id) => snapshot.passes.find((p) => p.id === id);
  const vivo = await verifica(await qrGratis());
  const impreso = await verifica(qrPago);
  check(vivo.ok && vivo.via === "live" && impreso.ok && impreso.via === "printed", "las dos credenciales llevan una firma válida: la del celular (que rota) y la impresa (fija)");
  const alterado = (await qrGratis()).replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  check(!(await verifica(alterado)).ok && decideVerdict(await verifica(alterado), puerta.cuerpo.station, undefined, undefined).kind === "no", "una credencial con una letra cambiada no corresponde");
  const captura = await verifica(await qrGratis(), Date.now() + 3 * WINDOW_SECONDS * 1000);
  check(!captura.ok && captura.reason === "expired", `una captura de pantalla vieja (de hace ${3 * WINDOW_SECONDS} s) no sirve: el QR venció`);
  const anterior = await verifica(await qrGratis(), Date.now() + WINDOW_SECONDS * 1000);
  check(anterior.ok, "pero la ventana anterior sí se acepta (el celular de la persona puede ir atrasado)");
  const v1 = decideVerdict(vivo, puerta.cuerpo.station, paseEn(puerta.cuerpo, paseGratis.id), undefined);
  const v2 = decideVerdict(impreso, puerta.cuerpo.station, paseEn(puerta.cuerpo, pasePago.id), undefined);
  check(v1.kind === "ok" && v1.action === "checkin" && v1.name === gratis.nombre && v1.via === undefined, `${gratis.nombre}: verde, entra`);
  check(v2.kind === "ok" && v2.action === "checkin" && v2.name === almuerzo.nombre && v2.via === "printed", `${almuerzo.nombre}: verde, entra, y el veredicto dice que la credencial es la impresa`);
  const ahora = () => new Date().toISOString();
  const local = { checkedInAt: ahora(), redeemed: {} };
  const v1b = decideVerdict(await verifica(await qrGratis()), puerta.cuerpo.station, paseEn(puerta.cuerpo, paseGratis.id), local);
  check(v1b.kind === "already" && v1b.action === "checkin", `${gratis.nombre} otra vez, antes de sincronizar: amarillo, ya entró (lo sabe la cola local)`);

  inicio = Date.now();
  // Cada lectura viaja con el QR que se leyó: el servidor vuelve a comprobar la firma antes de registrarla.
  const items = [
    { clientId: `e2e-${stamp}-entrada-1`, action: "checkin", passId: paseGratis.id, benefitId: null, scannedAt: ahora(), scannerId: "e2e-puerta", qr: await qrGratis() },
    { clientId: `e2e-${stamp}-entrada-2`, action: "checkin", passId: pasePago.id, benefitId: null, scannedAt: ahora(), scannerId: "e2e-puerta", qr: qrPago },
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
  const fuera = await json("/api/scan/sync", { code: puertaCode, items: [{ clientId: `e2e-${stamp}-fuera`, action: "redeem", passId: pasePago.id, benefitId: lunch.id, scannedAt: ahora(), scannerId: "e2e-puerta", qr: qrPago }] });
  check(fuera.cuerpo.results?.[0]?.status === "rejected", "un canje mandado con el código de la puerta se rechaza: cada puesto hace lo suyo");
  const sinQr = await json("/api/scan/sync", { code: puertaCode, items: [{ clientId: `e2e-${stamp}-sin-qr`, action: "checkin", passId: pasePago.id, benefitId: null, scannedAt: ahora(), scannerId: "e2e-puerta" }] });
  check(sinQr.cuerpo.results?.[0]?.status === "rejected", `una entrada sin el QR leído se rechaza (${sinQr.cuerpo.results?.[0]?.error}): con el código de un puesto no se registra a quien nunca pasó`);

  // 6. La mesa del almuerzo
  paso(`La mesa del almuerzo (código ${tapado(almuerzoCode)}): canjea una sola vez`);
  const mesa = await json("/api/scan/open", { code: almuerzoCode });
  check(mesa.status === 200 && mesa.cuerpo.station?.kind === "benefit" && mesa.cuerpo.station.id === lunch.id, `la mesa abre con su puesto "${mesa.cuerpo.station?.name}"`);
  const v3 = decideVerdict(await verifica(await qrGratis()), mesa.cuerpo.station, paseEn(mesa.cuerpo, paseGratis.id), undefined);
  check(v3.kind === "no" && v3.reason === "not_included", `${gratis.nombre} (inscripción gratis): no corresponde, la entrada no incluye el almuerzo`);
  const v4 = decideVerdict(await verifica(qrPago), mesa.cuerpo.station, paseEn(mesa.cuerpo, pasePago.id), undefined);
  check(v4.kind === "ok" && v4.action === "redeem", `${almuerzo.nombre}: verde, canjea el almuerzo`);
  inicio = Date.now();
  const canje = { clientId: `e2e-${stamp}-almuerzo-1`, action: "redeem", passId: pasePago.id, benefitId: lunch.id, scannedAt: ahora(), scannerId: "e2e-mesa", qr: qrPago };
  const sync2 = await json("/api/scan/sync", { code: almuerzoCode, items: [canje] });
  const canjeado = sync2.cuerpo.results?.[0];
  check(sync2.status === 200 && canjeado?.status === "synced" && canjeado.txHash, `el canje llegó al contrato en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  if (canjeado?.txHash) tx(`canje del almuerzo de ${almuerzo.nombre} (redeem, firma la puerta)`, canjeado.txHash);
  const v5 = decideVerdict(await verifica(qrPago), sync2.cuerpo.snapshot.station, paseEn(sync2.cuerpo.snapshot, pasePago.id), undefined);
  check(v5.kind === "already" && v5.action === "redeem", `${almuerzo.nombre} otra vez: amarillo, ya canjeado (el escáner lo decide solo, sin mandar nada)`);
  const segundo = await json("/api/scan/sync", { code: almuerzoCode, items: [{ ...canje, clientId: `e2e-${stamp}-almuerzo-2` }] });
  check(segundo.cuerpo.results?.[0]?.status === "duplicate", `y si otro puesto lo manda igual, el contrato lo rechaza (${segundo.cuerpo.results?.[0]?.error})`);
  const sinAlmuerzo = await json("/api/scan/sync", { code: almuerzoCode, items: [{ ...canje, clientId: `e2e-${stamp}-almuerzo-gratis`, passId: paseGratis.id, qr: await qrGratis() }] });
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

  // 9. La cuenta propia: una llave local hace de la billetera de Pollar (lo que en el navegador firma Pollar)
  const propia = { nombre: "Lucía Prueba", correo: `e2e-${stamp}-propia@example.com`, llave: Keypair.random() };
  const propiaPaga = { nombre: "Tomás Prueba", correo: `e2e-${stamp}-propia-paga@example.com`, llave: Keypair.random() };
  /** El desafío del servidor, firmado según SEP-53 por la llave: lo que hace client.stellar.sep53.signMessage. */
  const probarCuenta = async (llave) => {
    const d = await json("/api/cuenta/desafio", { publicKey: llave.publicKey(), lang: "es" });
    const firma = d.cuerpo.message ? Buffer.from(llave.sign(sep53Digest(d.cuerpo.message))).toString("base64") : "";
    return { status: d.status, wallet: { provider: "pollar", publicKey: llave.publicKey(), challengeId: d.cuerpo.challengeId, signature: firma } };
  };
  /** La autorización firmada por la llave: lo que hace client.signAuthEntry(entry, { validUntilLedger }). */
  const autorizar = async (cuerpo, llave) => (await authorizeEntry(xdr.SorobanAuthorizationEntry.fromXdr(cuerpo.authEntry, "base64"), llave, cuerpo.validUntilLedger, Networks.TESTNET)).toXdr("base64");
  const inscribirPropia = (persona, entrada, wallet) => json(`/api/evento/${SLUG}/inscripcion`, { ticketTypeId: entrada.id, name: persona.nombre, email: persona.correo, lang: "es", wallet });
  const firmar = (requestId, signedAuthEntry) => json(`/api/evento/${SLUG}/inscripcion/firma`, { requestId, signedAuthEntry, lang: "es" });

  paso(`Inscripción gratis de ${propia.nombre} con su cuenta propia: una llave local hace de la billetera de Pollar, y la cuenta todavía no existe en la red`);
  check(!(await accountExists(propia.llave.publicKey())), `la cuenta ${propia.llave.publicKey()} no existe en la red`);
  const prueba1 = await probarCuenta(propia.llave);
  check(prueba1.status === 201 && Boolean(prueba1.wallet.challengeId), "POST /api/cuenta/desafio da un desafío de un solo uso, y la llave lo firma según SEP-53");
  inicio = Date.now();
  const w1 = await inscribirPropia(propia, entradaGratis, prueba1.wallet);
  check(w1.status === 202 && w1.cuerpo.status === "needs_signature" && w1.cuerpo.fn === "register", `la inscripción devuelve la autorización de register para firmar en el dispositivo (${w1.status}, en ${((Date.now() - inicio) / 1000).toFixed(0)} s)`);
  check(await accountExists(propia.llave.publicKey()), "la patrocinadora creó la cuenta en la red, porque Pollar todavía no lo había hecho");
  const tipoCredencial = w1.cuerpo.authEntry ? inspectAuthEntry(xdr.SorobanAuthorizationEntry.fromXdr(w1.cuerpo.authEntry, "base64")).credentialType : null;
  check(tipoCredencial === "address", `lo que se da a firmar usa las credenciales de antes de CAP-71 (${tipoCredencial}), las que entiende cualquier billetera`);
  check(!JSON.stringify(w1.cuerpo).includes("@example.com") && !JSON.stringify(w1.cuerpo).includes(propia.nombre), "lo que se da a firmar no lleva ni el nombre ni el correo");
  const otraVez = await inscribirPropia(propia, entradaGratis, prueba1.wallet);
  check(otraVez.status === 401 && otraVez.cuerpo.error === "wallet_invalid", `el mismo desafío otra vez no sirve (${otraVez.status} ${otraVez.cuerpo.error})`);
  const ajena = await firmar(w1.cuerpo.requestId, await autorizar(w1.cuerpo, Keypair.random()));
  check(ajena.status === 400 && ajena.cuerpo.error === "signature_invalid", `una autorización firmada por otra llave no se manda (${ajena.status} ${ajena.cuerpo.error})`);
  const usada = await firmar(w1.cuerpo.requestId, await autorizar(w1.cuerpo, propia.llave));
  check(usada.status === 410 && usada.cuerpo.error === "signature_expired", `y ese pedido de firma ya no sirve: se empieza de nuevo (${usada.status} ${usada.cuerpo.error})`);
  const w1b = await inscribirPropia(propia, entradaGratis, (await probarCuenta(propia.llave)).wallet);
  check(w1b.status === 202 && w1b.cuerpo.status === "needs_signature", "de nuevo, con otro desafío: otra autorización para firmar");
  inicio = Date.now();
  const f1 = await firmar(w1b.cuerpo.requestId, await autorizar(w1b.cuerpo, propia.llave));
  check(f1.status === 201 && f1.cuerpo.status === "created", `con la firma de su llave, la credencial quedó creada (${f1.status}) en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  const pasePropio = f1.cuerpo.passId ? await repo.getPass(f1.cuerpo.passId) : null;
  check(pasePropio?.status === "active" && pasePropio.account === propia.llave.publicKey(), `el pase ${pasePropio?.id} quedó activo en la cuenta propia ${pasePropio?.account}`);
  if (pasePropio?.txHash) tx(`inscripción gratis de ${propia.nombre} con su cuenta propia (register, autoriza su llave, paga el servidor, pase número ${pasePropio.chainNumber})`, pasePropio.txHash);
  const ligada = pasePropio ? await repo.getWalletLink(pasePropio.personId) : null;
  check(ligada?.provider === "pollar" && ligada.publicKey === propia.llave.publicKey(), "la persona quedó ligada a esa cuenta, con el proveedor pollar");
  check(pasePropio !== null && (await repo.getDevAccount(pasePropio.personId)) === null, "el servidor no guardó ninguna llave de esta persona");
  const enCadena = await rumboPass.status(contratoGratis, propia.llave.publicKey());
  check(enCadena.has_pass && enCadena.number === pasePropio?.chainNumber, `status() de la cuenta propia: pase ${enCadena.number}`);
  const firmaRepetida = await firmar(w1b.cuerpo.requestId, await autorizar(w1b.cuerpo, propia.llave));
  check(firmaRepetida.status === 410, "mandar la misma autorización otra vez no hace nada");

  paso(`Entrada con almuerzo de ${propiaPaga.nombre} con su cuenta propia: acepta el USDC de prueba, recibe saldo de prueba y autoriza buy`);
  const w2 = await inscribirPropia(propiaPaga, entradaPaga, (await probarCuenta(propiaPaga.llave)).wallet);
  check(w2.status === 202 && w2.cuerpo.status === "needs_trustline" && w2.cuerpo.asset?.issuer === activo.issuer, `primero la cuenta tiene que aceptar el USDC de prueba (${w2.cuerpo.status} ${w2.cuerpo.asset?.code})`);
  // Lo que en el navegador hace client.setTrustline: la cuenta firma su línea de confianza; acá la comisión la paga la patrocinadora.
  const linea = await submitClassic([Operation.changeTrust({ asset: activo.asset, source: propiaPaga.llave.publicKey() })], [propiaPaga.llave]);
  tx(`${propiaPaga.nombre} acepta el USDC de prueba (changeTrust, firma su llave)`, linea.hash);
  const antesPropia = { organizador: organizador ? await saldo(organizador) : null, tesoreria: tesoreria ? await saldo(tesoreria) : null };
  inicio = Date.now();
  const w3 = await inscribirPropia(propiaPaga, entradaPaga, (await probarCuenta(propiaPaga.llave)).wallet);
  check(w3.status === 202 && w3.cuerpo.status === "needs_signature" && w3.cuerpo.fn === "buy", `con la línea, la autorización de buy para firmar (${w3.cuerpo.status}, en ${((Date.now() - inicio) / 1000).toFixed(0)} s)`);
  check((await saldo(propiaPaga.llave.publicKey())) === inicial, `la cuenta recibió ${inicial} USDC de prueba para pagar`);
  inicio = Date.now();
  const f2 = await firmar(w3.cuerpo.requestId, await autorizar(w3.cuerpo, propiaPaga.llave));
  check(f2.status === 201 && f2.cuerpo.paid === true, `se pagó y se creó la credencial (${f2.status}) en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  const pasePropioPago = f2.cuerpo.passId ? await repo.getPass(f2.cuerpo.passId) : null;
  check(pasePropioPago?.status === "active" && pasePropioPago.account === propiaPaga.llave.publicKey(), `el pase ${pasePropioPago?.id} quedó activo en la cuenta propia`);
  if (pasePropioPago?.txHash) tx(`entrada paga de ${propiaPaga.nombre} con su cuenta propia (buy, autoriza su llave, pase número ${pasePropioPago.chainNumber})`, pasePropioPago.txHash);
  const despuesPropia = { organizador: organizador ? await saldo(organizador) : null, tesoreria: tesoreria ? await saldo(tesoreria) : null, comprador: await saldo(propiaPaga.llave.publicKey()) };
  if (antesPropia.organizador !== null) check(Math.abs(despuesPropia.organizador - antesPropia.organizador - (precio - comision)) < 1e-6, `quien organiza recibió ${precio - comision} USDC de prueba en la misma transacción`);
  if (antesPropia.tesoreria !== null) check(Math.abs(despuesPropia.tesoreria - antesPropia.tesoreria - comision) < 1e-6, `Rumbo recibió la comisión de ${comision} USDC de prueba`);
  check(Math.abs(despuesPropia.comprador - (inicial - precio)) < 1e-6, `a ${propiaPaga.nombre} le quedan ${despuesPropia.comprador} USDC de prueba`);

  paso(`La puerta deja entrar a ${propia.nombre}: check_in lo firma la puerta, como con cualquier credencial`);
  inicio = Date.now();
  const entradaPropia = { clientId: `e2e-${stamp}-entrada-propia`, action: "checkin", passId: pasePropio?.id, benefitId: null, scannedAt: new Date().toISOString(), scannerId: "e2e-puerta", qr: pasePropio ? buildPrintedPayload(pasePropio.id, llavesDelEvento) : "" };
  const sync3 = await json("/api/scan/sync", { code: puertaCode, items: [entradaPropia] });
  const entro = sync3.cuerpo.results?.[0];
  check(sync3.status === 200 && entro?.status === "synced" && entro.txHash, `la entrada llegó al contrato en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  if (entro?.txHash) tx(`entrada por la puerta de ${propia.nombre} (check_in, firma la puerta)`, entro.txHash);
  check((await rumboPass.status(contratoGratis, propia.llave.publicKey())).checked_in, "status() dice que la cuenta propia entró");
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
