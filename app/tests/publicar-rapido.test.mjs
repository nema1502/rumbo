// Publicar en segundos: de a un contrato por paso, primero los del asistente, y el evento abre apenas ellos tienen el
// suyo; lo del equipo se termina después, o en el momento en que alguien emite una credencial de ese tipo (importar
// una lista, la inscripción de una credencial importada, la puerta, los equipos). Y la ruta que da cada paso, la
// vista previa del borrador para quien tiene acceso y la dirección personalizable. Sin red: los contratos los crea
// un desplegador falso.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { beforeEach, test } from "node:test";
import { entornoDePrueba, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
process.env.RUMBO_TRUSTED_IP_HEADER = "x-real-ip";
const { getRepo } = await import("../src/server/repo.ts");
const stellar = await import("../src/server/stellar.ts");
const { createEventFromTemplate } = await import("../src/server/kit/plantillas.ts");
const pub = await import("../src/server/kit/publicar.ts");
const imp = await import("../src/server/kit/importar.ts");
const { registerForEvent } = await import("../src/server/evento/inscripcion.ts");
const { registerTeam } = await import("../src/server/kit/equipos.ts");
const { addAtDoor } = await import("../src/server/puerta.ts");
const { registrationAttempts } = await import("../src/server/limites.ts");
const { getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { panelCookieName, resolvePanelAccess } = await import("../src/server/panel-sesion.ts");
const { ORGANIZER_COOKIE, sessionIdOf } = await import("../src/server/organizador.ts");
const { checkSlugFormat, changeEventSlug, RESERVED_SLUGS } = await import("../src/server/kit/direccion.ts");
const { POST: publicarRuta } = await import("../src/app/api/admin/[slug]/publicar/route.ts");

const repo = getRepo();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enRuta = (slug) => ({ params: Promise.resolve({ slug }) });

// Sin red: las cuentas, el contrato y el correo son de mentira, como en las pruebas de la inscripción.
globalThis.__rumboAccounts = {
  kind: "dev",
  getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
  authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
};
const registros = [];
stellar.rumboPass.register = async (contractId, account) => {
  registros.push({ contractId, account });
  return { hash: `h-${registros.length}`, ledger: 1, returnValue: registros.length, number: registros.length };
};
stellar.rumboPass.status = async () => ({ has_pass: true, number: 1, checked_in: false, redeemed: [] });
globalThis.__rumboMailer = { kind: "dev", send: async () => ({ id: "1" }) };

/** Un desplegador falso que anota qué pidió cada contrato y tarda `ms`. */
function desplegador(prefijo, { ms = 0 } = {}) {
  const creados = [];
  return {
    creados,
    deploy: async (spec) => {
      if (ms) await sleep(ms);
      const id = `${prefijo}${creados.length + 1}`;
      creados.push({ id, ...spec });
      return id;
    },
    allow: async () => ({ ok: true }),
  };
}
// El de este proceso, el que usan la ruta y las credenciales que se emiten (currentProvisioner): uno falso.
let delProceso = desplegador("CPROC");
globalThis.__rumboProvisioner = { deploy: (spec) => delProceso.deploy(spec), allow: async () => ({ ok: true }) };

beforeEach(async () => {
  await registrationAttempts().clear();
  delProceso = desplegador("CPROC");
  registros.length = 0;
});

let n = 0;
async function borrador(template = "meetup", extra = {}) {
  return createEventFromTemplate(repo, { template, lang: "es", name: `Evento rápido ${++n}`, startsAtLocal: "2026-12-05T19:00", place: "Santa Cruz", organizerName: "La comunidad", ...extra });
}

/** Pasos hasta que el evento abre: devuelve el último. */
async function hastaPublicar(event, provisioner) {
  for (let i = 0; i < 20; i++) {
    const paso = await pub.publishStep(repo, event, provisioner);
    assert.equal(paso.ok, true, JSON.stringify(paso));
    if (paso.published) return paso;
  }
  throw new Error("no abrió");
}

// ---------- publishStep ----------

test("cada paso crea un solo contrato: primero los del asistente, después el resto en su orden; el evento abre apenas los del asistente están", async () => {
  const event = await borrador();
  const tipos = await repo.listTicketTypes(event.id);
  const publicos = tipos.filter((t) => t.credentialKind === "attendee");
  assert.ok(publicos.length >= 1 && tipos.length > publicos.length, "un meetup trae asistente y credenciales del equipo");
  const orden = pub.deployOrder(tipos).map((t) => t.id);
  assert.deepEqual(orden, [...publicos, ...tipos.filter((t) => t.credentialKind !== "attendee")].map((t) => t.id));

  const d = desplegador("CPASO");
  const pasos = [];
  for (let i = 0; i < tipos.length + 2; i++) {
    const paso = await pub.publishStep(repo, event, d);
    pasos.push(paso);
    if (paso.published && paso.done === paso.total) break;
  }
  assert.ok(pasos.every((p) => p.ok));
  assert.equal(d.creados.length, tipos.length, "un contrato por tipo, ninguno de más");
  assert.deepEqual(pasos.map((p) => p.deployed), tipos.map(() => 1), "un contrato por paso");
  assert.deepEqual(pasos.map((p) => p.done), tipos.map((_, i) => i + 1));
  // Publicado desde el paso en que el último del asistente tuvo su contrato, aunque falten los del equipo.
  assert.deepEqual(pasos.map((p) => p.published), tipos.map((_, i) => i + 1 >= publicos.length));
  assert.equal(pasos[publicos.length - 1].done < tipos.length, true, "abrió antes de terminar todo");
  assert.deepEqual(pasos.at(-1), { ok: true, deployed: 1, published: true, done: tipos.length, total: tipos.length, publicDone: publicos.length, publicTotal: publicos.length });

  // El contrato de cada tipo, en el orden de deployOrder.
  const finales = new Map((await repo.listTicketTypes(event.id)).map((t) => [t.id, t.contractId]));
  assert.deepEqual(orden.map((id) => finales.get(id)), d.creados.map((c) => c.id));
  // Con todo listo, otro paso no despliega nada.
  assert.deepEqual(await pub.publishStep(repo, await repo.getEventById(event.id), d), { ok: true, deployed: 0, published: true, done: tipos.length, total: tipos.length, publicDone: publicos.length, publicTotal: publicos.length });
  assert.equal(d.creados.length, tipos.length);
  assert.equal(pub.isPublishPending(await pub.publishProgress(repo, await repo.getEventById(event.id))), false);
});

test("publishStep valida el borrador como siempre: sin asistente gratis o sin cupo no despliega nada", async () => {
  const sinCupo = await borrador();
  await repo.updateEvent(sinCupo.id, { capacity: 0 });
  const d = desplegador("CNADA");
  assert.deepEqual(await pub.publishStep(repo, sinCupo, d), { ok: false, reason: "no_capacity", detail: null });
  await repo.updateEvent(sinCupo.id, { capacity: 1001 });
  assert.deepEqual(await pub.publishStep(repo, sinCupo, d), { ok: false, reason: "no_capacity", detail: null });

  const pago = await borrador();
  for (const t of (await repo.listTicketTypes(pago.id)).filter((t) => t.credentialKind === "attendee")) await repo.updateTicketType(t.id, { priceUsdc: 10 });
  assert.deepEqual(await pub.publishStep(repo, pago, d), { ok: false, reason: "no_free_attendee", detail: null });
  assert.equal(d.creados.length, 0);
  assert.equal((await repo.getEventById(pago.id)).published, false);
});

test("dos pasos a la vez: uno despliega y el otro recibe busy sin esperar; nunca dos contratos para el mismo tipo", async () => {
  const event = await borrador();
  const d = desplegador("CLENTO", { ms: 60 });
  const [a, b] = await Promise.all([pub.publishStep(repo, event, d), pub.publishStep(repo, event, d)]);
  const [bien, ocupado] = [a, b].sort((x, y) => Number(y.ok) - Number(x.ok));
  assert.equal(bien.ok, true);
  assert.equal(bien.deployed, 1);
  assert.deepEqual(ocupado, { ok: false, reason: "busy", detail: null });
  assert.equal(d.creados.length, 1);
  assert.equal((await repo.listTicketTypes(event.id)).filter((t) => t.contractId).length, 1);
});

test("si un paso falla, lo ya creado queda y el siguiente sigue desde ahí; publishEvent sigue siendo el bucle entero", async () => {
  const event = await borrador();
  const tipos = await repo.listTicketTypes(event.id);
  let vez = 0;
  const fragil = { deploy: async () => { if (++vez === 2) throw new Error("sin saldo"); return `CFRAGIL${vez}`; }, allow: async () => ({ ok: true }) };
  assert.equal((await pub.publishStep(repo, event, fragil)).ok, true);
  assert.deepEqual(await pub.publishStep(repo, event, fragil), { ok: false, reason: "deploy_failed", detail: "sin saldo" });
  const r = await pub.publishEvent(repo, event, fragil);
  assert.deepEqual(r, { ok: true, deployed: tipos.length - 1 });
  assert.ok((await repo.listTicketTypes(event.id)).every((t) => t.contractId));
});

// ---------- Las credenciales del equipo, en el momento ----------

test("importar a alguien del equipo antes de que su tipo tenga contrato: el contrato se crea al activar, una sola vez, y la credencial sale con él", async () => {
  const event = await borrador();
  await hastaPublicar(event, desplegador("CABRE"));
  const abierto = await repo.getEventById(event.id);
  const orador = (await repo.listTicketTypes(event.id)).find((t) => t.credentialKind !== "attendee");
  assert.equal(orador.contractId, null, "el del equipo todavía no tiene contrato");

  const lista = imp.parseGuests(`nombre,correo\n${[1, 2, 3].map((i) => `Persona Equipo ${i},equipo${i}-${randomBytes(3).toString("hex")}@example.com`).join("\n")}`);
  const { run } = await imp.prepareImport(repo, abierto, lista, { statuses: ["approved"], mapping: {}, defaultTypeId: orador.id });
  const d = desplegador("CEQUIPO", { ms: 20 });
  const deps = {
    lang: "es",
    origin: "http://localhost:3000",
    provisioner: d,
    accounts: globalThis.__rumboAccounts,
    chain: { register: stellar.rumboPass.register, status: stellar.rumboPass.status },
    mailer: globalThis.__rumboMailer,
  };
  const tanda = await imp.activateBatch(repo, abierto, run.id, 5, deps);
  assert.equal(tanda.remaining, 0, JSON.stringify(tanda));
  assert.equal(d.creados.length, 1, "un solo contrato para el tipo, aunque la tanda active a tres a la vez");
  const contrato = (await repo.getTicketType(orador.id)).contractId;
  assert.equal(contrato, "CEQUIPO1");
  assert.deepEqual(registros.map((r) => r.contractId), [contrato, contrato, contrato]);
  // El cupo y los canjes del contrato nuevo son los del tipo.
  assert.equal(d.creados[0].capacity, abierto.capacity);
  assert.equal(d.creados[0].benefits, (await repo.listTicketTypeBenefits(orador.id)).length);
  // Y el avance de publicar lo cuenta.
  const avance = await pub.publishProgress(repo, abierto);
  assert.equal(avance.done, avance.publicTotal + 1);
});

test("si el contrato del equipo no se puede crear, la credencial importada queda como fallida para reintentar, no se rompe la tanda", async () => {
  const event = await borrador();
  await hastaPublicar(event, desplegador("CABRE"));
  const abierto = await repo.getEventById(event.id);
  const orador = (await repo.listTicketTypes(event.id)).find((t) => t.credentialKind !== "attendee");
  const lista = imp.parseGuests(`nombre,correo\nPersona Falla,falla-${randomBytes(3).toString("hex")}@example.com`);
  const { run } = await imp.prepareImport(repo, abierto, lista, { statuses: ["approved"], mapping: {}, defaultTypeId: orador.id });
  const roto = { deploy: async () => { throw new Error("sin saldo"); } };
  const tanda = await imp.activateBatch(repo, abierto, run.id, 5, { lang: "es", provisioner: roto, accounts: globalThis.__rumboAccounts, chain: { register: stellar.rumboPass.register, status: stellar.rumboPass.status }, mailer: globalThis.__rumboMailer });
  assert.equal(tanda.failed, 1);
  assert.equal(registros.length, 0);
  await assert.rejects(() => pub.ensureTicketTypeContract(repo, abierto, orador, roto), (e) => e instanceof pub.ContractNotReady);
});

test("una credencial importada del equipo que se inscribe por la página: su contrato se crea en ese momento, con el desplegador del proceso", async () => {
  const event = await borrador();
  await hastaPublicar(event, desplegador("CABRE"));
  const abierto = await repo.getEventById(event.id);
  const tipos = await repo.listTicketTypes(event.id);
  const asistente = tipos.find((t) => t.credentialKind === "attendee");
  const orador = tipos.find((t) => t.credentialKind !== "attendee");
  const correo = `oradora-${randomBytes(3).toString("hex")}@example.com`;
  // Importada y sin activar todavía (la tanda no corrió): queda pendiente con su tipo.
  await imp.prepareImport(repo, abierto, imp.parseGuests(`nombre,correo\nOradora Prueba,${correo}`), { statuses: ["approved"], mapping: {}, defaultTypeId: orador.id });

  const r = await registerForEvent({ slug: abierto.slug, ticketTypeId: asistente.id, name: "Oradora Prueba", email: correo, lang: "es", origin: "http://localhost:3000", clientKey: "10.0.0.9" });
  assert.equal(r.kind, "created", JSON.stringify(r));
  assert.equal(r.ticketType.id, orador.id, "sigue con la credencial de su tipo");
  assert.equal(delProceso.creados.length, 1);
  assert.equal((await repo.getTicketType(orador.id)).contractId, delProceso.creados[0].id);
  assert.deepEqual(registros.map((x) => x.contractId), [delProceso.creados[0].id]);
});

test("la puerta y la inscripción por equipos andan apenas el evento abre, sin esperar a las credenciales del equipo", async () => {
  const meetup = await borrador();
  await hastaPublicar(meetup, desplegador("CABRE"));
  const abierto = await repo.getEventById(meetup.id);
  const enPuerta = await addAtDoor(repo, abierto, { name: "Llega Tarde", email: `tarde-${randomBytes(3).toString("hex")}@example.com`, lang: "es", origin: "http://localhost:3000", clientKey: "10.0.0.10" });
  assert.equal(enPuerta.kind, "added", JSON.stringify(enPuerta));

  const hack = await borrador("hackaton");
  await hastaPublicar(hack, desplegador("CHACK"));
  const r = await registerTeam(
    { slug: hack.slug, teamName: "Los Rápidos", members: [1, 2].map((i) => ({ name: `Integrante ${i} Prueba`, email: `rapido${i}-${randomBytes(3).toString("hex")}@example.com` })), lang: "es", origin: "http://localhost:3000" },
    repo,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.registered, 2);
  assert.equal(delProceso.creados.length, 0, "ninguno de los dos necesitó un contrato nuevo");
});

test("ensureTicketTypeContract espera el turno si un paso de publicar lo tiene, y no crea otro contrato si el paso ya le dio uno", async () => {
  const event = await borrador();
  await hastaPublicar(event, desplegador("CABRE"));
  const abierto = await repo.getEventById(event.id);
  const siguiente = pub.deployOrder(await repo.listTicketTypes(event.id)).find((t) => !t.contractId);
  const lento = desplegador("CTURNO", { ms: 150 });
  const [paso, contrato] = await Promise.all([pub.publishStep(repo, abierto, lento), sleep(10).then(() => pub.ensureTicketTypeContract(repo, abierto, siguiente, lento))]);
  assert.equal(paso.ok, true);
  assert.equal(lento.creados.length, 1, "el paso creó el contrato; ensure lo encontró hecho");
  assert.equal(contrato, lento.creados[0].id);
});

// ---------- La ruta ----------

const keyCookie = (slug, key) => ({ cookie: `${panelCookieName(slug)}=${encodeURIComponent(key)}` });

test("POST /api/admin/<evento>/publicar: con la clave da un paso y contesta el avance y la página; sin acceso 401; de otro sitio 403", async () => {
  const event = await borrador();
  const key = await getOrCreateOrganizerKey(event.id);
  const url = `http://localhost/api/admin/${event.slug}/publicar`;

  const sin = await publicarRuta(await pedido(url, {}), enRuta(event.slug));
  assert.equal(sin.status, 401);
  const otraClave = await publicarRuta(await pedido(url, { headers: keyCookie(event.slug, "no-es-la-clave") }), enRuta(event.slug));
  assert.equal(otraClave.status, 401);
  const ajeno = await publicarRuta(await pedido(url, { headers: { ...keyCookie(event.slug, key), origin: "https://otro-sitio.example.com" } }), enRuta(event.slug));
  assert.equal(ajeno.status, 403);
  const noExiste = await publicarRuta(await pedido("http://localhost/api/admin/no-existe/publicar", { headers: keyCookie("no-existe", key) }), enRuta("no-existe"));
  assert.equal(noExiste.status, 404);
  assert.equal(delProceso.creados.length, 0, "nada de eso desplegó");

  const res = await publicarRuta(await pedido(url, { headers: keyCookie(event.slug, key) }), enRuta(event.slug));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const cuerpo = await res.json();
  const tipos = await repo.listTicketTypes(event.id);
  const publicos = tipos.filter((t) => t.credentialKind === "attendee").length;
  assert.deepEqual(cuerpo, { published: publicos === 1, done: 1, total: tipos.length, publicDone: 1, publicTotal: publicos, path: `/e/${event.slug}` });
  assert.equal(delProceso.creados.length, 1);
});

test("la ruta contesta 409 busy si otro paso está corriendo, 422 si al borrador le falta algo y 502 si el despliegue falló", async () => {
  const event = await borrador();
  const key = await getOrCreateOrganizerKey(event.id);
  const url = `http://localhost/api/admin/${event.slug}/publicar`;
  const anterior = globalThis.__rumboProvisioner;
  try {
    globalThis.__rumboProvisioner = desplegador("CRUTA", { ms: 80 });
    const [a, b] = await Promise.all([publicarRuta(await pedido(url, { headers: keyCookie(event.slug, key) }), enRuta(event.slug)), publicarRuta(await pedido(url, { headers: keyCookie(event.slug, key) }), enRuta(event.slug))]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    globalThis.__rumboProvisioner = { deploy: async () => { throw new Error("sin saldo"); } };
    const fallo = await publicarRuta(await pedido(url, { headers: keyCookie(event.slug, key) }), enRuta(event.slug));
    // El meetup trae un solo tipo de asistente: con él listo, el próximo es del equipo y falla.
    assert.equal(fallo.status, 502);
    assert.deepEqual(await fallo.json(), { error: "deploy_failed" });
  } finally {
    globalThis.__rumboProvisioner = anterior;
  }
  const sinCupo = await borrador();
  await repo.updateEvent(sinCupo.id, { capacity: 0 });
  const k2 = await getOrCreateOrganizerKey(sinCupo.id);
  const r = await publicarRuta(await pedido(`http://localhost/api/admin/${sinCupo.slug}/publicar`, { headers: keyCookie(sinCupo.slug, k2) }), enRuta(sinCupo.slug));
  assert.equal(r.status, 422);
  assert.deepEqual(await r.json(), { error: "no_capacity" });
});

// ---------- La vista previa ----------

test("la vista previa de un borrador: la abre quien tiene acceso al panel (la dueña, la clave), y nadie más", async () => {
  const dueña = await repo.upsertOrganizer({ publicKey: `GDUENA${randomBytes(25).toString("hex").toUpperCase()}`.slice(0, 56), provider: "pollar", name: "Dueña Prueba" });
  const otra = await repo.upsertOrganizer({ publicKey: `GOTRA${randomBytes(26).toString("hex").toUpperCase()}`.slice(0, 56), provider: "pollar", name: "Otra Prueba" });
  const sesion = async (organizer) => {
    const token = randomBytes(16).toString("base64url");
    await repo.createOrganizerSession({ id: sessionIdOf(token), organizerId: organizer.id, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    return token;
  };
  const event = await borrador("meetup");
  await repo.updateEvent(event.id, { organizerId: dueña.id });
  const propio = await repo.getEventById(event.id);
  const key = await getOrCreateOrganizerKey(event.id);

  assert.equal((await resolvePanelAccess(propio, await sesion(dueña), null))?.role, "owner");
  assert.equal(await resolvePanelAccess(propio, await sesion(otra), null), null, "otra cuenta no");
  assert.equal(await resolvePanelAccess(propio, null, null), null, "sin nada, no");
  assert.equal((await resolvePanelAccess(propio, null, key))?.via, "key", "la clave sí");
  assert.equal(await resolvePanelAccess(propio, null, "otra-clave"), null);
  assert.ok(ORGANIZER_COOKIE);
});

// ---------- La dirección personalizable ----------

test("la dirección del evento: minúsculas, números y guiones, de 3 a 60, sin palabras reservadas", () => {
  for (const bien of ["meetup-santa-cruz", "abc", "devfest-2026", "a1b", "x".repeat(60), "  Meetup-SCZ  "]) assert.equal(checkSlugFormat(bien).ok, true, bien);
  for (const mal of ["ab", "x".repeat(61), "-meetup", "meetup-", "meetup--scz", "meetup scz", "meetup_scz", "mítin", "meetup/otro", "", null, 42]) {
    assert.deepEqual(checkSlugFormat(mal), { ok: false, problem: "formato" }, String(mal));
  }
  for (const reservada of ["nuevo", "invitacion", "admin", "publicando", "api"]) {
    assert.ok(RESERVED_SLUGS.has(reservada));
    assert.deepEqual(checkSlugFormat(reservada), { ok: false, problem: "reservada" }, reservada);
  }
  assert.deepEqual(checkSlugFormat("  Meetup-SCZ "), { ok: true, slug: "meetup-scz" });
});

test("cambiar la dirección de un borrador: cambia, no choca con otro evento, y después de publicar no se toca", async () => {
  const uno = await borrador();
  const dos = await borrador();
  const nueva = `mi-meetup-${randomBytes(3).toString("hex")}`;
  assert.deepEqual(await changeEventSlug(uno, nueva), { ok: true, slug: nueva });
  assert.equal((await repo.getEventBySlug(nueva))?.id, uno.id);
  assert.equal(await repo.getEventBySlug(uno.slug), null, "la de antes ya no abre");
  const cambiado = await repo.getEventById(uno.id);
  assert.deepEqual(await changeEventSlug(cambiado, nueva), { ok: true, slug: nueva }, "la misma no es un cambio");

  assert.deepEqual(await changeEventSlug(dos, nueva), { ok: false, problem: "ocupada" });
  assert.deepEqual(await changeEventSlug(dos, "nuevo"), { ok: false, problem: "reservada" });
  assert.deepEqual(await changeEventSlug(dos, "No Vale"), { ok: false, problem: "formato" });

  await hastaPublicar(cambiado, desplegador("CDIR"));
  const publicado = await repo.getEventById(uno.id);
  assert.deepEqual(await changeEventSlug(publicado, `otra-${randomBytes(3).toString("hex")}`), { ok: false, problem: "publicado" });
  // Aunque quien llama tenga una copia vieja (de antes de publicar), la base no lo deja.
  assert.deepEqual(await changeEventSlug(cambiado, `vieja-${randomBytes(3).toString("hex")}`), { ok: false, problem: "publicado" });
  assert.equal((await repo.getEventById(uno.id)).slug, nueva);
});

test("crear desde una plantilla con un nombre corto o reservado le pone un sufijo a la dirección", async () => {
  const corto = await borrador("meetup", { name: "¡Go!" });
  assert.equal(checkSlugFormat(corto.slug).ok, true, corto.slug);
  const reservado = await borrador("meetup", { name: "Nuevo" });
  assert.notEqual(reservado.slug, "nuevo");
  assert.equal(checkSlugFormat(reservado.slug).ok, true, reservado.slug);
});

// ---------- Lo que encontró la revisión ----------

const { getDb } = await import("../src/server/base/index.ts");
const { TEMPLATES } = await import("../src/server/kit/plantillas.ts");
const { defaultDraft, saveDraft, draftVersion, DraftError } = await import("../src/server/kit/borrador.ts");
const { MAX_DISCARDED, countEventContracts } = await import("../src/server/kit/contratos-del-evento.ts");
const { PUBLISH_INTENT_COOKIE, shouldAutoStart } = await import("../src/server/kit/publicar-pedido.ts");
const { findEventBySlug } = await import("../src/server/kit/direccion.ts");
const { authorizePanelRequest } = await import("../src/server/panel-sesion.ts");
const { GET: entrarRuta } = await import("../src/app/api/admin/[slug]/entrar/route.ts");

const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("/publicando de un borrador no arranca sola por un enlace: solo con la cookie que deja Publicar el evento, de ese evento; ya publicado, sí", async () => {
  const event = await borrador();
  const otro = await borrador();
  // Un enlace de otro sitio no lleva la cookie (es SameSite=Strict): la pantalla pide tocar Publicar.
  assert.equal(shouldAutoStart(event, undefined), false);
  assert.equal(shouldAutoStart(event, ""), false);
  assert.equal(shouldAutoStart(event, otro.id), false, "la de otro evento no sirve");
  assert.equal(shouldAutoStart(event, event.id), true);
  assert.equal(shouldAutoStart({ ...event, published: true }, undefined), true, "terminar las del equipo no cambia nada que se vea");

  // El primer paso la borra: volver a abrir /publicando de este borrador pide el botón.
  const key = await getOrCreateOrganizerKey(event.id);
  const res = await publicarRuta(await pedido(`http://localhost/api/admin/${event.slug}/publicar`, { headers: { cookie: `${panelCookieName(event.slug)}=${key}; ${PUBLISH_INTENT_COOKIE}=${event.id}` } }), enRuta(event.slug));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("set-cookie") ?? "", new RegExp(`${escapar(PUBLISH_INTENT_COOKIE)}=;.*Max-Age=0`, "i"));
});

test("un borrador a medias no crea contratos sin fin: cambiar lo ya preparado se frena a las MAX_DISCARDED vueltas, y después publica normal", async () => {
  const event = await borrador();
  const input = defaultDraft(TEMPLATES.meetup, "es");
  input.slots.attendeePaid.included = true;
  await saveDraft(repo, event, input, "es");
  const original = [...input.slots.attendee.benefits];
  assert.ok(original.length > 0, "el asistente trae algún canje");
  const sinUno = original.slice(1);
  const d = desplegador("CVUELTA");
  let frenado = null;
  for (let vuelta = 0; vuelta < 10 && !frenado; vuelta++) {
    // El paso prepara la inscripción gratis; el evento sigue en borrador porque falta la paga.
    const paso = await pub.publishStep(repo, await repo.getEventById(event.id), d);
    assert.equal(paso.ok, true, JSON.stringify(paso));
    assert.equal(paso.published, false);
    // Sacar o poner un canje de la gratis descarta su contrato.
    input.slots.attendee.benefits = vuelta % 2 === 0 ? sinUno : original;
    try {
      await saveDraft(repo, await repo.getEventById(event.id), input, "es");
    } catch (error) {
      frenado = error;
    }
  }
  assert.ok(frenado instanceof DraftError && frenado.code === "preparadas", String(frenado));
  assert.equal(d.creados.length, MAX_DISCARDED + 1, "un contrato por vuelta, y la vuelta frenada no descartó el suyo");
  const gratis = (await repo.listTicketTypes(event.id)).find((t) => t.templateSlot === "attendee");
  assert.equal(gratis.contractId, d.creados.at(-1).id, "lo preparado quedó como estaba");

  // Lo demás se sigue pudiendo cambiar (el nombre no toca el contrato), y publicar termina sin crear de más.
  input.slots.attendee.benefits = (await repo.listTicketTypeBenefits(gratis.id)).map((b) => b.templateKey);
  input.slots.attendee.name = "Inscripción general";
  await saveDraft(repo, await repo.getEventById(event.id), input, "es");
  await hastaPublicar(await repo.getEventById(event.id), d);
  const tipos = await repo.listTicketTypes(event.id);
  assert.ok((await countEventContracts(event.id)) <= tipos.length + MAX_DISCARDED);
  const anotados = await getDb().all("SELECT contract_id FROM event_contracts WHERE event_id = ?", [event.id]);
  assert.deepEqual(new Set(anotados.map((r) => String(r.contract_id))), new Set(d.creados.map((c) => c.id)), "cada contrato creado quedó anotado");
});

test("aunque algo se le escape a guardar, un borrador con todos sus contratos ya creados no despliega más: la ruta contesta 422 too_many_contracts", async () => {
  const event = await borrador();
  const tipos = await repo.listTicketTypes(event.id);
  for (let i = 0; i < tipos.length + MAX_DISCARDED; i++) {
    await getDb().run("INSERT INTO event_contracts (contract_id, event_id, ticket_type_id, created_at) VALUES (?, ?, ?, ?)", [`CVIEJO${randomBytes(4).toString("hex")}`, event.id, tipos[0].id, new Date().toISOString()]);
  }
  const d = desplegador("CTOPE");
  assert.deepEqual(await pub.publishStep(repo, event, d), { ok: false, reason: "too_many_contracts", detail: null });
  const key = await getOrCreateOrganizerKey(event.id);
  const res = await publicarRuta(await pedido(`http://localhost/api/admin/${event.slug}/publicar`, { headers: keyCookie(event.slug, key) }), enRuta(event.slug));
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { error: "too_many_contracts" });
  assert.equal(d.creados.length + delProceso.creados.length, 0);
});

test("la huella del borrador cambia cuando alguien del equipo guarda (o cambia la dirección), y no cambia si guarda lo mismo", async () => {
  const event = await borrador();
  const input = defaultDraft(TEMPLATES.meetup, "es");
  await saveDraft(repo, event, input, "es");
  const antes = await draftVersion(repo, await repo.getEventById(event.id));
  assert.match(antes, /^[0-9a-f]{32}$/);
  await saveDraft(repo, await repo.getEventById(event.id), input, "es");
  assert.equal(await draftVersion(repo, await repo.getEventById(event.id)), antes, "guardar lo mismo no la cambia");
  input.benefits[Object.keys(input.benefits)[0]].stock = 77;
  await saveDraft(repo, await repo.getEventById(event.id), input, "es");
  const despues = await draftVersion(repo, await repo.getEventById(event.id));
  assert.notEqual(despues, antes, "el formulario de antes ya no coincide");
  await changeEventSlug(await repo.getEventById(event.id), `otra-direccion-${randomBytes(3).toString("hex")}`);
  assert.notEqual(await draftVersion(repo, await repo.getEventById(event.id)), despues);
});

const { readDraft } = await import("../src/server/kit/borrador.ts");
const { saveDraftForm } = await import("../src/server/kit/guardar-borrador.ts");

/** El formulario de /admin/<evento>/armar tal como lo manda el navegador, armado con lo que muestra la página en `lang`. */
async function formularioMostrado(event, lang) {
  const view = await readDraft(repo, event, lang);
  const form = new FormData();
  form.set("evento_id", event.id);
  form.set("version", await draftVersion(repo, event));
  form.set("direccion", event.slug);
  if (view.teamSignup) form.set("equipos", "on");
  for (const slot of view.slots) {
    if (slot.included) form.set(`tipo.${slot.slot}`, "on");
    form.set(`nombre.${slot.slot}`, slot.name);
    if (slot.slot === "attendeePaid") form.set(`precio.${slot.slot}`, String(slot.price));
    for (const key of slot.benefits) form.set(`trae.${slot.slot}.${key}`, "on");
  }
  const used = new Set(view.slots.filter((s) => s.included).flatMap((s) => s.benefits));
  for (const b of view.benefits.filter((b) => used.has(b.key) || !b.perCredential)) {
    form.set(`bnombre.${b.key}`, b.name);
    form.set(`blugar.${b.key}`, b.place);
    form.set(`bstock.${b.key}`, b.stock === null ? "" : String(b.stock));
  }
  return form;
}

test("cambiar el idioma entre abrir el borrador y guardarlo no es un cambio de nadie: la huella no depende del idioma y guardar guarda", async () => {
  const event = await borrador();
  const ev = await repo.getEventById(event.id);
  // Un meetup tiene tipos apagados y canjes sin crear: lo que la página propone para ellos cambia con el idioma.
  const es = await readDraft(repo, ev, "es");
  const en = await readDraft(repo, ev, "en");
  assert.ok(es.slots.some((s) => !s.included), "hay tipos apagados");
  assert.notDeepEqual(es.slots.find((s) => !s.included).name, en.slots.find((s) => !s.included).name, "lo que se propone para lo apagado sí cambia");
  const huella = await draftVersion(repo, ev);
  assert.equal(await draftVersion(repo, ev, "en"), huella, "la huella no mira el idioma");

  // La página en castellano, el pedido de guardar en inglés (se cambió el idioma en otra pestaña): guarda.
  const form = await formularioMostrado(ev, "es");
  form.set(`bstock.${es.benefits.find((b) => es.slots[0].benefits.includes(b.key)).key}`, "40");
  const saved = await saveDraftForm(repo, ev, TEMPLATES.meetup, form, String(form.get("version")), "en");
  assert.deepEqual(saved, { ok: true, slug: ev.slug, moved: false });
  assert.ok((await repo.listBenefits(ev.id)).some((b) => b.stock === 40), "lo editado quedó guardado");

  // Y al revés: la página en inglés, el pedido en castellano.
  const ev2 = await repo.getEventById(event.id);
  const enForm = await formularioMostrado(ev2, "en");
  assert.deepEqual(await saveDraftForm(repo, ev2, TEMPLATES.meetup, enForm, String(enForm.get("version")), "es"), { ok: true, slug: ev2.slug, moved: false });
});

test("un cambio de verdad de otra persona se sigue detectando: guardar con la huella vieja no pisa lo suyo y avisa", async () => {
  const event = await borrador();
  const ev = await repo.getEventById(event.id);
  const mio = await formularioMostrado(ev, "es");
  // Otra persona del equipo, en inglés, prende la entrada paga y guarda.
  const suyo = await formularioMostrado(ev, "en");
  suyo.set("tipo.attendeePaid", "on");
  suyo.set("precio.attendeePaid", "12");
  assert.deepEqual(await saveDraftForm(repo, ev, TEMPLATES.meetup, suyo, String(suyo.get("version")), "en"), { ok: true, slug: ev.slug, moved: false });
  // Yo guardo lo que tenía abierto: no se pisa lo suyo.
  mio.set("nombre.attendee", "Lo mío");
  const saved = await saveDraftForm(repo, await repo.getEventById(ev.id), TEMPLATES.meetup, mio, String(mio.get("version")), "es");
  assert.deepEqual(saved, { ok: false, slug: ev.slug, error: "cambiado" });
  const tipos = await repo.listTicketTypes(ev.id);
  assert.equal(tipos.find((t) => t.templateSlot === "attendeePaid")?.priceUsdc, 12, "lo suyo sigue");
  assert.notEqual(tipos.find((t) => t.templateSlot === "attendee")?.name, "Lo mío");
  // Cambiar solo un nombre de un canje o su puesto también cuenta.
  const otra = await formularioMostrado(await repo.getEventById(ev.id), "es");
  const huella = String(otra.get("version"));
  const canje = (await repo.listBenefits(ev.id)).find((b) => b.templateKey !== "prize");
  await repo.updateBenefit(canje.id, { station: "Otra mesa" });
  assert.notEqual(await draftVersion(repo, await repo.getEventById(ev.id)), huella);
});

test("cambiar la dirección de un borrador no deja afuera a nadie: la vieja lleva a la nueva, la cookie de la clave con el nombre viejo sirve, y otro evento no la puede tomar", async () => {
  const event = await borrador("meetup", { name: "Encuentro con dirección vieja" });
  const vieja = event.slug;
  const key = await getOrCreateOrganizerKey(event.id);
  const nueva = `encuentro-${randomBytes(3).toString("hex")}`;
  assert.deepEqual(await changeEventSlug(event, nueva), { ok: true, slug: nueva });

  // La vieja encuentra al evento y dice que se movió.
  const encontrado = await findEventBySlug(repo, vieja);
  assert.deepEqual([encontrado?.event.id, encontrado?.moved], [event.id, true]);
  assert.equal((await findEventBySlug(repo, nueva))?.moved, false);
  assert.equal(await findEventBySlug(repo, "no-existe-nada"), null);

  // Quien tenía la cookie con el nombre viejo sigue entrando, por la dirección nueva y por la vieja.
  const conVieja = { cookie: `${panelCookieName(vieja)}=${key}` };
  for (const slug of [nueva, vieja]) {
    const auth = await authorizePanelRequest(await pedido(`http://localhost/api/admin/${slug}`, { method: "GET", headers: conVieja }), slug);
    assert.deepEqual([auth.event?.id, auth.via], [event.id, "key"], slug);
  }
  // El enlace para compartir el panel que se pasó antes (/admin/<vieja>?k=) lleva al de ahora, con la cookie nueva.
  const entrar = await entrarRuta(await pedido(`http://localhost/api/admin/${vieja}/entrar?k=${key}`, { method: "GET" }), enRuta(vieja));
  assert.equal(entrar.status, 303);
  assert.equal(entrar.headers.get("location"), `/admin/${nueva}`);
  assert.match(entrar.headers.get("set-cookie") ?? "", new RegExp(`^${escapar(panelCookieName(nueva))}=`));

  // Nadie más toma la vieja: ni cambiando la suya, ni al crearse con ese nombre.
  const otro = await borrador();
  assert.deepEqual(await changeEventSlug(otro, vieja), { ok: false, problem: "ocupada" });
  const mismoNombre = await borrador("meetup", { name: "Encuentro con dirección vieja" });
  assert.notEqual(mismoNombre.slug, vieja);
  // Volver a la de antes, sí: es suya.
  assert.deepEqual(await changeEventSlug(await repo.getEventById(event.id), vieja), { ok: true, slug: vieja });
  const ahora = await findEventBySlug(repo, nueva);
  assert.deepEqual([ahora?.event.id, ahora?.moved], [event.id, true]);
  assert.equal((await findEventBySlug(repo, vieja))?.moved, false);
});
