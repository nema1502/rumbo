// Publicar un borrador no se hace dos veces a la vez: un doble clic (o dos pestañas) desplegaba el doble de contratos
// y el segundo pisaba el contrato de una entrada que ya podía tener inscriptos. Sin red: el contrato lo crea un falso.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { createEventFromTemplate } = await import("../src/server/kit/plantillas.ts");
const { publishEvent } = await import("../src/server/kit/publicar.ts");

const repo = getRepo();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function borrador(nombre) {
  return createEventFromTemplate(repo, { template: "devfest", lang: "es", name: nombre, startsAtLocal: "2026-12-05T09:00", place: "Santa Cruz", organizerName: "GDG" });
}

/** Un desplegador falso que tarda `ms` por contrato y anota cada uno que creó. */
function desplegador(ms, prefijo, creados) {
  let n = 0;
  return {
    deploy: async () => {
      await sleep(ms);
      const id = `${prefijo}${++n}`;
      creados.push(id);
      return id;
    },
  };
}

test("publicar dos veces a la vez despliega los contratos una sola vez, y el segundo pedido recibe que ya se está publicando", async () => {
  const draft = await borrador("Publicar dos veces");
  const tipos = await repo.listTicketTypes(draft.id);
  const creados = [];
  // Dos envíos del mismo formulario: cada uno leyó el evento antes de que el otro empezara.
  const [e1, e2] = await Promise.all([repo.getEventById(draft.id), repo.getEventById(draft.id)]);
  const [r1, r2] = await Promise.all([publishEvent(repo, e1, desplegador(15, "RAPIDO", creados)), publishEvent(repo, e2, desplegador(40, "LENTO", creados))]);
  const resultados = [r1, r2].sort((a, b) => Number(b.ok) - Number(a.ok));
  assert.deepEqual(resultados[0], { ok: true, deployed: tipos.length });
  assert.deepEqual(resultados[1], { ok: false, reason: "busy", detail: null });
  assert.equal(creados.length, tipos.length, "un contrato por tipo de entrada, y ninguno de más");
  const finales = await repo.listTicketTypes(draft.id);
  assert.ok(finales.every((t) => t.contractId && creados.includes(t.contractId)));
  assert.equal((await repo.getEventById(draft.id)).published, true);

  // Ya publicado, volver a pedirlo no despliega nada ni cambia ningún contrato.
  const antes = Object.fromEntries(finales.map((t) => [t.id, t.contractId]));
  assert.deepEqual(await publishEvent(repo, await repo.getEventById(draft.id), desplegador(0, "OTRO", creados)), { ok: true, deployed: 0 });
  assert.deepEqual(Object.fromEntries((await repo.listTicketTypes(draft.id)).map((t) => [t.id, t.contractId])), antes);
});

test("el contrato de una entrada que ya tiene uno no se pisa, aunque alguien despliegue otro para ella", async () => {
  const draft = await borrador("Contrato que no se pisa");
  const [primera] = await repo.listTicketTypes(draft.id);
  assert.equal(await repo.setTicketTypeContractIfEmpty(primera.id, "CPRIMERO"), true);
  assert.equal(await repo.setTicketTypeContractIfEmpty(primera.id, "CSEGUNDO"), false, "ya tenía: no cambia");
  assert.equal((await repo.getTicketType(primera.id)).contractId, "CPRIMERO");

  // Publicar completa solo las entradas que faltan y respeta la que ya tenía contrato.
  const creados = [];
  const resultado = await publishEvent(repo, await repo.getEventById(draft.id), desplegador(0, "CNUEVO", creados));
  const tipos = await repo.listTicketTypes(draft.id);
  assert.deepEqual(resultado, { ok: true, deployed: tipos.length - 1 });
  assert.equal(tipos.find((t) => t.id === primera.id).contractId, "CPRIMERO");
  assert.ok(tipos.filter((t) => t.id !== primera.id).every((t) => creados.includes(t.contractId)));
});
