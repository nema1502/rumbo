// La sesión del escáner: abrir el puesto con el código da una ficha firmada por el servidor, y con ella se
// sincroniza, se busca y se agrega sin pasar por el freno de códigos equivocados (que queda solo para abrir). Así un
// celular con un código muerto, o alguien probando códigos desde el mismo wifi, no deja sin sincronizar a los
// voluntarios de al lado. La ficha va atada al código: si quien organiza lo cambia, deja de valer. Una ficha
// inventada no cuenta como intento. Y un cuerpo JSON que no es un objeto contesta 400, nunca 500. Sin red.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba, pedido, qrImpreso } from "./lib/entorno.mjs";

entornoDePrueba();
process.env.RUMBO_TRUSTED_IP_HEADER = "x-real-ip";
const { getRepo } = await import("../src/server/repo.ts");
const { getDb } = await import("../src/server/base/index.ts");
const stellar = await import("../src/server/stellar.ts");
const { ensureStationCodes, resolveStationCode } = await import("../src/server/panel.ts");
const { stationCodeAttempts, registrationAttempts } = await import("../src/server/limites.ts");
const { doorSearchAttempts } = await import("../src/server/puerta.ts");
const { SCAN_SESSION_TTL_MS, issueScanSession, readScanSession } = await import("../src/server/sesion-escaner.ts");
const { regenerateStandCode, createStand } = await import("../src/server/stands.ts");
const { abrirCola, agruparParaSincronizar, nuevaEntrada } = await import("../src/lib/cola.ts");
const { formatStationCode } = await import("../src/lib/station-code.ts");
const rutas = {
  open: (await import("../src/app/api/scan/open/route.ts")).POST,
  sync: (await import("../src/app/api/scan/sync/route.ts")).POST,
  buscar: (await import("../src/app/api/scan/buscar/route.ts")).POST,
  agregar: (await import("../src/app/api/scan/agregar/route.ts")).POST,
};

const repo = getRepo();

// Sin red: las cuentas, el contrato y el correo son de mentira (para "agregar en la puerta").
let numero = 0;
globalThis.__rumboAccounts = {
  kind: "dev",
  getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
  authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
};
stellar.rumboPass.register = async () => ({ hash: `h-${++numero}`, ledger: 1, returnValue: numero, number: numero });
stellar.rumboPass.checkIn = async () => ({ hash: `hc-${++numero}`, ledger: 1, returnValue: 1, arrival: 1 });
globalThis.__rumboMailer = { kind: "dev", send: async () => ({ id: "1" }) };

const llamar = async (ruta, body, ip = "200.1.1.1") => {
  const res = await rutas[ruta](await pedido(`http://localhost/api/scan/${ruta}`, { body, ip }));
  return { status: res.status, cuerpo: res.headers.get("content-type")?.includes("json") ? await res.json() : null };
};
const abrir = (code, ip, scannerId = "celu-1") => llamar("open", { code, scannerId }, ip);

beforeEach(async () => {
  await stationCodeAttempts().clear();
  await doorSearchAttempts().clear();
  await registrationAttempts().clear();
});

async function evento() {
  const d = await eventoDePrueba(repo);
  const stand = await createStand(d.event, { name: "Acme" }, repo);
  const codigos = await ensureStationCodes(d.event, repo);
  return { ...d, stand, puerta: codigos.find((c) => c.kind === "gate").code, mesa: codigos.find((c) => c.kind === "benefit").code, codigoStand: codigos.find((c) => c.kind === "stand").code };
}

test("abrir el puesto da una ficha de sesión atada al código, al evento y al celular, que vale treinta y seis horas y no se puede tocar", async () => {
  const d = await evento();
  const antes = Date.now();
  const { status, cuerpo } = await abrir(formatStationCode(d.puerta).toLowerCase(), "10.0.0.1", "celu-7");
  assert.equal(status, 200);
  assert.equal(cuerpo.station.kind, "gate");
  const { token, expiresAt } = cuerpo.session;
  assert.equal(typeof token, "string");
  assert.ok(Math.abs(Date.parse(expiresAt) - (antes + SCAN_SESSION_TTL_MS)) < 5000, "vence en treinta y seis horas");
  const leida = await readScanSession(token);
  assert.deepEqual([leida.eventId, leida.code, leida.scannerId], [d.event.id, d.puerta, "celu-7"]);
  assert.equal(await readScanSession(token, Date.parse(expiresAt) + 1), null, "vencida");
  // tocada: una letra de la firma, o del contenido
  const [payload, sig] = token.split(".");
  assert.equal(await readScanSession(`${payload}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`), null);
  const otro = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), c: d.mesa }), "utf8").toString("base64url");
  assert.equal(await readScanSession(`${otro}.${sig}`), null, "la ficha de la puerta no sirve para la mesa");
  for (const basura of ["", "a", "a.b", `${payload}.${sig}.c`, "x".repeat(2000)]) assert.equal(await readScanSession(basura), null, JSON.stringify(basura));
  // ni la del escáner sirve de código: con la ficha de otro evento, aunque la firma sea buena, no abre este puesto
  const ajeno = await eventoDePrueba(repo);
  const ajena = await issueScanSession({ eventId: ajeno.event.id, code: d.puerta, scannerId: "x" });
  assert.deepEqual((await llamar("sync", { token: ajena.token, items: [] }, "10.0.0.1")).status, 401);
});

test("con la ficha, sincronizar, buscar y agregar no pasan por el freno de códigos: un wifi frenado sigue trabajando, y una ficha inventada no cuenta como intento", async () => {
  const d = await evento();
  const ana = await paseDePrueba(repo, d, { name: "Ana Quiroga", email: "ana.q@example.com" });
  const wifi = "200.50.60.70";
  const { cuerpo } = await abrir(d.puerta, wifi);
  const token = cuerpo.session.token;
  // Un colega (o alguien cualquiera) se equivoca ocho veces desde el mismo wifi: la IP queda frenada para abrir.
  for (let i = 0; i < 8; i++) assert.equal((await abrir("ZZZZZZZZZZZZ", wifi)).status, 401);
  assert.equal((await abrir(d.puerta, wifi)).status, 429, "abrir con el código correcto desde esa IP, frenado");
  // Pero la sesión que ya estaba abierta sigue: sincroniza, busca y agrega.
  const item = { clientId: "s-1", action: "checkin", passId: ana.pass.id, benefitId: null, scannedAt: new Date().toISOString(), scannerId: "celu-1", qr: await qrImpreso(d.event.id, ana.pass.id) };
  const sync = await llamar("sync", { token, items: [item] }, wifi);
  assert.equal(sync.status, 200);
  assert.equal(sync.cuerpo.results[0].status, "synced");
  const busqueda = await llamar("buscar", { token, query: "ana" }, wifi);
  assert.equal(busqueda.status, 200);
  assert.deepEqual(busqueda.cuerpo.matches.map((m) => m.passId), [ana.pass.id]);
  const agregado = await llamar("agregar", { token, name: "Pedro Nuevo", email: "pedro.nuevo@example.com" }, wifi);
  assert.equal(agregado.status, 201);
  // Con el código, en cambio, el freno sigue valiendo (la cola de una versión anterior).
  assert.equal((await llamar("sync", { code: d.puerta, items: [] }, wifi)).status, 429);
  // Y una ficha inventada contesta 401 sin contar como intento: después de muchas, la IP sigue abriendo con el código bueno.
  const otraIp = "181.2.2.2";
  for (let i = 0; i < 20; i++) {
    const r = await llamar("sync", { token: `aW52ZW50YWRh${i}.firma`, items: [] }, otraIp);
    assert.deepEqual([r.status, r.cuerpo], [401, { error: "session_expired" }]);
  }
  assert.equal((await abrir(d.puerta, otraIp)).status, 200);
  // Si vienen la ficha y el código, manda la ficha: el freno no mira el código.
  assert.equal((await llamar("sync", { token, code: "ZZZZZZZZZZZZ", items: [] }, wifi)).status, 200);
});

test("la ficha deja de valer cuando quien organiza cambia el código, y abrir con la ficha da una nueva", async () => {
  const d = await evento();
  const abierto = await abrir(d.codigoStand, "10.0.0.2");
  const token = abierto.cuerpo.session.token;
  assert.equal(abierto.cuerpo.station.kind, "stand");
  // Abrir con la ficha (la foto fresca en medio de una lectura) también vale, y da otra ficha.
  const otraVez = await llamar("open", { token, scannerId: "celu-1" }, "10.0.0.2");
  assert.equal(otraVez.status, 200);
  assert.notEqual(otraVez.cuerpo.session.token, undefined);
  const nuevo = await regenerateStandCode(d.event, d.stand.id, repo);
  const muerta = await llamar("sync", { token, items: [] }, "10.0.0.2");
  assert.deepEqual([muerta.status, muerta.cuerpo], [401, { error: "wrong_code" }]);
  assert.deepEqual((await llamar("open", { token }, "10.0.0.2")).status, 401);
  assert.equal((await abrir(nuevo, "10.0.0.2")).status, 200);
  assert.equal(await resolveStationCode(d.codigoStand, repo), null);
});

test("una ficha con la forma correcta de un evento que no existe contesta 401 en las cuatro rutas: no crea llaves, no choca con la base y cuesta una sola lectura", async () => {
  const d = await evento();
  const inventado = "11111111-2222-4333-8444-555555555555";
  const armar = (claims) => `${Buffer.from(JSON.stringify({ v: 1, e: inventado, c: d.puerta, s: "celu-1", x: Date.now() + 60_000, ...claims }), "utf8").toString("base64url")}.firma`;
  const token = armar({});
  const cuerpos = { open: { token, scannerId: "celu-1" }, sync: { token, items: [] }, buscar: { token, query: "ana" }, agregar: { token, name: "Pedro Nuevo", email: "pedro.nuevo@example.com" } };
  for (const [ruta, cuerpo] of Object.entries(cuerpos)) {
    const r = await llamar(ruta, cuerpo, "10.0.0.4");
    assert.deepEqual([r.status, r.cuerpo], [401, { error: "session_expired" }], ruta);
  }
  const db = getDb();
  assert.equal(await db.one("SELECT 1 AS yes FROM event_qr_keys WHERE event_id = ?", [inventado]), null, "no quedaron llaves de un evento que no existe");
  // Lo que cuesta leerla: una vencida se descarta sin tocar la base; una de un evento que no existe, una lectura y ninguna escritura.
  const one = db.one.bind(db);
  const run = db.run.bind(db);
  const cuenta = { lecturas: 0, escrituras: 0 };
  db.one = (...args) => (cuenta.lecturas++, one(...args));
  db.run = (...args) => (cuenta.escrituras++, run(...args));
  try {
    assert.equal(await readScanSession(armar({ e: d.event.id, x: Date.now() - 1 })), null, "vencida");
    assert.deepEqual(cuenta, { lecturas: 0, escrituras: 0 }, "una vencida no busca las llaves");
    assert.equal(await readScanSession(token), null, "de un evento que no existe");
    assert.deepEqual(cuenta, { lecturas: 1, escrituras: 0 }, "una de un evento que no existe cuesta una lectura, y nunca crea llaves");
  } finally {
    db.one = one;
    db.run = run;
  }
});

test("la cola agrupa lo pendiente por puesto con la ficha de cada uno: la de la sesión para el puesto abierto, la última guardada para los otros, y el código si no hay", async () => {
  const entrada = (code, token, passId, extra = {}) => nuevaEntrada({ eventId: "ev", stationId: code === "PUERTAPUERTA" ? "gate" : "almuerzo", code, token, action: "checkin", passId, benefitId: null, scannerId: "celu", ...extra });
  const vieja = entrada("MESAMESAMESA", undefined, "AAAAAAAA");
  const mesa1 = entrada("MESAMESAMESA", "ficha-vieja", "BBBBBBBB");
  const mesa2 = entrada("MESAMESAMESA", "ficha-nueva", "CCCCCCCC");
  const puerta = entrada("PUERTAPUERTA", "ficha-de-antes", "DDDDDDDD");
  const grupos = agruparParaSincronizar([vieja, mesa1, mesa2, puerta], { code: "PUERTA-PUERTA", token: "ficha-de-ahora", eventId: "ev", stationId: "gate" });
  assert.deepEqual(
    grupos.map((g) => [g.code, g.actual, g.token, g.entries.length]),
    [
      ["PUERTAPUERTA", true, "ficha-de-ahora", 1],
      ["MESAMESAMESA", false, "ficha-nueva", 3],
    ],
  );
  const soloViejas = agruparParaSincronizar([vieja], { code: "PUERTAPUERTA", token: "ficha", eventId: "ev", stationId: "gate" });
  assert.deepEqual(soloViejas.map((g) => [g.code, g.token]), [["MESAMESAMESA", null]], "sin ficha, viaja con el código");
  assert.equal(vieja.token, undefined, "una entrada sin ficha no la inventa");

  // Quien organiza cambió el código de la puerta: lo que se registró con el viejo es del mismo evento y puesto, así que
  // viaja con la sesión abierta, con el código y la ficha nuevos (el servidor vuelve a comprobar el QR de cada lectura).
  // Lo de la puerta de OTRO evento, con el mismo id de puesto, no: espera con su código y su ficha.
  const conElViejo = entrada("VIEJOVIEJOVI", "ficha-del-viejo", "EEEEEEEE", { stationId: "gate" });
  const ajena = entrada("AJENOAJENOAJ", "ficha-ajena", "FFFFFFFF", { stationId: "gate", eventId: "otro" });
  const tras = agruparParaSincronizar([conElViejo, mesa1, ajena], { code: "NUEVONUEVONU", token: "ficha-nueva-de-la-puerta", eventId: "ev", stationId: "gate" });
  assert.deepEqual(
    tras.map((g) => [g.code, g.actual, g.token, g.entries.map((e) => e.passId)]),
    [
      ["NUEVONUEVONU", true, "ficha-nueva-de-la-puerta", ["EEEEEEEE"]],
      ["MESAMESAMESA", false, "ficha-vieja", ["BBBBBBBB"]],
      ["AJENOAJENOAJ", false, "ficha-ajena", ["FFFFFFFF"]],
    ],
  );
  // Si el servidor pidió reintentar, el escáner vuelve a anotar el registro con el código y la ficha con que viajó
  // (la cola admite el cambio): desde otro puesto abierto después sigue saliendo con los nuevos, no con el viejo muerto.
  const cola = await abrirCola();
  await cola.add(conElViejo);
  await cola.update(conElViejo.clientId, { attempts: 1, lastError: "en curso", code: "NUEVONUEVONU", token: "ficha-nueva-de-la-puerta" });
  const desdeOtro = agruparParaSincronizar(await cola.listPendingAll(), { code: "MESAMESAMESA", token: "ficha-de-la-mesa", eventId: "ev", stationId: "almuerzo" });
  assert.deepEqual(
    desdeOtro.map((g) => [g.code, g.actual, g.token, g.entries.map((e) => [e.passId, e.attempts])]),
    [["NUEVONUEVONU", false, "ficha-nueva-de-la-puerta", [["EEEEEEEE", 1]]]],
  );
});

test("un cuerpo JSON que es null, una lista o un texto contesta 400 en las cuatro rutas del escáner, nunca 500", async () => {
  const d = await evento();
  for (const cuerpo of [null, [], "texto", 7]) {
    for (const ruta of ["open", "sync", "buscar", "agregar"]) {
      assert.equal((await llamar(ruta, cuerpo, "10.0.0.3")).status, 400, `${ruta} con ${JSON.stringify(cuerpo)}`);
    }
  }
  assert.equal((await abrir(d.puerta, "10.0.0.3")).status, 200, "y después sigue andando: los cuerpos malos no contaron como intentos");
});
