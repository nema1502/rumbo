// Los eventos que entran solo por lista (RUMBO_LIST_ONLY_EVENTS): la inscripción la lleva quien organiza. Cada
// puerta pública contesta que no (el formulario, el formulario con la cuenta propia y su paso de firma, el de
// equipos, la API y su paso de firma, con la entrada gratis o con la paga, por la dirección de ahora o por una
// vieja), y lo que pide quien organiza sigue andando: importar una lista, agregar en la puerta, el panel, el
// escáner, abrir una credencial y las herramientas del asistente. Con la variable vacía, todo queda como siempre.
// Sin red: las cuentas, el contrato y el correo son de mentira.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { beforeEach, test } from "node:test";
import { APP_DIR, capturarConsola, entornoDePrueba, mananaALas9, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
process.env.RUMBO_TRUSTED_IP_HEADER = "x-real-ip";
delete process.env.RUMBO_LIST_ONLY_EVENTS;

const { Address, Keypair, Networks, StrKey, authorizeEntry, xdr } = await import("@stellar/stellar-sdk");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
// Las acciones de los formularios leen el pedido (el idioma, de dónde llegó). Fuera de Next no hay pedido: se les
// da uno sin cabeceras, que es lo que Next entrega cuando no hay nada que leer. Next guarda el pedido en curso en
// un AsyncLocalStorage que busca en globalThis, y lo pone ahí su propio arranque; acá va a mano, antes de importarlo.
await import("next/dist/server/node-environment-baseline.js");
const { NextRequest } = await import("next/server");
const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
const { getRepo } = await import("../src/server/repo.ts");
const stellar = await import("../src/server/stellar.ts");
const propia = await import("../src/server/cuenta-propia.ts");
const { evento: textos } = await import("../src/i18n/evento.ts");
const { panel: textosPanel } = await import("../src/i18n/panel.ts");
const { LIST_ONLY_ENV, isListOnly, listOnlyEventAt, listedEvents } = await import("../src/server/evento/por-lista.ts");
const { publicRegistration } = await import("../src/server/evento/inscripcion.ts");
const { PollarAccountProvider } = await import("../src/server/accounts.ts");
const { activateBatch, importQueue, importStatus, parseGuests, prepareImport } = await import("../src/server/kit/importar.ts");
const { getOrCreateAccessKey } = await import("../src/server/evento/acceso.ts");
const { createEventFromTemplate } = await import("../src/server/kit/plantillas.ts");
const { changeEventSlug } = await import("../src/server/kit/direccion.ts");
const { publishEvent } = await import("../src/server/kit/publicar.ts");
const { registerTeam } = await import("../src/server/kit/equipos.ts");
const { ensureStationCodes, getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { linkResendAttempts, registrationAttempts, walletChallengeAttempts } = await import("../src/server/limites.ts");
const { createRumboMcpServer } = await import("../src/server/mcp/servidor.ts");
const { registerAction, walletRegisterAction, walletSignAction } = await import("../src/app/e/[slug]/inscripcion/actions.ts");
const { registerTeamAction } = await import("../src/app/e/[slug]/equipo/actions.ts");
const { GET: verEvento } = await import("../src/app/api/evento/[slug]/route.ts");
const { POST: inscribir } = await import("../src/app/api/evento/[slug]/inscripcion/route.ts");
const { POST: firmar } = await import("../src/app/api/evento/[slug]/inscripcion/firma/route.ts");
const { POST: pedirDesafio } = await import("../src/app/api/cuenta/desafio/route.ts");
const { POST: agregar } = await import("../src/app/api/scan/agregar/route.ts");
const { POST: abrirPuesto } = await import("../src/app/api/scan/open/route.ts");
const { POST: importar } = await import("../src/app/api/admin/[slug]/importar/route.ts");
const { GET: panel } = await import("../src/app/api/admin/[slug]/route.ts");
const { GET: credencial } = await import("../src/app/api/pase/[passId]/route.ts");

const repo = getRepo();
const POR_LISTA = textos.es["evento.porLista"];

// ---------- Sin red: las cuentas, el contrato y el correo, de mentira ----------

const cadena = { inscriptas: 0, compradas: 0, preparadas: 0, mandadas: 0 };
const emitidas = () => cadena.inscriptas + cadena.compradas + cadena.mandadas;
let numero = 0;
const recibo = () => ({ hash: `h-${++numero}`, ledger: 1, returnValue: numero, number: numero });
globalThis.__rumboAccounts = {
  kind: "dev",
  getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
  getForPerson: async () => null,
  authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
};
stellar.rumboPass.register = async () => (cadena.inscriptas++, recibo());
stellar.rumboPass.buy = async () => (cadena.compradas++, recibo());
stellar.rumboPass.status = async () => ({ has_pass: true, number: 1, checked_in: false, redeemed: [] });
// La importación habla con el contrato por su propio gancho.
globalThis.__rumboKitChain = { register: async () => recibo(), status: async () => ({ has_pass: true, number: 1, checked_in: false, redeemed: [] }) };
const correos = [];
globalThis.__rumboMailer = { kind: "dev", send: async (mail) => (correos.push(mail.to), { id: String(correos.length) }) };

// La cuenta propia: una llave local hace de cuenta de quien se inscribe, y firma como lo haría su dispositivo.
const CONTRATO = StrKey.encodeContract(randomBytes(32));
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
stellar.walletChain.ensureAccount = async () => true;
stellar.walletChain.hasTestTrustline = async () => true;
stellar.walletChain.topUpTestUsdc = async () => {};
stellar.rumboPass.prepare = async (_contractId, fn, cuenta) => (cadena.preparadas++, { entryXdr: autorizacionSinFirmar(cuenta, fn).toXdr("base64"), validUntilLedger: 1060, latestLedger: 1000 });
stellar.rumboPass.submitSigned = async () => (cadena.mandadas++, recibo());

beforeEach(async () => {
  await registrationAttempts().clear();
  await linkResendAttempts().clear();
  await walletChallengeAttempts().clear();
  delete process.env[LIST_ONLY_ENV];
});

// ---------- Los eventos ----------

let contratos = 0;
/** Una hackatón publicada (se inscribe sola o por equipos), con una entrada paga además de la gratis. */
async function hackaton(nombre, { direccion, publicar = true } = {}) {
  let event = await createEventFromTemplate(repo, { template: "hackaton", lang: "es", name: nombre, startsAtLocal: mananaALas9().slice(0, 16), place: "Santa Cruz", organizerName: "La comunidad" });
  const vieja = event.slug;
  if (direccion) {
    // La dirección se cambia mientras es un borrador; la de antes queda anotada como dirección vieja del evento.
    assert.deepEqual(await changeEventSlug(event, direccion), { ok: true, slug: direccion });
    event = await repo.getEventById(event.id);
  }
  if (publicar) assert.equal((await publishEvent(repo, event, { deploy: async () => `CLISTA${++contratos}` })).ok, true);
  event = await repo.getEventById(event.id);
  const gratis = (await repo.listTicketTypes(event.id)).find((t) => t.templateSlot === "attendee");
  const paga = await repo.createTicketType({ eventId: event.id, name: "Con polera", priceUsdc: 10, contractId: "CPAGA" });
  return { event, slug: event.slug, vieja, gratis, paga };
}

const lista = await hackaton("Hackatón por lista", { direccion: "solo-por-lista" });
const abierto = await hackaton("Hackatón abierta", { direccion: "con-inscripcion" });
const borrador = await hackaton("Hackatón en borrador", { direccion: "todavia-borrador", publicar: false });
/** La variable como la escribiría alguien apurado: con mayúsculas, espacios, un salto de línea y un evento que no existe. */
const SOLO_LISTA = `  Solo-Por-Lista ,\n no-existe , TODAVIA-BORRADOR `;
const soloPorLista = () => (process.env[LIST_ONLY_ENV] = SOLO_LISTA);

// ---------- Cómo se llama a cada puerta ----------

let ips = 0;
const ip = () => `190.20.${Math.floor(++ips / 250)}.${(ips % 250) + 1}`;
const enRuta = (slug) => ({ params: Promise.resolve({ slug }) });
const correo = (nombre) => `${nombre}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const leer = async (res) => ({ status: res.status, cuerpo: await res.json() });

const porApi = async (slug, cuerpo) => leer(await inscribir(await pedido(`http://localhost/api/evento/${slug}/inscripcion`, { ip: ip(), body: { name: "Persona Prueba", lang: "es", ...cuerpo } }), enRuta(slug)));
const firmaPorApi = async (slug, cuerpo) => leer(await firmar(await pedido(`http://localhost/api/evento/${slug}/inscripcion/firma`, { ip: ip(), body: cuerpo }), enRuta(slug)));

const comoPedido = (fn) => workAsyncStorage.run({ forceStatic: true, route: "/prueba" }, fn);
/** A dónde manda una acción que terminó bien: Next redirige con un error que lleva la ruta. */
async function adondeRedirige(fn) {
  try {
    const estado = await comoPedido(fn);
    return { estado };
  } catch (error) {
    const digest = String(error?.digest ?? "");
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return { redirige: digest.split(";")[2] };
  }
}
function formulario(campos) {
  const form = new FormData();
  for (const [k, v] of Object.entries(campos)) form.set(k, v);
  return form;
}
const porFormulario = (slug, entrada, email) => adondeRedirige(() => registerAction({}, formulario({ evento: slug, entrada, nombre: "Persona Formulario", correo: email })));
const equipoPorFormulario = (slug, equipo, emails) =>
  adondeRedirige(() => registerTeamAction({}, formulario({ evento: slug, equipo, ...Object.fromEntries(emails.flatMap((email, i) => [[`nombre${i}`, `Integrante ${i + 1}`], [`correo${i}`, email]])) })));

/** Lo que hace el navegador con la cuenta propia: pide el desafío y lo firma. */
async function pruebaDeCuenta(llave) {
  const d = await leer(await pedirDesafio(await pedido("http://localhost/api/cuenta/desafio", { ip: ip(), body: { publicKey: llave.publicKey(), lang: "es" } })));
  assert.equal(d.status, 201);
  return { provider: "pollar", publicKey: llave.publicKey(), challengeId: d.cuerpo.challengeId, signature: Buffer.from(llave.sign(propia.sep53Digest(d.cuerpo.message))).toString("base64") };
}
const firmarAutorizacion = async (xdrB64, llave) => (await authorizeEntry(xdr.SorobanAuthorizationEntry.fromXdr(xdrB64, "base64"), llave, 1060, Networks.TESTNET)).toXdr("base64");

/** Que nada haya quedado de un pedido que se frenó: ni la persona, ni una credencial a medias, ni una llamada al contrato. */
async function nadaQuedo(email, antes, que) {
  assert.equal(await repo.getPersonByEmail(email), null, `${que}: no se guarda a la persona`);
  assert.equal(emitidas(), antes.emitidas, `${que}: no se emite ninguna credencial`);
  assert.equal(cadena.preparadas, antes.preparadas, `${que}: no se le pide nada al contrato`);
  assert.equal((await repo.listPasses(lista.event.id)).length, antes.pases, `${que}: no queda ninguna credencial, ni pendiente`);
}
const foto = async () => ({ emitidas: emitidas(), preparadas: cadena.preparadas, pases: (await repo.listPasses(lista.event.id)).length });

// ---------- La variable ----------

test("la variable: direcciones separadas por coma, sin distinguir mayúsculas ni espacios; vacía o sin definir, ningún evento", async () => {
  assert.equal(LIST_ONLY_ENV, "RUMBO_LIST_ONLY_EVENTS");
  assert.equal(isListOnly(lista.event), false, "sin definir");
  process.env[LIST_ONLY_ENV] = "";
  assert.equal(isListOnly(lista.event), false, "vacía");
  process.env[LIST_ONLY_ENV] = " , ,, ";
  assert.equal(isListOnly(lista.event), false, "solo comas y espacios");
  assert.equal(await listOnlyEventAt(repo, lista.slug), null);

  for (const valor of ["solo-por-lista", "SOLO-POR-LISTA", "  solo-por-lista  ", "otro,solo-por-lista", "otro , Solo-Por-Lista ,", "otro\nsolo-por-lista\n", SOLO_LISTA]) {
    process.env[LIST_ONLY_ENV] = valor;
    assert.equal(isListOnly(lista.event), true, JSON.stringify(valor));
    assert.equal(isListOnly(abierto.event), false, `${JSON.stringify(valor)} no alcanza a otro evento`);
  }
  // Una dirección que solo empieza igual, o que la contiene, es otro evento.
  process.env[LIST_ONLY_ENV] = "solo-por-lista-2,solo-por,por-lista";
  assert.equal(isListOnly(lista.event), false);
});

test("la variable se lee con tolerancia: comillas pegadas, punto y coma, la ruta o el enlace entero, y lo que se cuela al copiar y pegar", async () => {
  const ZWSP = String.fromCodePoint(0x200b);
  const BOM = String.fromCodePoint(0xfeff);
  const cierran = [
    '"solo-por-lista,otro"',
    "'otro','solo-por-lista'",
    `${String.fromCodePoint(0x201c)}solo-por-lista${String.fromCodePoint(0x201d)}`,
    "otro;solo-por-lista",
    "otro ; solo-por-lista ;",
    "/e/solo-por-lista",
    "e/solo-por-lista/",
    "/e/solo-por-lista/inscripcion?entrada=1",
    "/admin/solo-por-lista",
    "https://rumbo.example.com/e/solo-por-lista",
    "https://rumbo.example.com/e/Solo-Por-Lista?lang=en#entradas",
    "rumbo.example.com/solo-por-lista",
    `${BOM}solo-por-lista${ZWSP}`,
    `otro,${ZWSP}solo-por-${ZWSP}lista`,
  ];
  for (const valor of cierran) {
    process.env[LIST_ONLY_ENV] = valor;
    assert.equal(isListOnly(lista.event), true, JSON.stringify(valor));
    assert.equal(isListOnly(abierto.event), false, `${JSON.stringify(valor)} no alcanza a otro evento`);
    assert.equal((await listOnlyEventAt(repo, lista.slug))?.id, lista.event.id, JSON.stringify(valor));
  }
  // Con la variable entre comillas, como queda al pegarla en un panel de variables, la API contesta que no.
  process.env[LIST_ONLY_ENV] = '"solo-por-lista"';
  assert.deepEqual(await porApi(lista.slug, { ticketTypeId: lista.gratis.id, email: correo("comillas") }), { status: 403, cuerpo: { error: "list_only" } });
});

test("lo que no tiene forma de dirección no cierra nada y queda avisado en el registro, una sola vez", async () => {
  process.env[LIST_ONLY_ENV] = "solo_por_lista, con-inscripcion";
  const primera = await capturarConsola(async () => [isListOnly(lista.event), isListOnly(abierto.event)]);
  assert.deepEqual(primera.resultado, [false, true], "la entrada mal escrita no cierra su evento; la buena sí cierra el suyo");
  const avisos = primera.lineas.filter((l) => l.includes("[por-lista]"));
  assert.equal(avisos.length, 1, primera.lineas.join("\n"));
  assert.match(avisos[0], /RUMBO_LIST_ONLY_EVENTS trae "solo_por_lista"/);
  assert.match(avisos[0], /no cierra ningún evento/);

  // El mismo problema no se repite en cada pedido, ni cuando la variable cambia y vuelve.
  process.env[LIST_ONLY_ENV] = "solo_por_lista";
  const segunda = await capturarConsola(async () => [isListOnly(lista.event), await listOnlyEventAt(repo, lista.slug)]);
  assert.deepEqual(segunda.resultado, [false, null]);
  assert.deepEqual(segunda.lineas, []);
});

test("el inicio lista los publicados que no entran solo por lista, y avisa de una dirección de la variable que no es de ningún evento", async () => {
  const todos = await repo.listEvents();
  const direcciones = (eventos) => eventos.map((e) => e.slug).sort();
  const publicados = direcciones(todos.filter((e) => e.published));
  assert.ok(publicados.includes(lista.slug) && publicados.includes(abierto.slug) && !publicados.includes(borrador.slug));

  // Sin la variable salen todos los publicados y ningún borrador, y no se avisa nada.
  const libre = await capturarConsola(async () => direcciones(listedEvents(todos)));
  assert.deepEqual(libre.resultado, publicados);
  assert.deepEqual(libre.lineas, []);

  // Con la variable, el evento de la lista no sale; los demás, sí.
  process.env[LIST_ONLY_ENV] = "solo-por-lista, todavia-borrador";
  const cerrado = await capturarConsola(async () => direcciones(listedEvents(todos)));
  assert.deepEqual(cerrado.resultado, publicados.filter((slug) => slug !== lista.slug));
  assert.deepEqual(cerrado.lineas, [], "un borrador de la variable es un evento que existe: no hay nada que avisar");

  // La dirección real terminó siendo otra (el evento se volvió a crear y quedó con otro final): el evento sale en
  // el inicio, y el registro dice que la variable nombra una dirección que no es de nadie.
  process.env[LIST_ONLY_ENV] = "solo-por-lista-2";
  const corrida = await capturarConsola(async () => direcciones(listedEvents(todos)));
  assert.deepEqual(corrida.resultado, publicados);
  assert.equal(corrida.lineas.length, 1, corrida.lineas.join("\n"));
  assert.match(corrida.lineas[0], /\[por-lista\] RUMBO_LIST_ONLY_EVENTS nombra "solo-por-lista-2", que no es la dirección de ningún evento/);
  const otraVez = await capturarConsola(async () => listedEvents(todos).length);
  assert.deepEqual(otraVez.lineas, [], "una vez por proceso");

  // Datos sueltos, sin la base: solo cuentan publicado y la dirección.
  process.env[LIST_ONLY_ENV] = "uno";
  assert.deepEqual(listedEvents([{ slug: "uno", published: true }, { slug: "dos", published: true }, { slug: "tres", published: false }]), [{ slug: "dos", published: true }]);
  assert.deepEqual(listedEvents([]), []);
});

test("el evento se resuelve primero y se compara su dirección de ahora: vale por la vieja, y una vieja en la variable no cierra nada", async () => {
  assert.notEqual(lista.vieja, lista.slug);
  soloPorLista();
  assert.equal((await listOnlyEventAt(repo, lista.slug))?.id, lista.event.id);
  assert.equal((await listOnlyEventAt(repo, lista.vieja))?.id, lista.event.id, "por la dirección vieja es el mismo evento");
  assert.equal(await listOnlyEventAt(repo, abierto.slug), null);
  assert.equal(await listOnlyEventAt(repo, abierto.vieja), null);
  assert.equal(await listOnlyEventAt(repo, "no-existe"), null);
  assert.equal(await listOnlyEventAt(repo, borrador.slug), null, "un borrador todavía no recibe inscripciones: se contesta lo de siempre");

  // En la variable va la dirección de ahora. Con la vieja el evento no queda cerrado.
  process.env[LIST_ONLY_ENV] = lista.vieja;
  assert.equal(isListOnly(lista.event), false);
  assert.equal(await listOnlyEventAt(repo, lista.vieja), null);
});

// ---------- Las puertas públicas contestan que no ----------

test("la API contesta 403 list_only: con la entrada gratis, con la paga y con la cuenta propia", async () => {
  soloPorLista();
  const antes = await foto();

  const gratis = correo("api-gratis");
  assert.deepEqual(await porApi(lista.slug, { ticketTypeId: lista.gratis.id, email: gratis }), { status: 403, cuerpo: { error: "list_only" } });
  await nadaQuedo(gratis, antes, "la API con la entrada gratis");

  const paga = correo("api-paga");
  assert.deepEqual(await porApi(lista.slug, { ticketTypeId: lista.paga.id, email: paga }), { status: 403, cuerpo: { error: "list_only" } });
  await nadaQuedo(paga, antes, "la API con la entrada paga");

  const llave = Keypair.random();
  const conCuenta = correo("api-cuenta");
  for (const entrada of [lista.gratis, lista.paga]) {
    const wallet = await pruebaDeCuenta(llave);
    assert.deepEqual(await porApi(lista.slug, { ticketTypeId: entrada.id, email: conCuenta, wallet }), { status: 403, cuerpo: { error: "list_only" } });
  }
  await nadaQuedo(conCuenta, antes, "la API con la cuenta propia");
  assert.equal(await repo.getWalletLinkByAccount(llave.publicKey()), null, "la cuenta no queda ligada a nadie");

  // Una entrada que no existe o un correo ya inscripto reciben la misma respuesta: no dice quién está en la lista.
  assert.deepEqual(await porApi(lista.slug, { ticketTypeId: "no-existe", email: correo("api-otra") }), { status: 403, cuerpo: { error: "list_only" } });
  assert.deepEqual(correos, [], "y no sale ningún correo");
});

test("el paso de firma de la cuenta propia tampoco emite: un pedido que quedó de antes de cerrar el evento contesta 403", async () => {
  // Con la inscripción abierta, la persona llega hasta el paso de firmar.
  const llave = Keypair.random();
  const email = correo("firma");
  const paso1 = await porApi(lista.slug, { ticketTypeId: lista.gratis.id, email, wallet: await pruebaDeCuenta(llave) });
  assert.equal(paso1.status, 202, JSON.stringify(paso1.cuerpo));
  const firmada = await firmarAutorizacion(paso1.cuerpo.authEntry, llave);
  const persona = await repo.getPersonByEmail(email);
  const pendiente = () => repo.findPass(lista.event.id, persona.id);
  assert.equal((await pendiente()).status, "pending");

  // El evento pasa a entrar solo por lista: la firma ya no emite la credencial, ni por la API ni por el formulario.
  soloPorLista();
  const mandadas = cadena.mandadas;
  assert.deepEqual(await firmaPorApi(lista.slug, { requestId: paso1.cuerpo.requestId, signedAuthEntry: firmada }), { status: 403, cuerpo: { error: "list_only" } });
  assert.deepEqual(await firmaPorApi(lista.vieja, { requestId: paso1.cuerpo.requestId, signedAuthEntry: firmada }), { status: 403, cuerpo: { error: "list_only" } }, "por la dirección vieja");
  const porAccion = await adondeRedirige(() => walletSignAction({ slug: lista.slug, requestId: paso1.cuerpo.requestId, signedAuthEntry: firmada }));
  assert.deepEqual(porAccion, { estado: { error: POR_LISTA, values: undefined } });
  // Con el evento de otra ruta tampoco sale: ese pedido de firma es de este evento.
  const porOtroEvento = await firmaPorApi(abierto.slug, { requestId: paso1.cuerpo.requestId, signedAuthEntry: firmada });
  assert.equal(porOtroEvento.status, 410);
  assert.equal(cadena.mandadas, mandadas, "nada llegó al contrato");
  assert.equal((await pendiente()).status, "pending", "la credencial sigue sin emitir");
});

test("el formulario contesta que la inscripción la lleva quien organiza: con la entrada gratis, con la paga y con la cuenta propia", async () => {
  soloPorLista();
  const antes = await foto();

  for (const [que, entrada] of [["gratis", lista.gratis], ["paga", lista.paga]]) {
    const email = correo(`form-${que}`);
    const { estado, redirige } = await porFormulario(lista.slug, entrada.id, email);
    assert.equal(redirige, undefined, `el formulario con la entrada ${que} no lleva a la confirmación`);
    assert.equal(estado.error, POR_LISTA);
    assert.deepEqual(estado.values, { name: "Persona Formulario", email, contact: false }, "lo escrito no se pierde");
    await nadaQuedo(email, antes, `el formulario con la entrada ${que}`);
  }

  const llave = Keypair.random();
  const email = correo("form-cuenta");
  const wallet = await pruebaDeCuenta(llave);
  const conCuenta = await adondeRedirige(() => walletRegisterAction({ slug: lista.slug, ticketTypeId: lista.gratis.id, name: "Persona Cuenta", email, contact: false, diet: "", wallet }));
  assert.equal(conCuenta.estado.error, POR_LISTA);
  assert.equal(conCuenta.estado.needsSignature, undefined, "no hay nada que firmar");
  await nadaQuedo(email, antes, "el formulario con la cuenta propia");
});

test("el formulario de equipos contesta lo mismo, y no anota el equipo ni inscribe a nadie", async () => {
  soloPorLista();
  const antes = await foto();
  const gente = [correo("equipo-1"), correo("equipo-2")];

  const { estado } = await equipoPorFormulario(lista.slug, "Los Cerrados", gente);
  assert.equal(estado.error, POR_LISTA);
  assert.equal(estado.done, undefined);

  const directo = await registerTeam({ slug: lista.slug, teamName: "Los Cerrados", members: gente.map((email, i) => ({ name: `Integrante ${i + 1}`, email })), lang: "es" }, repo);
  assert.deepEqual(directo, { ok: false, reason: "list_only" });

  assert.deepEqual(await repo.listTeams(lista.event.id), [], "el equipo no queda anotado");
  for (const email of gente) await nadaQuedo(email, antes, "el formulario de equipos");
});

test("entrando por una dirección vieja del evento, cada puerta contesta igual", async () => {
  soloPorLista();
  const antes = await foto();
  const email = correo("vieja");

  assert.deepEqual(await porApi(lista.vieja, { ticketTypeId: lista.gratis.id, email }), { status: 403, cuerpo: { error: "list_only" } });
  assert.deepEqual(await porApi(lista.vieja, { ticketTypeId: lista.paga.id, email }), { status: 403, cuerpo: { error: "list_only" } });
  assert.equal((await porFormulario(lista.vieja, lista.gratis.id, email)).estado.error, POR_LISTA);
  assert.equal((await equipoPorFormulario(lista.vieja, "Los Viejos", [email])).estado.error, POR_LISTA);
  const directa = await publicRegistration({ slug: lista.vieja, ticketTypeId: lista.gratis.id, name: "Persona Vieja", email, lang: "es", selfService: true });
  assert.deepEqual([directa.kind, directa.reason], ["failed", "list_only"]);
  await nadaQuedo(email, antes, "por la dirección vieja");

  // La dirección vieja de un evento que no está en la lista sigue sin ser una puerta, como siempre.
  assert.deepEqual(await porApi(abierto.vieja, { ticketTypeId: abierto.gratis.id, email }), { status: 404, cuerpo: { error: "not_found", what: "event" } });
  // Y un borrador de la lista no dice nada distinto de cualquier borrador.
  assert.deepEqual(await porApi(borrador.slug, { ticketTypeId: borrador.gratis.id, email }), { status: 404, cuerpo: { error: "not_found", what: "event" } });
});

test("lo público del evento dice que entra solo por lista; el de los demás no cambia", async () => {
  soloPorLista();
  const ver = async (slug) => leer(await verEvento(await pedido(`http://localhost/api/evento/${slug}`, { method: "GET" }), enRuta(slug)));
  const cerrado = await ver(lista.slug);
  assert.equal(cerrado.status, 200, "la página y sus datos siguen abiertos con el enlace");
  assert.equal(cerrado.cuerpo.event.registration, "list_only");
  const libre = await ver(abierto.slug);
  assert.equal("registration" in libre.cuerpo.event, false);
});

// ---------- Lo que pide quien organiza sigue andando ----------

test("agregar en la puerta devuelve a la persona agregada, con su credencial emitida", async () => {
  soloPorLista();
  const puerta = (await ensureStationCodes(lista.event, repo)).find((c) => c.kind === "gate").code;
  const email = correo("puerta");
  const antes = cadena.inscriptas;
  const r = await leer(await agregar(await pedido("http://localhost/api/scan/agregar", { ip: ip(), body: { code: puerta, name: "Llegó Sin Lista", email, lang: "es" } })));
  assert.equal(r.status, 201, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.kind, "added");
  assert.equal(r.cuerpo.match.name, "Llegó Sin Lista");
  assert.equal(cadena.inscriptas, antes + 1);
  const pase = await repo.getPass(r.cuerpo.match.passId);
  assert.deepEqual([pase.status, pase.eventId, pase.ticketTypeId], ["active", lista.event.id, lista.gratis.id]);
  assert.deepEqual(correos.slice(-1), [email], "le sale su enlace");

  // La misma persona otra vez: vuelve como la que ya estaba, para marcarle la entrada.
  const otraVez = await leer(await agregar(await pedido("http://localhost/api/scan/agregar", { ip: ip(), body: { code: puerta, name: "Llegó Sin Lista", email, lang: "es" } })));
  assert.deepEqual([otraVez.status, otraVez.cuerpo.kind, otraVez.cuerpo.match.passId], [200, "existing", pase.id]);
});

const CSV = (personas) => `name,email,approval_status\n${personas.map(([nombre, email]) => `${nombre},${email},approved`).join("\n")}\n`;

test("una importación sigue emitiendo credenciales, y el panel, el escáner y la credencial abren como siempre", async () => {
  soloPorLista();
  const clave = await getOrCreateOrganizerKey(lista.event.id);
  const gente = [["Ana Lista", correo("ana")], ["Bea Lista", correo("bea")], ["Cata Lista", correo("cata")]];
  const llamar = async (campos) => {
    const form = formulario(campos);
    const res = await importar(new NextRequest(`http://localhost/api/admin/${lista.slug}/importar?k=${clave}`, { method: "POST", body: form }), enRuta(lista.slug));
    return leer(res);
  };
  const archivo = () => new File([CSV(gente)], "aprobadas.csv", { type: "text/csv" });

  const vista = await llamar({ accion: "vista", archivo: archivo() });
  assert.equal(vista.status, 200, JSON.stringify(vista.cuerpo));
  assert.equal(vista.cuerpo.preview.buckets.approved.valid, 3);
  const importado = await llamar({ accion: "importar", archivo: archivo(), estados: JSON.stringify(["approved"]), tipos: JSON.stringify({}), tipoPorDefecto: vista.cuerpo.preview.defaultTypeId });
  assert.deepEqual([importado.status, importado.cuerpo.summary.created, importado.cuerpo.pending], [200, 3, 3]);
  const tanda = await llamar({ accion: "tanda", importacion: importado.cuerpo.runId });
  assert.deepEqual([tanda.status, tanda.cuerpo.result.activated, tanda.cuerpo.result.remaining], [200, 3, 0]);

  const pases = [];
  for (const [, email] of gente) {
    const persona = await repo.getPersonByEmail(email);
    const pase = await repo.findPass(lista.event.id, persona.id);
    assert.equal(pase.status, "active", "cada persona de la lista tiene su credencial");
    pases.push(pase);
  }

  // El panel, con la clave del evento.
  const estado = await leer(await panel(new NextRequest(`http://localhost/api/admin/${lista.slug}?k=${clave}`), enRuta(lista.slug)));
  assert.equal(estado.status, 200);
  const enPanel = new Set(estado.cuerpo.passes.map((p) => p.id));
  assert.ok(pases.every((p) => enPanel.has(p.id)), "el panel lista las credenciales importadas");
  // Y dice que el evento entra solo por lista: es la comprobación de quien organiza de que la variable lo alcanza.
  assert.equal(estado.cuerpo.listOnly, true);
  const claveAbierto = await getOrCreateOrganizerKey(abierto.event.id);
  const otroPanel = await leer(await panel(new NextRequest(`http://localhost/api/admin/${abierto.slug}?k=${claveAbierto}`), enRuta(abierto.slug)));
  assert.deepEqual([otroPanel.status, otroPanel.cuerpo.listOnly], [200, false], "el panel de un evento con inscripción abierta no lo dice");
  process.env[LIST_ONLY_ENV] = "solo-por-lista-2";
  const malEscrita = await leer(await panel(new NextRequest(`http://localhost/api/admin/${lista.slug}?k=${clave}`), enRuta(lista.slug)));
  assert.equal(malEscrita.cuerpo.listOnly, false, "con la variable apuntando a otra dirección, el panel deja de decirlo");
  soloPorLista();

  // El escáner: el puesto de la puerta abre y trae las credenciales.
  const puerta = (await ensureStationCodes(lista.event, repo)).find((c) => c.kind === "gate").code;
  const puesto = await leer(await abrirPuesto(await pedido("http://localhost/api/scan/open", { ip: ip(), body: { code: puerta, scannerId: "celu-lista" } })));
  assert.equal(puesto.status, 200, JSON.stringify(puesto.cuerpo));
  const enEscaner = new Set(puesto.cuerpo.passes.map((p) => p.id));
  assert.ok(pases.every((p) => enEscaner.has(p.id)), "el escáner conoce las credenciales importadas");

  // La credencial, con su enlace personal.
  const k = await getOrCreateAccessKey(pases[0].id);
  const abierta = await leer(await credencial(new NextRequest(`http://localhost/api/pase/${pases[0].id}?k=${k}`), { params: Promise.resolve({ passId: pases[0].id }) }));
  assert.equal(abierta.status, 200);
  assert.deepEqual([abierta.cuerpo.event.slug, abierta.cuerpo.person.name], [lista.slug, "Ana Lista"]);
});

test("quien ya tiene su cuenta propia no frena la importación: su credencial queda pendiente al final de la fila y las de atrás salen", async () => {
  soloPorLista();
  // Nueve personas aprobadas. Las seis primeras de la fila ya entraron alguna vez con su cuenta propia con ese correo:
  // el servidor no puede firmar por ellas, así que su credencial no se puede preparar desde la importación.
  const gente = Array.from({ length: 9 }, (_, i) => [`Persona ${i + 1}`, correo(`fila-${i + 1}`)]);
  const { run } = await prepareImport(repo, lista.event, parseGuests(CSV(gente)), { statuses: ["approved"], mapping: {}, defaultTypeId: lista.gratis.id });
  const fila = await repo.listPassesByImportRun(run.id);
  assert.equal(fila.length, 9);
  const conCuenta = fila.slice(0, 6);
  for (const pase of conCuenta) assert.equal(await repo.linkWallet({ personId: pase.personId, provider: "pollar", publicKey: Keypair.random().publicKey() }), true);
  const sinCuenta = fila.slice(6);

  const deps = { accounts: new PollarAccountProvider(repo, globalThis.__rumboAccounts), chain: globalThis.__rumboKitChain, mailer: globalThis.__rumboMailer, lang: "es" };
  const tanda = async () => (await capturarConsola(() => activateBatch(repo, lista.event, run.id, 5, deps))).resultado;
  const estadoDe = async (pases) => Promise.all(pases.map(async (p) => (await repo.getPass(p.id)).status));

  // La primera tanda toma las cinco primeras: ninguna sale, y pasan al final de la fila.
  const primera = await tanda();
  assert.deepEqual([primera.processed, primera.activated, primera.failed, primera.remaining], [5, 0, 5, 9]);

  // La segunda no vuelve sobre las mismas cinco: toma las que siguen, y las tres sin cuenta propia tienen su credencial.
  const segunda = await tanda();
  assert.deepEqual([segunda.processed, segunda.activated, segunda.failed, segunda.remaining], [5, 3, 2, 6]);
  assert.deepEqual(await estadoDe(sinCuenta), ["active", "active", "active"]);

  // Lo que queda son las seis con cuenta propia: siguen pendientes, sin cuenta del servidor ni lugar en el evento.
  const tercera = await tanda();
  assert.deepEqual([tercera.activated, tercera.failed, tercera.remaining], [0, 5, 6]);
  assert.deepEqual(await estadoDe(conCuenta), Array(6).fill("pending"));
  assert.ok((await Promise.all(conCuenta.map((p) => repo.getPass(p.id)))).every((p) => p.account === null));

  // La pantalla recibe el resumen de siempre, sin la fila de adentro.
  const estado = await importStatus(repo, run.id);
  assert.deepEqual([estado.remaining, estado.summary.activated, estado.summary.failed, "retryLast" in estado.summary], [6, 3, 5, false]);

  // La fila, con datos sueltos: primero las que nunca fallaron, en su orden; al final las que fallaron, en el orden en que fallaron.
  const ids = (lista) => lista.map((p) => p.id);
  const pendientes = ["a", "b", "c", "d"].map((id) => ({ id }));
  assert.deepEqual(ids(importQueue(pendientes, [])), ["a", "b", "c", "d"]);
  assert.deepEqual(ids(importQueue(pendientes, ["c", "a"])), ["b", "d", "c", "a"]);
  assert.deepEqual(ids(importQueue(pendientes, ["ya-no-esta", "d"])), ["a", "b", "c", "d"]);
});

test("las herramientas del asistente de quien organiza siguen andando, y dicen que el evento entra solo por lista", async () => {
  soloPorLista();
  const clave = await getOrCreateOrganizerKey(lista.event.id);
  const server = createRumboMcpServer({ repo, lang: "es", origin: "http://localhost:3999", organizerKey: clave, createKey: null, provisioner: { deploy: async () => `CLISTA${++contratos}` } });
  const [lado, otro] = InMemoryTransport.createLinkedPair();
  await server.connect(lado);
  const client = new Client({ name: "prueba-por-lista", version: "0" });
  await client.connect(otro);
  const llamar = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    return { error: r.isError === true, texto: r.content?.[0]?.text ?? "", datos: r.structuredContent ?? null };
  };

  const leido = await llamar("get_event", { event: lista.slug });
  assert.equal(leido.error, false, leido.texto);
  assert.equal(leido.datos.event.registration, "list_only");
  assert.ok(leido.datos.tickets.every((t) => t.publicRegistration === false), "ninguna entrada se ofrece para inscribirse sola");
  const otroEvento = await llamar("get_event", { event: abierto.slug });
  assert.equal("registration" in otroEvento.datos.event, false);
  assert.ok(otroEvento.datos.tickets.some((t) => t.publicRegistration === true));

  const gente = [["Dana Lista", correo("dana")], ["Eli Lista", correo("eli")]];
  const importado = await llamar("import_guest_list", { event: lista.slug, csv: CSV(gente), confirm: true });
  assert.equal(importado.error, false, importado.texto);
  assert.deepEqual([importado.datos.summary.created, importado.datos.batch.activated, importado.datos.batch.remaining], [2, 2, 0]);
  for (const [, email] of gente) {
    const persona = await repo.getPersonByEmail(email);
    assert.equal((await repo.findPass(lista.event.id, persona.id)).status, "active");
  }
  const numeros = await llamar("event_status", { event: lista.slug });
  assert.equal(numeros.error, false, numeros.texto);
  await client.close();
});

// ---------- Con la variable vacía, todo como siempre ----------

test("con la lista vacía todo queda como hoy: el mismo evento inscribe por la API, por el formulario y por equipos", async () => {
  for (const valor of [undefined, "", "otro-evento"]) {
    if (valor === undefined) delete process.env[LIST_ONLY_ENV];
    else process.env[LIST_ONLY_ENV] = valor;
    const que = `con la variable ${valor === undefined ? "sin definir" : JSON.stringify(valor)}`;

    const api = await porApi(lista.slug, { ticketTypeId: lista.gratis.id, email: correo("libre-api") });
    assert.equal(api.status, 201, `${que}: ${JSON.stringify(api.cuerpo)}`);
    assert.equal(api.cuerpo.status, "created");

    const paga = await porApi(lista.slug, { ticketTypeId: lista.paga.id, email: correo("libre-paga") });
    assert.deepEqual([paga.status, paga.cuerpo.paid], [201, true], que);

    const form = await porFormulario(lista.slug, lista.gratis.id, correo("libre-form"));
    assert.match(form.redirige ?? "", new RegExp(`^/e/${lista.slug}/listo\\?pase=`), `${que}: el formulario lleva a la confirmación`);

    const equipo = await equipoPorFormulario(lista.slug, `Los Libres ${Math.random().toString(36).slice(2, 6)}`, [correo("libre-eq1"), correo("libre-eq2")]);
    assert.deepEqual([equipo.estado.done?.registered, equipo.estado.done?.failed], [2, 0], que);
  }
});

test("un evento que no está en la lista se inscribe como siempre aunque otro esté cerrado", async () => {
  soloPorLista();
  const api = await porApi(abierto.slug, { ticketTypeId: abierto.gratis.id, email: correo("abierto-api") });
  assert.equal(api.status, 201, JSON.stringify(api.cuerpo));
  const form = await porFormulario(abierto.slug, abierto.gratis.id, correo("abierto-form"));
  assert.match(form.redirige ?? "", new RegExp(`^/e/${abierto.slug}/listo\\?pase=`));
  const equipo = await registerTeam({ slug: abierto.slug, teamName: "Los Abiertos", members: [{ name: "Integrante Uno", email: correo("abierto-eq") }], lang: "es" }, repo);
  assert.deepEqual([equipo.ok, equipo.registered], [true, 1]);
});

// ---------- Que no aparezca otra puerta sin el freno ----------

/** Los archivos de código de una carpeta, con la ruta desde src/ y barras derechas. */
function fuentes(dir) {
  const src = join(APP_DIR, "src");
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((f) => f.isFile() && /\.tsx?$/.test(f.name))
    .map((f) => join(f.parentPath, f.name))
    .map((ruta) => ({ ruta: relative(src, ruta).split(sep).join("/"), texto: readFileSync(ruta, "utf8") }));
}

test("ninguna ruta ni acción inscribe por su cuenta: todas pasan por una puerta que mira la lista", () => {
  const src = join(APP_DIR, "src");
  // Lo que inscribe sin mirar la lista. Las puertas públicas (publicRegistration, publicCompletion, registerTeam) sí la miran.
  const SIN_FRENO = /\b(registerForEvent|completeRegistration)\b/;

  // Las rutas, las acciones y las pantallas no las nombran nunca.
  const enLaApp = fuentes(join(src, "app")).filter((f) => SIN_FRENO.test(f.texto)).map((f) => f.ruta);
  assert.deepEqual(enLaApp, [], "una ruta o una acción llama a la inscripción sin pasar por la puerta pública");

  // En el servidor, solo quien las define, agregar en la puerta (lo pide quien organiza) y los equipos (que miran la lista antes).
  const enElServidor = fuentes(join(src, "server")).filter((f) => /\b(registerForEvent|completeRegistration)\(/.test(f.texto)).map((f) => f.ruta).sort();
  assert.deepEqual(enElServidor, ["server/evento/inscripcion.ts", "server/kit/equipos.ts", "server/puerta.ts"]);
  const equipos = readFileSync(join(src, "server", "kit", "equipos.ts"), "utf8");
  assert.ok(equipos.indexOf("listOnlyEventAt(repo, input.slug)") > 0 && equipos.indexOf("listOnlyEventAt(repo, input.slug)") < equipos.indexOf("registerForEvent({"), "los equipos miran la lista antes de inscribir");

  // Y las pantallas que ofrecen inscribirse miran la lista: la página del evento y los dos formularios. El inicio
  // arma su lista con listedEvents, que se prueba con datos más arriba, y no trae eventos por otro lado.
  for (const pantalla of ["app/e/[slug]/page.tsx", "app/e/[slug]/inscripcion/page.tsx", "app/e/[slug]/equipo/page.tsx"]) {
    assert.match(readFileSync(join(src, ...pantalla.split("/")), "utf8"), /\bisListOnly\(event\)/, `${pantalla} no mira la lista`);
  }
  const inicio = readFileSync(join(src, "app", "page.tsx"), "utf8");
  assert.match(inicio, /const events = listedEvents\(await repo\.listEvents\(\)\);/, "el inicio no arma su lista con listedEvents");
  assert.equal(inicio.match(/repo\.(listEvents\w*|getEvent\w*)\(/g)?.length, 1, "el inicio trae eventos por otro lado, sin pasar por listedEvents");
});

test("el texto de la página existe en los dos idiomas y dice quién lleva la inscripción", () => {
  assert.equal(textos.es["evento.porLista"], "La inscripción a este evento la lleva quien organiza.");
  assert.equal(textos.en["evento.porLista"], "Registration for this event is handled by the organizer.");
});

test("el aviso que vuelve del servidor se muestra junto al botón del formulario, que es lo que queda a la vista en un celular", () => {
  // Quien manda un formulario que tenía abierto de antes recibe "la lleva quien organiza". Debajo de los campos, en
  // un celular quedaba fuera de la pantalla, tapado por el botón fijo: va adentro de la zona del botón, antes que él.
  for (const [archivo, boton] of [["evento/FormularioInscripcion.tsx", "<Enviar label="], ["kit/FormularioEquipo.tsx", "<Enviar />"]]) {
    const fuente = readFileSync(join(APP_DIR, "src", "components", ...archivo.split("/")), "utf8");
    const formulario = fuente.slice(fuente.lastIndexOf("<form action={formAction}"));
    const accion = formulario.indexOf('<div className="pantalla-accion">');
    const estado = formulario.indexOf("<Estado error={state.error} />");
    assert.ok(accion > 0 && estado > accion && formulario.indexOf(boton) > estado, `${archivo}: el aviso no está junto al botón, antes que él`);
    assert.equal(formulario.slice(0, accion).includes("state.error"), false, `${archivo}: queda un aviso de error entre los campos`);
    assert.match(fuente, /<div aria-live="polite" className="cuenta-estado">\s+\{pending \? <Aviso>.*<\/Aviso> : error \? <Aviso tono="alerta">\{error\}<\/Aviso> : null\}/, archivo);
  }
});

test("el panel de un evento que entra solo por lista lo dice arriba, en los dos idiomas, y no anuncia que recibe inscripciones", () => {
  assert.match(textosPanel.es["panel.porLista"], /^Este evento entra solo por lista: nadie se inscribe por su cuenta/);
  assert.match(textosPanel.en["panel.porLista"], /^This event is list-only: nobody can sign up on their own/);
  const pantalla = readFileSync(join(APP_DIR, "src", "components", "panel", "PanelCliente.tsx"), "utf8");
  assert.match(pantalla, /\{state\.listOnly && <Aviso>\{t\("panel\.porLista"\)\}<\/Aviso>\}/);
  assert.match(pantalla, /\{publicado && !state\.listOnly && <Aviso tono="listo">\{t\("kit\.armar\.publicado"\)\}<\/Aviso>\}/);
});
