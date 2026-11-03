// La credencial y el escáner muestran el tipo (asistente, mentoría, jurado...), cada tipo tiene sus propios canjes,
// la dieta aparece en grande solo en los puestos de comida, los topes (150 poleras) se descuentan y avisan, y la
// asistencia sale en la forma de Bevy. Sin red.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const stellar = await import("../src/server/stellar.ts");
const { createEventFromTemplate, TEMPLATES } = await import("../src/server/kit/plantillas.ts");
const { defaultDraft, saveDraft } = await import("../src/server/kit/borrador.ts");
const { publishEvent } = await import("../src/server/kit/publicar.ts");
const { loadCredentialUnchecked } = await import("../src/server/evento/credencial.ts");
const { renderCredentialSvg } = await import("../src/server/evento/credencial-svg.ts");
const { RegistrationNotFound, registerForEvent } = await import("../src/server/evento/inscripcion.ts");
const { ensureStationCodes, resolveStationCode, getPanelState } = await import("../src/server/panel.ts");
const { buildSnapshot } = await import("../src/server/escaner.ts");
const { decideVerdict } = await import("../src/lib/escaner-api.ts");
const { buildAttendanceCsv, splitName } = await import("../src/server/kit/asistencia.ts");
const { registrationAttempts, linkResendAttempts } = await import("../src/server/limites.ts");

const repo = getRepo();

// Sin red.
let numero = 0;
globalThis.__rumboAccounts = {
  kind: "dev",
  getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
  authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
};
stellar.rumboPass.register = async () => ({ hash: `h-${++numero}`, ledger: 1, returnValue: numero, number: numero });
stellar.rumboPass.status = async () => ({ has_pass: true, number: 1, checked_in: false, redeemed: [] });
globalThis.__rumboMailer = { kind: "dev", send: async () => ({ id: "1" }) };
beforeEach(() => {
  registrationAttempts().clear();
  linkResendAttempts().clear();
});

let contratos = 0;
/** Una hackatón publicada, con stock de 3 en las poleras de staff, y un pase activo de cada tipo. */
async function armar(nombre) {
  const base = await createEventFromTemplate(repo, { template: "hackaton", lang: "es", name: nombre, startsAtLocal: "2026-12-05T09:00", place: "Santa Cruz", organizerName: "GDG" });
  const borrador = defaultDraft(TEMPLATES.hackaton, "es");
  borrador.benefits.staffMerch.stock = 3;
  await saveDraft(repo, base, borrador, "es");
  await publishEvent(repo, await repo.getEventById(base.id), { deploy: async () => `CCRED${++contratos}` });
  const event = await repo.getEventById(base.id);
  const types = await repo.listTicketTypes(event.id);
  const porLugar = Object.fromEntries(types.map((t) => [t.templateSlot, t]));
  const pase = async (slot, name, extra = {}) => {
    const persona = await repo.upsertPerson({ name, email: `${slot}-${Math.random().toString(36).slice(2, 7)}@example.com` });
    let pass = await repo.createPass({ eventId: event.id, personId: persona.id, ticketTypeId: porLugar[slot].id, status: "pending", diet: extra.diet ?? null });
    pass = await repo.updatePass(pass.id, { account: `G${pass.id.padEnd(55, "A")}`, status: "active" });
    await repo.grantTicketBenefits(pass.id);
    return pass;
  };
  return { event, types, porLugar, pase };
}

const nombres = async (passId) => (await repo.listPassBenefits(passId)).map((b) => b.name);

test("la credencial dice quién es la persona, y cada tipo trae sus propios canjes", async () => {
  const { pase } = await armar("Credenciales por tipo");
  const participante = await pase("attendee", "Ana Participante");
  const jurado = await pase("judge", "Rosa Jurado");
  const mentor = await pase("mentor", "Mario Mentor");
  const voluntaria = await pase("volunteer", "Vera Voluntaria");

  const vista = async (p) => loadCredentialUnchecked(p.id);
  assert.deepEqual((await Promise.all([participante, jurado, mentor, voluntaria].map(vista))).map((v) => v.kind), ["attendee", "judge", "mentor", "volunteer"]);

  // El jurado y la mentoría tienen cena; quien es voluntaria tiene su polera de staff; el participante, ninguna de las dos.
  assert.ok((await nombres(jurado.id)).includes("Cena, día 1") && (await nombres(jurado.id)).includes("Cena, día 2"));
  assert.ok((await nombres(mentor.id)).includes("Cena, día 1"));
  assert.ok((await nombres(voluntaria.id)).includes("Polera de staff"));
  const delParticipante = await nombres(participante.id);
  assert.ok(!delParticipante.includes("Polera de staff"));
  assert.equal(delParticipante.filter((n) => /^(Desayuno|Almuerzo|Refrigerio|Cena)/.test(n)).length, 8, "ocho comidas, una por franja y por día");
  // La credencial muestra esos canjes.
  const credencialJurado = await vista(jurado);
  assert.ok(credencialJurado.benefits.some((b) => b.name === "Cena, día 2"));
});

test("la credencial para imprimir lleva el tipo en grande y una banda de otro color para quien no es asistente", async () => {
  const { pase } = await armar("Credencial impresa");
  const jurado = await loadCredentialUnchecked((await pase("judge", "Rosa Jurado")).id);
  const participante = await loadCredentialUnchecked((await pase("attendee", "Ana Participante")).id);
  const svgJurado = renderCredentialSvg(jurado, "es");
  const svgParticipante = renderCredentialSvg(participante, "es");
  assert.match(svgJurado, />Jurado</);
  assert.match(svgJurado, /fill="#B43A0A"[^>]*clip-path/, "la banda del jurado va en el acento");
  assert.match(svgParticipante, />Participante</);
  assert.match(svgParticipante, /fill="#0F1C2E"[^>]*clip-path/, "la del participante, en tinta");
  assert.match(renderCredentialSvg(jurado, "en"), />Judge</);
});

test("el escáner muestra el tipo y el equipo; la dieta, solo en los puestos de comida", async () => {
  const { event, pase } = await armar("Escáner por tipo");
  const celiaca = await pase("attendee", "Celia Celíaca", { diet: "Sin gluten, alergia a la soja" });
  const jurado = await pase("judge", "Rosa Jurado");
  const equipo = (await repo.createTeam(event.id, "Los Cóndores")).team;
  await repo.setPassTeam(celiaca.id, equipo.id);

  const codigos = await ensureStationCodes(event, repo);
  const acceso = async (filtro) => resolveStationCode(codigos.find(filtro).code, repo);
  const beneficios = await repo.listBenefits(event.id);
  const porClave = (clave) => beneficios.find((b) => b.templateKey === clave);

  const puerta = await buildSnapshot(repo, await acceso((c) => c.kind === "gate"));
  const enPuerta = (id) => puerta.passes.find((p) => p.id === id);
  assert.deepEqual([enPuerta(celiaca.id).credential, enPuerta(celiaca.id).team, enPuerta(jurado.id).credential], ["attendee", "Los Cóndores", "judge"]);
  assert.equal(enPuerta(celiaca.id).diet, null, "la puerta no necesita la dieta, no baja");

  const comida = await buildSnapshot(repo, await acceso((c) => c.benefitId === porClave("lunch-1").id));
  assert.equal(comida.station.food, true);
  assert.equal(comida.passes.find((p) => p.id === celiaca.id).diet, "Sin gluten, alergia a la soja");
  const merch = await buildSnapshot(repo, await acceso((c) => c.benefitId === porClave("staffMerch").id));
  assert.equal(merch.station.food, false);
  assert.equal(merch.passes.find((p) => p.id === celiaca.id).diet, null, "la polera no pide la dieta");

  // El veredicto lleva quién es y, en la comida, la dieta.
  const ok = { ok: true, passId: celiaca.id };
  const enComida = comida.passes.find((p) => p.id === celiaca.id);
  const entro = { ...enComida, checkedInAt: "2026-12-05T10:00:00Z" };
  const veredicto = decideVerdict(ok, comida.station, entro, undefined);
  assert.deepEqual([veredicto.kind, veredicto.credential, veredicto.team, veredicto.diet], ["ok", "attendee", "Los Cóndores", "Sin gluten, alergia a la soja"]);
  const deJurado = decideVerdict({ ok: true, passId: jurado.id }, puerta.station, enPuerta(jurado.id), undefined);
  assert.deepEqual([deJurado.kind, deJurado.credential, deJurado.diet], ["ok", "judge", null]);
  // Una foto vieja, sin el tipo, se toma como asistente.
  const vieja = decideVerdict(ok, puerta.station, { id: celiaca.id, name: "Celia", benefits: [], checkedInAt: null, redeemed: {} }, undefined);
  assert.equal(vieja.credential, "attendee");
});

test("un canje con tope (150 poleras) lleva la cuenta: el panel dice cuántas quedan y avisa cuando se acaban", async () => {
  const { event, pase } = await armar("Stock de poleras");
  const gente = [];
  for (const n of [1, 2, 3]) gente.push(await pase("volunteer", `Voluntaria ${n}`));
  const polera = (await repo.listBenefits(event.id)).find((b) => b.templateKey === "staffMerch");
  assert.equal(polera.stock, 3);

  const quedan = async () => (await getPanelState(event, repo)).benefits.find((b) => b.id === polera.id);
  assert.deepEqual([(await quedan()).stock, (await quedan()).remaining, (await quedan()).redeemed], [3, 3, 0]);
  await repo.recordRedemption({ eventId: event.id, passId: gente[0].id, benefitId: polera.id });
  await repo.recordRedemption({ eventId: event.id, passId: gente[1].id, benefitId: polera.id });
  assert.deepEqual([(await quedan()).remaining, (await quedan()).redeemed], [1, 2]);
  const ultima = await repo.recordRedemption({ eventId: event.id, passId: gente[2].id, benefitId: polera.id });
  assert.equal((await quedan()).remaining, 0, "se acabaron");
  // Un canje repetido (doble) no gasta otra polera.
  await repo.markRedemption(ultima.id, { duplicate: true });
  assert.equal((await quedan()).remaining, 1);

  // En el puesto de la mesa de merch, el escáner baja cuántas quedan según el servidor.
  const codigos = await ensureStationCodes(event, repo);
  const acceso = await resolveStationCode(codigos.find((c) => c.benefitId === polera.id).code, repo);
  const foto = await buildSnapshot(repo, acceso);
  assert.deepEqual(foto.stock, { total: 3, left: 1 });
  // Lo que no tiene tope no lleva cuenta.
  const almuerzo = (await repo.listBenefits(event.id)).find((b) => b.templateKey === "lunch-1");
  const sinTope = await buildSnapshot(repo, await resolveStationCode(codigos.find((c) => c.benefitId === almuerzo.id).code, repo));
  assert.equal(sinTope.stock, null);
});

test("las credenciales de oradores, jurado y demás no se piden desde la página; un borrador no recibe inscripciones", async () => {
  const { event, porLugar } = await armar("Solo por invitación");
  const pedir = (slug, ticketTypeId, extra = {}) => registerForEvent({ slug, ticketTypeId, name: "Pedro Pedido", email: `pedro-${Math.random().toString(36).slice(2, 7)}@example.com`, lang: "es", ...extra });
  await assert.rejects(() => pedir(event.slug, porLugar.judge.id), (e) => e instanceof RegistrationNotFound && e.what === "ticket");
  const borrador = await createEventFromTemplate(repo, { template: "meetup", lang: "es", startsAtLocal: "2026-12-05T09:00", place: "Santa Cruz", organizerName: "GDG" });
  const ticketBorrador = (await repo.listTicketTypes(borrador.id))[0];
  await assert.rejects(() => pedir(borrador.slug, ticketBorrador.id), (e) => e instanceof RegistrationNotFound && e.what === "event");
  // Quien se inscribe como participante puede decir su dieta, opcional.
  const conDieta = await pedir(event.slug, porLugar.attendee.id, { diet: "  Vegetariana   estricta " });
  assert.equal(conDieta.kind, "created");
  assert.equal(conDieta.pass.diet, "Vegetariana estricta");
  const sinDieta = await pedir(event.slug, porLugar.attendee.id);
  assert.equal(sinDieta.pass.diet, null);
});

test("la asistencia sale en la forma de Bevy, con la columna Attended", async () => {
  const { event, pase } = await armar("Asistencia");
  const entro = await pase("attendee", "Ana María Quiroga");
  const noEntro = await pase("judge", "Rosa Jurado");
  const peligrosa = await pase("attendee", "=HYPERLINK(\"http://malo.example\",\"clic\")");
  await repo.updatePass(entro.id, { status: "checked_in", checkedInAt: "2026-12-05T10:15:00.000Z" });
  const equipo = (await repo.createTeam(event.id, "Los Búhos")).team;
  await repo.setPassTeam(entro.id, equipo.id);
  // Una credencial pendiente (sin activar) no entra.
  const aparte = await repo.upsertPerson({ name: "Pendiente Pago", email: "pendiente@example.com" });
  await repo.createPass({ eventId: event.id, personId: aparte.id, ticketTypeId: entro.ticketTypeId, status: "pending" });

  const csv = await buildAttendanceCsv(event, repo);
  assert.ok(csv.startsWith("﻿"), "con marca de orden para Excel");
  const filas = csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(filas[0], "First Name,Last Name,Email,Ticket Type,Attended,Checked In At,Credential Type,Team");
  assert.equal(filas.length, 4, "encabezado y tres credenciales");
  const ana = filas.find((f) => f.startsWith("Ana María,Quiroga,"));
  assert.match(ana, /,Participante,Yes,2026-12-05T10:15:00\.000Z,attendee,Los Búhos$/);
  const rosa = filas.find((f) => f.startsWith("Rosa,Jurado,"));
  assert.match(rosa, /,Jurado,No,,judge,$/);
  assert.ok(!csv.includes("Pendiente"));
  assert.ok(filas.some((f) => f.includes("'=HYPERLINK")), "una fórmula llega como texto");
  void noEntro;
  void peligrosa;
  assert.deepEqual(splitName("Quiroga, Ana María"), ["Ana María", "Quiroga"]);
  assert.deepEqual(splitName("Rodrigo"), ["Rodrigo", ""]);
});
