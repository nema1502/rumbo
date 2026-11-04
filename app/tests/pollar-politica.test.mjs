// La política de firma de Pollar: al publicar, cada contrato nuevo se le avisa a Pollar con una fila (register y
// buy). Sin la clave secreta no se llama a nadie; si Pollar contesta mal, se dice y publicar sigue. Sin red.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { allowEventContractInPollar, EVENT_CONTRACT_FUNCTIONS, POLLAR_SERVER_URL } = await import("../src/server/pollar-politica.ts");
const { getRepo } = await import("../src/server/repo.ts");
const { createEventFromTemplate } = await import("../src/server/kit/plantillas.ts");
const { publishEvent } = await import("../src/server/kit/publicar.ts");

const CONTRATO = "CDKAPFK7NM4MCITFNAOTOBRTCFALZVL3MU7V7N3PTY7LURHSMNTMU2E5";

function fetchFalso(status, body) {
  const llamadas = [];
  const fetch = async (url, init) => {
    llamadas.push({ url, init });
    return { ok: status < 400, status, json: async () => body };
  };
  return { fetch, llamadas };
}

test("sin la clave secreta no se llama a nadie, y un id que no es de un contrato real tampoco viaja", async () => {
  const nunca = async () => assert.fail("no tenía que llamar a Pollar");
  assert.deepEqual(await allowEventContractInPollar(CONTRATO, "x", { fetch: nunca, secretKey: undefined, serverUrl: POLLAR_SERVER_URL }), { ok: false, reason: "not_configured", detail: null });
  assert.deepEqual(await allowEventContractInPollar("CPRUEBA1", "x", { fetch: nunca, secretKey: "sec_x", serverUrl: POLLAR_SERVER_URL }), { ok: false, reason: "not_configured", detail: null });
});

test("con la clave manda una fila con register y buy; la clave va en la cabecera, nunca en el cuerpo", async () => {
  const { fetch, llamadas } = fetchFalso(200, { success: true, code: "SERVER_SOROBAN_AUTH_POLICY_CREATED", content: { id: "pol1" } });
  const largo = "Un nombre de evento muy largo ".repeat(10);
  const r = await allowEventContractInPollar(CONTRATO, largo, { fetch, secretKey: "sec_testnet_prueba", serverUrl: "https://pollar.prueba" });
  assert.deepEqual(r, { ok: true, policyId: "pol1" });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, "https://pollar.prueba/v3/treasury/soroban-auth/policies");
  assert.equal(llamadas[0].init.method, "POST");
  assert.equal(llamadas[0].init.headers["x-pollar-api-key"], "sec_testnet_prueba");
  const cuerpo = JSON.parse(llamadas[0].init.body);
  assert.deepEqual(cuerpo, { contract_id: CONTRATO, functions: [...EVENT_CONTRACT_FUNCTIONS], label: largo.slice(0, 120), enabled: true });
  assert.ok(!llamadas[0].init.body.includes("sec_testnet"), "la clave no va en el cuerpo");
});

test("si Pollar contesta mal o la red se corta, lo dice y no lanza", async () => {
  const { fetch } = fetchFalso(403, { success: false, code: "SERVER_FORBIDDEN" });
  assert.deepEqual(await allowEventContractInPollar(CONTRATO, "x", { fetch, secretKey: "sec_x", serverUrl: "https://pollar.prueba" }), { ok: false, reason: "failed", detail: "HTTP 403 SERVER_FORBIDDEN" });
  const cortada = async () => { throw new Error("fetch failed"); };
  const r = await allowEventContractInPollar(CONTRATO, "x", { fetch: cortada, secretKey: "sec_x", serverUrl: "https://pollar.prueba" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "failed");
});

test("publicar le avisa a Pollar de cada contrato nuevo, con el evento y la entrada en la etiqueta, y sigue aunque falle", async () => {
  const repo = getRepo();
  const event = await createEventFromTemplate(repo, { template: "meetup", name: "Meetup de prueba", lang: "es", startsAtLocal: "2026-12-05T19:00", place: "Santa Cruz", organizerName: "GDG" });
  const avisos = [];
  let n = 0;
  const r = await publishEvent(repo, event, {
    deploy: async () => `CMEET${++n}`,
    allow: async (contractId, label) => (avisos.push({ contractId, label }), { ok: false, reason: "failed", detail: "HTTP 500" }),
  });
  assert.equal(r.ok, true);
  assert.ok(r.deployed >= 1);
  assert.equal(avisos.length, r.deployed);
  assert.ok(avisos.every((a) => a.contractId.startsWith("CMEET") && a.label.startsWith("Meetup de prueba: ")), JSON.stringify(avisos));
});
