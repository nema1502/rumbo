// "Credencial N de M": el número es el que dio el contrato al emitir la credencial (el que se puede comprobar), y no
// cambia nunca delante de la persona: ni al entrar, ni cuando se activa otra credencial. Hasta que el contrato lo
// confirme, la credencial dice "Credencial", sin número, en la pantalla, en la confirmación y en el SVG. Sin red.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { loadCredentialUnchecked } = await import("../src/server/evento/credencial.ts");
const { renderCredentialSvg } = await import("../src/server/evento/credencial-svg.ts");
const { translate } = await import("../src/i18n/index.ts");

const repo = getRepo();

test("el número de la credencial es el del contrato, y no cambia al entrar ni cuando se activan otras credenciales", async () => {
  const d = await eventoDePrueba(repo);
  const ana = await paseDePrueba(repo, d, { name: "Ana Quiroga" });
  await repo.updatePass(ana.pass.id, { chainNumber: 7 });
  const antes = await loadCredentialUnchecked(ana.pass.id);
  assert.equal(antes.number, 7);
  assert.ok(antes.total >= 7);
  const activadaEl = (await repo.getPass(ana.pass.id)).activatedAt;
  assert.ok(activadaEl);

  // Entra por la puerta: el número sigue, y la hora de activación no se vuelve a escribir.
  await repo.updatePass(ana.pass.id, { status: "checked_in", checkedInAt: new Date().toISOString() });
  const despues = await loadCredentialUnchecked(ana.pass.id);
  assert.equal(despues.number, 7);
  assert.equal((await repo.getPass(ana.pass.id)).activatedAt, activadaEl, "activada cuando se activó, no cuando entró");
  // Se activan otras credenciales, antes y después: el número de Ana no se mueve.
  for (let i = 0; i < 3; i++) await paseDePrueba(repo, d, { name: `Otra ${i}` });
  assert.equal((await loadCredentialUnchecked(ana.pass.id)).number, 7);
  // Lo que muestra cada pantalla.
  assert.equal(translate("es", "evento.credencial.numero", { n: 7, total: despues.total }), `Credencial 7 de ${despues.total}`);
  assert.ok(renderCredentialSvg(despues, "es").includes(`Credencial 7 de ${despues.total}`));
  assert.ok(renderCredentialSvg(despues, "en").includes(`Pass 7 of ${despues.total}`));
});

test("hasta que el contrato confirme el número, la credencial dice solo Credencial", async () => {
  const d = await eventoDePrueba(repo);
  const beto = await paseDePrueba(repo, d, { name: "Beto Soria" });
  assert.equal((await repo.getPass(beto.pass.id)).chainNumber, null);
  const vista = await loadCredentialUnchecked(beto.pass.id);
  assert.equal(vista.number, null);
  assert.ok(vista.total >= 1);
  const svg = renderCredentialSvg(vista, "es");
  assert.ok(svg.includes(">Credencial<") && !svg.includes("Credencial 0") && !/Credencial \d+ de/.test(svg), "sin número, y sin un cero inventado");
  assert.ok(renderCredentialSvg(vista, "en").includes(">Pass<"));
  // Cuando el contraste con la cadena trae el número, aparece, y es el del contrato.
  await repo.updatePass(beto.pass.id, { chainNumber: 12 });
  assert.equal((await loadCredentialUnchecked(beto.pass.id)).number, 12);
});

test("una credencial que pasa de pendiente a activa queda activada una sola vez; un cero del contrato no es un número", async () => {
  const d = await eventoDePrueba(repo);
  const persona = await repo.upsertPerson({ name: "Caro Tres", email: "caro.tres@example.com" });
  const pendiente = await repo.createPass({ eventId: d.event.id, personId: persona.id, ticketTypeId: d.ticket.id, status: "pending" });
  assert.equal(pendiente.activatedAt, null);
  const activa = await repo.updatePass(pendiente.id, { status: "active", account: "GCARO", chainNumber: 0 });
  assert.ok(activa.activatedAt, "al activarse, queda la hora");
  const entro = await repo.updatePass(pendiente.id, { status: "checked_in" });
  assert.equal(entro.activatedAt, activa.activatedAt);
  assert.ok(entro.checkedInAt);
  assert.equal((await loadCredentialUnchecked(pendiente.id)).number, null, "un cero no es un número de credencial");
});
