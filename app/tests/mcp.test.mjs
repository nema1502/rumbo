// El servidor MCP, sin red: un cliente MCP en memoria contra una base vacía, con las cuentas, el contrato y el correo de
// mentira (los mismos ganchos que usan las capturas y la prueba de la ruta de importar). Sin la clave de la casa no se
// crea nada; sin la clave de organizador no se lee ni se publica nada; el CSV de ejemplo importa de a tandas; las
// herramientas de números (el estado, el informe, la lista del sorteo, el resumen para el capítulo) no traen correos ni
// nombres. Al final, la ruta HTTP (POST /api/mcp) con un pedido JSON-RPC, como lo manda un cliente.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { APP_DIR, entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
// Este servidor pide la clave de la casa para crear eventos, como uno en producción.
const CLAVE_CASA = "CASA-DE-PRUEBA-2026";
process.env.RUMBO_CREATE_KEY = CLAVE_CASA;

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { NextRequest } = await import("next/server");
const { getRepo } = await import("../src/server/repo.ts");
const { createRumboMcpServer, MCP_SERVER_NAME } = await import("../src/server/mcp/servidor.ts");
const { createStand } = await import("../src/server/stands.ts");
const { POST: mcpHttp, GET: mcpGet } = await import("../src/app/api/mcp/route.ts");

const repo = getRepo();

// Sin red: las cuentas, el contrato y el correo son de mentira.
let numero = 0;
globalThis.__rumboAccounts = {
  kind: "dev",
  getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
  authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
};
globalThis.__rumboKitChain = {
  register: async () => ({ hash: `h-${++numero}`, ledger: 1, returnValue: numero, number: numero }),
  status: async () => ({ has_pass: true, number: 1, checked_in: false, redeemed: [] }),
};
const correos = [];
globalThis.__rumboMailer = { kind: "dev", send: async (mail) => (correos.push(mail), { id: String(correos.length) }) };
let contratos = 0;
const provisioner = { deploy: async () => `CMCP${String(++contratos).padStart(3, "0")}` };

const csvLuma = readFileSync(join(APP_DIR, "tests", "fixtures", "luma-invitados.csv.txt"), "utf8");
const csvBevy = readFileSync(join(APP_DIR, "tests", "fixtures", "bevy-asistentes.csv.txt"), "utf8");

/** Un cliente MCP conectado en memoria a un servidor con las claves de esa sesión. */
async function cliente({ organizerKey = null, createKey = null } = {}) {
  const server = createRumboMcpServer({ repo, lang: "es", origin: "http://localhost:3999", organizerKey, createKey, provisioner });
  const [lado, otro] = InMemoryTransport.createLinkedPair();
  await server.connect(lado);
  const client = new Client({ name: "prueba-mcp", version: "0" });
  await client.connect(otro);
  const llamar = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { error: r.isError === true, texto: r.content?.[0]?.text ?? "", datos: r.structuredContent ?? null };
  };
  return { client, llamar, cerrar: async () => void (await client.close()) };
}

const NOMBRES = ["Ana Quiroga", "María", "Quispe", "Lucía", "Fernández", "Valeria Choque", "Sofía", "Aguilar"];
/** Que un texto de salida no traiga correos ni nombres de la lista. */
function sinPersonas(texto, que) {
  assert.ok(!texto.includes("@"), `${que} trae un correo`);
  for (const nombre of NOMBRES) assert.ok(!texto.includes(nombre), `${que} trae el nombre "${nombre}"`);
}

const BASICOS = { template: "build-with-ai", name: "Build with AI de prueba", starts_at: "2026-11-28T09:00", city: "Santa Cruz de la Sierra", venue: "El auditorio", organizer: "GDG Santa Cruz", capacity: 150 };

test("el servidor se presenta con sus herramientas, sus instrucciones y el prompt", async () => {
  const { client, cerrar } = await cliente();
  assert.equal(client.getServerVersion()?.name, MCP_SERVER_NAME);
  assert.match(client.getInstructions() ?? "", /organizer key/);
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["chapter_package_summary", "continue_import", "create_event_draft", "draw_list", "event_status", "get_event", "import_guest_list", "list_templates", "publish_event", "resend_links", "sponsor_report"],
  );
  for (const tool of tools) {
    assert.ok(tool.description && tool.description.length > 60, `${tool.name} tiene descripción`);
    assert.equal(tool.inputSchema.type, "object", `${tool.name} tiene esquema`);
  }
  const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort();
  assert.deepEqual(readOnly, ["chapter_package_summary", "draw_list", "event_status", "get_event", "list_templates", "sponsor_report"]);

  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name), ["describe_your_event"]);
  const prompt = await client.getPrompt({ name: "describe_your_event", arguments: { description: "un meetup para 40 personas el viernes" } });
  const guion = prompt.messages[0].content.text;
  assert.match(guion, /un meetup para 40 personas el viernes/);
  assert.match(guion, /Call publish_event only after an explicit yes/);
  await cerrar();
});

test("list_templates: las seis, con lo que trae cada una, sin clave", async () => {
  const { llamar, cerrar } = await cliente();
  const { error, datos } = await llamar("list_templates", { lang: "es" });
  assert.equal(error, false);
  assert.deepEqual(
    datos.templates.map((t) => t.id),
    ["devfest", "build-with-ai", "iwd", "hackaton", "meetup", "taller"],
  );
  const bwa = datos.templates.find((t) => t.id === "build-with-ai");
  assert.equal(bwa.suggestedCapacity, 150);
  assert.equal(bwa.days, 1);
  const asistente = bwa.credentialTypes.find((c) => c.slot === "attendee");
  assert.deepEqual(asistente.benefits, ["Almuerzo", "Refrigerio", "Café del auspiciante"]);
  const paga = bwa.credentialTypes.find((c) => c.slot === "attendeePaid");
  assert.deepEqual([paga.included, paga.optionalPaid, paga.priceUsdc], [false, true, 10]);
  assert.equal(bwa.stations[0].name, "Puerta");
  const hackaton = datos.templates.find((t) => t.id === "hackaton");
  assert.deepEqual([hackaton.days, hackaton.teamSignup], [2, true]);
  const en = (await llamar("list_templates", { lang: "en" })).datos.templates.find((t) => t.id === "taller");
  assert.equal(en.name, "Workshop");
  await cerrar();
});

test("sin la clave de la casa no se crea nada; con la clave queda el borrador, su clave y su enlace", async () => {
  const { llamar, cerrar } = await cliente();
  const antes = (await repo.listEvents()).length;

  const sin = await llamar("create_event_draft", BASICOS);
  assert.equal(sin.error, true);
  assert.match(sin.texto, /^unauthorized: .*create_key/);
  const mala = await llamar("create_event_draft", { ...BASICOS, create_key: "OTRA" });
  assert.equal(mala.error, true);
  assert.equal((await repo.listEvents()).length, antes, "sin la clave de la casa no se crea ningún evento");

  const fecha = await llamar("create_event_draft", { ...BASICOS, create_key: CLAVE_CASA, starts_at: "28/11/2026 9:00" });
  assert.equal(fecha.error, true, "una fecha con otra forma no pasa la validación del esquema");
  const zona = await llamar("create_event_draft", { ...BASICOS, create_key: CLAVE_CASA, timezone: "Marte/Olympus" });
  assert.match(zona.texto, /^invalid_input: timezone/);
  assert.equal((await repo.listEvents()).length, antes);

  const { error, datos } = await llamar("create_event_draft", { ...BASICOS, create_key: CLAVE_CASA });
  assert.equal(error, false);
  assert.equal(datos.event.slug, "build-with-ai-de-prueba");
  assert.deepEqual([datos.event.published, datos.event.capacity, datos.event.place, datos.event.timezone], [false, 150, "Santa Cruz de la Sierra", "America/La_Paz"]);
  // El mismo instante en los dos motores: SQLite devuelve el texto guardado y Postgres lo da en UTC.
  assert.equal(Date.parse(datos.event.startsAt), Date.parse("2026-11-28T09:00:00-04:00"));
  assert.match(datos.organizer_key, /^[A-Z2-7]{24}$/);
  assert.equal(datos.links.review, `http://localhost:3999/admin/build-with-ai-de-prueba/armar?k=${datos.organizer_key}`);
  assert.equal(datos.links.page, "http://localhost:3999/e/build-with-ai-de-prueba");
  const incluidos = datos.draft.credentialTypes.filter((c) => c.included).map((c) => c.slot);
  assert.deepEqual(incluidos, ["attendee", "speaker", "mentor", "volunteer", "organizer", "sponsor"]);
  assert.ok(datos.draft.benefits.some((b) => b.key === "prize" && b.perCredential === false));
  assert.match(datos.next, /publish_event/);

  // Como un servidor que recibió la clave de la casa en la cabecera, sin pasarla en cada llamada.
  const conCasa = await cliente({ createKey: CLAVE_CASA });
  const otro = await conCasa.llamar("create_event_draft", { ...BASICOS, name: "Segundo borrador" });
  assert.equal(otro.error, false);
  assert.equal(otro.datos.event.slug, "segundo-borrador");
  await conCasa.cerrar();
  await cerrar();
});

/** Un borrador nuevo con su clave, para las pruebas que siguen. */
async function borrador(name) {
  const { llamar, cerrar } = await cliente({ createKey: CLAVE_CASA });
  const { datos } = await llamar("create_event_draft", { ...BASICOS, name });
  await cerrar();
  return { slug: datos.event.slug, key: datos.organizer_key };
}

test("get_event: un borrador solo se ve con su clave; publicar pide la clave y crea un contrato por credencial", async () => {
  const { slug, key } = await borrador("Publicar de prueba");
  const anonimo = await cliente();
  const oculto = await anonimo.llamar("get_event", { event: slug });
  assert.match(oculto.texto, /^not_found: /);
  assert.match((await anonimo.llamar("get_event", { event: "no-existe" })).texto, /^not_found: /);
  const ajena = await anonimo.llamar("get_event", { event: slug, organizer_key: "CLAVEQUENOES" });
  assert.match(ajena.texto, /^unauthorized: /);

  const visto = await anonimo.llamar("get_event", { event: slug, organizer_key: key });
  assert.equal(visto.error, false);
  assert.equal(visto.datos.event.published, false);
  assert.equal(visto.datos.tickets.length, 6, "con la clave se ven también las credenciales por invitación");
  assert.ok(visto.datos.links.review.includes(`?k=${key}`));

  // Publicar: sin clave no, con otra clave no, con la clave sí.
  const sinClave = await anonimo.llamar("publish_event", { event: slug });
  assert.match(sinClave.texto, /^unauthorized: .*organizer_key/);
  assert.equal((await repo.getEventBySlug(slug)).published, false);
  await anonimo.cerrar();

  const dueno = await cliente({ organizerKey: key });
  const antes = contratos;
  const publicado = await dueno.llamar("publish_event", { event: slug });
  assert.equal(publicado.error, false, publicado.texto);
  assert.deepEqual([publicado.datos.ok, publicado.datos.deployed, publicado.datos.network], [true, 6, "testnet"]);
  assert.equal(contratos - antes, 6, "un contrato por tipo de credencial");
  assert.equal(publicado.datos.contracts.length, 6);
  assert.ok(publicado.datos.contracts.every((c) => c.explorer.startsWith("https://stellar.expert/explorer/testnet/contract/CMCP")));
  assert.equal((await repo.getEventBySlug(slug)).published, true);
  const otraVez = await dueno.llamar("publish_event", { event: slug });
  assert.deepEqual([otraVez.datos.alreadyPublished, otraVez.datos.deployed, contratos - antes], [true, 0, 6]);
  await dueno.cerrar();

  // Ahora es público: la entrada gratis, y nada de contratos ni enlaces de quien organiza.
  const publico = await cliente();
  const abierto = await publico.llamar("get_event", { event: slug });
  assert.equal(abierto.error, false);
  assert.equal(abierto.datos.event.published, true);
  assert.deepEqual(abierto.datos.tickets.map((t) => [t.kind, t.free, "contractId" in t]), [["attendee", true, false]]);
  assert.deepEqual(Object.keys(abierto.datos.links), ["page"]);
  await publico.cerrar();
});

test("importar: la vista previa no crea nada; confirmar manda de a cinco y dice cuánto falta; un borrador no importa", async () => {
  const draft = await borrador("Importar en borrador");
  const cerrado = await cliente({ organizerKey: draft.key });
  assert.match((await cerrado.llamar("import_guest_list", { event: draft.slug, csv: csvLuma })).texto, /^draft: /);
  await cerrado.cerrar();

  const { slug, key } = await borrador("Importar de prueba");
  const { llamar, cerrar } = await cliente({ organizerKey: key });
  await llamar("publish_event", { event: slug });
  const event = await repo.getEventBySlug(slug);

  const vacio = await llamar("import_guest_list", { event: slug, csv: "  \n" });
  assert.match(vacio.texto, /^invalid_input: The list is empty/);
  const sinCorreos = await llamar("import_guest_list", { event: slug, csv: "nombre,ciudad\nAna,La Paz\n" });
  assert.match(sinCorreos.texto, /^invalid_input: .*emails/);

  const vista = await llamar("import_guest_list", { event: slug, csv: csvLuma });
  assert.equal(vista.error, false, vista.texto);
  assert.equal(vista.datos.preview, true);
  assert.deepEqual([vista.datos.source, vista.datos.rows, vista.datos.wouldImport], ["luma", 16, 9]);
  assert.deepEqual(vista.datos.byStatus.approved, { valid: 9, invalidEmail: 3, duplicatesInFile: 1, alreadyHere: 0 });
  assert.equal(vista.datos.columnsRead.diet, "¿Tenés alguna restricción alimentaria?");
  const speaker = vista.datos.tickets.find((t) => t.label === "Speaker");
  assert.equal(speaker.credentialType.kind, "speaker", "la entrada Speaker va sugerida a la credencial de oradores");
  assert.equal(vista.datos.defaultCredentialType.kind, "attendee");
  assert.equal((await repo.listPasses(event.id)).length, 0, "ver no crea nada");
  sinPersonas(vista.texto, "la vista previa");

  const correosAntes = correos.length;
  const importado = await llamar("import_guest_list", { event: slug, csv: csvLuma, confirm: true });
  assert.equal(importado.error, false, importado.texto);
  assert.equal(importado.datos.imported, true);
  assert.deepEqual([importado.datos.summary.created, importado.datos.summary.invalidEmail, importado.datos.summary.duplicatesInFile], [9, 3, 1]);
  // Build with AI no tiene jurado: la entrada "Jurado" de la lista cae en la credencial de asistente.
  assert.deepEqual(importado.datos.summary.byCredentialType, { Asistente: 6, "Oradora u orador": 1, "Mentora o mentor": 1, "Voluntaria o voluntario": 1 });
  assert.deepEqual([importado.datos.batch.processed, importado.datos.batch.activated, importado.datos.batch.remaining], [5, 5, 4]);
  assert.equal(correos.length - correosAntes, 5, "una llamada manda una sola tanda de correos");
  assert.match(importado.datos.next, /continue_import/);
  sinPersonas(importado.texto, "el resultado de importar");

  const runId = importado.datos.run_id;
  const segunda = await llamar("continue_import", { event: slug, run_id: runId });
  assert.deepEqual([segunda.datos.batch.processed, segunda.datos.batch.remaining, segunda.datos.totals.activated, segunda.datos.totals.pending], [4, 0, 9, 0]);
  assert.equal(correos.length - correosAntes, 9);
  const nada = await llamar("continue_import", { event: slug, run_id: runId });
  assert.equal(nada.datos.batch.processed, 0);
  assert.match((await llamar("continue_import", { event: slug, run_id: "no-existe" })).texto, /^not_found: /);

  // El mismo archivo otra vez: nadie se duplica.
  const repetido = await llamar("import_guest_list", { event: slug, csv: csvLuma, confirm: true });
  assert.deepEqual([repetido.datos.summary.created, repetido.datos.summary.alreadyHere], [0, 9]);

  // La lista de Bevy, con el mapeo a mano: Speaker y Mentor a la credencial de asistente igual.
  const tipos = vista.datos.credentialTypes;
  const asistente = tipos.find((t) => t.kind === "attendee").id;
  const bevy = await llamar("import_guest_list", { event: slug, csv: csvBevy, confirm: true, statuses: ["approved", "waitlist"], mapping: { Speaker: asistente, Mentor: asistente }, batch_size: 20 });
  assert.equal(bevy.error, false, bevy.texto);
  assert.equal(bevy.datos.summary.source, "bevy");
  assert.equal(bevy.datos.summary.byCredentialType["Oradora u orador"], undefined, "el mapeo a mano manda");
  assert.equal(bevy.datos.batch.remaining, 0);
  await cerrar();
});

test("resend_links reenvía a quien no entró y respeta el freno de diez minutos", async () => {
  const { slug, key } = await borrador("Recordatorio de prueba");
  const { llamar, cerrar } = await cliente({ organizerKey: key });
  await llamar("publish_event", { event: slug });
  await llamar("import_guest_list", { event: slug, csv: csvLuma, confirm: true, batch_size: 20 });
  const event = await repo.getEventBySlug(slug);
  const pases = await repo.listPasses(event.id);
  assert.equal(pases.length, 9);
  // Dos ya entraron: a ellas no se les reenvía nada.
  for (const pass of pases.slice(0, 2)) await repo.updatePass(pass.id, { status: "checked_in" });

  const antes = correos.length;
  const primera = await llamar("resend_links", { event: slug, batch_size: 4 });
  assert.equal(primera.error, false, primera.texto);
  assert.deepEqual([primera.datos.eligible, primera.datos.sent, primera.datos.skipped, primera.datos.remaining], [7, 4, 0, 3]);
  assert.equal(correos.length - antes, 4);
  assert.ok(correos.slice(-4).every((m) => m.text.includes("/p/") && m.text.includes("?k=")), "cada correo lleva el enlace personal");
  const segunda = await llamar("resend_links", { event: slug });
  assert.deepEqual([segunda.datos.sent, segunda.datos.skipped, segunda.datos.remaining], [3, 4, 0]);
  const tercera = await llamar("resend_links", { event: slug });
  assert.deepEqual([tercera.datos.sent, tercera.datos.skipped], [0, 7], "diez minutos después, recién, se les manda otro");
  assert.equal(correos.length - antes, 7);
  sinPersonas(tercera.texto, "el resultado del reenvío");
  await cerrar();
});

test("event_status, sponsor_report, draw_list y el resumen para el capítulo: números, nunca personas", async () => {
  const { slug, key } = await borrador("Números de prueba");
  const { llamar, cerrar } = await cliente({ organizerKey: key });
  await llamar("publish_event", { event: slug });
  await llamar("import_guest_list", { event: slug, csv: csvLuma, confirm: true, batch_size: 20 });
  const event = await repo.getEventBySlug(slug);
  const pases = await repo.listPasses(event.id);
  const stand = await createStand(event, { name: "Nube Andina" }, repo);

  // Dos entran por la puerta y una canja el almuerzo (el espejo, como lo deja el escáner).
  const almuerzo = (await repo.listBenefits(event.id)).find((b) => b.kind === "lunch");
  for (const pass of pases.slice(0, 2)) {
    await repo.updatePass(pass.id, { status: "checked_in", checkedInAt: new Date().toISOString() });
    const entrada = await repo.recordCheckIn({ clientId: `mcp-${pass.id}`, eventId: event.id, passId: pass.id, scannerId: "puerta-prueba" });
    await repo.markCheckIn(entrada.id, { synced: true });
  }
  const canje = await repo.recordRedemption({ clientId: `mcp-canje-${pases[0].id}`, eventId: event.id, passId: pases[0].id, benefitId: almuerzo.id, scannerId: "mesa-prueba" });
  await repo.markRedemption(canje.id, { synced: true });

  const estado = await llamar("event_status", { event: slug });
  assert.equal(estado.error, false, estado.texto);
  assert.deepEqual([estado.datos.counters.issued, estado.datos.counters.checkedIn, estado.datos.counters.lunch.redeemed, estado.datos.pendingSync], [9, 2, 1, 0]);
  const fila = estado.datos.redemptions.find((b) => b.id === almuerzo.id);
  assert.deepEqual([fila.granted, fila.redeemed, fila.remaining], [9, 1, null]);
  const puerta = estado.datos.stations.find((s) => s.kind === "gate");
  assert.match(puerta.code, /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  assert.equal(puerta.name, "Puerta");
  assert.ok(estado.datos.stations.some((s) => s.kind === "stand" && s.name === "Nube Andina"));
  assert.equal(estado.datos.duplicates.total, 0);
  assert.ok(!("passes" in estado.datos), "la lista de personas no viaja");
  sinPersonas(estado.texto, "event_status");

  const informe = await llamar("sponsor_report", { event: slug });
  assert.equal(informe.error, false, informe.texto);
  assert.deepEqual([informe.datos.issued, informe.datos.checkedIn, informe.datos.headline.name, informe.datos.headline.redeemed], [9, 2, "Almuerzo", 1]);
  assert.equal(informe.datos.stands[0].name, "Nube Andina");
  assert.deepEqual([informe.datos.stands[0].visits, informe.datos.stands[0].contactsAccepted], [0, 0]);
  assert.ok(!("contacts" in informe.datos.stands[0]));
  sinPersonas(informe.texto, "sponsor_report");
  const unStand = await llamar("sponsor_report", { event: slug, stand_id: stand.id });
  assert.equal(unStand.datos.stand.standId, stand.id);
  assert.match((await llamar("sponsor_report", { event: slug, stand_id: "otro" })).texto, /^not_found: /);

  const sorteo = await llamar("draw_list", { event: slug });
  assert.equal(sorteo.error, false, sorteo.texto);
  const codigos = pases
    .slice(0, 2)
    .map((p) => p.id)
    .sort();
  assert.deepEqual([sorteo.datos.total, sorteo.datos.participants], [2, codigos]);
  assert.equal(sorteo.datos.sha256, createHash("sha256").update(codigos.join("\n"), "utf8").digest("hex"));
  sinPersonas(sorteo.texto, "draw_list");

  const capitulo = await llamar("chapter_package_summary", { event: slug, stellar_minutes: 30, food_spend_usd: 100 });
  assert.equal(capitulo.error, false, capitulo.texto);
  assert.deepEqual(capitulo.datos.attendees, { verified: 2, required: 20, ok: false });
  assert.deepEqual(capitulo.datos.stellarMinutes, { value: 30, required: 20, ok: true });
  assert.deepEqual(capitulo.datos.food, { spendUsd: 100, perPersonUsd: 50, capUsd: 25, ok: false });
  assert.deepEqual([capitulo.datos.contactsShared, capitulo.datos.allChecksPass, capitulo.datos.contracts.length], [0, false, 6]);
  const sinDatos = await llamar("chapter_package_summary", { event: slug });
  assert.deepEqual([sinDatos.datos.stellarMinutes.ok, sinDatos.datos.food.ok, sinDatos.datos.allChecksPass], [null, null, false]);
  sinPersonas(capitulo.texto, "chapter_package_summary");

  // Con otra clave, ninguna de las de números abre.
  const ajeno = await cliente({ organizerKey: "CLAVEQUENOES" });
  for (const name of ["event_status", "sponsor_report", "draw_list", "chapter_package_summary", "resend_links"]) {
    assert.match((await ajeno.llamar(name, { event: slug })).texto, /^unauthorized: /, name);
  }
  await ajeno.cerrar();
  await cerrar();
});

test("por HTTP: tools/list sin clave, una herramienta protegida sin Bearer no abre nada, con Bearer sí, y GET no es el camino", async () => {
  const { slug, key } = await borrador("HTTP de prueba");
  const pedir = async (body, headers = {}) => {
    const request = new NextRequest("http://localhost:3999/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", host: "localhost:3999", ...headers },
      body: JSON.stringify(body),
    });
    const res = await mcpHttp(request);
    return { status: res.status, cuerpo: await res.json() };
  };
  const lista = await pedir({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(lista.status, 200);
  assert.equal(lista.cuerpo.result.tools.length, 11);

  const llamada = (args) => ({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_event", arguments: args } });
  const sin = await pedir(llamada({ event: slug }));
  assert.equal(sin.cuerpo.result.isError, true);
  assert.match(sin.cuerpo.result.content[0].text, /^not_found: /);
  const con = await pedir(llamada({ event: slug }), { authorization: `Bearer ${key}` });
  assert.equal(con.cuerpo.result.isError, undefined, JSON.stringify(con.cuerpo));
  assert.equal(con.cuerpo.result.structuredContent.event.slug, slug);
  assert.equal(con.cuerpo.result.structuredContent.links.review, `http://localhost:3999/admin/${slug}/armar?k=${key}`);

  // La clave de la casa por cabecera, como la manda el puente.
  const creada = await pedir({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_event_draft", arguments: { ...BASICOS, name: "Por HTTP" } } }, { "x-rumbo-create-key": CLAVE_CASA });
  assert.equal(creada.cuerpo.result.isError, undefined, JSON.stringify(creada.cuerpo));
  assert.equal(creada.cuerpo.result.structuredContent.event.slug, "por-http");

  const get = await mcpGet();
  assert.equal(get.status, 405);
});
