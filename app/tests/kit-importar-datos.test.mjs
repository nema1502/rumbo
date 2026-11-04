// Lo que la revisión de datos encontró en la importación y en las personas, y no vuelve: una importación que se
// cortó se retoma con la siguiente; la página pública no le cambia el tipo a quien se importó como oradora; un
// correo que no sale no se cuenta como enviado y el enlace personal no va al registro; quien ya existe conserva
// su nombre aunque otro escriba su correo; dos correos que llegan al mismo buzón son una sola persona; y en
// producción no se cuelan el contrato ni el correo de mentira de las pruebas. Sin red.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { capturarConsola, entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo, emailKey, normalizeEmail } = await import("../src/server/repo.ts");
const { createEventFromTemplate, TEMPLATES } = await import("../src/server/kit/plantillas.ts");
const { defaultDraft, saveDraft } = await import("../src/server/kit/borrador.ts");
const { publishEvent } = await import("../src/server/kit/publicar.ts");
const imp = await import("../src/server/kit/importar.ts");
const { DevMailer, getMailer } = await import("../src/server/mailer.ts");
const stellar = await import("../src/server/stellar.ts");
const { registerForEvent } = await import("../src/server/evento/inscripcion.ts");
const { registrationAttempts, linkResendAttempts } = await import("../src/server/limites.ts");

const repo = getRepo();

let contratos = 0;
async function eventoPublicado(nombre) {
  const base = await createEventFromTemplate(repo, { template: "devfest", lang: "es", name: nombre, startsAtLocal: "2026-12-05T09:00", place: "Santa Cruz", organizerName: "GDG" });
  await saveDraft(repo, base, defaultDraft(TEMPLATES.devfest, "es"), "es");
  const resultado = await publishEvent(repo, await repo.getEventById(base.id), { deploy: async () => `CFALSO${++contratos}` });
  assert.equal(resultado.ok, true);
  const event = await repo.getEventById(base.id);
  const types = await repo.listTicketTypes(event.id);
  return { event, types, porKind: Object.fromEntries(types.map((t) => [t.credentialKind, t])) };
}

/** Las cuentas, el contrato y el correo de mentira. `correo` dice qué contesta el correo (por omisión, que salió). */
function dependencias({ correo = () => ({ id: "1" }) } = {}) {
  const correos = [];
  let numero = 0;
  return {
    correos,
    deps: {
      lang: "es",
      origin: "http://localhost:3000",
      accounts: {
        getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
        authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
      },
      chain: {
        register: async () => {
          numero++;
          return { hash: `h-${numero}`, ledger: 1, returnValue: numero, number: numero };
        },
        status: async () => ({ has_pass: true, number: 99, checked_in: false, redeemed: [] }),
      },
      mailer: {
        send: async (mail) => {
          correos.push(mail);
          return correo(mail);
        },
      },
    },
  };
}

const opciones = (evento, extra = {}) => ({ statuses: ["approved"], mapping: {}, defaultTypeId: evento.porKind.attendee.id, ...extra });
const lista = (n, prefijo = "persona") => ["Name,Email", ...Array.from({ length: n }, (_, i) => `Persona ${i},${prefijo}${i}@example.com`)].join("\n");

beforeEach(async () => {
  await registrationAttempts().clear();
  await linkResendAttempts().clear();
});

// ---------- Retomar (H-D1) ----------

test("una importación que se cortó a mitad de las tandas se retoma con la siguiente: nadie queda colgado y no hay credenciales de más", async () => {
  const ev = await eventoPublicado("Retomar");
  const parsed = imp.parseGuests(lista(12));
  const { deps } = dependencias();
  const p1 = await imp.prepareImport(repo, ev.event, parsed, opciones(ev));
  const t1 = await imp.activateBatch(repo, ev.event, p1.run.id, 5, deps);
  assert.deepEqual([p1.summary.created, t1.activated, t1.remaining], [12, 5, 7]);

  // Se cerró la pestaña (el id de la importación se perdió) y se vuelve a subir el mismo archivo.
  const vista = await imp.previewGuests(repo, ev.event, parsed);
  assert.deepEqual(vista.buckets.approved, { valid: 7, invalidEmail: 0, duplicatesInFile: 0, alreadyHere: 5, resumable: 7 });
  const p2 = await imp.prepareImport(repo, ev.event, parsed, opciones(ev));
  assert.deepEqual([p2.summary.created, p2.summary.resumed, p2.summary.alreadyHere], [7, 7, 5]);
  assert.equal((await repo.listPasses(ev.event.id)).length, 12, "ninguna credencial de más");
  assert.equal((await repo.listPassesByImportRun(p1.run.id)).filter((p) => p.status === "pending").length, 0, "las pendientes ya no son de la importación vieja");

  const t2 = await imp.activateBatch(repo, ev.event, p2.run.id, 20, deps);
  assert.deepEqual([t2.processed, t2.activated, t2.remaining], [7, 7, 0]);
  assert.deepEqual(await imp.importStatus(repo, p2.run.id).then((s) => s.remaining), 0);
  assert.equal((await repo.listPasses(ev.event.id)).filter((p) => p.status === "active").length, 12);
});

test("si prepareImport se cae a la mitad, lo que alcanzó a dejar pendiente lo retoma el reintento", async () => {
  const ev = await eventoPublicado("Se cae a la mitad");
  const parsed = imp.parseGuests(lista(10, "caida"));
  const original = repo.createPass.bind(repo);
  let cuenta = 0;
  repo.createPass = async (input) => {
    if (++cuenta === 7) throw new Error("la conexión con la base se cortó");
    return original(input);
  };
  try {
    await assert.rejects(imp.prepareImport(repo, ev.event, parsed, opciones(ev)), /se cortó/);
  } finally {
    repo.createPass = original;
  }
  assert.equal((await repo.listPasses(ev.event.id)).length, 6);
  const reintento = await imp.prepareImport(repo, ev.event, parsed, opciones(ev));
  assert.deepEqual([reintento.summary.created, reintento.summary.resumed, reintento.summary.alreadyHere], [10, 6, 0]);
  assert.equal((await repo.listPassesByImportRun(reintento.run.id)).length, 10, "las diez son de la importación nueva");
});

test("la página pública no le cambia el tipo a una credencial pendiente que vino de una importación; otra importación sí", async () => {
  const ev = await eventoPublicado("Tipo importado");
  const speaker = ev.porKind.speaker;
  const p = await imp.prepareImport(repo, ev.event, imp.parseGuests("Name,Email,Ticket\nOra Dora,ora.dora@example.com,Speaker\n"), opciones(ev, { mapping: { [imp.labelKey("Speaker")]: speaker.id } }));
  const [pase] = await repo.listPassesByImportRun(p.run.id);
  assert.equal(pase.ticketTypeId, speaker.id);
  // Lo que la inscripción pública hace con una credencial pendiente de otra entrada: cambiarle el tipo. Importada, no.
  await repo.updatePass(pase.id, { ticketTypeId: ev.porKind.attendee.id });
  assert.equal((await repo.getPass(pase.id)).ticketTypeId, speaker.id, "sigue siendo oradora");
  // Una credencial pendiente que no vino de una importación sí cambia (una inscripción que quedó a medias con otra entrada).
  const persona = await repo.upsertPerson({ name: "Pepe Propio", email: "pepe.propio@example.com" });
  const propio = await repo.createPass({ eventId: ev.event.id, personId: persona.id, ticketTypeId: ev.porKind.attendee.id, status: "pending" });
  await repo.updatePass(propio.id, { ticketTypeId: ev.types.find((t) => t.id !== ev.porKind.attendee.id && t.credentialKind === "attendee")?.id ?? ev.porKind.attendee.id });
  // Otra importación la retoma con la entrada de su lista (viene con el id de la importación).
  const p2 = await imp.prepareImport(repo, ev.event, imp.parseGuests("Name,Email,Ticket\nOra Dora,ora.dora@example.com,General\n"), opciones(ev));
  assert.equal(p2.summary.resumed, 1);
  assert.equal((await repo.getPass(pase.id)).ticketTypeId, ev.porKind.attendee.id);
});

// ---------- Los correos (H-D2) ----------

test("en producción el correo de desarrollo no manda nada y lo dice; en desarrollo guarda el archivo y al registro va solo el dominio", async () => {
  const correo = { to: "ana@example.com", subject: "Tu credencial", text: "Abrí https://rum.bo/p/ABCDEFG2?k=CLAVESECRETA" };
  const antes = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const { resultado, lineas } = await capturarConsola(() => new DevMailer().send(correo));
    assert.deepEqual(resultado, { id: null, outcome: "not_configured" });
    assert.ok(!lineas.join("\n").includes("CLAVESECRETA"), "nada del correo en el registro");
  } finally {
    process.env.NODE_ENV = antes;
  }
  const carpeta = mkdtempSync(join(tmpdir(), "rumbo-correos-"));
  const { resultado, lineas } = await capturarConsola(() => new DevMailer(carpeta).send(correo));
  assert.equal(resultado.outcome, "sent");
  const registro = lineas.join("\n");
  assert.ok(registro.includes("example.com") && !registro.includes("ana@example.com") && !registro.includes("CLAVESECRETA"), `el registro dice el dominio y nada más: ${registro}`);
  assert.ok(readFileSync(join(carpeta, resultado.id), "utf8").includes("CLAVESECRETA"), "el archivo sí tiene el correo entero");
});

test("armar el correo nunca tira un 500: sin carpeta donde escribir contesta que no salió, y Resend sin implementar también", async () => {
  const archivo = join(mkdtempSync(join(tmpdir(), "rumbo-sin-carpeta-")), "soy-un-archivo");
  writeFileSync(archivo, "x");
  const { resultado } = await capturarConsola(() => new DevMailer(join(archivo, "correos")).send({ to: "a@example.com", subject: "x", text: "y" }));
  assert.deepEqual(resultado, { id: null, outcome: "not_configured" });
  const antes = process.env.RUMBO_MAILER;
  process.env.RUMBO_MAILER = "resend";
  const guardado = globalThis.__rumboMailer;
  delete globalThis.__rumboMailer;
  try {
    const mailer = getMailer();
    assert.equal(mailer.kind, "resend");
    const { resultado: r } = await capturarConsola(() => mailer.send({ to: "a@example.com", subject: "x", text: "y" }));
    assert.equal(r.outcome, "not_configured");
  } finally {
    process.env.RUMBO_MAILER = antes;
    globalThis.__rumboMailer = guardado;
  }
});

test("una tanda sin servicio de correo cuenta las credenciales como con enlace y sin correo, y quien organiza baja los enlaces en CSV", async () => {
  const ev = await eventoPublicado("Sin correo");
  const csv = "Name,Email\n=SUMA(1;2) Malicia,malicia@example.com\nBeto Bueno,beto.bueno@example.com\nCaro Cierta,caro.cierta@example.com\n";
  const p = await imp.prepareImport(repo, ev.event, imp.parseGuests(csv), opciones(ev));
  const { deps, correos } = dependencias({ correo: () => ({ id: null, outcome: "not_configured" }) });
  const tanda = await imp.activateBatch(repo, ev.event, p.run.id, 20, deps);
  assert.deepEqual([tanda.activated, tanda.emailsSent, tanda.linkOnly, tanda.emailsFailed], [3, 0, 3, 0]);
  assert.equal(correos.length, 3, "se intentó mandar cada uno");
  const estado = await imp.importStatus(repo, p.run.id);
  assert.deepEqual([estado.summary.linkOnly, estado.summary.emailsSent], [3, 0]);

  const enlaces = await imp.buildImportLinksCsv(repo, ev.event, p.run.id, "es", "http://localhost:3000");
  const filas = enlaces.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(filas.length, 4, "cabecera y tres personas");
  assert.ok(filas.slice(1).every((f) => /http:\/\/localhost:3000\/p\/[A-Z2-9]{8}\?k=/.test(f)), "cada fila con su enlace personal");
  assert.ok(!/(^|,)=SUMA/m.test(enlaces), "una celda que empieza con = no se ejecuta en la planilla");
  assert.equal(await imp.buildImportLinksCsv(repo, ev.event, "no-existe", "es"), null);
  // Con un correo que sí sale, la cuenta es la de siempre.
  const ev2 = await eventoPublicado("Con correo");
  const p2 = await imp.prepareImport(repo, ev2.event, imp.parseGuests(lista(2, "concorreo")), opciones(ev2));
  const bien = await imp.activateBatch(repo, ev2.event, p2.run.id, 20, dependencias().deps);
  assert.deepEqual([bien.emailsSent, bien.linkOnly], [2, 0]);
});

// ---------- Las personas (H-D7 y H-D10) ----------

test("quien ya existe conserva su nombre aunque otra persona escriba su correo en otro evento", async () => {
  const guardados = { accounts: globalThis.__rumboAccounts, mailer: globalThis.__rumboMailer, register: stellar.rumboPass.register, status: stellar.rumboPass.status };
  let n = 0;
  globalThis.__rumboAccounts = { kind: "dev", getOrCreateForPerson: async (id) => `G${id.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`, authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (e) => e }) };
  stellar.rumboPass.register = async () => ({ hash: `h-${++n}`, ledger: 1, returnValue: n, number: n });
  stellar.rumboPass.status = async () => ({ has_pass: true, number: 1, checked_in: false, redeemed: [] });
  globalThis.__rumboMailer = { kind: "dev", send: async () => ({ id: "1", outcome: "sent" }) };
  try {
    const A = await eventoPublicado("Evento A");
    const B = await eventoPublicado("Evento B");
    const v = await registerForEvent({ slug: A.event.slug, ticketTypeId: A.porKind.attendee.id, name: "Victoria Real", email: "victoria@example.com", lang: "es" });
    assert.equal(v.kind, "created");
    const x = await registerForEvent({ slug: B.event.slug, ticketTypeId: B.porKind.attendee.id, name: "Nombre Falso", email: "Victoria@Example.com", lang: "es" });
    assert.equal(x.kind, "created");
    assert.equal((await repo.getPersonById(v.person.id)).name, "Victoria Real", "su nombre en toda la plataforma sigue siendo el suyo");
    assert.equal(x.person.id, v.person.id, "es la misma persona");
  } finally {
    globalThis.__rumboAccounts = guardados.accounts;
    globalThis.__rumboMailer = guardados.mailer;
    stellar.rumboPass.register = guardados.register;
    stellar.rumboPass.status = guardados.status;
  }
  // En la capa de datos: el nombre nuevo se descarta, salvo que el guardado esté vacío.
  const sinNombre = await repo.upsertPerson({ name: "", email: "sin.nombre@example.com" });
  assert.equal((await repo.upsertPerson({ name: "Ahora Con Nombre", email: "sin.nombre@example.com" })).name, "Ahora Con Nombre");
  assert.equal((await repo.upsertPerson({ name: "Otro Nombre", email: "sin.nombre@example.com" })).name, "Ahora Con Nombre");
  assert.equal((await repo.getPersonById(sinNombre.id)).name, "Ahora Con Nombre");
});

test("dos correos que llegan al mismo buzón son una sola persona: mayúsculas, espacios, caracteres invisibles, ancho completo, y en Gmail los puntos y la etiqueta", async () => {
  // Los buzones de Gmail se arman acá: la regla es solo para esos dos dominios, y las pruebas no escriben direcciones reales.
  const gmail = (local, dominio = "gmail.com") => [local, dominio].join("@");
  assert.equal(normalizeEmail(" Ana@Example.com​ "), "ana@example.com");
  assert.equal(normalizeEmail("ａｎａ@example.com"), "ana@example.com");
  assert.equal(emailKey(gmail("A.na+rumbo", "GoogleMail.com")), gmail("ana"));
  assert.equal(emailKey("a.na@example.com"), "a.na@example.com", "fuera de Gmail los puntos sí importan");

  const ev = await eventoPublicado("Buzones");
  const csv = [
    "Name,Email,Status",
    "Ana,Ana@Example.com,approved",
    "Ana dos, ana@example.com ,approved",
    "Ana tres,ANA@EXAMPLE.COM,approved",
    "Cero ancho,ana@example.com​,approved",
    "Ancho completo,ａｎａ@example.com,approved",
    `Gmail uno,${gmail("a.na")},approved`,
    `Gmail dos,${gmail("ana")},approved`,
    `Gmail tres,${gmail("ana+bolivia")},approved`,
    `Gmail cuatro,${gmail("Ana", "googlemail.com")},approved`,
  ].join("\n");
  const p = await imp.prepareImport(repo, ev.event, imp.parseGuests(csv), opciones(ev));
  assert.deepEqual([p.summary.created, p.summary.duplicatesInFile, p.summary.invalidEmail], [2, 7, 0]);
  const persona = await repo.getPersonByEmail(gmail("ANA", "googlemail.com"));
  assert.equal(persona.email, gmail("a.na"), "se guarda como lo escribió la primera vez");
  assert.equal((await repo.getPersonByEmail(gmail("ana+otra"))).id, persona.id);
  // Inscribirse después con una variante no crea otra persona.
  assert.equal((await repo.upsertPerson({ name: "Ana Otra Vez", email: gmail("a.n.a") })).id, persona.id);
  assert.equal((await repo.listPersonsByEmails(["ANA@EXAMPLE.COM", gmail("ana+x", "googlemail.com"), "nadie@example.com"])).length, 2);
});

// ---------- En producción no se cuelan los de mentira (H-D12c) ----------

test("en producción se ignoran el contrato y el correo de mentira de las pruebas", async () => {
  const falso = { register: async () => ({ hash: "falso" }), status: async () => ({}) };
  const guardados = { chain: globalThis.__rumboKitChain, mailer: globalThis.__rumboMailer, env: process.env.NODE_ENV };
  globalThis.__rumboKitChain = falso;
  globalThis.__rumboMailer = { kind: "dev", send: async () => ({ id: "x", outcome: "sent" }) };
  try {
    assert.equal(imp.defaultImportDeps("es", null, repo).chain, falso, "en desarrollo y en las pruebas, sí");
    assert.equal(getMailer(), globalThis.__rumboMailer);
    process.env.NODE_ENV = "production";
    assert.equal(imp.defaultImportDeps("es", null, repo).chain, stellar.rumboPass);
    assert.notEqual(getMailer(), globalThis.__rumboMailer);
  } finally {
    process.env.NODE_ENV = guardados.env;
    globalThis.__rumboKitChain = guardados.chain;
    globalThis.__rumboMailer = guardados.mailer;
  }
});
