// El importador lee los dos formatos de ejemplo (Luma y Bevy, inventados, en tests/fixtures), salta duplicados y
// correos inválidos, no crea dos credenciales a la misma persona, no pisa lo que ya pasó en la puerta y manda los
// correos en tandas. Sin red: el contrato, las cuentas y el correo son de mentira.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { APP_DIR, entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { createEventFromTemplate, TEMPLATES } = await import("../src/server/kit/plantillas.ts");
const { defaultDraft, saveDraft } = await import("../src/server/kit/borrador.ts");
const { publishEvent } = await import("../src/server/kit/publicar.ts");
const imp = await import("../src/server/kit/importar.ts");

const repo = getRepo();
const leer = (nombre) => new Uint8Array(readFileSync(join(APP_DIR, "tests", "fixtures", nombre)));
const LUMA = () => imp.parseGuestFile(leer("luma-invitados.csv.txt"));
const BEVY = () => imp.parseGuestFile(leer("bevy-asistentes.csv.txt"));
const contar = (filas, clave) => Object.fromEntries(Object.entries(Object.groupBy(filas, clave)).map(([k, v]) => [k, v.length]));

// ---------- Un evento publicado, con todos los tipos de credencial, y las cuentas, el contrato y el correo falsos ----------

let contratos = 0;
async function eventoPublicado(nombre) {
  const base = await createEventFromTemplate(repo, { template: "devfest", lang: "es", name: nombre, startsAtLocal: "2026-12-05T09:00", place: "Santa Cruz", organizerName: "GDG" });
  const borrador = defaultDraft(TEMPLATES.devfest, "es");
  borrador.slots.judge.included = true;
  borrador.slots.judge.benefits = ["lunch", "snack", "dinner"];
  await saveDraft(repo, base, borrador, "es");
  const resultado = await publishEvent(repo, await repo.getEventById(base.id), { deploy: async () => `CFALSO${++contratos}` });
  assert.equal(resultado.ok, true);
  const event = await repo.getEventById(base.id);
  const types = await repo.listTicketTypes(event.id);
  return { event, types, porKind: Object.fromEntries(types.map((t) => [t.credentialKind, t])) };
}

function dependencias({ falla = () => false, correoFalla = () => false, demora = 0 } = {}) {
  const registros = [];
  const correos = [];
  let numero = 0;
  return {
    registros,
    correos,
    deps: {
      lang: "es",
      origin: "http://localhost:3000",
      accounts: {
        getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
        authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
      },
      chain: {
        register: async (contractId, account) => {
          if (demora) await new Promise((r) => setTimeout(r, demora));
          if (falla(account)) throw new Error("la red no contesta");
          numero++;
          registros.push({ contractId, account, numero });
          return { hash: `h-${numero}`, ledger: 1, returnValue: numero, number: numero };
        },
        status: async () => ({ has_pass: true, number: 99, checked_in: false, redeemed: [] }),
      },
      mailer: {
        send: async (mail) => {
          if (correoFalla(mail.to)) throw new Error("el proveedor rechazó el correo");
          correos.push(mail);
          return { id: String(correos.length) };
        },
      },
    },
  };
}

const opciones = (evento, extra = {}) => ({ statuses: ["approved"], mapping: {}, defaultTypeId: evento.porKind.attendee.id, ...extra });

/** El tipo que sugiere el importador para cada entrada de la lista de Luma. */
const mapaDeLuma = (evento) =>
  Object.fromEntries(["General", "Speaker", "Jurado", "Mentor", "Volunteer"].map((e) => [imp.labelKey(e), imp.suggestType(e, evento.types).id]));

/** Activa todo lo pendiente de una importación en tandas del tamaño dado; devuelve las tandas. */
async function tandas(evento, runId, deps, size = 4) {
  const lista = [];
  for (let i = 0; i < 50; i++) {
    const r = await imp.activateBatch(repo, evento.event, runId, size, deps);
    lista.push(r);
    if (r.remaining === 0 || r.processed === 0) break;
  }
  return lista;
}

// ---------- Leer los dos formatos ----------

test("la lista de Luma: se reconoce, se leen sus columnas por nombre y las de más se ignoran", () => {
  const luma = LUMA();
  assert.equal(luma.source, "luma");
  assert.deepEqual(luma.columns, { name: "name", email: "email", status: "approval_status", ticket: "ticket_name", diet: "¿Tenés alguna restricción alimentaria?" });
  // 20 columnas, 7 leídas (nombre, nombre de pila, apellido, correo, estado, entrada y dieta): 13 se ignoran.
  assert.equal(luma.ignored, 13);
  assert.equal(luma.rows.length, 16);
  assert.deepEqual(luma.skippedLines, []);

  const por = (email) => luma.rows.find((r) => r.email.toLowerCase() === email);
  assert.equal(por("maria.quispe@example.com").name, "Quispe, María", "un nombre con coma no se parte");
  assert.equal(por("jorge.mamani@example.com").name, "Jorge Mamani", "lo que llegó en minúsculas se arregla");
  assert.equal(por("elena.condori@example.com").name, "Elena Condori", "y lo que llegó en mayúsculas");
  assert.equal(por("maria.quispe@example.com").diet, "Vegetariana");
  assert.equal(por("jorge.mamani@example.com").diet, null, "«ninguna» no es una restricción");
  assert.equal(por("elena.condori@example.com").diet, "Alergia a las nueces y al maní", "una respuesta de varias líneas queda en una");

  assert.deepEqual(contar(luma.rows, (r) => r.status), { approved: 13, pending: 2, declined: 1 });
  assert.deepEqual(luma.rows.map((r) => r.ticketLabel).filter((e) => e !== "General"), ["Speaker", "Jurado", "Mentor", "Volunteer"]);
});

test("la lista de Bevy: se reconoce, con el BOM de Excel y los estados de su plataforma", () => {
  const bevy = BEVY();
  assert.equal(bevy.source, "bevy");
  assert.deepEqual(bevy.columns, { name: "First Name", email: "Email", status: "Attendee Status", ticket: "Ticket Type", diet: null });
  // 12 columnas, 5 leídas (nombre de pila, apellido, correo, estado y entrada): 7 se ignoran.
  assert.equal(bevy.ignored, 7);
  assert.equal(bevy.rows.length, 12);
  assert.equal(bevy.rows[0].name, "Sofía Aguilar");
  assert.equal(bevy.rows[9].name, "Rodrigo", "sin apellido, queda el nombre de pila");
  assert.deepEqual(contar(bevy.rows, (r) => r.status), { approved: 10, waitlist: 1, cancelled: 1 });
});

test("los estados de las dos plataformas, en castellano y en inglés", () => {
  const casos = {
    approved: ["approved", "Approved", "Aprobado", "confirmada", "Registered", "Checked In", "Going", "Attended"],
    pending: ["pending_approval", "Pending Approval", "invited", "Pendiente"],
    waitlist: ["Waitlisted", "waitlist", "Lista de espera"],
    declined: ["declined", "Rechazada", "rejected"],
    cancelled: ["Cancelled", "canceled", "Cancelado"],
    unknown: ["", "algo raro", null],
  };
  for (const [esperado, textos] of Object.entries(casos)) for (const texto of textos) assert.equal(imp.normalizeStatus(texto), esperado, String(texto));
});

test("una lista sin columna de estado entra entera; sin cabecera, se busca la columna de correos", () => {
  const sinEstado = imp.parseGuests("nombre,correo\nAna Quiroga,ana@example.com\nLuis Choque,luis@example.com");
  assert.deepEqual(sinEstado.rows.map((r) => r.status), ["approved", "approved"]);
  assert.equal(sinEstado.source, "other");
  const sinCabecera = imp.parseGuests("1001,Ana Quiroga,ana@example.com\n1002,Luis Choque,luis@example.com\n1003,Rodrigo Mamani,rodrigo@example.com");
  assert.deepEqual(sinCabecera.rows.map((r) => [r.name, r.email]), [["Ana Quiroga", "ana@example.com"], ["Luis Choque", "luis@example.com"], ["Rodrigo Mamani", "rodrigo@example.com"]]);
});

test("un CSV de Excel en español (punto y coma, ANSI) se lee con sus tildes", () => {
  const ansi = Uint8Array.from([..."Nombre;Correo;Estado\nMaría Peña;maria.pena@example.com;Aprobado\nÓscar Limachi;oscar@example.com;Pendiente"].map((c) => c.charCodeAt(0)));
  const lista = imp.parseGuestFile(ansi);
  assert.deepEqual(lista.rows.map((r) => [r.name, r.status]), [["María Peña", "approved"], ["Óscar Limachi", "pending"]]);
});

test("lo que no se puede leer dice por qué", () => {
  const codigo = (fn) => {
    try {
      fn();
    } catch (e) {
      return e.name === "ImportFormatError" ? e.code : e;
    }
    return null;
  };
  assert.equal(codigo(() => imp.parseGuests("   \n ")), "empty");
  assert.equal(codigo(() => imp.parseGuests("nombre,correo\n")), "empty");
  assert.equal(codigo(() => imp.parseGuests("nombre,ciudad\nAna,La Paz\nLuis,Sucre")), "no_email");
  assert.equal(codigo(() => imp.parseGuestFile(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))), "no_text");
});

// ---------- La vista previa ----------

test("la vista previa cuenta, por estado, quiénes entrarían, y propone el tipo de cada entrada", async () => {
  const evento = await eventoPublicado("Vista previa");
  const vista = await imp.previewGuests(repo, evento.event, LUMA());
  assert.equal(vista.source, "luma");
  assert.equal(vista.total, 16);
  assert.deepEqual(vista.buckets.approved, { valid: 9, invalidEmail: 3, duplicatesInFile: 1, alreadyHere: 0 });
  assert.deepEqual(vista.buckets.pending, { valid: 2, invalidEmail: 0, duplicatesInFile: 0, alreadyHere: 0 });
  assert.deepEqual(vista.buckets.declined, { valid: 1, invalidEmail: 0, duplicatesInFile: 0, alreadyHere: 0 });
  const entradas = Object.fromEntries(vista.tickets.map((e) => [e.label, e]));
  assert.equal(entradas.General.count, 8);
  assert.equal(entradas.General.suggestedTypeId, evento.porKind.attendee.id);
  assert.equal(entradas.Speaker.suggestedTypeId, evento.porKind.speaker.id);
  assert.equal(entradas.Jurado.suggestedTypeId, evento.porKind.judge.id);
  assert.equal(entradas.Mentor.suggestedTypeId, evento.porKind.mentor.id);
  assert.equal(entradas.Volunteer.suggestedTypeId, evento.porKind.volunteer.id);
  assert.equal(vista.defaultTypeId, evento.porKind.attendee.id);
  assert.ok(vista.types.length >= 6 && vista.types.every((t) => t.id && t.name && t.kind));
  assert.equal(await repo.getPersonByEmail("ana.quiroga@example.com"), null, "ver no crea a nadie");
});

test("una entrada de la lista que se llama como un tipo de acá va a ese tipo", async () => {
  const evento = await eventoPublicado("Mismo nombre");
  assert.equal(imp.suggestType("Mentora o mentor", evento.types).id, evento.porKind.mentor.id);
  assert.equal(imp.suggestType("Jury member", evento.types).id, evento.porKind.judge.id);
  assert.equal(imp.suggestType("Auspiciante", evento.types).id, evento.porKind.sponsor.id);
  assert.equal(imp.suggestType("Entrada general", evento.types).id, evento.porKind.attendee.id);
  assert.equal(imp.suggestKind("Early Bird"), null);
});

// ---------- Importar ----------

test("importar Luma: cuenta lo importado, lo salteado y lo inválido, y cada quien recibe el tipo que le toca", async () => {
  const evento = await eventoPublicado("Importar Luma");
  const { run, summary } = await imp.prepareImport(repo, evento.event, LUMA(), opciones(evento, { mapping: mapaDeLuma(evento) }));
  // 16 filas: 9 entran, 3 con correo inválido, 1 repetida en el archivo, 3 por su estado (2 pendientes y 1 rechazada).
  assert.deepEqual(
    [summary.read, summary.created, summary.invalidEmail, summary.duplicatesInFile, summary.alreadyHere, summary.duplicates, summary.notSelected],
    [16, 9, 3, 1, 0, 1, 3],
  );
  assert.equal(summary.source, "luma");
  const pases = await repo.listPassesByImportRun(run.id);
  assert.equal(pases.length, 9);
  assert.ok(pases.every((p) => p.status === "pending" && p.account === null), "quedan pendientes hasta mandarlas");

  const tipoDe = async (email) => {
    const persona = await repo.getPersonByEmail(email);
    return (await repo.getTicketType((await repo.findPass(evento.event.id, persona.id)).ticketTypeId)).credentialKind;
  };
  assert.equal(await tipoDe("lucia.fernandez@example.com"), "speaker");
  assert.equal(await tipoDe("diego.rojas@example.com"), "judge");
  assert.equal(await tipoDe("camila.rojas@example.com"), "mentor");
  assert.equal(await tipoDe("pablo.gutierrez@example.com"), "volunteer");
  assert.equal(await tipoDe("ana.quiroga@example.com"), "attendee");
  // Los pendientes y la rechazada no entraron.
  assert.equal(await repo.getPersonByEmail("rosa.villca@example.com"), null);
  assert.equal(await repo.getPersonByEmail("nina.rocha@example.com"), null);
  // La dieta queda en la credencial, y los correos inválidos no crean a nadie.
  const maria = await repo.findPass(evento.event.id, (await repo.getPersonByEmail("maria.quispe@example.com")).id);
  assert.equal(maria.diet, "Vegetariana");
  assert.equal(await repo.getPersonByEmail("correo.roto@"), null);
  assert.equal((await repo.listPasses(evento.event.id)).length, 9);
  // Guarda de dónde vino el resumen.
  assert.equal((await repo.getImportRun(run.id)).summary.created, 9);
});

test("el correo sale en tandas: cada persona recibe su enlace, y los canjes de su tipo", async () => {
  const evento = await eventoPublicado("En tandas");
  const { run } = await imp.prepareImport(repo, evento.event, LUMA(), opciones(evento, { mapping: mapaDeLuma(evento) }));
  const { deps, registros, correos } = dependencias();
  const lista = await tandas(evento, run.id, deps, 4);
  assert.deepEqual(lista.map((t) => t.processed), [4, 4, 1], "tres tandas de hasta cuatro");
  assert.deepEqual(lista.map((t) => t.remaining), [5, 1, 0]);
  assert.equal(lista.reduce((n, t) => n + t.emailsSent, 0), 9);
  assert.equal(registros.length, 9);
  assert.equal(correos.length, 9);

  const final = await imp.importStatus(repo, run.id);
  assert.equal(final.remaining, 0);
  assert.deepEqual([final.summary.activated, final.summary.emailsSent, final.summary.emailsFailed], [9, 9, 0]);

  // Cada correo va a la dirección en minúsculas, con el enlace personal a su credencial.
  const paraLucia = correos.find((c) => c.to === "lucia.fernandez@example.com");
  assert.match(paraLucia.text, /http:\/\/localhost:3000\/p\/[A-Z2-7]{8}\?k=[\w-]{22}&lang=es/);
  assert.match(paraLucia.text, /como oradora u orador/, "el correo dice como qué");
  assert.match(correos.find((c) => c.to === "ana.quiroga@example.com").text, /Ya tenés tu credencial para Importar|Ya tenés tu credencial para En tandas/);
  assert.ok(!correos.find((c) => c.to === "ana.quiroga@example.com").text.includes("como asistente"));
  for (const mail of correos) assert.ok(!/secret|clave secreta|contraseña/i.test(mail.text), "ningún correo lleva llaves ni contraseñas");

  // Las credenciales quedan activas, con su cuenta, y cada contrato es el de su tipo.
  const pases = await repo.listPassesByImportRun(run.id);
  assert.ok(pases.every((p) => p.status === "active" && p.account && p.chainNumber));
  const contratoDe = new Map(evento.types.map((t) => [t.id, t.contractId]));
  for (const pase of pases) assert.ok(registros.some((r) => r.account === pase.account && r.contractId === contratoDe.get(pase.ticketTypeId)));

  // Lo que le toca a cada tipo: el jurado tiene cena, el voluntariado su polera de staff, y quien asiste ninguna de las dos.
  const canjesDe = async (email) => {
    const pase = await repo.findPass(evento.event.id, (await repo.getPersonByEmail(email)).id);
    return (await repo.listPassBenefits(pase.id)).map((b) => b.templateKey);
  };
  assert.ok((await canjesDe("diego.rojas@example.com")).includes("dinner"));
  assert.ok((await canjesDe("pablo.gutierrez@example.com")).includes("staffMerch"));
  const asistente = await canjesDe("ana.quiroga@example.com");
  assert.ok(!asistente.includes("dinner") && !asistente.includes("staffMerch"));
});

test("importar dos veces la misma lista no crea dos credenciales a la misma persona", async () => {
  const evento = await eventoPublicado("Dos veces");
  const primera = await imp.prepareImport(repo, evento.event, LUMA(), opciones(evento, { mapping: mapaDeLuma(evento) }));
  const { deps } = dependencias();
  await tandas(evento, primera.run.id, deps);
  const antes = (await repo.listPasses(evento.event.id)).length;

  const segunda = await imp.prepareImport(repo, evento.event, LUMA(), opciones(evento, { mapping: mapaDeLuma(evento) }));
  assert.equal(segunda.summary.created, 0);
  assert.equal(segunda.summary.alreadyHere, 9, "ya tenían su credencial");
  assert.equal(segunda.summary.duplicatesInFile, 1);
  assert.equal(segunda.summary.duplicates, 10);
  assert.equal((await repo.listPasses(evento.event.id)).length, antes);
  assert.equal((await repo.listPassesByImportRun(segunda.run.id)).length, 0);

  // El mismo correo con otras mayúsculas dentro del archivo tampoco se repite.
  const mismaPersona = imp.parseGuests("nombre,correo\nBeto Rojas,beto@example.com\nBeto R.,BETO@Example.com\n Beto ,  beto@example.com  ");
  const resumen = (await imp.prepareImport(repo, evento.event, mismaPersona, opciones(evento))).summary;
  assert.deepEqual([resumen.created, resumen.duplicatesInFile], [1, 2]);
  const persona = await repo.getPersonByEmail("beto@example.com");
  assert.equal([...(await repo.listPasses(evento.event.id))].filter((p) => p.personId === persona.id).length, 1);
});

test("importar de nuevo no pisa la entrada ni los canjes ya hechos, ni el tipo de quien ya estaba", async () => {
  const evento = await eventoPublicado("Sin pisar");
  const primera = await imp.prepareImport(repo, evento.event, LUMA(), opciones(evento, { mapping: mapaDeLuma(evento) }));
  const { deps } = dependencias();
  await tandas(evento, primera.run.id, deps);

  const persona = await repo.getPersonByEmail("diego.rojas@example.com");
  const pase = await repo.findPass(evento.event.id, persona.id);
  const entro = "2026-12-05T09:30:00.000Z";
  await repo.updatePass(pase.id, { status: "checked_in", checkedInAt: entro });
  const entrada = await repo.recordCheckIn({ eventId: evento.event.id, passId: pase.id });
  const canje = (await repo.listPassBenefits(pase.id))[0];
  const canjeado = await repo.recordRedemption({ eventId: evento.event.id, passId: pase.id, benefitId: canje.id });

  // La lista de ahora lo trae como asistente común (cambió la entrada): nada de lo anterior cambia.
  const otra = imp.parseGuests("name,email,approval_status,ticket_name\nDiego Rojas,diego.rojas@example.com,approved,General");
  const { summary } = await imp.prepareImport(repo, evento.event, otra, opciones(evento));
  assert.equal(summary.created, 0);
  assert.equal(summary.alreadyHere, 1);

  const despues = await repo.getPass(pase.id);
  assert.equal(despues.status, "checked_in");
  assert.equal(despues.checkedInAt, entro);
  assert.equal(despues.ticketTypeId, evento.porKind.judge.id, "sigue siendo jurado");
  assert.equal((await repo.listCheckInsForPass(pase.id)).length, 1);
  assert.equal((await repo.listCheckInsForPass(pase.id))[0].id, entrada.id);
  assert.equal((await repo.listRedemptionsForPass(pase.id))[0].id, canjeado.id);
  assert.equal((await repo.getPersonById(persona.id)).name, persona.name);
});

test("quien ya existe como persona (de otro evento) conserva su nombre, y quien ya se inscribió por la página no se duplica", async () => {
  const evento = await eventoPublicado("Personas conocidas");
  await repo.upsertPerson({ name: "Valeria C.", email: "valeria.choque@example.com" });
  const inscripta = await repo.upsertPerson({ name: "Ana Quiroga", email: "ana.quiroga@example.com" });
  const suya = await repo.createPass({ eventId: evento.event.id, personId: inscripta.id, ticketTypeId: evento.porKind.attendee.id, status: "active", account: "GANA" });

  const { summary } = await imp.prepareImport(repo, evento.event, LUMA(), opciones(evento, { mapping: mapaDeLuma(evento) }));
  assert.equal(summary.alreadyHere, 1, "Ana ya estaba inscripta");
  assert.equal(summary.created, 8);
  assert.equal((await repo.getPersonByEmail("valeria.choque@example.com")).name, "Valeria C.", "no se le cambia el nombre");
  assert.ok(await repo.findPass(evento.event.id, (await repo.getPersonByEmail("valeria.choque@example.com")).id), "pero sí recibe su credencial");
  assert.equal((await repo.getPass(suya.id)).account, "GANA");
});

test("importar Bevy: aprobados y confirmados, con los tipos de su plataforma", async () => {
  const evento = await eventoPublicado("Importar Bevy");
  const bevy = BEVY();
  const mapping = Object.fromEntries(["General Admission", "Speaker", "Mentor", "Volunteer", "Sponsor"].map((e) => [imp.labelKey(e), imp.suggestType(e, evento.types).id]));
  const { run, summary } = await imp.prepareImport(repo, evento.event, bevy, opciones(evento, { mapping }));
  // 12 filas: 8 entran, 1 con correo inválido, 1 repetida (Elena, dos veces), 2 por su estado (lista de espera y cancelada).
  assert.deepEqual([summary.read, summary.created, summary.invalidEmail, summary.duplicates, summary.notSelected], [12, 8, 1, 1, 2]);
  assert.equal(summary.source, "bevy");
  const kinds = [];
  for (const p of await repo.listPassesByImportRun(run.id)) kinds.push((await repo.getTicketType(p.ticketTypeId)).credentialKind);
  assert.deepEqual(contar(kinds, (k) => k), { attendee: 4, speaker: 1, mentor: 1, volunteer: 1, sponsor: 1 });
  // Elena aparece como voluntaria y como asistente: gana la primera.
  const elena = await repo.findPass(evento.event.id, (await repo.getPersonByEmail("elena.mamani@example.org")).id);
  assert.equal((await repo.getTicketType(elena.ticketTypeId)).credentialKind, "volunteer");
  assert.equal(await repo.getPersonByEmail("luis.choque@example.org"), null, "la cancelada no entra");

  // Si quien organiza también quiere a la lista de espera, entra.
  const mas = await imp.prepareImport(repo, evento.event, bevy, opciones(evento, { mapping, statuses: ["approved", "waitlist"] }));
  assert.equal(mas.summary.created, 1);
  assert.ok(await repo.getPersonByEmail("marta.perez@example.org"));
});

// ---------- Cuando algo falla ----------

test("si la cuenta o el contrato fallan, la credencial queda pendiente y se retoma; si el correo falla, ya tiene credencial", async () => {
  const evento = await eventoPublicado("Fallas");
  const lista = imp.parseGuests("name,email\nAna Uno,uno@example.com\nBeto Dos,dos@example.com\nCaro Tres,tres@example.com");
  const { run } = await imp.prepareImport(repo, evento.event, lista, opciones(evento));

  // La red está caída: ninguna credencial se activa, ningún correo sale, y todo sigue pendiente.
  const falsa = dependencias({ falla: () => true });
  const caidas = await imp.activateBatch(repo, evento.event, run.id, 5, falsa.deps);
  assert.deepEqual([caidas.processed, caidas.activated, caidas.failed, caidas.remaining], [3, 0, 3, 3]);
  assert.ok((await repo.listPassesByImportRun(run.id)).every((p) => p.status === "pending"), "nada se activó");
  assert.equal(falsa.correos.length, 0);

  // La red vuelve: se retoma lo pendiente. El correo de la primera persona no sale, pero su credencial ya está.
  const sana = dependencias({ correoFalla: (to) => to === "uno@example.com" });
  const segunda = await imp.activateBatch(repo, evento.event, run.id, 5, sana.deps);
  assert.deepEqual([segunda.activated, segunda.emailsSent, segunda.emailsFailed, segunda.failed, segunda.remaining], [3, 2, 1, 0, 0]);
  const pase = await repo.findPass(evento.event.id, (await repo.getPersonByEmail("uno@example.com")).id);
  assert.equal(pase.status, "active", "con el correo caído, la credencial vale igual");
  const resumen = (await imp.importStatus(repo, run.id)).summary;
  assert.deepEqual([resumen.activated, resumen.emailsSent, resumen.emailsFailed, resumen.failed], [3, 2, 1, 0]);
});

test("dos pedidos de la misma tanda a la vez no mandan dos veces: el segundo espera", async () => {
  const evento = await eventoPublicado("A la vez");
  const lista = imp.parseGuests("name,email\nAna Uno,a1@example.com\nBeto Dos,a2@example.com");
  const { run } = await imp.prepareImport(repo, evento.event, lista, opciones(evento));
  const { deps, correos } = dependencias({ demora: 40 });
  const [a, b] = await Promise.all([imp.activateBatch(repo, evento.event, run.id, 5, deps), imp.activateBatch(repo, evento.event, run.id, 5, deps)]);
  assert.deepEqual([a.busy, b.busy].sort(), [false, true]);
  assert.equal(correos.length, 2, "cada persona recibe un solo correo");
});

test("lo que no se puede importar: un borrador, un tipo de pago o un tipo que no es del evento", async () => {
  const evento = await eventoPublicado("Opciones");
  const borrador = await createEventFromTemplate(repo, { template: "meetup", lang: "es", startsAtLocal: "2026-12-05T09:00", place: "Santa Cruz", organizerName: "GDG" });
  const lista = imp.parseGuests("name,email\nAna Uno,o1@example.com");
  const codigo = async (event, options) => {
    try {
      await imp.prepareImport(repo, event, lista, options);
    } catch (e) {
      return e.code;
    }
    return null;
  };
  assert.equal(await codigo(borrador, opciones(evento)), "draft");
  assert.equal(await codigo(evento.event, opciones(evento, { defaultTypeId: "no-existe" })), "bad_type");
  const pago = await repo.createTicketType({ eventId: evento.event.id, name: "Con polera", priceUsdc: 10, contractId: "CPAGO" });
  assert.equal(await codigo(evento.event, opciones(evento, { defaultTypeId: pago.id })), "paid_type");
  assert.equal(await codigo(evento.event, opciones(evento, { mapping: { general: pago.id } })), null, "un mapa sin esa entrada no molesta");
  assert.equal((await repo.listPasses(evento.event.id)).length, 1, "lo anterior no creó nada, salvo la última, que sí era válida");
});
