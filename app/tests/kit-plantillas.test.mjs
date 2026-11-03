// Las plantillas generan el evento esperado: sus tipos de credencial, lo que trae cada uno, los puestos, y que
// el evento nace gratis y como borrador. Sin red: el contrato de cada entrada lo crea un falso al publicar.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const plantillas = await import("../src/server/kit/plantillas.ts");
const { saveDraft, readDraft, defaultDraft, parseDraftForm, DraftError } = await import("../src/server/kit/borrador.ts");
const { publishEvent } = await import("../src/server/kit/publicar.ts");
const { translate } = await import("../src/i18n/index.ts");

const { TEMPLATES, TEMPLATE_IDS, createEventFromTemplate, templateStations, benefitDef, localToIso, slugify, suggestedStart } = plantillas;
const repo = getRepo();

const datos = (template, extra = {}) => ({
  template,
  lang: "es",
  startsAtLocal: "2026-12-05T09:00",
  place: "Santa Cruz de la Sierra",
  organizerName: "GDG Santa Cruz",
  ...extra,
});

/** Lo que quedó guardado de un evento: los tipos por lugar y, de cada uno, los nombres de sus canjes por orden. */
async function cargar(event) {
  const types = await repo.listTicketTypes(event.id);
  const porLugar = {};
  for (const type of types) {
    const canjes = await repo.listTicketTypeBenefits(type.id);
    porLugar[type.templateSlot] = { type, canjes: canjes.map((c) => c.templateKey), nombres: canjes.map((c) => c.name), indices: canjes.map((c) => c.chainIndex) };
  }
  return { types, porLugar, benefits: await repo.listBenefits(event.id) };
}

test("hay seis plantillas, cada una con su nombre y su descripción en los dos idiomas", () => {
  assert.deepEqual([...TEMPLATE_IDS], ["devfest", "build-with-ai", "iwd", "hackaton", "meetup", "taller"]);
  for (const id of TEMPLATE_IDS) {
    for (const lang of ["es", "en"]) {
      for (const clave of [TEMPLATES[id].nameKey, TEMPLATES[id].descriptionKey]) assert.notEqual(translate(lang, clave), clave, `${lang} ${clave}`);
    }
  }
});

test("DevFest: nace como borrador, gratis, con los tipos y los canjes de siempre", async () => {
  const event = await createEventFromTemplate(repo, datos("devfest", { name: "DevFest Santa Cruz 2026" }));
  assert.equal(event.published, false, "es un borrador");
  assert.equal(event.template, "devfest");
  assert.equal(event.slug, "devfest-santa-cruz-2026");
  assert.equal(event.capacity, 300);
  assert.equal(event.startsAt, "2026-12-05T09:00:00-04:00");
  assert.equal(event.endsAt, "2026-12-05T18:00:00-04:00");
  assert.equal(event.contractId, null, "todavía no tiene contrato");
  assert.equal(event.teamSignup, false);

  const { types, porLugar, benefits } = await cargar(event);
  // Los tipos que la plantilla propone encendidos; la entrada paga y el jurado quedan apagados.
  assert.deepEqual(types.map((t) => t.templateSlot), ["attendee", "speaker", "mentor", "volunteer", "organizer", "sponsor"]);
  assert.deepEqual(types.map((t) => t.credentialKind), ["attendee", "speaker", "mentor", "volunteer", "organizer", "sponsor"]);
  assert.ok(types.every((t) => t.priceUsdc === 0), "todo es gratis por defecto");
  assert.ok(types.every((t) => t.contractId === null));

  // Lo que le toca a cada tipo, numerado de 0 en adelante en el orden de los canjes.
  assert.deepEqual(porLugar.attendee.canjes, ["lunch", "snack", "sponsorCoffee"]);
  assert.deepEqual(porLugar.attendee.indices, [0, 1, 2]);
  assert.deepEqual(porLugar.mentor.canjes, ["lunch", "snack", "dinner"], "la mentoría tiene cena");
  assert.ok(porLugar.speaker.canjes.includes("dinner") && porLugar.speaker.canjes.includes("merch"));
  assert.deepEqual(porLugar.volunteer.canjes, ["lunch", "snack", "staffMerch"], "quien es voluntario tiene su polera de staff");
  assert.ok(!porLugar.attendee.canjes.includes("dinner"), "la cena no es de quien asiste");
  assert.ok(!porLugar.attendee.canjes.includes("merch"), "la polera es de la entrada paga, que viene apagada");

  // El catálogo: solo lo que alguien trae, más el premio del sorteo, que no lo trae nadie.
  const claves = benefits.map((b) => b.templateKey);
  assert.deepEqual(claves, ["lunch", "snack", "dinner", "merch", "staffMerch", "sponsorCoffee", "prize"]);
  const premio = benefits.find((b) => b.templateKey === "prize");
  assert.equal(premio.kind, "prize");
  assert.equal(premio.name, "Premio del sorteo");
  for (const lugar of Object.values(porLugar)) assert.ok(!lugar.canjes.includes("prize"), "el premio no viene con la credencial");
  const almuerzo = benefits.find((b) => b.templateKey === "lunch");
  assert.equal(almuerzo.kind, "lunch");
  assert.equal(almuerzo.station, "Mesa del almuerzo");
});

test("los puestos del escáner salen de los canjes: la puerta y uno por canje", () => {
  const puestos = templateStations(TEMPLATES.devfest, "es");
  assert.equal(puestos[0].name, "Puerta");
  assert.deepEqual(puestos.map((p) => p.name), ["Puerta", "Almuerzo", "Refrigerio", "Cena", "Polera", "Polera de staff", "Café del auspiciante", "Premio del sorteo"]);
  assert.equal(templateStations(TEMPLATES.devfest, "en")[0].name, "Gate");
});

test("la hackatón: dos días con una comida por franja, equipos, jurado y mentoría con cena", async () => {
  const event = await createEventFromTemplate(repo, datos("hackaton", { name: "Hackatón Nacional" }));
  assert.equal(event.teamSignup, true, "se inscribe por equipos");
  assert.equal(event.endsAt, "2026-12-06T15:00:00-04:00", "dura dos días");
  const { types, porLugar, benefits } = await cargar(event);
  assert.deepEqual(types.map((t) => t.templateSlot), ["attendee", "mentor", "judge", "volunteer", "organizer", "sponsor"]);
  assert.equal(types[0].name, "Participante");
  assert.equal(types.find((t) => t.templateSlot === "judge").credentialKind, "judge", "trae la credencial de jurado");

  // Desayuno, almuerzo, refrigerio y cena de cada día: ocho canjes distintos para cada participante.
  assert.equal(porLugar.attendee.canjes.filter((k) => /^(breakfast|lunch|snack|dinner)-\d$/.test(k)).length, 8);
  assert.ok(porLugar.attendee.canjes.includes("breakfast-1") && porLugar.attendee.canjes.includes("dinner-2"));
  assert.deepEqual(porLugar.attendee.indices, porLugar.attendee.canjes.map((_, i) => i));
  assert.ok(porLugar.judge.canjes.includes("dinner-1") && porLugar.judge.canjes.includes("dinner-2"), "el jurado tiene cena");
  assert.ok(porLugar.mentor.canjes.includes("dinner-1"), "la mentoría tiene cena");
  assert.deepEqual(porLugar.volunteer.canjes.slice(-1), ["staffMerch"]);
  const cena2 = benefits.find((b) => b.templateKey === "dinner-2");
  assert.equal(cena2.name, "Cena, día 2");
  assert.equal(cena2.kind, "other");
  assert.equal(benefits.find((b) => b.templateKey === "lunch-1").kind, "lunch");
});

test("las otras plantillas: meetup, taller, Build with AI y Día de la Mujer", async () => {
  for (const id of ["meetup", "taller", "build-with-ai", "iwd"]) {
    const event = await createEventFromTemplate(repo, datos(id));
    const { types, porLugar } = await cargar(event);
    assert.ok(types.length >= 4, id);
    assert.ok(types.every((t) => t.priceUsdc === 0), `${id} es gratis`);
    assert.equal(event.published, false);
    assert.ok(porLugar.attendee.canjes.length >= 1, id);
  }
  const taller = await createEventFromTemplate(repo, datos("taller"));
  assert.equal(taller.capacity, 40);
  assert.equal(benefitDef("merch", "es", "taller").name, "Kit del taller");
  assert.equal(benefitDef("merch", "es", "devfest").name, "Polera");
  const en = await createEventFromTemplate(repo, datos("iwd", { lang: "en" }));
  assert.equal(en.name, "Women's Day (IWD)");
  assert.equal((await cargar(en)).porLugar.mentor.type.name, "Mentor");
});

test("lo pago es opcional: la entrada paga se enciende, se cobra y trae la polera", async () => {
  const event = await createEventFromTemplate(repo, datos("meetup", { name: "Meetup de Bevy" }));
  const draft = await readDraft(repo, event, "es");
  assert.equal(draft.slots.find((s) => s.slot === "attendeePaid").included, false);
  assert.equal(draft.slots.find((s) => s.slot === "attendee").locked, true);

  const input = defaultDraft(TEMPLATES.meetup, "es");
  input.slots.attendeePaid.included = true;
  input.slots.attendeePaid.price = 12.5;
  await saveDraft(repo, event, input, "es");
  const { porLugar } = await cargar(event);
  assert.equal(porLugar.attendeePaid.type.priceUsdc, 12.5);
  assert.equal(porLugar.attendeePaid.type.credentialKind, "attendee");
  assert.ok(porLugar.attendeePaid.canjes.includes("merch"), "trae la polera");
  assert.equal(porLugar.attendee.type.priceUsdc, 0, "la inscripción sigue gratis");

  // Una entrada paga sin precio no se guarda.
  input.slots.attendeePaid.price = 0;
  await assert.rejects(() => saveDraft(repo, event, input, "es"), (e) => e instanceof DraftError && e.code === "price");
});

test("todo se edita antes de publicar: apagar un tipo, renombrar un canje, su puesto y su stock", async () => {
  const event = await createEventFromTemplate(repo, datos("devfest", { name: "DevFest editable" }));
  const input = defaultDraft(TEMPLATES.devfest, "es");
  input.slots.mentor.included = false;
  input.slots.volunteer.name = "Equipo de apoyo";
  input.slots.speaker.benefits = input.slots.speaker.benefits.filter((k) => k !== "dinner");
  input.benefits.lunch = { name: "Almuerzo del sábado", place: "Patio", stock: 250 };
  input.benefits.merch.stock = 150;
  input.slots.attendeePaid.included = true;
  await saveDraft(repo, event, input, "es");

  const { types, porLugar, benefits } = await cargar(event);
  assert.ok(!types.some((t) => t.templateSlot === "mentor"), "el tipo apagado desaparece");
  assert.equal(porLugar.volunteer.type.name, "Equipo de apoyo");
  assert.ok(!porLugar.speaker.canjes.includes("dinner"));
  const almuerzo = benefits.find((b) => b.templateKey === "lunch");
  assert.deepEqual([almuerzo.name, almuerzo.station, almuerzo.stock], ["Almuerzo del sábado", "Patio", 250]);
  assert.equal(benefits.find((b) => b.templateKey === "merch").stock, 150);
  // La cena sigue en el catálogo porque la organización y quienes hablan... la organización la trae.
  assert.ok(benefits.some((b) => b.templateKey === "dinner"));

  // Los números de canje se vuelven a asignar sin huecos.
  for (const lugar of Object.values(porLugar)) assert.deepEqual(lugar.indices, lugar.canjes.map((_, i) => i));

  // Un stock que no es un entero positivo no se guarda.
  input.benefits.merch.stock = 0;
  await assert.rejects(() => saveDraft(repo, event, input, "es"), (e) => e instanceof DraftError && e.code === "stock");
  input.benefits.merch.stock = 1.5;
  await assert.rejects(() => saveDraft(repo, event, input, "es"), (e) => e instanceof DraftError && e.code === "stock");
});

test("el formulario del borrador se lee tal cual lo mandan las casillas", async () => {
  const event = await createEventFromTemplate(repo, datos("hackaton", { name: "Hackatón del formulario" }));
  const form = new FormData();
  form.set("tipo.attendee", "on");
  form.set("nombre.attendee", "Participante");
  form.set("trae.attendee.lunch-1", "on");
  form.set("trae.attendee.lunch-2", "on");
  form.set("tipo.judge", "on");
  form.set("nombre.judge", "Jurado");
  form.set("trae.judge.dinner-1", "on");
  form.set("bnombre.lunch-1", "Almuerzo del viernes");
  form.set("blugar.lunch-1", "Cancha");
  form.set("bstock.lunch-1", "180");
  form.set("bstock.dinner-1", "");
  form.set("bnombre.dinner-1", "Cena");
  form.set("blugar.dinner-1", "Comedor");
  form.set("equipos", "on");
  const input = parseDraftForm(form, TEMPLATES.hackaton);
  await saveDraft(repo, event, input, "es");
  const { types, porLugar, benefits } = await cargar(event);
  assert.deepEqual(types.map((t) => t.templateSlot), ["attendee", "judge"]);
  assert.deepEqual(porLugar.attendee.canjes, ["lunch-1", "lunch-2"]);
  assert.deepEqual(porLugar.judge.canjes, ["dinner-1"]);
  assert.equal(benefits.find((b) => b.templateKey === "lunch-1").stock, 180);
  assert.equal(benefits.find((b) => b.templateKey === "dinner-1").stock, null);
  assert.equal((await repo.getEventById(event.id)).teamSignup, true);
});

test("publicar prepara el contrato de cada entrada y deja el evento a la vista; sin red, con un falso", async () => {
  const event = await createEventFromTemplate(repo, datos("devfest", { name: "DevFest a publicar" }));
  const pedidos = [];
  let n = 0;
  const falso = { deploy: async (spec) => (pedidos.push(spec), `CFALSO${++n}`) };
  const resultado = await publishEvent(repo, event, falso);
  assert.deepEqual(resultado, { ok: true, deployed: 6 });
  assert.equal((await repo.getEventById(event.id)).published, true);
  const types = await repo.listTicketTypes(event.id);
  assert.ok(types.every((t) => /^CFALSO\d$/.test(t.contractId)));
  // Cada contrato se crea con el cupo del evento y con tantos canjes como trae esa entrada.
  const asistente = types.find((t) => t.templateSlot === "attendee");
  const pedidoAsistente = pedidos[types.indexOf(asistente)];
  assert.deepEqual([pedidoAsistente.price, pedidoAsistente.capacity, pedidoAsistente.benefits], [0, 300, 3]);

  // Publicar otra vez no vuelve a crear nada, y un publicado ya no se edita.
  assert.deepEqual(await publishEvent(repo, await repo.getEventById(event.id), falso), { ok: true, deployed: 0 });
  assert.equal(pedidos.length, 6);
  const publicado = await repo.getEventById(event.id);
  await assert.rejects(() => saveDraft(repo, publicado, defaultDraft(TEMPLATES.devfest, "es"), "es"), (e) => e instanceof DraftError && e.code === "published");
});

test("si un contrato falla al publicar, el evento sigue en borrador y lo ya creado queda guardado", async () => {
  const event = await createEventFromTemplate(repo, datos("meetup", { name: "Meetup que falla" }));
  let n = 0;
  const fragil = { deploy: async () => { if (++n === 3) throw new Error("sin saldo"); return `CFRAGIL${n}`; } };
  const primero = await publishEvent(repo, event, fragil);
  assert.deepEqual(primero, { ok: false, reason: "deploy_failed", detail: "sin saldo" });
  assert.equal((await repo.getEventById(event.id)).published, false);
  assert.equal((await repo.listTicketTypes(event.id)).filter((t) => t.contractId).length, 2);
  // El segundo intento sigue desde donde quedó.
  const segundo = await publishEvent(repo, event, fragil);
  assert.equal(segundo.ok, true);
  assert.equal(segundo.deployed, (await repo.listTicketTypes(event.id)).length - 2);
});

test("los datos del formulario se validan y la hora se arma con el desfase de la zona", async () => {
  for (const [campo, malo] of [["name", { name: "ab" }], ["place", { place: "  " }], ["organizer", { organizerName: "" }], ["date", { startsAtLocal: "mañana" }], ["capacity", { capacity: 5000 }]]) {
    await assert.rejects(() => createEventFromTemplate(repo, datos("meetup", malo)), (e) => e.name === "TemplateInputError" && e.field === campo, campo);
  }
  assert.equal(localToIso("2026-11-28T09:00", "America/La_Paz"), "2026-11-28T09:00:00-04:00");
  assert.equal(localToIso("2026-11-28T09:00", "America/Argentina/Buenos_Aires"), "2026-11-28T09:00:00-03:00");
  assert.equal(localToIso("2026-11-28 09:00", "America/La_Paz"), null);
  assert.equal(slugify("Hackatón: ¡Año Nuevo!"), "hackaton-ano-nuevo");
  assert.match(suggestedStart(new Date("2026-11-03T12:00:00Z")), /^2026-11-21T09:00$/);
  // Dos eventos con el mismo nombre no se pisan.
  const a = await createEventFromTemplate(repo, datos("meetup", { name: "Mismo nombre" }));
  const b = await createEventFromTemplate(repo, datos("meetup", { name: "Mismo nombre" }));
  assert.deepEqual([a.slug, b.slug], ["mismo-nombre", "mismo-nombre-2"]);
});
