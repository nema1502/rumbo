// El flujo entero de Rumbo por el servidor MCP, contra la red de prueba, como lo haría un asistente:
//   1. por HTTP (POST /api/mcp), sin clave: se presenta, lista las herramientas y el prompt, y las plantillas;
//      crea un "Build with AI para 150 personas el 28 de noviembre en Santa Cruz" (sin la clave de la casa no se
//      crea nada; con ella queda el borrador y su enlace) y lo publica en la red de prueba: un contrato por credencial;
//   2. por stdio, con el puente (scripts/mcp.mjs) apuntando a ese servidor con la clave de organizador, como desde
//      la máquina de quien organiza: importa el CSV de ejemplo de Luma (la vista previa, y después de a tandas, con
//      la cuenta y la inscripción en el contrato de cada persona), reenvía los enlaces y lee el estado;
//   3. dos personas entran por la puerta (la API del escáner), y el asistente lee el estado, la lista del sorteo con
//      su huella, el informe para quien auspicia y el resumen para el programa de embajadores.
// Deja la transcripción, con los ids de los contratos y de las transacciones, en demo/mcp.txt. Ninguna clave va ahí.
//
//   node scripts/prueba-mcp.mjs                   levanta su propio servidor (next dev) con una base nueva en data/mcp
//   node scripts/prueba-mcp.mjs --base http://127.0.0.1:3250 [--datos ./data]   usa un servidor ya levantado (la clave
//                                                 de la casa de ese servidor, si la pide, en RUMBO_CREATE_KEY)
//   --port 3250            el puerto del servidor propio
//   --salida demo/mcp.txt  dónde queda la transcripción (relativo a app/)
//
// Tarda entre cinco y diez minutos según la red de prueba: cada contrato, cada inscripción y cada entrada es una transacción.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { APP_DIR, loadEnv } from "./lib/env.mjs";

process.chdir(APP_DIR);

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(option("--port", 3250));
const SALIDA = join(APP_DIR, option("--salida", "demo/mcp.txt"));
const baseDada = option("--base", null);
const servidorPropio = !baseDada;
const BASE = (baseDada ?? `http://127.0.0.1:${PORT}`).replace(/\/+$/, "");
const DATOS = option("--datos", servidorPropio ? "./data/mcp" : "./data");
/** Publicar y cada tanda tardan minutos en la red de prueba. */
const TIMEOUT = { timeout: 15 * 60_000 };

// La base y los correos del servidor y los de este script tienen que ser los mismos: se fija antes de cargar nada.
process.env.RUMBO_DATA_DIR = DATOS;
process.env.NEXT_PUBLIC_BASE_URL = BASE;
loadEnv();
// La clave de la casa: el servidor propio la pide, como uno en producción. Con --base, la del entorno (si la pide).
const CLAVE_CASA = servidorPropio ? randomBytes(9).toString("base64url") : (process.env.RUMBO_CREATE_KEY ?? "");

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
/** Las claves (de organizador, de la casa, de acceso) no van a la transcripción. */
const sinClave = (texto) => String(texto).replace(/([?&]k=)[^&\s"]+/g, "$1...");
const explorer = (hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
const transacciones = [];
const tx = (que, hash) => {
  transacciones.push({ que, hash });
  log(`  transacción: ${hash}`);
};
const json = (value) => JSON.stringify(value);

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
const post = (ruta, body) => pedir(ruta, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ---------- El servidor ----------

let servidor = null;
const logServidor = join(APP_DIR, DATOS, "servidor.log");

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

function levantarServidor() {
  const next = join(APP_DIR, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(next)) throw new Error("no encontré Next en node_modules: corré pnpm install");
  const proc = spawn(process.execPath, [next, "dev", "-p", String(PORT)], {
    cwd: APP_DIR,
    env: { ...process.env, RUMBO_DATA_DIR: DATOS, NEXT_PUBLIC_BASE_URL: BASE, RUMBO_CREATE_KEY: CLAVE_CASA },
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

// ---------- Los clientes MCP ----------

/** Llama a una herramienta y devuelve si falló, el texto y los datos, como los recibe el asistente. */
async function herramienta(client, name, argumentos = {}) {
  const r = await client.callTool({ name, arguments: argumentos }, undefined, TIMEOUT);
  return { error: r.isError === true, texto: r.content?.[0]?.text ?? "", datos: r.structuredContent ?? null };
}

async function clienteHttp() {
  const client = new Client({ name: "prueba-mcp-http", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`)), TIMEOUT);
  return client;
}

/** El puente por stdio, como lo levanta el asistente en la máquina de quien organiza: con la clave en su entorno. */
async function clienteStdio(organizerKey) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(APP_DIR, "scripts", "mcp.mjs")],
    env: { ...getDefaultEnvironment(), RUMBO_BASE_URL: BASE, RUMBO_ORGANIZER_KEY: organizerKey },
    stderr: "pipe",
  });
  const avisos = [];
  transport.stderr?.on("data", (chunk) => avisos.push(...String(chunk).split(/\r?\n/).filter(Boolean)));
  const client = new Client({ name: "prueba-mcp-stdio", version: "0.1.0" });
  await client.connect(transport, TIMEOUT);
  return { client, avisos };
}

const sinPersonas = (texto) => !texto.includes("@") && !/Quiroga|Quispe|Mamani|Condori|Villca|Apaza|Rocha|Fern[aá]ndez|Rojas|Guti[eé]rrez|Choque/.test(texto);

// ---------- El flujo ----------

const csvLuma = readFileSync(join(APP_DIR, "tests", "fixtures", "luma-invitados.csv.txt"), "utf8");
let http = null;
let stdio = null;

try {
  log(`Rumbo, el flujo entero por el servidor MCP contra la red de prueba de Stellar. ${new Date().toISOString()}`);
  log(`Servidor: ${BASE} (${servidorPropio ? "levantado por este script, con la clave de la casa puesta" : "ya levantado"}). Datos: ${DATOS}.`);

  if (servidorPropio) {
    paso(`Una base nueva en ${DATOS} y el servidor de desarrollo en el puerto ${PORT}`);
    rmSync(join(APP_DIR, DATOS), { recursive: true, force: true });
    mkdirSync(join(APP_DIR, DATOS), { recursive: true });
    servidor = levantarServidor();
    await esperarServidor();
    check(true, `el servidor contesta en ${BASE}`);
  }
  // La primera visita compila la ruta: así la medición de después es la de verdad.
  const get = await pedir("/api/mcp");
  check(get.status === 405 && get.cuerpo.error === "method_not_allowed", "GET /api/mcp dice que el camino es POST (405): no hay sesiones ni flujo de eventos");

  // 1. Por HTTP, sin clave
  paso("Un cliente MCP por HTTP (POST /api/mcp), sin ninguna clave: se presenta y lista lo que sabe hacer");
  http = await clienteHttp();
  const version = http.getServerVersion();
  check(version?.name === "rumbo", `el servidor se presenta como "${version?.name}" ${version?.version}, con instrucciones de ${http.getInstructions()?.length ?? 0} letras`);
  const { tools } = await http.listTools();
  check(tools.length === 11, `tools/list: ${tools.length} herramientas: ${tools.map((t) => t.name).join(", ")}`);
  const { prompts } = await http.listPrompts();
  const prompt = await http.getPrompt({ name: "describe_your_event", arguments: { description: "un Build with AI para 150 personas el 28 de noviembre en Santa Cruz" } });
  const guion = prompt.messages[0].content.text;
  check(prompts.length === 1 && guion.includes("Call publish_event only after an explicit yes"), `prompts/get describe_your_event: ${guion.split("\n")[0]}`);

  const plantillas = await herramienta(http, "list_templates", { lang: "es" });
  const bwa = plantillas.datos?.templates.find((t) => t.id === "build-with-ai");
  check(!plantillas.error && plantillas.datos.templates.length === 6 && bwa?.suggestedCapacity === 150, `list_templates: ${plantillas.datos?.templates.map((t) => `${t.name} (${t.suggestedCapacity})`).join(", ")}`);
  log(`  Build with AI trae: ${bwa.credentialTypes.filter((c) => c.included).map((c) => `${c.name}: ${c.benefits.join(", ")}`).join("; ")}; puestos: ${bwa.stations.map((s) => s.name).join(", ")}`);

  paso("Armar el evento: un Build with AI para 150 personas el 28 de noviembre en Santa Cruz");
  const basicos = { template: "build-with-ai", name: "Build with AI Santa Cruz", starts_at: "2026-11-28T09:00", city: "Santa Cruz de la Sierra", venue: "El auditorio de la comunidad", organizer: "GDG Santa Cruz", capacity: 150 };
  const sinCasa = await herramienta(http, "create_event_draft", basicos);
  check(sinCasa.error && sinCasa.texto.startsWith("unauthorized:"), `sin la clave de la casa no se crea nada: ${sinCasa.texto.slice(0, 110)}`);
  const creado = await herramienta(http, "create_event_draft", { ...basicos, create_key: CLAVE_CASA });
  if (creado.error) throw new Error(`create_event_draft falló: ${creado.texto}`);
  const slug = creado.datos.event.slug;
  const clave = creado.datos.organizer_key;
  check(creado.datos.event.published === false && /^[A-Z2-7]{24}$/.test(clave), `quedó el borrador "${creado.datos.event.name}" (/e/${slug}), ${creado.datos.event.startsAt}, cupo ${creado.datos.event.capacity}, con su clave de organizador`);
  log(`  para revisarlo: ${sinClave(creado.datos.links.review)}`);
  log(`  credenciales: ${creado.datos.draft.credentialTypes.filter((c) => c.included).map((c) => c.name).join(", ")}; canjes: ${creado.datos.draft.benefits.map((b) => `${b.name} (${b.place})`).join(", ")}`);

  const { getRepo } = await import("../src/server/repo.ts");
  const repo = getRepo();
  const oculto = await herramienta(http, "get_event", { event: slug });
  check(oculto.error && oculto.texto.startsWith("not_found:"), "get_event sin clave: el borrador no existe para el público");
  const visto = await herramienta(http, "get_event", { event: slug, organizer_key: clave });
  check(!visto.error && visto.datos.tickets.length === 6, `get_event con la clave: el borrador, con sus ${visto.datos.tickets.length} tipos de credencial`);

  paso("Publicar el evento en la red de prueba: un contrato rumbo-pass por tipo de credencial");
  const sinClaveDeEvento = await herramienta(http, "publish_event", { event: slug });
  check(sinClaveDeEvento.error && sinClaveDeEvento.texto.startsWith("unauthorized:"), "publish_event sin la clave de organizador no publica");
  let inicio = Date.now();
  const publicado = await herramienta(http, "publish_event", { event: slug, organizer_key: clave });
  if (publicado.error) throw new Error(`publish_event falló: ${publicado.texto}`);
  check(publicado.datos.ok && publicado.datos.deployed === 6, `publicado: ${publicado.datos.deployed} contratos creados en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  for (const c of publicado.datos.contracts) log(`  ${c.ticketType} (${c.kind}${c.priceUsdc ? `, ${c.priceUsdc} USDC de prueba` : ", gratis"}): ${c.contractId}\n    ${c.explorer}`);
  const publico = await herramienta(http, "get_event", { event: slug });
  check(!publico.error && publico.datos.event.published && publico.datos.tickets.length === 1 && publico.datos.tickets[0].free, `get_event ya sin clave: publicado, con su inscripción gratis ("${publico.datos.tickets[0].name}")`);
  const pagina = await pedir(`/e/${slug}`);
  check(pagina.status === 200 && pagina.cuerpo.includes("Build with AI Santa Cruz"), `la página /e/${slug} se ve`);
  const otraVez = await herramienta(http, "publish_event", { event: slug, organizer_key: clave });
  check(!otraVez.error && otraVez.datos.alreadyPublished && otraVez.datos.deployed === 0, "publicar de nuevo no crea nada");

  // 2. Por stdio, con el puente
  paso("Desde la máquina de quien organiza: el puente por stdio (pnpm mcp) apuntando a ese servidor, con la clave en su entorno");
  stdio = await clienteStdio(clave);
  const puente = stdio.client;
  const viaPuente = await puente.listTools();
  check(viaPuente.tools.length === 11 && puente.getServerVersion()?.name === "rumbo", `el puente arrancó (${stdio.avisos[0] ?? "sin avisos"}) y expone las ${viaPuente.tools.length} herramientas`);

  const vista = await herramienta(puente, "import_guest_list", { event: slug, csv: csvLuma });
  check(!vista.error && vista.datos.preview && vista.datos.source === "luma" && vista.datos.rows === 16 && vista.datos.wouldImport === 9, `import_guest_list, la vista previa: lista de ${vista.datos.source}, ${vista.datos.rows} filas, entrarían ${vista.datos.wouldImport} (${json(vista.datos.byStatus.approved)})`);
  log(`  columnas: ${json(vista.datos.columnsRead)}; entradas: ${vista.datos.tickets.map((t) => `${t.label} (${t.people}) a ${t.credentialType?.name}`).join(", ")}`);
  check((await repo.listPasses((await repo.getEventBySlug(slug)).id)).length === 0, "la vista previa no creó nada");

  paso("Confirmar la importación: credencial, cuenta en la red de prueba, inscripción en el contrato y correo, de a cinco");
  inicio = Date.now();
  const importado = await herramienta(puente, "import_guest_list", { event: slug, csv: csvLuma, confirm: true });
  if (importado.error) throw new Error(`import_guest_list falló: ${importado.texto}`);
  const tanda1 = importado.datos.batch;
  check(importado.datos.summary.created === 9 && tanda1.processed === 5 && tanda1.activated === 5 && tanda1.remaining === 4, `creadas ${importado.datos.summary.created} (por tipo: ${json(importado.datos.summary.byCredentialType)}); la primera tanda preparó ${tanda1.activated} en ${((Date.now() - inicio) / 1000).toFixed(0)} s y faltan ${tanda1.remaining}`);
  const event = await repo.getEventBySlug(slug);
  const pasesTanda1 = (await repo.listPassesByImportRun(importado.datos.run_id)).filter((p) => p.status === "active");
  for (const p of pasesTanda1) if (p.txHash) tx(`inscripción importada, pase ${p.id} (register, número ${p.chainNumber})`, p.txHash);
  inicio = Date.now();
  const tanda2 = await herramienta(puente, "continue_import", { event: slug, run_id: importado.datos.run_id });
  check(!tanda2.error && tanda2.datos.batch.processed === 4 && tanda2.datos.batch.remaining === 0 && tanda2.datos.totals.activated === 9, `continue_import: la segunda tanda preparó ${tanda2.datos.batch.activated} en ${((Date.now() - inicio) / 1000).toFixed(0)} s; ${tanda2.datos.totals.activated} activadas, ${tanda2.datos.totals.pending} pendientes`);
  const pases = await repo.listPassesByImportRun(importado.datos.run_id);
  for (const p of pases) if (p.txHash && !pasesTanda1.some((q) => q.id === p.id)) tx(`inscripción importada, pase ${p.id} (register, número ${p.chainNumber})`, p.txHash);
  check(pases.every((p) => p.status === "active" && p.account), `los ${pases.length} pases quedaron activos, cada uno con su cuenta en la red de prueba`);
  const correos = readdirSync(join(APP_DIR, DATOS, "correos"));
  const textos = correos.map((f) => readFileSync(join(APP_DIR, DATOS, "correos", f), "utf8"));
  check(correos.length === 9 && textos.every((t) => t.includes("/p/") && t.includes("?k=")), `${correos.length} correos con el enlace personal quedaron en ${DATOS}/correos`);
  check(textos.every((t) => !/\bS[A-Z2-7]{55}\b/.test(t)), "ningún correo lleva una llave secreta");

  paso("El recordatorio: reenviar el enlace a quienes todavía no entraron, con el freno de diez minutos");
  const reenvio = await herramienta(puente, "resend_links", { event: slug });
  check(!reenvio.error && reenvio.datos.eligible === 9 && reenvio.datos.sent === 9, `resend_links: ${reenvio.datos.sent} reenviados de ${reenvio.datos.eligible}`);
  const reenvio2 = await herramienta(puente, "resend_links", { event: slug });
  check(reenvio2.datos.sent === 0 && reenvio2.datos.skipped === 9, `otra vez enseguida: ${reenvio2.datos.sent} reenviados, ${reenvio2.datos.skipped} frenados (hace menos de diez minutos)`);
  check(readdirSync(join(APP_DIR, DATOS, "correos")).length === 18, "en el disco hay 18 correos: los 9 de la importación y los 9 del recordatorio");

  paso("El estado antes del evento, por el puente");
  const estado0 = await herramienta(puente, "event_status", { event: slug });
  check(!estado0.error && estado0.datos.counters.issued === 9 && estado0.datos.counters.checkedIn === 0, `event_status: ${estado0.datos.counters.issued} credenciales, ${estado0.datos.counters.checkedIn} entraron, por sincronizar ${estado0.datos.pendingSync}`);
  const puerta = estado0.datos.stations.find((s) => s.kind === "gate");
  check(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(puerta?.code ?? ""), `códigos de puesto: ${estado0.datos.stations.map((s) => `${s.name} ${s.code}`).join(", ")}`);
  check(sinPersonas(estado0.texto), "el estado no trae nombres ni correos");

  // 3. La puerta y lo de después
  paso(`Dos personas entran por la puerta (la API del escáner con el código ${puerta.code}): check_in en el contrato`);
  const abierto = await post("/api/scan/open", { code: puerta.code });
  check(abierto.status === 200 && abierto.cuerpo.station?.kind === "gate" && abierto.cuerpo.passes.length === 9, `la puerta abre y baja ${abierto.cuerpo.passes.length} pases`);
  const entran = pases.slice(0, 2);
  const ahora = () => new Date().toISOString();
  const items = entran.map((p, i) => ({ clientId: `mcp-${Date.now().toString(36)}-${i}`, action: "checkin", passId: p.id, benefitId: null, scannedAt: ahora(), scannerId: "prueba-mcp-puerta" }));
  inicio = Date.now();
  const sync = await post("/api/scan/sync", { code: puerta.code, items });
  const resultados = sync.cuerpo.results ?? [];
  check(sync.status === 200 && resultados.length === 2 && resultados.every((r) => r.status === "synced" && r.txHash), `las dos entradas llegaron al contrato en ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  for (const r of resultados) if (r.txHash) tx(`entrada por la puerta, pase ${items.find((i) => i.clientId === r.clientId)?.passId ?? "?"} (check_in, firma la puerta)`, r.txHash);

  paso("Después: el estado, la lista del sorteo, el informe para quien auspicia y el resumen para el capítulo");
  const estado1 = await herramienta(puente, "event_status", { event: slug });
  check(estado1.datos.counters.checkedIn === 2 && estado1.datos.pendingSync === 0, `event_status: ${estado1.datos.counters.checkedIn} entraron, ${estado1.datos.counters.issued} credenciales, almuerzos ${estado1.datos.counters.lunch.redeemed} de ${estado1.datos.counters.lunch.granted}, dobles ${estado1.datos.duplicates.total}`);
  const sorteo = await herramienta(puente, "draw_list", { event: slug });
  const codigos = entran.map((p) => p.id).sort();
  const huella = createHash("sha256").update(codigos.join("\n"), "utf8").digest("hex");
  check(!sorteo.error && sorteo.datos.total === 2 && json(sorteo.datos.participants) === json(codigos) && sorteo.datos.sha256 === huella, `draw_list: ${sorteo.datos.total} participantes (${sorteo.datos.participants.join(", ")}), huella ${sorteo.datos.sha256}`);
  check(sinPersonas(sorteo.texto), "la lista del sorteo son códigos, sin nombres ni correos");
  const informe = await herramienta(puente, "sponsor_report", { event: slug });
  check(!informe.error && informe.datos.issued === 9 && informe.datos.checkedIn === 2, `sponsor_report: ${informe.datos.issued} credenciales, ${informe.datos.checkedIn} entraron, titular "${informe.datos.headline?.name}: ${informe.datos.headline?.redeemed} de ${informe.datos.headline?.granted}", ruta de stands: ${informe.datos.route.standCount} stands`);
  check(sinPersonas(informe.texto), "el informe no trae nombres ni correos");
  const capitulo = await herramienta(puente, "chapter_package_summary", { event: slug, stellar_minutes: 30, food_spend_usd: 150 });
  check(!capitulo.error && capitulo.datos.attendees.ok === false && capitulo.datos.stellarMinutes.ok === true && capitulo.datos.food.perPersonUsd === 75 && capitulo.datos.food.ok === false, `chapter_package_summary: asistentes verificados ${capitulo.datos.attendees.verified} de ${capitulo.datos.attendees.required} (${capitulo.datos.attendees.ok ? "sí" : "no"}), minutos ${capitulo.datos.stellarMinutes.value} (${capitulo.datos.stellarMinutes.ok ? "sí" : "no"}), comida ${capitulo.datos.food.perPersonUsd} por persona frente a ${capitulo.datos.food.capUsd} (${capitulo.datos.food.ok ? "sí" : "no"}), contactos compartidos ${capitulo.datos.contactsShared}`);
  check(capitulo.datos.contracts.length === 6, `el resumen enlaza los ${capitulo.datos.contracts.length} contratos del evento`);
  const ajeno = await herramienta(http, "draw_list", { event: slug, organizer_key: "CLAVEQUENOES" });
  check(ajeno.error && ajeno.texto.startsWith("unauthorized:"), "con otra clave, la lista del sorteo no se entrega");
} catch (error) {
  fallas.push(`la corrida se cortó: ${error instanceof Error ? error.message : String(error)}`);
  log(`\nLa corrida se cortó: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
} finally {
  await stdio?.client.close().catch(() => undefined);
  await http?.close().catch(() => undefined);
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
const { closeDb } = await import("../src/server/base/index.ts");
await closeDb();
process.exit(fallas.length === 0 ? 0 : 1);
