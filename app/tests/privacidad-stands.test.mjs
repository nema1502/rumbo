// Lo que un auspiciante, un código filtrado o un alias malicioso no pueden hacer, sin red: la dieta no viaja a la
// mesa de un regalo, una visita a un stand solo cuenta con el QR auténtico de ese pase, la pantalla en vivo no
// proyecta correos ni teléfonos ni alias con enlaces, quien organiza saca a alguien de la pantalla y cambia el
// código de un stand, la nota no se guarda si el permiso se retiró un instante antes, el logo es una ruta propia y
// las rutas de la API no se caen con un cuerpo JSON que no es un objeto.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
process.env.RUMBO_TRUSTED_IP_HEADER = "x-real-ip";
const { getRepo } = await import("../src/server/repo.ts");
const stands = await import("../src/server/stands.ts");
const { ensureStationCodes, resolveStationCode, getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { buildSnapshot, processScanItems, scanStations, stationOf, parseScanItems, UNKNOWN_PASS, UNVERIFIED_VISIT } = await import("../src/server/escaner.ts");
const { getEventQrKeys } = await import("../src/server/qr-keys.ts");
const { buildPrintedPayload, buildLiveGrant } = await import("../src/server/qr.ts");
const { buildLivePayload } = await import("../src/lib/qr-live.ts");
const { isFoodBenefit } = await import("../src/server/kit/plantillas.ts");
const { isLocalLogoPath } = await import("../src/lib/logo.ts");
const { getDb } = await import("../src/server/base/index.ts");
const { getOrCreateAccessKey } = await import("../src/server/evento/acceso.ts");
const { stationCodeAttempts } = await import("../src/server/limites.ts");
const { getLiveState } = await import("../src/server/vivo.ts");
const rutas = {
  adminStands: await import("../src/app/api/admin/[slug]/stands/route.ts"),
  ruta: await import("../src/app/api/pase/[passId]/ruta/route.ts"),
  contacto: await import("../src/app/api/stand/[codigo]/contacto/route.ts"),
  stand: await import("../src/app/api/stand/[codigo]/route.ts"),
  sync: await import("../src/app/api/scan/sync/route.ts"),
};

const repo = getRepo();
const ahora = () => new Date().toISOString();
const ctx = (params) => ({ params: Promise.resolve(params) });
const noHayRed = {
  checkIn: async () => {
    throw new Error("sin red");
  },
  redeem: async () => {
    throw new Error("sin red");
  },
  outcome: async () => "missing",
};

/** Un evento con tres stands y la meta "visitá 2 de 3", con el código de cada stand ya emitido. */
async function evento({ meta = 2 } = {}) {
  const datos = await eventoDePrueba(repo);
  const lista = [];
  for (const nombre of ["Acme Cloud", "Nube Andina", "Código Abierto"]) lista.push(await stands.createStand(datos.event, { name: nombre }, repo));
  if (meta) await stands.setRouteGoal(datos.event, { target: meta }, repo);
  const codigos = await ensureStationCodes(datos.event, repo);
  const codigoDe = (stand) => codigos.find((c) => c.kind === "stand" && c.standId === stand.id).code;
  return { ...datos, stands: lista, codigos, codigoDe };
}

/** El QR impreso y el del celular de un pase, como los lee un escáner. El del celular, de hace una hora: la cola sube tarde. */
async function qrDe(eventId, passId) {
  const keys = await getEventQrKeys(eventId);
  return { impreso: buildPrintedPayload(passId, keys), vivo: await buildLivePayload(buildLiveGrant(passId, keys), Date.now() - 3_600_000) };
}

const visita = (clientId, passId, qr) => ({ clientId, action: "visit", passId, benefitId: null, scannedAt: ahora(), scannerId: "stand-1", ...(qr ? { qr } : {}) });

// ---------- H-P2: la dieta viaja solo a los puestos de comida ----------

test("la dieta llega a la mesa del almuerzo y del refrigerio del kit, y no a la del regalo de un auspiciante ni al café", async () => {
  const d = await eventoDePrueba(repo);
  const taza = await repo.createBenefit({ eventId: d.event.id, name: "Taza de Acme", kind: "other", station: "Stand de Acme" });
  const refrigerio = await repo.createBenefit({ eventId: d.event.id, name: "Refrigerio", kind: "other", station: "Mesa del refrigerio", templateKey: "snack" });
  const cena2 = await repo.createBenefit({ eventId: d.event.id, name: "Cena, día 2", kind: "other", station: "Mesa de la cena", templateKey: "dinner-2" });
  const cafe = await repo.createBenefit({ eventId: d.event.id, name: "Café del auspiciante", kind: "other", station: "Stand del auspiciante", templateKey: "sponsorCoffee" });
  const polera = await repo.createBenefit({ eventId: d.event.id, name: "Polera", kind: "merch", station: "Stand de merch", templateKey: "merch" });
  for (const [i, b] of [taza, refrigerio, cena2, cafe, polera].entries()) await repo.linkBenefit(d.ticket.id, b.id, i + 1);
  await stands.createStand(d.event, { name: "Acme", benefitId: taza.id }, repo);
  const ana = await paseDePrueba(repo, d, { name: "Ana María Quiroga", email: "ana@example.com" });
  await repo.updatePass(ana.pass.id, { diet: "celíaca, sin gluten" });
  await repo.grantTicketBenefits(ana.pass.id);

  assert.deepEqual([d.lunch, refrigerio, cena2, taza, cafe, polera].map(isFoodBenefit), [true, true, true, false, false, false]);
  const puestos = await scanStations(repo, d.event.id);
  assert.deepEqual(
    Object.fromEntries(puestos.filter((p) => p.kind === "benefit").map((p) => [p.name, p.food])),
    { Almuerzo: true, Refrigerio: true, "Cena, día 2": true, "Taza de Acme": false, "Café del auspiciante": false, Polera: false },
  );

  const codigos = await ensureStationCodes(d.event, repo);
  const dietaEn = async (benefitId) => {
    const codigo = codigos.find((c) => c.kind === "benefit" && c.benefitId === benefitId);
    const foto = await buildSnapshot(repo, await resolveStationCode(codigo.code, repo));
    return foto.passes.find((p) => p.id === ana.pass.id).diet ?? null;
  };
  assert.equal(await dietaEn(d.lunch.id), "celíaca, sin gluten");
  assert.equal(await dietaEn(refrigerio.id), "celíaca, sin gluten");
  assert.equal(await dietaEn(taza.id), null, "la mesa del regalo del auspiciante no recibe la dieta");
  assert.equal(await dietaEn(cafe.id), null);
  assert.equal(await dietaEn(polera.id), null);
  // ni la foto entera de esa mesa lleva la palabra
  const mesaTaza = codigos.find((c) => c.kind === "benefit" && c.benefitId === taza.id);
  assert.ok(!JSON.stringify(await buildSnapshot(repo, await resolveStationCode(mesaTaza.code, repo))).includes("celíaca"));

  // y lo que se puede regalar desde un stand no incluye la comida ni el premio
  await stands.setRouteGoal(d.event, { target: 1 }, repo);
  const regalos = (await stands.getAdminStands(d.event, repo)).benefits.map((b) => b.name).sort();
  assert.deepEqual(regalos, ["Café del auspiciante", "Polera", "Taza de Acme"]);
});

// ---------- H-P3: una visita vale solo con el QR auténtico de ese pase ----------

test("con el código de un stand no se suman visitas por id de pase: hace falta el QR auténtico de ese pase", async () => {
  const d = await evento({ meta: 1 });
  const victima = await paseDePrueba(repo, d, { name: "Nunca Pasó", email: "nunca@example.com" });
  const otra = await paseDePrueba(repo, d, { name: "Otra Persona", email: "otra@example.com" });
  const puesto = stationOf(await resolveStationCode(d.codigoDe(d.stands[0]), repo));
  const qrVictima = await qrDe(d.event.id, victima.pass.id);
  const qrOtra = await qrDe(d.event.id, otra.pass.id);
  const premio = (await stands.getRouteGoal(d.event.id)).prizeBenefitId;

  const falsas = [
    ["sin qr", visita("f-1", victima.pass.id)],
    ["qr de otro pase", visita("f-2", victima.pass.id, qrOtra.impreso)],
    ["qr mal formado", visita("f-3", victima.pass.id, `${victima.pass.id}.ABCDEFG`)],
    ["firma tocada", visita("f-4", victima.pass.id, qrVictima.impreso.slice(0, -1) + (qrVictima.impreso.endsWith("A") ? "B" : "A"))],
    ["id inexistente con el qr de otro", visita("f-5", "AAAAAAAA", qrOtra.vivo)],
  ];
  for (const [nombre, item] of falsas) {
    const [r] = await processScanItems(repo, d.event, puesto, [item], noHayRed);
    assert.deepEqual([r.status, r.error], ["rejected", UNVERIFIED_VISIT], nombre);
  }
  assert.equal((await stands.getStandReport(d.stands[0].id, repo)).visits, 0, "ninguna visita fabricada cuenta");
  assert.ok(!(await repo.listPassBenefits(victima.pass.id)).some((b) => b.id === premio), "y nadie gana el premio de la ruta sin pasar");

  // Las de verdad: el QR impreso, y el del celular aunque su ventana haya pasado hace una hora.
  const [impreso] = await processScanItems(repo, d.event, puesto, [visita("v-1", victima.pass.id, qrVictima.impreso)], noHayRed);
  assert.equal(impreso.status, "synced");
  const puesto1 = stationOf(await resolveStationCode(d.codigoDe(d.stands[1]), repo));
  const [vivo] = await processScanItems(repo, d.event, puesto1, [visita("v-2", victima.pass.id, qrVictima.vivo.toLowerCase())], noHayRed);
  assert.equal(vivo.status, "synced", "el QR del celular vale aunque la cola suba tarde, y en minúsculas");
  assert.equal((await stands.getPassRoute(victima.pass.id, repo)).visited, 2);
  // repetir la misma lectura no duplica
  const [repetida] = await processScanItems(repo, d.event, puesto, [visita("v-1", victima.pass.id, qrVictima.impreso)], noHayRed);
  assert.equal(repetida.status, "synced");
  assert.equal((await stands.getStandReport(d.stands[0].id, repo)).visits, 1);
});

test("la respuesta de la sincronización no cuenta qué pases existen: un mismo mensaje para inexistente, de otro evento, sin activar y sin QR", async () => {
  const d = await evento({ meta: 0 });
  const otro = await evento({ meta: 0 });
  const ok = await paseDePrueba(repo, d, { name: "Valido Uno", email: "v1@example.com" });
  const persona = await repo.upsertPerson({ name: "Pendiente", email: "pend@example.com" });
  const pendiente = await repo.createPass({ eventId: d.event.id, personId: persona.id, ticketTypeId: d.ticket.id, status: "pending" });
  const deOtro = await paseDePrueba(repo, otro, { name: "Otro Evento", email: "oe@example.com" });
  const puesto = stationOf(await resolveStationCode(d.codigoDe(d.stands[0]), repo));
  // Visitas sin QR: todas iguales, exista el pase o no.
  const rs = await processScanItems(repo, d.event, puesto, [visita("o1", ok.pass.id), visita("o2", "AAAAAAAA"), visita("o3", deOtro.pass.id), visita("o4", pendiente.id)], noHayRed);
  assert.deepEqual(
    rs.map((r) => `${r.status}:${r.error}`),
    Array(4).fill(`rejected:${UNVERIFIED_VISIT}`),
  );
  // Entradas en la puerta: un pase que no existe, uno de otro evento y uno sin activar contestan lo mismo.
  const puerta = stationOf(await resolveStationCode(d.codigos.find((c) => c.kind === "gate").code, repo));
  const entrada = (clientId, passId) => ({ clientId, action: "checkin", passId, benefitId: null, scannedAt: ahora(), scannerId: "puerta" });
  const es = await processScanItems(repo, d.event, puerta, [entrada("e1", "AAAAAAAA"), entrada("e2", deOtro.pass.id), entrada("e3", pendiente.id)], noHayRed);
  assert.deepEqual(es.map((r) => `${r.status}:${r.error}`), Array(3).fill(`rejected:${UNKNOWN_PASS}`));
});

test("por la ruta /api/scan/sync la visita viaja con su QR, y parseScanItems acepta el campo", async () => {
  const d = await evento({ meta: 0 });
  await stationCodeAttempts().clear();
  const ana = await paseDePrueba(repo, d, { name: "Ana Quiroga", email: "ana@example.com" });
  const { impreso } = await qrDe(d.event.id, ana.pass.id);
  const code = d.codigoDe(d.stands[0]);
  const post = async (items) => (await rutas.sync.POST(await pedido("http://localhost/api/scan/sync", { ip: "10.0.0.9", body: { code, items } }))).json();
  const sinQr = await post([visita("h-1", ana.pass.id)]);
  assert.deepEqual([sinQr.results[0].status, sinQr.results[0].error], ["rejected", UNVERIFIED_VISIT]);
  const conQr = await post([visita("h-2", ana.pass.id, impreso)]);
  assert.equal(conQr.results[0].status, "synced");
  assert.deepEqual(
    conQr.snapshot.passes.map((p) => p.id),
    [ana.pass.id],
  );
  // La forma: el qr es opcional, se normaliza a mayúsculas y no puede ser más largo que un QR.
  assert.equal(parseScanItems([visita("x", ana.pass.id, impreso.toLowerCase())])[0].qr, impreso);
  assert.equal("qr" in parseScanItems([visita("x", ana.pass.id)])[0], false);
  assert.equal(parseScanItems([visita("x", ana.pass.id, "A".repeat(321))]), null);
});

// ---------- H-P4: el nombre de pila en la pantalla ----------

test("la etiqueta de la pantalla toma el nombre de pila de verdad, y nunca proyecta un correo, un teléfono o un enlace", () => {
  const casos = [
    ["Quiroga Soria, Ana María", "Ana"],
    ["María José Flores", "María"],
    ["O'Brien Patrick", "O'Brien"],
    ["José-Luis Pérez", "José-Luis"],
    ["李小龍", "李小龍"],
    ["Ana‮evil Pérez", "Ana"],
    ["juan.perez@example.com", null],
    ["+591 70012345", null],
    ["70012345", null],
    ["https://wa.me/59170012345", null],
    ["Dr. Pérez", null],
    ["  ", null],
    ["Quiroga, ana.q@example.com", null],
  ];
  for (const [nombre, esperado] of casos) assert.equal(stands.publicLabel(nombre, null), esperado, JSON.stringify(nombre));
  // el alias, si lo hay, manda; y "no aparecer" manda sobre todo
  assert.equal(stands.publicLabel("juan.perez@example.com", { alias: "Juancho", hidden: false }), "Juancho");
  assert.equal(stands.publicLabel("Ana Pérez", { alias: null, hidden: true }), null);
});

// ---------- H-P5: el alias y la moderación ----------

test("un alias no puede ser un correo (ni con arroba de ancho completo), un enlace, un teléfono ni puro aire", () => {
  for (const malo of ["maria@example.com", "maria＠gmail.com", "t.me/estafa", "bit.ly", "https://x.y", "www.algo", "llamame 70012345", "123456"]) {
    assert.throws(() => stands.cleanAlias(malo), (e) => e.code === "invalid_alias", JSON.stringify(malo));
  }
  assert.throws(() => stands.cleanAlias({ a: 1 }), (e) => e.code === "invalid_alias");
  // invisibles: hangul filler, braille en blanco, word joiner, guion blando, etiquetas, selectores de variante
  for (const aire of ["ㅤ", "⠀⠀", "⁠⁠", "­", "\u{e0041}\u{e0042}", "️️", "ᅟᅠﾠ͏؜᠎"]) {
    assert.equal(stands.cleanAlias(aire), null, JSON.stringify(aire));
  }
  assert.equal(stands.cleanAlias("Ana­María"), "Ana María");
  assert.equal(stands.cleanAlias("  Beto   el Bravo "), "Beto el Bravo");
  assert.equal(stands.cleanAlias("Sr. Ana"), "Sr. Ana");
  assert.equal(stands.cleanAlias("Ana2"), "Ana2");
});

test("quien organiza saca a alguien de la pantalla: queda como anónimo, su alias se borra, y solo en su evento", async () => {
  const d = await evento({ meta: 2 });
  const otro = await evento({ meta: 0 });
  const p = await paseDePrueba(repo, d, { name: "Maria Normal", email: "maria@example.com" });
  const ajeno = await paseDePrueba(repo, otro, { name: "De Otro", email: "deotro@example.com" });
  await stands.recordVisit({ standId: d.stands[0].id, passId: p.pass.id }, repo);
  await stands.setDisplay(p.pass.id, { alias: "Staff Rumbo", hidden: false });
  let admin = await stands.getAdminStands(d.event, repo);
  assert.deepEqual(admin.screen.map((r) => [r.rank, r.passId, r.label, r.visited, r.hidden]), [[1, p.pass.id, "Staff Rumbo", 1, false]]);
  assert.equal((await getLiveState(d.event)).route.ranking[0].label, "Staff Rumbo");

  const orgKey = await getOrCreateOrganizerKey(d.event.id);
  const post = async (slug, body) => rutas.adminStands.POST(await pedido(`http://localhost/api/admin/${slug}/stands?k=${orgKey}`, { body }), ctx({ slug }));
  const r = await post(d.event.slug, { action: "hide", passId: p.pass.id.toLowerCase() });
  assert.equal(r.status, 200);
  admin = await r.json();
  assert.deepEqual(admin.screen.map((x) => [x.label, x.hidden]), [[null, true]]);
  assert.equal((await getLiveState(d.event)).route.ranking[0].label, null, "la pantalla lo proyecta como anónimo");
  const ruta = await stands.getPassRoute(p.pass.id, repo);
  assert.deepEqual(ruta.display, { alias: null, hidden: true, shownAs: null }, "el alias se borró");
  // la persona puede volver a aparecer, y lo nuevo pasa por el filtro
  await stands.setDisplay(p.pass.id, { alias: "", hidden: false });
  assert.equal((await getLiveState(d.event)).route.ranking[0].label, "Maria");
  // un pase de otro evento no se toca con esta clave; sin passId es un pedido mal formado
  assert.equal((await post(d.event.slug, { action: "hide", passId: ajeno.pass.id })).status, 404);
  assert.equal((await post(d.event.slug, { action: "hide" })).status, 400);
  assert.equal((await stands.getPassRoute(ajeno.pass.id, repo))?.display.hidden ?? false, false);
});

// ---------- H-P7: el código de un stand se puede cambiar ----------

test("cambiar el código de un stand: el nuevo abre, el viejo deja de abrir el escáner y el panel", async () => {
  const d = await evento({ meta: 0 });
  await stationCodeAttempts().clear();
  const viejo = d.codigoDe(d.stands[0]);
  const orgKey = await getOrCreateOrganizerKey(d.event.id);
  const res = await rutas.adminStands.POST(await pedido(`http://localhost/api/admin/${d.event.slug}/stands?k=${orgKey}`, { body: { action: "regenerate", standId: d.stands[0].id } }), ctx({ slug: d.event.slug }));
  assert.equal(res.status, 200);
  const nuevo = (await res.json()).stands.find((s) => s.id === d.stands[0].id).code;
  assert.ok(nuevo && nuevo !== viejo && /^[A-Z2-7]{12}$/.test(nuevo));
  assert.equal(await resolveStationCode(viejo, repo), null);
  assert.equal((await resolveStationCode(nuevo, repo)).stand.id, d.stands[0].id);
  assert.equal((await stands.authorizeStandCode(viejo, { get: () => null }, repo)).ok, false);
  assert.equal((await stands.authorizeStandCode(nuevo, { get: () => null }, repo)).ok, true);
  const panel = await rutas.stand.GET(await pedido("http://localhost/api/stand/x", { method: "GET", ip: "10.0.0.7" }), ctx({ codigo: viejo }));
  assert.equal(panel.status, 401);
  // los demás códigos quedan como estaban
  assert.equal((await resolveStationCode(d.codigoDe(d.stands[1]), repo)).stand.id, d.stands[1].id);
  // un stand de otro evento no se toca
  const otro = await evento({ meta: 0 });
  const ajeno = await rutas.adminStands.POST(await pedido(`http://localhost/api/admin/${d.event.slug}/stands?k=${orgKey}`, { body: { action: "regenerate", standId: otro.stands[0].id } }), ctx({ slug: d.event.slug }));
  assert.equal(ajeno.status, 404);
  assert.equal((await resolveStationCode(otro.codigoDe(otro.stands[0]), repo)).stand.id, otro.stands[0].id);
});

// ---------- H-P8: retirar el permiso gana siempre ----------

test("una nota que llega justo cuando la persona retira el permiso no queda guardada, y volver a aceptar arranca limpio", async () => {
  const d = await eventoDePrueba(repo);
  const st = await stands.createStand(d.event, { name: "Acme" }, repo);
  const ana = await paseDePrueba(repo, d, { name: "Ana Quiroga", email: "ana@example.com" });
  await stands.recordVisit({ standId: st.id, passId: ana.pass.id }, repo);
  for (let vuelta = 0; vuelta < 12; vuelta++) {
    await stands.answerConsent(ana.pass.id, st.id, "granted");
    const [, nota] = await Promise.allSettled([
      stands.answerConsent(ana.pass.id, st.id, "declined"),
      stands.saveContactNote(st.id, ana.pass.id, { rating: 5, note: `dato sensible ${vuelta}` }),
    ]);
    const fila = await getDb().one("SELECT consent, rating, note FROM stand_visits WHERE stand_id = ? AND pass_id = ?", [st.id, ana.pass.id]);
    assert.equal(fila.consent, "declined");
    assert.deepEqual([fila.rating, fila.note], [null, null], `vuelta ${vuelta}: la nota ${nota.status === "fulfilled" ? "se aceptó" : "se rechazó"} y aun así no puede quedar`);
    if (nota.status === "rejected") assert.equal(nota.reason.code, "no_consent");
    // al volver a aceptar no reaparece nada
    await stands.answerConsent(ana.pass.id, st.id, "granted");
    const panel = await stands.getStandPanel(st.id, repo);
    assert.deepEqual([panel.contacts[0].rating, panel.contacts[0].note], [null, ""]);
    await stands.answerConsent(ana.pass.id, st.id, "declined");
  }
  // decir que sí dos veces seguidas no borra lo que el auspiciante anotó en el medio
  await stands.answerConsent(ana.pass.id, st.id, "granted");
  await stands.saveContactNote(st.id, ana.pass.id, { rating: 4, note: "quiere el SDK" });
  await stands.answerConsent(ana.pass.id, st.id, "granted");
  const panel = await stands.getStandPanel(st.id, repo);
  assert.deepEqual([panel.contacts[0].rating, panel.contacts[0].note], [4, "quiere el SDK"]);
});

// ---------- H-P10: el logo es una ruta propia ----------

test("el logo de un stand es una ruta de esta app: nunca un enlace a otro servidor, ni //host, ni subir carpetas", async () => {
  const d = await evento({ meta: 0 });
  for (const malo of ["https://auspiciante.example/logo.png", "http://x.example/l.svg", "//auspiciante.example/logo.png", "/../etc/x.svg", "/muestra/../x.svg", "javascript:alert(1)", "muestra/logo.svg", "/muestra/logo con espacios.svg"]) {
    assert.equal(isLocalLogoPath(malo), false, malo);
    await assert.rejects(stands.createStand(d.event, { name: "Logo", logoUrl: malo }, repo), (e) => e.code === "invalid_logo", malo);
    await assert.rejects(stands.updateStand(d.stands[0].id, { logoUrl: malo }, repo), (e) => e.code === "invalid_logo", malo);
  }
  const ok = await stands.updateStand(d.stands[0].id, { logoUrl: "/muestra/logo-nube.svg" }, repo);
  assert.equal(ok.logoUrl, "/muestra/logo-nube.svg");
  // lo guardado antes de la regla (un https de afuera) no se muestra en ningún lado
  await getDb().run("UPDATE stands SET logo_url = ? WHERE id = ?", ["https://auspiciante.example/logo.png", d.stands[1].id]);
  assert.equal((await stands.getStand(d.stands[1].id)).logoUrl, null);
  assert.equal((await stands.listStands(d.event.id)).find((s) => s.id === d.stands[1].id).logoUrl, null);
  assert.equal((await resolveStationCode(d.codigoDe(d.stands[1]), repo)).stand.logoUrl, null);
  const p = await paseDePrueba(repo, d, { name: "Ana Prueba" });
  assert.ok(!JSON.stringify(await stands.getPassRoute(p.pass.id, repo)).includes("auspiciante.example"));
  assert.ok(!JSON.stringify(await stands.getAdminStands(d.event, repo)).includes("auspiciante.example"));
});

// ---------- H-P12: cuerpos JSON que no son un objeto ----------

test("un cuerpo JSON que es null o una lista contesta 400 en la ruta de la credencial, la del stand y la de quien organiza", async () => {
  const d = await evento({ meta: 0 });
  await stationCodeAttempts().clear();
  const ana = await paseDePrueba(repo, d, { name: "Ana Quiroga", email: "ana@example.com" });
  const kAna = await getOrCreateAccessKey(ana.pass.id);
  const orgKey = await getOrCreateOrganizerKey(d.event.id);
  const codigo = d.codigoDe(d.stands[0]);
  for (const cuerpo of [null, [], "texto", 7]) {
    const r1 = await rutas.ruta.POST(await pedido("http://localhost/x", { body: cuerpo }), ctx({ passId: ana.pass.id }));
    const r2 = await rutas.contacto.POST(await pedido("http://localhost/x", { body: cuerpo, ip: "10.0.0.8" }), ctx({ codigo }));
    const r3 = await rutas.adminStands.POST(await pedido(`http://localhost/x?k=${orgKey}`, { body: cuerpo }), ctx({ slug: d.event.slug }));
    assert.deepEqual([r1.status, r2.status, r3.status], [400, 400, 400], JSON.stringify(cuerpo));
  }
  // y con un cuerpo bien formado siguen andando
  const ok = await rutas.ruta.POST(await pedido("http://localhost/x", { body: { k: kAna, action: "display", alias: "Anita", hidden: false } }), ctx({ passId: ana.pass.id }));
  assert.equal(ok.status, 200);
  const raro = await rutas.ruta.POST(await pedido("http://localhost/x", { body: { k: kAna, action: "display", alias: { a: 1 }, hidden: "sí" } }), ctx({ passId: ana.pass.id }));
  assert.equal(raro.status, 400);
});
