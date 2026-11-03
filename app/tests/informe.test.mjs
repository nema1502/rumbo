// El informe del evento, los certificados y el paquete para el programa de embajadores, sin red y sin
// XeLaTeX: el escape de LaTeX aguanta cualquier nombre, los datos del informe no llevan personas, los
// contactos del capítulo son solo los de quien marcó la casilla, y la verificación pública de un
// certificado no dice nada sin su código.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { buildEventReportData, arrivalsByHour } = await import("../src/server/informe.ts");
const { buildChapterContactsCsv, listChapterContacts } = await import("../src/server/panel.ts");
const { certificateCode, verifyAttendance } = await import("../src/server/verificacion.ts");
const { signPassId } = await import("../src/server/qr.ts");
const { tex, safeUrl, TexData } = await import("../scripts/lib/latex.mjs");
const { buildInformeTex } = await import("../scripts/lib/informe-pdf.mjs");
const { qrTikzPath } = await import("../scripts/lib/certificado-pdf.mjs");

/** Un pase que entró por la puerta, con su transacción ya en el contrato. */
async function entro(repo, datos, { name, email, hash = "ab".repeat(32), consent = false } = {}) {
  const { person, pass } = await paseDePrueba(repo, datos, { name, email });
  if (consent) await repo.updatePass(pass.id, { contactConsent: true });
  const checkIn = await repo.recordCheckIn({ clientId: `prueba:${pass.id}`, eventId: datos.event.id, passId: pass.id, scannerId: "puerta", scannedAt: "2026-11-22T09:12:00-04:00" });
  await repo.markCheckIn(checkIn.id, { synced: true, txHash: hash });
  await repo.updatePass(pass.id, { status: "checked_in", checkedInAt: "2026-11-22T09:12:00-04:00" });
  return { person, pass: await repo.getPass(pass.id) };
}

test("el escape de LaTeX deja como texto los caracteres especiales", () => {
  assert.equal(tex("DevFest & Co. 100% #1"), "DevFest \\& Co. 100\\% \\#1");
  assert.equal(tex("a_b {c} $5 ~x^ \\y"), "a\\_b \\{c\\} \\$5 \\textasciitilde{}x\\textasciicircum{} \\textbackslash{}y");
  assert.equal(tex("[corchetes]"), "{[}corchetes{]}");
  // Sin ligaduras de TeX ni saltos de línea, ni caracteres de control
  assert.equal(tex("uno--dos ''tres''"), "uno-{}-dos '{}'tres'{}'");
  assert.equal(tex("una\nlínea\u0007 sola"), "una línea sola");
  // El espacio duro (de "79 %") se queda
  assert.equal(tex("79\u00A0%"), "79\u00A0\\%");
});

test("los enlaces van solo http o https y con lo que LaTeX no aguanta ya codificado", () => {
  assert.equal(safeUrl("https://example.com/a b?x={1}|2"), "https://example.com/a%20b?x=%7B1%7D%7C2");
  assert.throws(() => safeUrl("javascript:alert(1)"));
  const d = new TexData().url("sorteo.url", "https://example.com/s?id=a_b&x=100%25#f~1");
  assert.match(String(d), /\\rumbourl\{sorteo\.url\}\|https:\/\/example\.com\/s\?id=a_b&x=100%25#f~1\|/);
  assert.throws(() => new TexData().raw("clave con espacios", "x"));
});

test("los datos del informe salen del panel y no traen nombres ni correos", async () => {
  const repo = getRepo();
  const datos = await eventoDePrueba(repo);
  await entro(repo, datos, { name: "Ana Secreta", email: "ana.secreta@example.com" });
  await entro(repo, datos, { name: "Beto Secreto", email: "beto.secreto@example.com", hash: "cd".repeat(32) });
  await paseDePrueba(repo, datos, { name: "Caro Secreta", email: "caro.secreta@example.com" });
  const data = await buildEventReportData(datos.event, repo);
  assert.equal(data.issued, 3);
  assert.equal(data.checkedIn, 2);
  assert.equal(data.checkInTxs.recorded, 2);
  assert.deepEqual(data.contracts, [{ id: "CPRUEBA", label: datos.ticket.name }]);
  assert.deepEqual(data.arrivals, [{ hour: "09:00", count: 2 }]);
  const json = JSON.stringify(data);
  for (const secreto of ["Secret", "example.com"]) assert.ok(!json.includes(secreto), `el informe trae ${secreto}`);

  const texData = String(buildInformeTex({ ...data, foodSpendUsd: 60, stellarMinutes: 25 }, "es", { now: "2026-11-23T10:00:00-04:00" }));
  assert.match(texData, /\\rumbourl\{tx\.0\}\|https:\/\/stellar\.expert\/explorer\/testnet\/tx\/abab/);
  assert.match(texData, /\\rumbourl\{contrato\.0\}\|https:\/\/stellar\.expert\/explorer\/testnet\/contract\/CPRUEBA\|/);
  assert.match(texData, /\\rumboset\{asistencia\.chip\}\{\\rumboChipPendiente\{Le faltan 18 para el mínimo de 20\}\}/);
  assert.match(texData, /\\rumboset\{gasto\.persona\}\{US\\\$\u00A030\}/);
  assert.ok(!texData.includes("Secret"));
});

test("un ejemplo lo dice y no muestra transacciones aunque las traiga", () => {
  const data = {
    version: 1, example: true, generatedAt: "2026-11-21T23:30:00-04:00", network: "testnet",
    event: { slug: "x", name: "DevFest & Co. 100% #1", community: "Comunidad", startsAt: "2026-11-21T08:30:00-04:00", endsAt: null, timezone: "America/La_Paz", place: "Santa Cruz", venue: null, capacity: null },
    issued: 30, checkedIn: 25, benefits: [], arrivals: [], contracts: [{ id: "CREAL", label: "" }],
    checkInTxs: { recorded: 1, sample: [{ hash: "ff".repeat(32), at: "2026-11-21T09:00:00-04:00" }] }, chainCheck: null,
    stellarMinutes: null, foodSpendUsd: null, sponsor: null, raffle: null,
  };
  const texData = String(buildInformeTex(data, "en"));
  assert.match(texData, /\\rumboset\{ejemplo\}\{1\}/);
  assert.match(texData, /Example with fictitious data/);
  assert.match(texData, /In a real report, the links to each check-in on Stellar go here\./);
  assert.ok(!texData.includes("stellar.expert/explorer"), "un ejemplo no enlaza nada real");
  assert.match(texData, /\\rumboset\{evento\.nombre\}\{DevFest \\& Co\. 100\\% \\#1\}/);
});

test("la llegada por hora no deja huecos y no dibuja eventos de varios días", () => {
  const horas = arrivalsByHour(["2026-11-22T09:05:00-04:00", "2026-11-22T11:50:00-04:00", "2026-11-22T09:59:00-04:00"], "America/La_Paz");
  assert.deepEqual(horas, [{ hour: "09:00", count: 2 }, { hour: "10:00", count: 0 }, { hour: "11:00", count: 1 }]);
  assert.deepEqual(arrivalsByHour(["2026-11-22T09:00:00-04:00", "2026-11-24T09:00:00-04:00"], "America/La_Paz"), []);
});

test("los contactos del capítulo son solo los de quien marcó la casilla, y sin fórmulas", async () => {
  const repo = getRepo();
  const datos = await eventoDePrueba(repo);
  await entro(repo, datos, { name: "Acepta Uno", email: "acepta1@example.com", consent: true });
  await paseDePrueba(repo, datos, { name: "No Acepta", email: "noacepta@example.com" });
  const { pass } = await paseDePrueba(repo, datos, { name: "=HYPERLINK(\"x\")", email: "acepta2@example.com" });
  await repo.updatePass(pass.id, { contactConsent: true });
  // Una inscripción que no terminó no cuenta, aunque haya marcado la casilla.
  const person = await repo.upsertPerson({ name: "Pendiente", email: "pendiente@example.com" });
  const pending = await repo.createPass({ eventId: datos.event.id, personId: person.id, ticketTypeId: datos.ticket.id, status: "pending" });
  await repo.updatePass(pending.id, { contactConsent: true });

  const contacts = await listChapterContacts(datos.event, repo);
  assert.deepEqual(contacts.map((c) => c.email).sort(), ["acepta1@example.com", "acepta2@example.com"]);
  const csv = await buildChapterContactsCsv(datos.event, "es", repo);
  assert.ok(!csv.includes("noacepta@") && !csv.includes("pendiente@"));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")",acepta2@example.com`), csv);
  const marcado = await repo.getPass(pass.id);
  assert.equal(marcado.contactConsent, true);
  assert.ok(marcado.contactConsentAt);
  const desmarcado = await repo.updatePass(pass.id, { contactConsent: false });
  assert.equal(desmarcado.contactConsent, false);
  assert.equal(desmarcado.contactConsentAt, null);
});

test("la verificación de un certificado no dice nada sin su código", async () => {
  const repo = getRepo();
  const datos = await eventoDePrueba(repo);
  const { pass } = await entro(repo, datos, { name: "Valentina Prueba", email: "valentina@example.com" });
  const key = await repo.getEventQrKey(datos.event.id);
  const code = certificateCode(pass.id, key);
  // El código del certificado no es la firma del QR de la credencial: con uno no se arma el otro.
  assert.notEqual(code, signPassId(pass.id, key));

  const ok = await verifyAttendance(pass.id, code, repo);
  assert.equal(ok.found, true);
  assert.equal(ok.checkedIn, true);
  assert.equal(ok.name, "Valentina Prueba");
  assert.equal(ok.txUrl, `https://stellar.expert/explorer/testnet/tx/${"ab".repeat(32)}`);
  assert.equal((await verifyAttendance(pass.id.toLowerCase(), code.toLowerCase(), repo)).found, true);

  for (const malo of [null, "", "A".repeat(16), `${code.slice(0, 15)}A` === code ? `${code.slice(0, 15)}B` : `${code.slice(0, 15)}A`]) {
    assert.deepEqual(await verifyAttendance(pass.id, malo, repo), { found: false });
  }
  assert.deepEqual(await verifyAttendance("NOEXISTE", code, repo), { found: false });

  // Con el código correcto, quien no entró figura como que no entró (la página dice que no hay registro).
  const { pass: otro } = await paseDePrueba(repo, datos, { name: "No Vino", email: "novino@example.com" });
  const nadie = await verifyAttendance(otro.id, certificateCode(otro.id, key), repo);
  assert.equal(nadie.found, true);
  assert.equal(nadie.checkedIn, false);
  assert.equal(nadie.txUrl, null);
});

test("el QR del certificado se dibuja con un rectángulo por tramo de módulos oscuros", () => {
  const { size, path } = qrTikzPath("https://rum.bo/v/ABCDEFGH?c=ABCDEFGHIJKLMNOP");
  assert.ok(size >= 21 && size <= 41, `tamaño ${size}`);
  // El patrón de esquina de arriba a la izquierda: la primera fila empieza con siete módulos oscuros.
  assert.match(path, /^\(0,0\) rectangle \(7,1\)/);
});
