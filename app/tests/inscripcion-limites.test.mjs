// La inscripción tiene freno: por IP (la que pone la plataforma) y en total, igual para un correo nuevo o
// uno conocido, y el enlace a un correo que ya tenía su credencial se reenvía una vez cada diez minutos.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { entornoDePrueba, eventoDePrueba, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
process.env.RUMBO_TRUSTED_IP_HEADER = "x-real-ip";
const { getRepo } = await import("../src/server/repo.ts");
const stellar = await import("../src/server/stellar.ts");
const { linkResendAttempts, registrationAttempts } = await import("../src/server/limites.ts");
const { POST: inscribir } = await import("../src/app/api/evento/[slug]/inscripcion/route.ts");

const repo = getRepo();
const datos = await eventoDePrueba(repo);

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
    correos.push(mail.to);
    return { id: String(correos.length) };
  },
};

beforeEach(async () => {
  await registrationAttempts().clear();
  await linkResendAttempts().clear();
  correos.length = 0;
});

const inscripcion = async (email, ip) => {
  const res = await inscribir(await pedido(`http://localhost/api/evento/${datos.event.slug}/inscripcion`, { ip, body: { ticketTypeId: datos.ticket.id, name: "Persona Prueba", email, lang: "es" } }), {
    params: Promise.resolve({ slug: datos.event.slug }),
  });
  return { status: res.status, cuerpo: await res.json() };
};

test("sesenta pedidos por IP en diez minutos; el siguiente se frena, con correo nuevo o conocido", async () => {
  const conocido = "conocida@example.com";
  assert.equal((await inscripcion(conocido, "200.0.0.1")).status, 201);
  for (let i = 1; i < 60; i++) assert.equal((await inscripcion(`masiva-${i}@example.com`, "200.0.0.1")).status, 201, `pedido ${i}`);
  const nuevo = await inscripcion("otra-mas@example.com", "200.0.0.1");
  const yaInscripta = await inscripcion(conocido, "200.0.0.1");
  assert.deepEqual([nuevo.status, nuevo.cuerpo], [429, { error: "too_many" }]);
  assert.deepEqual([yaInscripta.status, yaInscripta.cuerpo], [429, { error: "too_many" }], "la misma respuesta: el freno no dice si el correo está inscripto");
  assert.equal(await repo.getPersonByEmail("otra-mas@example.com"), null, "frenado, no se crea nada");
  // desde otra conexión se sigue inscribiendo
  assert.equal((await inscripcion("de-otra-ip@example.com", "200.0.0.2")).status, 201);
});

test("el enlace a quien ya tenía su credencial se reenvía una vez cada diez minutos, aunque se pida desde muchas IP", async () => {
  const email = "valeria@example.com";
  assert.equal((await inscripcion(email, "201.0.0.1")).status, 201);
  for (let i = 2; i <= 6; i++) {
    const r = await inscripcion(email, `201.0.0.${i}`);
    assert.deepEqual([r.status, r.cuerpo], [200, { status: "existing" }]);
  }
  // uno al inscribirse y uno solo de reenvío
  assert.deepEqual(correos, [email, email]);
});

test("el reenvío vuelve a salir pasados los diez minutos", async () => {
  const email = "beto@example.com";
  await inscripcion(email, "202.0.0.1");
  await inscripcion(email, "202.0.0.2");
  assert.equal(correos.length, 2);
  // pasaron los diez minutos: el freno de ese correo ya no está
  await linkResendAttempts().clear();
  await inscripcion(email, "202.0.0.3");
  assert.equal(correos.length, 3);
});
