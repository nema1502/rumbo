// El respaldo manual de la puerta: buscar a alguien por nombre o correo, marcarle la entrada a mano y agregarlo
// en el momento. Solo lo abre el código del puesto Puerta. Sin red: las cuentas, el contrato y el correo son de mentira.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
process.env.RUMBO_TRUSTED_IP_HEADER = "x-real-ip";
const { getRepo } = await import("../src/server/repo.ts");
const stellar = await import("../src/server/stellar.ts");
const { ensureStationCodes } = await import("../src/server/panel.ts");
const { processScanItems } = await import("../src/server/escaner.ts");
const { doorSearchAttempts, maskEmail, searchDoor } = await import("../src/server/puerta.ts");
const { registrationAttempts } = await import("../src/server/limites.ts");
const { normalizeSearch, searchSnapshotByName } = await import("../src/lib/busqueda.ts");
const { GATE_STATION, isManualScannerId, manualScannerId } = await import("../src/lib/escaner-api.ts");
const { POST: buscar } = await import("../src/app/api/scan/buscar/route.ts");
const { POST: agregar } = await import("../src/app/api/scan/agregar/route.ts");

const repo = getRepo();

// Sin red: las cuentas, el contrato y el correo son de mentira.
let numero = 0;
globalThis.__rumboAccounts = {
  kind: "dev",
  getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
  authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
};
stellar.rumboPass.register = async () => {
  numero++;
  return { hash: `h-${numero}`, ledger: 1, returnValue: numero, number: numero };
};
const correos = [];
globalThis.__rumboMailer = {
  kind: "dev",
  send: async (mail) => {
    correos.push(mail);
    return { id: String(correos.length) };
  },
};

beforeEach(() => {
  doorSearchAttempts().clear();
  registrationAttempts().clear();
  correos.length = 0;
});

async function evento() {
  const datos = await eventoDePrueba(repo);
  const codigos = await ensureStationCodes(datos.event, repo);
  return { ...datos, puerta: codigos.find((c) => c.kind === "gate").code, mesa: codigos.find((c) => c.kind === "benefit").code };
}
const datos = await evento();
const jose = await paseDePrueba(repo, datos, { name: "José Pérez", email: "jose.perez@example.com" });
const ana = await paseDePrueba(repo, datos, { name: "Ana María Rojas", email: "ana.rojas@example.com" });
const anita = await paseDePrueba(repo, datos, { name: "Ana Torres", email: "anita@example.org" });
// una inscripción que no terminó (la red falló a mitad de camino) no aparece
const pendiente = await repo.upsertPerson({ name: "Pendiente Nadie", email: "pendiente@example.com" });
await repo.createPass({ eventId: datos.event.id, personId: pendiente.id, ticketTypeId: datos.ticket.id, status: "pending" });

const llamar = async (ruta, handler, body, ip = "200.1.1.1") => {
  const res = await handler(await pedido(`http://localhost/api/scan/${ruta}`, { body, ip }));
  return { status: res.status, cuerpo: await res.json() };
};

// ---------- Buscar ----------

test("la búsqueda no distingue mayúsculas ni tildes, y encuentra por nombre o por correo", async () => {
  assert.equal(normalizeSearch("  JOSÉ   Pérez "), "jose perez");
  const porNombre = await searchDoor(repo, datos.event, "jose");
  assert.deepEqual(porNombre.map((m) => m.passId), [jose.pass.id]);
  assert.deepEqual((await searchDoor(repo, datos.event, "PEREZ")).map((m) => m.passId), [jose.pass.id]);
  assert.deepEqual((await searchDoor(repo, datos.event, "anita@")).map((m) => m.passId), [anita.pass.id], "por correo");
  assert.deepEqual((await searchDoor(repo, datos.event, "rojas")).map((m) => m.passId), [ana.pass.id]);
  const dosAna = await searchDoor(repo, datos.event, "ana ");
  assert.deepEqual(dosAna.map((m) => m.name), ["Ana María Rojas", "Ana Torres"], "por nombre, en orden");
});

test("hacen falta tres letras, y quien no terminó de inscribirse no aparece", async () => {
  assert.deepEqual(await searchDoor(repo, datos.event, "an"), []);
  assert.deepEqual(await searchDoor(repo, datos.event, ""), []);
  assert.deepEqual(await searchDoor(repo, datos.event, "pendiente"), []);
  assert.deepEqual(await searchDoor(repo, datos.event, "nadie"), []);
});

test("el correo vuelve tapado, nunca entero", async () => {
  assert.equal(maskEmail("jose.perez@example.com"), "j***@example.com");
  const [match] = await searchDoor(repo, datos.event, "jose");
  assert.equal(match.emailHint, "j***@example.com");
  assert.ok(!JSON.stringify(match).includes("jose.perez"), "el correo entero no sale");
  assert.equal(match.ticket, "Inscripción");
  assert.equal(match.checkedInAt, null);
});

test("cuenta como entrada la que está en el espejo aunque todavía no haya llegado al contrato", async () => {
  const otra = await paseDePrueba(repo, datos, { name: "Zacarías Quispe", email: "zacarias@example.com" });
  assert.equal((await searchDoor(repo, datos.event, "zacarias"))[0].checkedInAt, null);
  const row = await repo.recordCheckIn({ clientId: "espejo-1", eventId: datos.event.id, passId: otra.pass.id, scannerId: "otro-celular", scannedAt: "2026-11-22T09:15:00-04:00" });
  assert.ok(row);
  assert.equal((await searchDoor(repo, datos.event, "zacarias"))[0].checkedInAt, "2026-11-22T09:15:00-04:00");
});

test("devuelve como mucho ocho", async () => {
  const lleno = await evento();
  for (let i = 0; i < 12; i++) await paseDePrueba(repo, lleno, { name: `Persona ${String(i).padStart(2, "0")}`, email: `persona${i}@example.com` });
  const encontrados = await searchDoor(repo, lleno.event, "persona");
  assert.equal(encontrados.length, 8);
  assert.deepEqual(encontrados.map((m) => m.name), [...encontrados.map((m) => m.name)].sort());
});

test("sin red, el escáner busca por nombre en la lista que ya bajó", () => {
  const lista = [
    { id: "AAAAAAA2", name: "José Pérez", benefits: [], checkedInAt: null, redeemed: {} },
    { id: "AAAAAAA3", name: "Ana María", benefits: [], checkedInAt: "2026-11-22T09:00:00-04:00", redeemed: {} },
  ];
  assert.deepEqual(searchSnapshotByName(lista, "JOSE").map((m) => m.passId), ["AAAAAAA2"]);
  assert.equal(searchSnapshotByName(lista, "ana m")[0].checkedInAt, "2026-11-22T09:00:00-04:00");
  assert.equal(searchSnapshotByName(lista, "jose", (id) => (id === "AAAAAAA2" ? "2026-11-22T09:30:00-04:00" : null))[0].checkedInAt, "2026-11-22T09:30:00-04:00", "lo que marcó este celular también cuenta");
  assert.deepEqual(searchSnapshotByName(lista, "jo"), []);
  assert.equal(searchSnapshotByName(lista, "jose")[0].emailHint, "", "sin red no hay correos");
});

// ---------- El permiso ----------

test("solo el código de la puerta abre el buscador y el agregar; el de una mesa y uno que no existe, no", async () => {
  const cuerpo = { query: "jose", name: "Pedro Nuevo", email: "pedro@example.com" };
  const conPuerta = await llamar("buscar", buscar, { code: datos.puerta, ...cuerpo });
  assert.equal(conPuerta.status, 200);
  assert.deepEqual(conPuerta.cuerpo.matches.map((m) => m.name), ["José Pérez"]);

  const conMesa = await llamar("buscar", buscar, { code: datos.mesa, ...cuerpo });
  assert.deepEqual([conMesa.status, conMesa.cuerpo], [403, { error: "gate_only" }]);
  const agregarConMesa = await llamar("agregar", agregar, { code: datos.mesa, ...cuerpo });
  assert.deepEqual([agregarConMesa.status, agregarConMesa.cuerpo], [403, { error: "gate_only" }]);
  assert.equal(await repo.getPersonByEmail("pedro@example.com"), null, "con el código de la mesa no se agrega a nadie");

  assert.equal((await llamar("buscar", buscar, { code: "ZZZZZZZZZZZZ", ...cuerpo })).status, 401);
  assert.equal((await llamar("agregar", agregar, { code: "ZZZZZZZZZZZZ", ...cuerpo })).status, 401);
  assert.equal((await llamar("buscar", buscar, { query: "jose" })).status, 400, "sin código");
});

test("la búsqueda tiene freno: ciento veinte por evento en diez minutos", async () => {
  for (let i = 0; i < 120; i++) assert.equal((await llamar("buscar", buscar, { code: datos.puerta, query: "jose" })).status, 200, `búsqueda ${i}`);
  const frenada = await llamar("buscar", buscar, { code: datos.puerta, query: "jose" });
  assert.equal(frenada.status, 429);
  assert.deepEqual(frenada.cuerpo, { error: "too_many_attempts" });
});

// ---------- Agregar en la puerta ----------

test("agregar en la puerta inscribe gratis a la persona, le manda su credencial y devuelve su pase", async () => {
  const { status, cuerpo } = await llamar("agregar", agregar, { code: datos.puerta, name: "Pedro Nuevo", email: "Pedro@Example.com", lang: "es" });
  assert.equal(status, 201);
  assert.equal(cuerpo.kind, "added");
  assert.equal(cuerpo.match.name, "Pedro Nuevo");
  assert.equal(cuerpo.match.emailHint, "p***@example.com");
  assert.equal(cuerpo.match.checkedInAt, null);
  assert.equal(cuerpo.match.ticket, "Inscripción");

  const pase = await repo.getPass(cuerpo.match.passId);
  assert.equal(pase.status, "active");
  assert.equal(pase.eventId, datos.event.id);
  assert.match(pase.account, /^G/);
  assert.equal(correos.length, 1, "la credencial le llega al correo");
  assert.equal(correos[0].to, "pedro@example.com");
  // y desde ese momento se lo encuentra
  assert.deepEqual((await searchDoor(repo, datos.event, "pedro")).map((m) => m.passId), [pase.id]);
});

test("agregar a quien ya estaba inscripto con ese correo devuelve su pase, para marcarle la entrada", async () => {
  const { status, cuerpo } = await llamar("agregar", agregar, { code: datos.puerta, name: "Jose Perez", email: "JOSE.PEREZ@example.com", lang: "es" });
  assert.equal(status, 200);
  assert.equal(cuerpo.kind, "existing");
  assert.equal(cuerpo.match.passId, jose.pass.id);
});

test("nombre o correo inválidos, y un evento sin entrada gratis, se dicen con su motivo", async () => {
  const sinCorreo = await llamar("agregar", agregar, { code: datos.puerta, name: "Pedro", email: "no-es-un-correo" });
  assert.deepEqual([sinCorreo.status, sinCorreo.cuerpo], [400, { kind: "error", error: "invalid_email" }]);
  const sinNombre = await llamar("agregar", agregar, { code: datos.puerta, name: " ", email: "alguien@example.com" });
  assert.deepEqual([sinNombre.status, sinNombre.cuerpo], [400, { kind: "error", error: "invalid_name" }]);

  const caro = await eventoDePrueba(repo, { precio: 10 });
  const codigos = await ensureStationCodes(caro.event, repo);
  const sinGratis = await llamar("agregar", agregar, { code: codigos.find((c) => c.kind === "gate").code, name: "Pedro Nuevo", email: "pedro2@example.com" });
  assert.deepEqual([sinGratis.status, sinGratis.cuerpo], [409, { kind: "error", error: "no_free_ticket" }]);
  assert.equal(await repo.getPersonByEmail("pedro2@example.com"), null);
});

test("el freno de inscripciones también vale en la puerta", async () => {
  for (let i = 0; i < 60; i++) registrationAttempts().note("200.9.9.9");
  const frenado = await llamar("agregar", agregar, { code: datos.puerta, name: "Pedro Tarde", email: "tarde@example.com" }, "200.9.9.9");
  assert.equal(frenado.status, 429);
  assert.deepEqual(frenado.cuerpo, { kind: "error", error: "too_many" });
});

// ---------- Marcar la entrada a mano ----------

test("la entrada marcada a mano va por el mismo camino que una lectura y queda como manual en el espejo", async () => {
  const llamadas = [];
  const cadena = {
    checkIn: async (contractId, account) => {
      llamadas.push(account);
      return { hash: "h-manual" };
    },
    redeem: async () => ({ hash: "no" }),
    outcome: async () => "missing",
  };
  const scannerId = manualScannerId("abc12345");
  assert.equal(scannerId, "manual:puerta:abc12345");
  assert.ok(isManualScannerId(scannerId));
  assert.ok(!isManualScannerId("abc12345"));
  const item = { clientId: "manual-1", action: "checkin", passId: anita.pass.id, benefitId: null, scannedAt: "2026-11-22T09:20:00-04:00", scannerId };
  const [resultado] = await processScanItems(repo, datos.event, GATE_STATION, [item], cadena);
  assert.equal(resultado.status, "synced");
  assert.deepEqual(llamadas, [anita.pass.account]);

  const [fila] = await repo.listCheckInsForPass(anita.pass.id);
  assert.equal(fila.scannerId, "manual:puerta:abc12345", "queda con su puesto");
  assert.equal(fila.scannedAt, "2026-11-22T09:20:00-04:00", "y con su hora");
  assert.ok(fila.synced);
  assert.equal((await repo.getPass(anita.pass.id)).status, "checked_in");
  assert.equal((await searchDoor(repo, datos.event, "anita"))[0].checkedInAt !== null, true, "y el buscador ya la muestra como que entró");

  // marcar dos veces no llega dos veces al contrato
  const [otra] = await processScanItems(repo, datos.event, GATE_STATION, [item], cadena);
  assert.equal(otra.status, "synced");
  assert.equal(llamadas.length, 1);
});

test("el escáner de una mesa no puede marcar entradas, ni a mano", async () => {
  const mesa = { id: datos.lunch.id, kind: "benefit", name: "Almuerzo", place: null };
  const item = { clientId: "manual-2", action: "checkin", passId: ana.pass.id, benefitId: null, scannedAt: new Date().toISOString(), scannerId: manualScannerId("zzz") };
  const [resultado] = await processScanItems(repo, datos.event, mesa, [item], { checkIn: async () => assert.fail("no debería llegar"), redeem: async () => ({ hash: "x" }), outcome: async () => "missing" });
  assert.equal(resultado.status, "rejected");
});
