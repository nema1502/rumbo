// Los certificados con nombres que la fuente propia no puede escribir, y el informe con los números de los stands,
// sin XeLaTeX: qué letras cubre Bricolage Grotesque según su propia tabla cmap, qué fuente de respaldo se elige y
// cómo se declara en LaTeX, que XeLaTeX corre sin shell, y que el informe toma los stands y los contactos del
// auspiciante de la base en vez de la línea de comandos.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const stands = await import("../src/server/stands.ts");
const { buildEventReportData } = await import("../src/server/informe.ts");
const { INFORMES_DIR, TexData } = await import("../scripts/lib/latex.mjs");
const { applyOrganizerInput, buildInformeTex } = await import("../scripts/lib/informe-pdf.mjs");
const { buildCertificadoTex } = await import("../scripts/lib/certificado-pdf.mjs");
const { chooseNameFonts, fallbackFontLine, findFallbackFont, readFontCoverage } = await import("../scripts/lib/fuentes.mjs");

const repo = getRepo();
const BRICOLAGE = join(INFORMES_DIR, "fuentes", "BricolageGrotesque96pt-Bold.ttf");
const INTER = join(INFORMES_DIR, "fuentes", "Inter-Regular.ttf");

test("la cobertura de una fuente se lee de su tabla cmap: Bricolage es latina, Inter además cirílica y griega", () => {
  const bricolage = readFontCoverage(BRICOLAGE);
  assert.ok(bricolage.size > 200);
  assert.deepEqual(bricolage.missing("Ana María Quiroga Ñandú Zoë O'Brien José-Luis"), []);
  assert.deepEqual(bricolage.missing("Дмитрий Иванов"), [..."Дмитрй Иванов".replace(/\s/g, "")].filter((c, i, a) => a.indexOf(c) === i));
  assert.ok(bricolage.missing("李小龍").length === 3);
  assert.ok(bricolage.missing("Νίκος").length > 0);
  // los espacios, los controles y las marcas combinantes no cuentan como letras que faltan
  assert.deepEqual(bricolage.missing("  Ana\u200b\u202e Pérez\n"), []);
  const inter = readFontCoverage(INTER);
  assert.deepEqual(inter.missing("Дмитрий Иванов Νίκος"), []);
  assert.ok(inter.missing("李小龍").length === 3);
  assert.throws(() => readFontCoverage(join(INFORMES_DIR, "textos.json")), /cmap/);
});

test("qué fuente lleva cada nombre: la propia si alcanza, la de respaldo si no, y una lista clara de a quién no escribe ninguna", () => {
  const ownCoverage = readFontCoverage(BRICOLAGE);
  const fallbackCoverage = readFontCoverage(INTER);
  const fallback = { name: "Inter", file: INTER, bold: null };
  const gente = [
    { passId: "AAAAAAAA", name: "Ana Pérez" },
    { passId: "BBBBBBBB", name: "Дмитрий Иванов" },
    { passId: "CCCCCCCC", name: "李小龍" },
  ];
  const con = chooseNameFonts(gente, { ownCoverage, fallback, fallbackCoverage });
  assert.deepEqual([con.fonts.get("AAAAAAAA"), con.fonts.get("BBBBBBBB"), con.fonts.get("CCCCCCCC")], [null, fallback, fallback]);
  assert.deepEqual(con.unwritable, [{ passId: "CCCCCCCC", name: "李小龍", letters: ["李", "小", "龍"] }]);
  const sin = chooseNameFonts(gente, { ownCoverage, fallback: null, fallbackCoverage: null });
  assert.deepEqual(sin.unwritable.map((u) => u.passId), ["BBBBBBBB", "CCCCCCCC"]);
  assert.equal(sin.fonts.get("BBBBBBBB"), null);
  // sin el archivo de la fuente de respaldo no se sabe qué cubre: se usa igual y no se acusa a nadie
  const aCiegas = chooseNameFonts(gente, { ownCoverage, fallback: { name: "Otra", file: null, bold: null }, fallbackCoverage: null });
  assert.deepEqual(aCiegas.unwritable, []);
});

test("la fuente de respaldo se declara por archivo (con su negrita si está al lado) o por nombre, y el nombre no se puede colar en LaTeX", () => {
  assert.equal(fallbackFontLine({ name: "Inter", file: "C:\\Windows\\Fonts\\segoeui.ttf", bold: "C:\\Windows\\Fonts\\segoeuib.ttf" }), "\\newfontfamily\\rumboNombreRespaldo[Path={C:/Windows/Fonts/}, BoldFont={segoeuib.ttf}]{segoeui.ttf}");
  assert.equal(fallbackFontLine({ name: "Inter", file: INTER, bold: null }), `\\newfontfamily\\rumboNombreRespaldo[Path={${join(INFORMES_DIR, "fuentes").replace(/\\/g, "/")}/}]{Inter-Regular.ttf}`);
  assert.equal(fallbackFontLine({ name: "Segoe UI", file: null, bold: null }), "\\newfontfamily\\rumboNombreRespaldo{Segoe UI}");
  assert.throws(() => fallbackFontLine({ name: "Segoe}\\input{x", file: null, bold: null }));
  assert.throws(() => fallbackFontLine({ name: "x", file: "C:\\con%llave{\\f.ttf", bold: null }));
  assert.throws(() => fallbackFontLine({ name: "x", file: "C:\\fuentes\\mala;f.ttf", bold: null }));
  // la que se pide por nombre manda; la del sistema, si la hay, trae el archivo
  assert.deepEqual(findFallbackFont({ name: "Mi Fuente" }), { name: "Mi Fuente", file: null, bold: null });
  assert.deepEqual(findFallbackFont({ name: "Mi Fuente", file: INTER }), { name: "Mi Fuente", file: INTER, bold: null });
  const sistema = findFallbackFont();
  if (sistema) assert.ok(sistema.name && (sistema.file === null || readFontCoverage(sistema.file).size > 0));
});

test("el certificado usa Bricolage para el nombre, o la fuente de respaldo declarada en el preámbulo", () => {
  const event = { slug: "x", name: "Evento", community: "Comunidad", startsAt: "2026-11-22T09:00:00-04:00", endsAt: null, timezone: "America/La_Paz", place: "Santa Cruz", venue: null };
  const attendee = { passId: "ABCDEFGH", code: "ABCDEFGHIJKLMNOP", name: "Дмитрий Иванов", role: null, checkedInAt: null };
  const url = "https://example.com/v/ABCDEFGH?c=ABCDEFGHIJKLMNOP";
  const propia = String(buildCertificadoTex({ event, attendee, url, lang: "es" }));
  assert.match(propia, /\\rumboset\{cert\.fuenteNombre\}\{\\rumboCifra\}/);
  assert.ok(!propia.includes("newfontfamily"));
  const conArchivo = String(buildCertificadoTex({ event, attendee, url, lang: "es", nameFont: { name: "Inter", file: INTER, bold: null } }));
  assert.match(conArchivo, /\\newfontfamily\\rumboNombreRespaldo\[Path=\{.*\/\}\]\{Inter-Regular\.ttf\}/);
  assert.match(conArchivo, /\\rumboset\{cert\.fuenteNombre\}\{\\rumboNombreRespaldo\}/, "sin negrita si la fuente no la trae");
  const porNombre = String(buildCertificadoTex({ event, attendee, url, lang: "en", nameFont: { name: "Segoe UI", file: null, bold: null } }));
  assert.match(porNombre, /\\newfontfamily\\rumboNombreRespaldo\{Segoe UI\}/);
  assert.match(porNombre, /\\rumboset\{cert\.fuenteNombre\}\{\\rumboNombreRespaldo\\bfseries\}/);
  assert.match(readFileSync(join(INFORMES_DIR, "certificado.tex"), "utf8"), /\\V\{cert\.fuenteNombre\}\\fontsize/);
  assert.throws(() => new TexData().preamble("una\nlínea"));
});

test("XeLaTeX corre sin shell", () => {
  const latex = readFileSync(join(INFORMES_DIR, "..", "scripts", "lib", "latex.mjs"), "utf8");
  assert.match(latex, /\["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", template\]/);
});

test("el informe toma los stands y la ruta de la base, y el auspiciante que es un stand trae sus números solos", async () => {
  const d = await eventoDePrueba(repo);
  const taza = await repo.createBenefit({ eventId: d.event.id, name: "Taza de Acme", kind: "merch", station: "Stand de Acme" });
  const acme = await stands.createStand(d.event, { name: "Acme Cloud", benefitId: taza.id }, repo);
  const nube = await stands.createStand(d.event, { name: "Nube Andina" }, repo);
  await stands.setRouteGoal(d.event, { target: 2 }, repo);
  const gente = [];
  for (const nombre of ["Uno", "Dos", "Tres"]) gente.push((await paseDePrueba(repo, d, { name: `${nombre} Secreto`, email: `${nombre.toLowerCase()}.secreto@example.com` })).pass);
  await stands.recordVisit({ standId: acme.id, passId: gente[0].id }, repo);
  await stands.recordVisit({ standId: nube.id, passId: gente[0].id }, repo);
  await stands.recordVisit({ standId: acme.id, passId: gente[1].id }, repo);
  await stands.recordVisit({ standId: acme.id, passId: gente[2].id }, repo);
  await stands.answerConsent(gente[0].id, acme.id, "granted");
  await stands.answerConsent(gente[1].id, acme.id, "granted");
  await repo.grantBenefit(gente[0].id, taza.id, "manual");
  await repo.recordRedemption({ clientId: "r1", eventId: d.event.id, passId: gente[0].id, benefitId: taza.id });

  const data = await buildEventReportData(d.event, repo);
  assert.deepEqual(data.stands, [
    { name: "Acme Cloud", visits: 3, contactsAccepted: 2, routeCompleted: 1, benefit: { name: "Taza de Acme", granted: 1, redeemed: 1 } },
    { name: "Nube Andina", visits: 1, contactsAccepted: 0, routeCompleted: 1, benefit: null },
  ]);
  assert.deepEqual(data.route, { target: 2, standCount: 2, participants: 3, completed: 1, prize: { name: "Premio de la ruta", granted: 1, redeemed: 0 } });
  assert.ok(!/Secreto|example\.com/.test(JSON.stringify(data)));

  // el auspiciante por nombre (sin tildes ni mayúsculas): visitas, regalo y contactos de los stands; la línea de comandos manda
  const solo = applyOrganizerInput(data, { sponsor: "acme cloud" });
  assert.deepEqual(solo.sponsor, { name: "acme cloud", benefit: "Taza de Acme", contactsShared: 2, visits: 3 });
  const forzado = applyOrganizerInput(data, { sponsor: "Acme Cloud", sponsorContacts: 7, sponsorBenefit: "Almuerzo" });
  assert.deepEqual(forzado.sponsor, { name: "Acme Cloud", benefit: "Almuerzo", contactsShared: 7, visits: 3 });
  const ajeno = applyOrganizerInput(data, { sponsor: "Cafetería La Brújula", sponsorContacts: 37 });
  assert.deepEqual(ajeno.sponsor, { name: "Cafetería La Brújula", benefit: null, contactsShared: 37, visits: null });

  const texData = String(buildInformeTex(solo, "es", { now: "2026-11-23T10:00:00-04:00" }));
  assert.match(texData, /\\rumboset\{seccion\.stands\}\{1\}/);
  assert.match(texData, /Meta: visitar 2 de 2 stands\. 3 personas pasaron por algún stand y 1 completaron la ruta\./);
  assert.match(texData, /\{\\bfseries Acme Cloud\}.*& 3 & 2 & 1 & 1 \\\\/);
  assert.match(texData, /\{\\bfseries Nube Andina\}.*& 1 & 0 & 1 & \\textendash \\\\/);
  assert.match(texData, /Visitas a tu stand/);
  assert.match(texData, /\\rumboCifraTarjeta\{2\}\{Contactos compartidos\}/);
  assert.ok(!texData.includes("Secreto"));
  // sin stands, la sección no existe y el auspiciante sin contactos no inventa un número
  const sinStands = await buildEventReportData((await eventoDePrueba(repo)).event, repo);
  assert.deepEqual([sinStands.stands, sinStands.route], [[], null]);
  const tex2 = String(buildInformeTex(applyOrganizerInput(sinStands, { sponsor: "Nadie" }), "en"));
  assert.ok(!tex2.includes("seccion.stands") && !tex2.includes("Contacts shared"));
});
