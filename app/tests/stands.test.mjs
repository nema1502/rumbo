// La ruta de stands y los contactos con permiso, sin red: un sello por persona y stand, la meta y el premio de
// la ruta, el consentimiento (sin aceptar no aparece el contacto), el CSV sin fórmulas, los números del informe,
// el escáner del stand (no recibe la lista de asistentes) y la pantalla en vivo (nunca correos ni apellidos).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo, ClientIdTaken } = await import("../src/server/repo.ts");
const stands = await import("../src/server/stands.ts");
const { ensureStationCodes, resolveStationCode } = await import("../src/server/panel.ts");
const { buildSnapshot, processScanItems, stationOf } = await import("../src/server/escaner.ts");
const { getLiveState, buildRaffleList, raffleListCsv } = await import("../src/server/vivo.ts");
const { decideVerdict } = await import("../src/lib/escaner-api.ts");
const { getEventQrKeys } = await import("../src/server/qr-keys.ts");
const { buildPrintedPayload } = await import("../src/server/qr.ts");

const repo = getRepo();

/** El QR impreso de un pase: una visita a un stand viaja con el QR leído, y el servidor lo vuelve a comprobar. */
const qrImpreso = async (eventId, passId) => buildPrintedPayload(passId, await getEventQrKeys(eventId));

/** La red de mentira: un stand y el premio de la ruta nunca deberían tocarla. */
const noHayRed = {
  checkIn: async () => {
    throw new Error("los stands no usan la red");
  },
  redeem: async () => {
    throw new Error("el premio de la ruta no usa la red");
  },
  outcome: async () => "missing",
};

const ahora = () => new Date().toISOString();
const enSegundos = (s) => new Date(Date.now() + s * 1000).toISOString();

/** Un evento con tres auspiciantes, la meta "visitá 2 de 3" y el código de puesto de cada stand. */
async function evento({ meta = 2 } = {}) {
  const datos = await eventoDePrueba(repo);
  const lista = [];
  for (const nombre of ["Acme Cloud", "Nube Andina", "Código Abierto"]) lista.push(await stands.createStand(datos.event, { name: nombre }, repo));
  if (meta) await stands.setRouteGoal(datos.event, { target: meta }, repo);
  return { ...datos, stands: lista };
}

const visita = (stand, pass, clientId = `v-${Math.random().toString(36).slice(2)}`, scannedAt = ahora()) =>
  stands.recordVisit({ standId: stand.id, passId: pass.id, clientId, scannerId: "stand-1", scannedAt }, repo);

test("un sello por persona y stand: repetir la lectura no suma otra visita", async () => {
  const d = await evento();
  const { pass } = await paseDePrueba(repo, d);
  const primera = await visita(d.stands[0], pass, "lectura-1");
  assert.equal(primera.created, true);
  assert.equal(primera.visited, 1);

  const mismaLectura = await visita(d.stands[0], pass, "lectura-1");
  assert.equal(mismaLectura.created, false);
  const otroCelular = await visita(d.stands[0], pass, "lectura-2");
  assert.equal(otroCelular.created, false);
  assert.equal(otroCelular.visited, 1);
  assert.equal((await stands.getStandReport(d.stands[0].id, repo)).visits, 1);

  // el mismo clientId no se presta a otra persona ni a otro stand
  const { pass: otra } = await paseDePrueba(repo, d, { name: "Beto Prueba" });
  await assert.rejects(visita(d.stands[0], otra, "lectura-1"), ClientIdTaken);
  await assert.rejects(visita(d.stands[1], pass, "lectura-1"), ClientIdTaken);

  // otra persona sí suma el suyo, y el mismo pase en otro stand también
  assert.equal((await visita(d.stands[0], otra)).visited, 1);
  assert.equal((await visita(d.stands[1], pass)).visited, 2);
});

test("un pase pendiente o de otro evento no suma sellos", async () => {
  const d = await evento();
  const otro = await evento();
  const person = await repo.upsertPerson({ name: "Pendiente Prueba", email: "pendiente@example.com" });
  const pendiente = await repo.createPass({ eventId: d.event.id, personId: person.id, ticketTypeId: d.ticket.id, status: "pending" });
  await assert.rejects(visita(d.stands[0], pendiente), (e) => e.code === "not_found");
  const { pass } = await paseDePrueba(repo, d);
  await assert.rejects(visita(otro.stands[0], pass), (e) => e.code === "not_found");
});

test("la meta de la ruta: al llegar, el premio pasa a la credencial y se canjea una sola vez en Premios", async () => {
  const d = await evento({ meta: 2 });
  const { pass } = await paseDePrueba(repo, d);
  const premio = (await stands.getRouteGoal(d.event.id)).prizeBenefitId;
  assert.ok(premio, "fijar la meta crea el premio de la ruta");
  assert.equal((await repo.getBenefit(premio)).kind, "prize");

  let ruta = await stands.getPassRoute(pass.id, repo);
  assert.deepEqual([ruta.visited, ruta.target, ruta.total, ruta.completed, ruta.prize.granted], [0, 2, 3, false, false]);

  const una = await visita(d.stands[0], pass);
  assert.equal(una.completed, false);
  assert.equal((await repo.listPassBenefits(pass.id)).some((b) => b.id === premio), false, "con una visita todavía no hay premio");

  const dos = await visita(d.stands[1], pass);
  assert.deepEqual([dos.completed, dos.completedNow], [true, true]);
  assert.ok((await repo.listPassBenefits(pass.id)).some((b) => b.id === premio), "con la meta cumplida el premio está en la credencial");
  const tercera = await visita(d.stands[2], pass);
  assert.deepEqual([tercera.completed, tercera.completedNow], [true, false], "pasar de la meta no lo vuelve a otorgar");
  assert.equal((await repo.listPassBenefits(pass.id)).filter((b) => b.id === premio).length, 1);

  ruta = await stands.getPassRoute(pass.id, repo);
  assert.deepEqual([ruta.visited, ruta.completed, ruta.prize.granted, ruta.prize.redeemed], [3, true, true, false]);

  // en el puesto de Premios (sin pasar por el contrato)
  const puesto = { id: premio, kind: "benefit", name: "Premio de la ruta", place: "Premios" };
  const canje = (clientId) => ({ clientId, action: "redeem", passId: pass.id, benefitId: premio, scannedAt: ahora(), scannerId: "premios-1" });
  const [primero] = await processScanItems(repo, d.event, puesto, [canje("p-1")], noHayRed);
  assert.equal(primero.status, "synced");
  const [segundo] = await processScanItems(repo, d.event, puesto, [canje("p-2")], noHayRed);
  assert.equal(segundo.status, "duplicate", "el segundo canje, aunque venga de otro escáner, es un doble");
  const [mismo] = await processScanItems(repo, d.event, puesto, [canje("p-1")], noHayRed);
  assert.equal(mismo.status, "synced", "reintentar el primero no lo duplica");
  assert.equal((await stands.getPassRoute(pass.id, repo)).prize.redeemed, true);
});

test("el premio de la ruta no se canjea sin haberlo ganado", async () => {
  const d = await evento({ meta: 2 });
  const { pass } = await paseDePrueba(repo, d);
  await visita(d.stands[0], pass);
  const premio = (await stands.getRouteGoal(d.event.id)).prizeBenefitId;
  const puesto = { id: premio, kind: "benefit", name: "Premio de la ruta", place: "Premios" };
  const [r] = await processScanItems(repo, d.event, puesto, [{ clientId: "sin-premio", action: "redeem", passId: pass.id, benefitId: premio, scannedAt: ahora(), scannerId: "x" }], noHayRed);
  assert.deepEqual([r.status, r.error], ["rejected", "la credencial todavía no ganó este premio"]);
  assert.equal((await repo.listRedemptionsForPass(pass.id)).length, 0, "no queda ningún canje");
});

test("la meta nunca pide más stands de los que hay, y subirla a quien ya la cumple le da el premio", async () => {
  const d = await evento({ meta: 3 });
  const { pass } = await paseDePrueba(repo, d);
  await visita(d.stands[0], pass);
  await visita(d.stands[1], pass);
  const premio = (await stands.getRouteGoal(d.event.id)).prizeBenefitId;
  assert.equal((await repo.listPassBenefits(pass.id)).some((b) => b.id === premio), false);
  // se saca un stand: la meta efectiva baja a 2
  await stands.deleteStand(d.stands[2].id);
  assert.equal(stands.effectiveTarget(await stands.getRouteGoal(d.event.id), (await stands.listStands(d.event.id)).length), 2);
  await stands.grantRoutePrizes(d.event.id, repo);
  assert.ok((await repo.listPassBenefits(pass.id)).some((b) => b.id === premio));
  // y la meta no se puede fijar fuera de rango
  await assert.rejects(stands.setRouteGoal(d.event, { target: 0 }, repo), (e) => e.code === "invalid_target");
  await assert.rejects(stands.setRouteGoal(d.event, { target: 5 }, repo), (e) => e.code === "invalid_target");
  await assert.rejects(stands.setRouteGoal(d.event, { target: 1.5 }, repo), (e) => e.code === "invalid_target");
});

test("el consentimiento: sin aceptar no aparece el contacto; aceptar lo muestra y dejar de compartir lo saca", async () => {
  const d = await evento();
  const { pass, person } = await paseDePrueba(repo, d, { name: "Ana María Quiroga", email: "ana.quiroga@example.com" });
  await visita(d.stands[0], pass);

  // sin responder: el auspiciante cuenta la visita y nada más
  let panel = await stands.getStandPanel(d.stands[0].id, repo);
  assert.deepEqual(panel.numbers, { visits: 1, accepted: 0, waiting: 1, declined: 0 });
  assert.deepEqual(panel.contacts, []);
  assert.ok(!JSON.stringify(panel).includes("ana.quiroga@example.com"));
  assert.ok(!JSON.stringify(panel).includes("Quiroga"));
  assert.equal(await stands.buildContactsCsv(d.stands[0].id, "es", repo), "\ufeffnombre,correo,calificación,nota,visita\r\n");
  assert.equal((await stands.getPassRoute(pass.id, repo)).stands[0].consent, "pending");

  // y no se puede anotar nada de quien no aceptó
  await assert.rejects(() => stands.saveContactNote(d.stands[0].id, pass.id, { rating: 5 }), (e) => e.code === "no_consent");

  // decir que no tampoco muestra nada
  await stands.answerConsent(pass.id, d.stands[0].id, "declined");
  panel = await stands.getStandPanel(d.stands[0].id, repo);
  assert.deepEqual([panel.numbers.accepted, panel.numbers.declined, panel.contacts.length], [0, 1, 0]);

  // aceptar: ahora sí, con nombre y correo
  await stands.answerConsent(pass.id, d.stands[0].id, "granted");
  panel = await stands.getStandPanel(d.stands[0].id, repo);
  assert.deepEqual([panel.numbers.accepted, panel.contacts.length], [1, 1]);
  assert.deepEqual([panel.contacts[0].name, panel.contacts[0].email], ["Ana María Quiroga", "ana.quiroga@example.com"]);

  // quien atiende el stand la califica y anota
  await stands.saveContactNote(d.stands[0].id, pass.id, { rating: 4, note: "Quiere probar el SDK  \n la semana que viene" });
  panel = await stands.getStandPanel(d.stands[0].id, repo);
  assert.deepEqual([panel.contacts[0].rating, panel.contacts[0].note], [4, "Quiere probar el SDK la semana que viene"]);
  await assert.rejects(() => stands.saveContactNote(d.stands[0].id, pass.id, { rating: 6 }), (e) => e.code === "invalid_rating");
  await assert.rejects(() => stands.saveContactNote(d.stands[0].id, pass.id, { rating: 2.5 }), (e) => e.code === "invalid_rating");

  // un auspiciante no ve los contactos de otro stand
  assert.deepEqual((await stands.getStandPanel(d.stands[1].id, repo)).contacts, []);

  // dejar de compartir saca el contacto y borra la calificación y la nota
  await stands.answerConsent(pass.id, d.stands[0].id, "declined");
  panel = await stands.getStandPanel(d.stands[0].id, repo);
  assert.deepEqual(panel.contacts, []);
  await stands.answerConsent(pass.id, d.stands[0].id, "granted");
  panel = await stands.getStandPanel(d.stands[0].id, repo);
  assert.deepEqual([panel.contacts[0].rating, panel.contacts[0].note], [null, ""]);

  // la respuesta exige una visita y una de las dos palabras
  await assert.rejects(() => stands.answerConsent(pass.id, d.stands[1].id, "granted"), (e) => e.code === "no_visit");
  await assert.rejects(() => stands.answerConsent(pass.id, d.stands[0].id, "maybe"), (e) => e.code === "invalid_answer");
  await assert.rejects(() => stands.answerConsent(pass.id, d.stands[0].id, undefined), (e) => e.code === "invalid_answer");
  assert.equal(person.email, "ana.quiroga@example.com");
});

test("el CSV del auspiciante no deja fórmulas, y solo trae a quienes aceptaron", async () => {
  const d = await evento();
  const malo = await paseDePrueba(repo, d, { name: '=HYPERLINK("http://malo.example","clic")', email: "=1+1@example.com" });
  const bueno = await paseDePrueba(repo, d, { name: "Beto Prueba", email: "beto@example.com" });
  const calla = await paseDePrueba(repo, d, { name: "Caro Callada", email: "caro@example.com" });
  for (const { pass } of [malo, bueno, calla]) await visita(d.stands[0], pass);
  await stands.answerConsent(malo.pass.id, d.stands[0].id, "granted");
  await stands.answerConsent(bueno.pass.id, d.stands[0].id, "granted");
  await stands.saveContactNote(d.stands[0].id, malo.pass.id, { rating: 3, note: "=cmd|' /C calc'!A0" });
  await stands.saveContactNote(d.stands[0].id, bueno.pass.id, { note: "+54 9 11, vendedor" });

  const csv = await stands.buildContactsCsv(d.stands[0].id, "es", repo);
  const filas = csv.replace(/^\ufeff/, "").trim().split("\r\n");
  assert.equal(filas.length, 3, "el encabezado y los dos que aceptaron");
  assert.ok(!csv.includes("caro@example.com") && !csv.includes("Caro"), "quien no contestó no sale");
  assert.ok(csv.includes(`"'=HYPERLINK(""http://malo.example"",""clic"")"`), csv);
  assert.ok(csv.includes(",'=1+1@example.com,"), csv);
  assert.ok(csv.includes(`'=cmd|' /C calc'!A0`), csv);
  assert.ok(csv.includes(`"'+54 9 11, vendedor"`), csv);
  for (const fila of filas) {
    for (const celda of fila.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, ""))) {
      assert.ok(!/^[=+\-@\t\r]/.test(celda), `celda con fórmula: ${celda}`);
    }
  }
  assert.ok((await stands.buildContactsCsv(d.stands[0].id, "en", repo)).startsWith("\ufeffname,email,rating,note,visit\r\n"));
});

test("el informe del auspiciante: visitas, canjes de su beneficio, contactos y ruta completada, solo números", async () => {
  const d = await evento({ meta: 2 });
  const polera = await repo.createBenefit({ eventId: d.event.id, name: "Polera de Acme", kind: "merch", station: "Stand de Acme" });
  await stands.updateStand(d.stands[0].id, { benefitId: polera.id }, repo);
  const gente = [];
  for (const nombre of ["Uno", "Dos", "Tres", "Cuatro"]) gente.push((await paseDePrueba(repo, d, { name: `${nombre} Prueba` })).pass);
  // Uno y Dos completan la ruta (Acme y Nube); Tres solo pasa por Acme; Cuatro por Código Abierto
  await visita(d.stands[0], gente[0]);
  await visita(d.stands[1], gente[0]);
  await visita(d.stands[0], gente[1]);
  await visita(d.stands[1], gente[1]);
  await visita(d.stands[0], gente[2]);
  await visita(d.stands[2], gente[3]);
  await stands.answerConsent(gente[0].id, d.stands[0].id, "granted");
  await stands.answerConsent(gente[1].id, d.stands[0].id, "granted");
  await stands.answerConsent(gente[2].id, d.stands[0].id, "declined");
  // dos canjes de la polera (uno doble no cuenta) y los otorgados
  await repo.grantBenefit(gente[0].id, polera.id, "manual");
  await repo.grantBenefit(gente[1].id, polera.id, "manual");
  await repo.grantBenefit(gente[2].id, polera.id, "manual");
  await repo.recordRedemption({ clientId: "r1", eventId: d.event.id, passId: gente[0].id, benefitId: polera.id });
  const doble = await repo.recordRedemption({ clientId: "r2", eventId: d.event.id, passId: gente[0].id, benefitId: polera.id });
  await repo.markRedemption(doble.id, { duplicate: true });

  const informe = await stands.getEventStandsReport(d.event, repo);
  const acme = informe.stands.find((s) => s.name === "Acme Cloud");
  assert.deepEqual(
    [acme.visits, acme.contactsAccepted, acme.contactsDeclined, acme.contactsWaiting, acme.routeCompleted],
    [3, 2, 1, 0, 2],
  );
  assert.deepEqual(acme.benefit, { id: polera.id, name: "Polera de Acme", granted: 3, redeemed: 1 });
  const nube = informe.stands.find((s) => s.name === "Nube Andina");
  assert.deepEqual([nube.visits, nube.contactsAccepted, nube.contactsWaiting, nube.routeCompleted, nube.benefit], [2, 0, 2, 2, null]);
  assert.deepEqual(
    [informe.route.target, informe.route.standCount, informe.route.participants, informe.route.completed],
    [2, 3, 4, 2],
  );
  assert.deepEqual([informe.route.prize.granted, informe.route.prize.redeemed], [2, 0]);
  // solo números: ni nombres de personas ni correos
  const texto = JSON.stringify(informe);
  assert.ok(!/@example\.com|Prueba/.test(texto), "el informe no lleva personas");
  assert.deepEqual((await stands.getStandReport(d.stands[0].id, repo)).visits, 3);
});

test("el escáner del stand: su código abre su stand, no recibe la lista de asistentes y solo suma visitas", async () => {
  const d = await evento();
  const a = await paseDePrueba(repo, d, { name: "Ana Quiroga", email: "ana@example.com" });
  const b = await paseDePrueba(repo, d, { name: "Beto Soria", email: "beto@example.com" });
  await paseDePrueba(repo, d, { name: "Carla Nunca", email: "carla@example.com" });
  const codigos = await ensureStationCodes(d.event, repo);
  const codigo = codigos.find((c) => c.kind === "stand" && c.standId === d.stands[0].id);
  assert.ok(codigo, "cada stand tiene su código de puesto");
  assert.equal(codigos.filter((c) => c.kind === "stand").length, 3);

  const acceso = await resolveStationCode(codigo.code, repo);
  assert.equal(acceso.kind, "stand");
  assert.equal(acceso.stand.name, "Acme Cloud");
  const puesto = stationOf(acceso);
  assert.deepEqual([puesto.id, puesto.kind, puesto.name], [d.stands[0].id, "stand", "Acme Cloud"]);

  // antes de que pase nadie, no hay lista de asistentes
  let foto = await buildSnapshot(repo, acceso);
  assert.deepEqual(foto.passes, []);
  assert.deepEqual(foto.stand.visits, []);

  const qr = { [a.pass.id]: await qrImpreso(d.event.id, a.pass.id), [b.pass.id]: await qrImpreso(d.event.id, b.pass.id) };
  const item = (clientId, pass, action = "visit") => ({ clientId, action, passId: pass.id, benefitId: null, scannedAt: ahora(), scannerId: "stand-1", qr: qr[pass.id] });
  const resultados = await processScanItems(repo, d.event, puesto, [item("s-1", a.pass), item("s-2", b.pass), item("s-1", a.pass), item("s-3", a.pass, "checkin")], noHayRed);
  assert.deepEqual(
    resultados.filter((r) => r.clientId !== "s-3").map((r) => r.status),
    ["synced", "synced", "synced"],
  );
  assert.deepEqual(resultados.find((r) => r.clientId === "s-3"), { clientId: "s-3", status: "rejected", txHash: null, error: "fuera del puesto" }, "un stand no registra entradas");
  assert.equal((await stands.getStandReport(d.stands[0].id, repo)).visits, 2, "dos personas, un sello cada una");

  await stands.answerConsent(a.pass.id, d.stands[0].id, "granted");
  foto = await buildSnapshot(repo, acceso);
  assert.deepEqual(foto.passes.map((p) => p.id).sort(), [a.pass.id, b.pass.id].sort(), "solo quienes ya pasaron");
  const nombres = Object.fromEntries(foto.stand.visits.map((v) => [v.passId, v.name]));
  assert.deepEqual(nombres, { [a.pass.id]: "Ana Quiroga", [b.pass.id]: null }, "el nombre solo de quien aceptó");
  const json = JSON.stringify(foto);
  assert.ok(!json.includes("Carla") && !json.includes("Soria") && !json.includes("@example.com"));
  // cada pase del escáner del stand solo sabe de su propio stand
  assert.deepEqual(Object.keys(foto.passes[0].visited), [d.stands[0].id]);

  // la puerta o una mesa no abren un stand
  const puerta = codigos.find((c) => c.kind === "gate");
  const { authorizeStandCode } = stands;
  assert.equal((await authorizeStandCode(puerta.code, { get: () => null }, repo)).ok, false);
  assert.equal((await authorizeStandCode(codigo.code, { get: () => null }, repo)).ok, true);
});

test("el veredicto en un stand: visita nueva, y 'ya visitó' por lo que sabía el servidor o por lo que registró este celular", () => {
  const stand = { id: "stand-1", kind: "stand", name: "Acme Cloud", place: null };
  const bien = { ok: true, passId: "ABCD2345" };
  // Quien auspicia no ve la credencial, el equipo ni la dieta de nadie.
  const nadie = { credential: null, team: null, diet: null };
  assert.deepEqual(decideVerdict(bien, stand, undefined, undefined), { kind: "ok", action: "visit", passId: "ABCD2345", name: null, ...nadie });
  const servidor = { id: "ABCD2345", name: "", benefits: [], checkedInAt: null, redeemed: {}, visited: { "stand-1": "2026-11-22T10:00:00.000Z" } };
  assert.equal(decideVerdict(bien, stand, servidor, undefined).kind, "already");
  const local = { checkedInAt: null, redeemed: {}, visited: { "stand-1": "2026-11-22T10:01:00.000Z" } };
  assert.equal(decideVerdict(bien, stand, undefined, local).kind, "already");
  // la visita a otro stand no cuenta, y una firma mala no suma nada
  assert.equal(decideVerdict(bien, stand, { ...servidor, visited: { "stand-2": "2026-11-22T10:00:00.000Z" } }, undefined).kind, "ok");
  assert.deepEqual(decideVerdict({ ok: false, reason: "bad_signature" }, stand, undefined, undefined), { kind: "no", reason: "invalid", passId: null, name: null, ...nadie });
});

test("la pantalla en vivo: cuenta lo que pasó, y el ranking usa nombre de pila o alias, nunca correos ni apellidos", async () => {
  const d = await evento({ meta: 2 });
  const lunch = d.lunch;
  const gente = [];
  for (const [nombre, correo] of [["Ana María Quiroga", "ana@example.com"], ["Beto Soria", "beto@example.com"], ["Carla Nunca", "carla@example.com"], ["Dani Oculto", "dani@example.com"]]) {
    gente.push((await paseDePrueba(repo, d, { name: nombre, email: correo })).pass);
  }
  for (const pass of gente.slice(0, 3)) await repo.updatePass(pass.id, { status: "checked_in" });
  await repo.recordRedemption({ clientId: "al-1", eventId: d.event.id, passId: gente[0].id, benefitId: lunch.id });
  await repo.recordRedemption({ clientId: "al-2", eventId: d.event.id, passId: gente[1].id, benefitId: lunch.id });

  // Ana completa la ruta primero, Beto y Dani llevan uno; Dani pidió no aparecer; Beto eligió un alias
  await visita(d.stands[0], gente[0], undefined, enSegundos(-30));
  await visita(d.stands[1], gente[0], undefined, enSegundos(-20));
  await visita(d.stands[0], gente[1], undefined, enSegundos(-10));
  await visita(d.stands[0], gente[3], undefined, enSegundos(-5));
  await stands.setDisplay(gente[1].id, { alias: "  Beto   el Bravo ", hidden: false });
  await stands.setDisplay(gente[3].id, { alias: null, hidden: true });

  const vivo = await getLiveState(d.event);
  assert.deepEqual([vivo.issued, vivo.entered, vivo.raffle.eligible], [4, 3, 3]);
  assert.deepEqual(vivo.lunch, { delivered: 2, granted: 4 });
  assert.deepEqual(vivo.merch, { delivered: 0, granted: 0 });
  assert.deepEqual([vivo.route.enabled, vivo.route.target, vivo.route.standCount, vivo.route.completed], [true, 2, 3, 1]);
  assert.deepEqual(
    vivo.route.ranking.map((r) => [r.rank, r.label, r.visited, r.completed]),
    [
      [1, "Ana", 2, true],
      [2, "Beto el Bravo", 1, false],
      [3, null, 1, false],
    ],
  );
  const texto = JSON.stringify(vivo);
  assert.ok(!/@example\.com|Quiroga|Soria|Nunca|Oculto/.test(texto), "la pantalla no lleva correos ni apellidos");

  // un alias que parece un correo no vale
  await assert.rejects(() => stands.setDisplay(gente[2].id, { alias: "carla@example.com" }), (e) => e.code === "invalid_alias");
  // y se limita el largo y se limpian los controles
  assert.equal(stands.cleanAlias("A\u202eB\u0000C".padEnd(40, "x")).length <= 20, true);
  assert.equal(stands.cleanAlias("   "), null);
  assert.equal((await stands.getPassRoute(gente[1].id, repo)).display.shownAs, "Beto el Bravo");
  assert.equal((await stands.getPassRoute(gente[3].id, repo)).display.shownAs, null);
});

test("la lista del sorteo: solo códigos de quienes entraron, siempre ordenada, con su huella", async () => {
  const d = await evento();
  const entraron = [];
  for (const nombre of ["Zoe", "Ana", "Mia"]) {
    const { pass } = await paseDePrueba(repo, d, { name: `${nombre} Sorteo`, email: `${nombre.toLowerCase()}@example.com` });
    entraron.push(pass);
  }
  const queda = (await paseDePrueba(repo, d, { name: "Nadie Sorteo" })).pass;
  for (const pass of entraron) await repo.updatePass(pass.id, { status: "checked_in" });

  const lista = await buildRaffleList(d.event);
  assert.equal(lista.total, 3);
  assert.deepEqual(lista.participants, entraron.map((p) => p.id).sort());
  assert.ok(!lista.participants.includes(queda.id), "quien no entró no participa");
  assert.equal(lista.sha256, createHash("sha256").update(lista.participants.join("\n")).digest("hex"));
  assert.equal((await buildRaffleList(d.event)).sha256, lista.sha256, "la misma lista da siempre la misma huella");
  assert.ok(!/@example\.com|Sorteo/.test(JSON.stringify(lista)), "sin nombres ni correos");
  const csv = raffleListCsv(lista);
  assert.equal(csv.split("\r\n")[0], "n,pass_id");
  assert.equal(csv.trim().split("\r\n").length, 4);
});

test("los datos del stand se limpian: nombre, logo y beneficio", async () => {
  const d = await evento({ meta: 0 });
  await assert.rejects(stands.createStand(d.event, { name: "   " }, repo), (e) => e.code === "invalid_name");
  await assert.rejects(stands.createStand(d.event, { name: "Sin logo", logoUrl: "javascript:alert(1)" }, repo), (e) => e.code === "invalid_logo");
  await assert.rejects(stands.createStand(d.event, { name: "Sin logo", logoUrl: "http://inseguro.example/logo.png" }, repo), (e) => e.code === "invalid_logo");
  await assert.rejects(stands.createStand(d.event, { name: "Beneficio ajeno", benefitId: "no-existe" }, repo), (e) => e.code === "invalid_benefit");
  const otro = await eventoDePrueba(repo);
  await assert.rejects(stands.createStand(d.event, { name: "De otro evento", benefitId: otro.lunch.id }, repo), (e) => e.code === "invalid_benefit");
  const ok = await stands.createStand(d.event, { name: "  Con   espacios \u202e raros ", logoUrl: "https://ejemplo.example/logo.svg" }, repo);
  assert.equal(ok.name, "Con espacios raros");
  assert.equal(ok.logoUrl, "https://ejemplo.example/logo.svg");
  const propio = await stands.createStand(d.event, { name: "Logo propio", logoUrl: "/muestra/logo.svg" }, repo);
  assert.equal(propio.logoUrl, "/muestra/logo.svg");
  await assert.rejects(stands.setRouteGoal(await eventoDePrueba(repo).then((x) => x.event), { target: 1 }, repo), (e) => e.code === "no_stands");
});
