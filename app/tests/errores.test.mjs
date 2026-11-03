// Los errores internos no salen del servidor: el panel recibe un código fijo, el detalle queda en el
// registro del servidor, y ese registro no lleva correos de personas.
import assert from "node:assert/strict";
import { test } from "node:test";
import { capturarConsola, entornoDePrueba, eventoDePrueba, paseDePrueba, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const stellar = await import("../src/server/stellar.ts");
const { getOrCreateOrganizerKey, refreshFromChain, CHAIN_UNAVAILABLE } = await import("../src/server/panel.ts");
const { registerForEvent } = await import("../src/server/evento/inscripcion.ts");
const { POST: contrastar } = await import("../src/app/api/admin/[slug]/cadena/route.ts");

const SECRETO = "https://rpc-interno.example/?key=llave-del-proveedor";

test("si la cadena no contesta, el resumen del panel dice que no se pudo y el detalle queda en el servidor", async () => {
  const repo = getRepo();
  const datos = await eventoDePrueba(repo);
  await paseDePrueba(repo, datos);
  const original = { info: stellar.rumboPass.info, attendees: stellar.rumboPass.attendees, status: stellar.rumboPass.status };
  stellar.rumboPass.info = async () => {
    throw new Error(`fetch failed ${SECRETO}`);
  };
  stellar.rumboPass.attendees = stellar.rumboPass.info;
  stellar.rumboPass.status = stellar.rumboPass.info;
  try {
    const { resultado: summary, lineas } = await capturarConsola(() => refreshFromChain(datos.event, repo));
    assert.equal(summary.contracts[0].error, CHAIN_UNAVAILABLE);
    assert.ok(summary.errors.length >= 2);
    assert.ok(!JSON.stringify(summary).includes("rpc-interno"), JSON.stringify(summary));
    assert.ok(lineas.some((l) => l.includes(SECRETO)), "el detalle tiene que quedar en el registro del servidor");
  } finally {
    Object.assign(stellar.rumboPass, original);
  }
});

test("la ruta del contraste responde un código fijo, sin el mensaje del error", async () => {
  const real = getRepo();
  const datos = await eventoDePrueba(real);
  const clave = await getOrCreateOrganizerKey(datos.event.id);
  // la base falla a mitad del contraste con un mensaje que trae una ruta del servidor
  globalThis.__rumboRepo = new Proxy(real, {
    get(target, prop) {
      if (prop === "listTicketTypes") return async () => {
        throw new Error("SQLITE_BUSY en C:\servidor\secreto\rumbo.db");
      };
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    const req = await pedido(`http://localhost/api/admin/${datos.event.slug}/cadena?k=${clave}`, { body: {} });
    const { resultado: res, lineas } = await capturarConsola(() => contrastar(req, { params: Promise.resolve({ slug: datos.event.slug }) }));
    assert.equal(res.status, 502);
    const cuerpo = await res.json();
    assert.deepEqual(cuerpo, { error: "chain" });
    assert.ok(lineas.some((l) => l.includes("secreto")), "el detalle tiene que quedar en el registro del servidor");
  } finally {
    globalThis.__rumboRepo = real;
  }
});

test("si el correo no sale, el registro del servidor lleva el id de la persona y no su correo", async () => {
  const repo = getRepo();
  const datos = await eventoDePrueba(repo);
  const { person, pass } = await paseDePrueba(repo, datos, { email: "valeria.privada@example.com" });
  const anterior = globalThis.__rumboMailer;
  globalThis.__rumboMailer = {
    kind: "dev",
    send: async (mail) => {
      throw new Error(`el proveedor rechazó a ${mail.to}`);
    },
  };
  try {
    // ya tenía su credencial: se le reenvía el enlace por correo, y el envío falla
    const { resultado, lineas } = await capturarConsola(() =>
      registerForEvent({ slug: datos.event.slug, ticketTypeId: datos.ticket.id, name: person.name, email: person.email, lang: "es" }),
    );
    assert.equal(resultado.kind, "existing");
    const aviso = lineas.find((l) => l.includes("No se pudo mandar el correo"));
    assert.ok(aviso, lineas.join("\n"));
    assert.ok(aviso.includes(person.id) && aviso.includes(pass.id), aviso);
    assert.ok(!lineas.some((l) => l.includes("valeria.privada")), lineas.join("\n"));
  } finally {
    globalThis.__rumboMailer = anterior;
  }
});
