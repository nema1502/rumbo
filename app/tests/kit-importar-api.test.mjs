// La ruta que usa la pantalla de importar (/api/admin/<evento>/importar): pide la clave de organizador, lee el
// archivo, y en tres pasos (vista, importar, tandas) deja a cada persona con su credencial y su correo. Sin red.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { APP_DIR, entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { NextRequest } = await import("next/server");
const { getRepo } = await import("../src/server/repo.ts");
const { createEventFromTemplate } = await import("../src/server/kit/plantillas.ts");
const { publishEvent } = await import("../src/server/kit/publicar.ts");
const { getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { POST: importar } = await import("../src/app/api/admin/[slug]/importar/route.ts");
const { GET: asistencia } = await import("../src/app/api/admin/[slug]/asistencia/route.ts");

const repo = getRepo();

// Sin red: las cuentas, el contrato y el correo son de mentira (los mismos ganchos que usan las capturas).
let numero = 0;
globalThis.__rumboAccounts = {
  kind: "dev",
  getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
  authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
};
globalThis.__rumboKitChain = {
  register: async () => ({ hash: `h-${++numero}`, ledger: 1, returnValue: numero, number: numero }),
  status: async () => ({ has_pass: true, number: 1, checked_in: false, redeemed: [] }),
};
const correos = [];
globalThis.__rumboMailer = { kind: "dev", send: async (mail) => (correos.push(mail), { id: String(correos.length) }) };

let contratos = 0;
async function evento(nombre, { publicar = true } = {}) {
  const base = await createEventFromTemplate(repo, { template: "devfest", lang: "es", name: nombre, startsAtLocal: "2026-12-05T09:00", place: "Santa Cruz", organizerName: "GDG" });
  if (publicar) await publishEvent(repo, base, { deploy: async () => `CAPI${++contratos}` });
  return repo.getEventById(base.id);
}

const archivoLuma = () => new File([readFileSync(join(APP_DIR, "tests", "fixtures", "luma-invitados.csv.txt"))], "invitados.csv", { type: "text/csv" });

async function llamar(event, campos, { clave } = {}) {
  clave ??= await getOrCreateOrganizerKey(event.id);
  const form = new FormData();
  for (const [k, v] of Object.entries(campos)) form.set(k, v);
  const request = new NextRequest(`http://localhost/api/admin/${event.slug}/importar${clave ? `?k=${clave}` : ""}`, { method: "POST", body: form });
  const res = await importar(request, { params: Promise.resolve({ slug: event.slug }) });
  return { status: res.status, cuerpo: await res.json() };
}

test("sin la clave del organizador no se importa nada", async () => {
  const event = await evento("API sin clave");
  const sin = await llamar(event, { accion: "vista", archivo: archivoLuma() }, { clave: "" });
  assert.equal(sin.status, 401);
  const mala = await llamar(event, { accion: "vista", archivo: archivoLuma() }, { clave: "CLAVEQUENOES" });
  assert.equal(mala.status, 401);
  assert.equal((await repo.listPasses(event.id)).length, 0);
});

test("un borrador no se importa, un archivo vacío o enorme se rechaza y dice por qué", async () => {
  const borrador = await evento("API borrador", { publicar: false });
  assert.deepEqual((await llamar(borrador, { accion: "vista", archivo: archivoLuma() })).cuerpo, { ok: false, error: "draft" });

  const event = await evento("API archivos");
  const vacio = await llamar(event, { accion: "vista", archivo: new File(["  \n"], "vacio.csv") });
  assert.deepEqual([vacio.status, vacio.cuerpo.error], [422, "empty"]);
  const sinCorreos = await llamar(event, { accion: "vista", archivo: new File(["nombre,ciudad\nAna,La Paz\nLuis,Sucre"], "sin-correos.csv") });
  assert.deepEqual([sinCorreos.status, sinCorreos.cuerpo.error], [422, "no_email"]);
  const excel = await llamar(event, { accion: "vista", archivo: new File([Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])], "lista.xlsx") });
  assert.deepEqual([excel.status, excel.cuerpo.error], [422, "no_text"]);
  const enorme = await llamar(event, { accion: "vista", archivo: new File([new Uint8Array(2 * 1024 * 1024 + 1)], "enorme.csv") });
  assert.deepEqual([enorme.status, enorme.cuerpo.error], [413, "too_big"]);
  const sinAccion = await llamar(event, { archivo: archivoLuma() });
  assert.equal(sinAccion.status, 400);
});

test("de la vista a la última tanda: lo que ve la pantalla, paso por paso", async () => {
  const event = await evento("API completo");
  const tipos = await repo.listTicketTypes(event.id);

  // 1. La vista: qué se leyó y cuántas personas entrarían.
  const vista = await llamar(event, { accion: "vista", archivo: archivoLuma() });
  assert.equal(vista.status, 200);
  const { preview } = vista.cuerpo;
  assert.equal(preview.source, "luma");
  assert.equal(preview.total, 16);
  assert.deepEqual(preview.buckets.approved, { valid: 9, invalidEmail: 3, duplicatesInFile: 1, alreadyHere: 0 });
  assert.equal(preview.defaultTypeId, tipos.find((t) => t.templateSlot === "attendee").id);
  assert.equal((await repo.listPasses(event.id)).length, 0, "ver no crea nada");

  // 2. Importar: una credencial pendiente por persona, y el resumen.
  const tiposPorEntrada = Object.fromEntries(preview.tickets.map((e) => [e.key, e.suggestedTypeId]));
  const importado = await llamar(event, {
    accion: "importar",
    archivo: archivoLuma(),
    estados: JSON.stringify(["approved"]),
    tipos: JSON.stringify(tiposPorEntrada),
    tipoPorDefecto: preview.defaultTypeId,
  });
  assert.equal(importado.status, 200);
  assert.deepEqual([importado.cuerpo.summary.created, importado.cuerpo.summary.invalidEmail, importado.cuerpo.summary.duplicates, importado.cuerpo.pending], [9, 3, 1, 9]);
  const runId = importado.cuerpo.runId;
  assert.equal(correos.length, 0, "todavía no salió ningún correo");

  // 3. Las tandas: de a cinco, hasta que no quede ninguna.
  const tandas = [];
  for (let i = 0; i < 10; i++) {
    const tanda = await llamar(event, { accion: "tanda", importacion: runId });
    assert.equal(tanda.status, 200);
    tandas.push(tanda.cuerpo.result);
    if (tanda.cuerpo.result.remaining === 0) break;
  }
  assert.deepEqual(tandas.map((t) => [t.processed, t.remaining]), [[5, 4], [4, 0]]);
  assert.equal(correos.length, 9);
  const ultimo = (await llamar(event, { accion: "tanda", importacion: runId })).cuerpo;
  assert.deepEqual([ultimo.result.processed, ultimo.summary.emailsSent, ultimo.summary.activated], [0, 9, 9]);

  // Una importación de otro evento no se toca desde este.
  const otro = await evento("API otro evento");
  const ajena = await llamar(otro, { accion: "tanda", importacion: runId });
  assert.equal(ajena.status, 404);
  const inexistente = await llamar(event, { accion: "tanda", importacion: "no-existe" });
  assert.equal(inexistente.status, 404);

  // Importar sin elegir nadie o sin tipo por defecto no es un pedido válido.
  const sinEstados = await llamar(event, { accion: "importar", archivo: archivoLuma(), estados: "[]", tipos: "{}", tipoPorDefecto: preview.defaultTypeId });
  assert.equal(sinEstados.status, 400);
  const tipoRaro = await llamar(event, { accion: "importar", archivo: archivoLuma(), estados: '["approved"]', tipos: "{}", tipoPorDefecto: "no-existe" });
  assert.deepEqual([tipoRaro.status, tipoRaro.cuerpo.error], [400, "bad_type"]);
});

test("la asistencia pide la clave y baja el CSV con su nombre de archivo", async () => {
  const event = await evento("API asistencia");
  const clave = await getOrCreateOrganizerKey(event.id);
  const sin = await asistencia(new NextRequest(`http://localhost/api/admin/${event.slug}/asistencia`), { params: Promise.resolve({ slug: event.slug }) });
  assert.equal(sin.status, 401);
  const con = await asistencia(new NextRequest(`http://localhost/api/admin/${event.slug}/asistencia?k=${clave}`), { params: Promise.resolve({ slug: event.slug }) });
  assert.equal(con.status, 200);
  assert.match(con.headers.get("content-type"), /text\/csv/);
  assert.match(con.headers.get("content-disposition"), new RegExp(`filename="${event.slug}-asistencia-\\d{4}-\\d{2}-\\d{2}\\.csv"`));
  assert.match(await con.text(), /First Name,Last Name,Email,Ticket Type,Attended/);
});
