// La clave de la casa (RUMBO_CREATE_KEY, la que abre /admin/nuevo) no se adivina a la fuerza: comparte el freno
// de los códigos de puesto, así que ocho intentos equivocados desde una IP la frenan, y frenada no entra ni la buena.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { checkCreateKey, createGate, verifyCreateKey } = await import("../src/server/kit/acceso.ts");
const { stationCodeAttempts } = await import("../src/server/limites.ts");

beforeEach(async () => {
  await stationCodeAttempts().clear();
  process.env.RUMBO_CREATE_KEY = "la-clave-de-la-casa";
});

test("sin clave configurada: abierto en desarrollo, cerrado en producción, y el freno no cuenta nada", async () => {
  delete process.env.RUMBO_CREATE_KEY;
  assert.deepEqual(createGate(), { open: true, needsKey: false });
  assert.equal(await checkCreateKey("", "1.1.1.1"), "ok");
  const antes = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.deepEqual(createGate(), { open: false, needsKey: false });
    assert.equal(await checkCreateKey("cualquiera", "1.1.1.1"), "wrong");
  } finally {
    process.env.NODE_ENV = antes;
  }
  assert.equal(await stationCodeAttempts().blockedFor("1.1.1.1"), 0);
});

test("con clave: la buena entra, la mala cuenta, y a los ocho intentos la IP queda frenada aunque escriba la buena", async () => {
  assert.equal(verifyCreateKey(" la-clave-de-la-casa "), true, "se compara sin los espacios de los bordes");
  assert.equal(await checkCreateKey("la-clave-de-la-casa", "10.0.0.1"), "ok");
  for (let i = 0; i < 8; i++) assert.equal(await checkCreateKey(`intento-${i}`, "10.0.0.1"), "wrong");
  assert.equal(await checkCreateKey("la-clave-de-la-casa", "10.0.0.1"), "blocked", "frenada: ni la buena entra");
  assert.ok((await stationCodeAttempts().blockedFor("10.0.0.1")) > 0);
  // Otra IP sigue pudiendo, y los intentos con la clave se cuentan junto a los de los códigos de puesto.
  assert.equal(await checkCreateKey("la-clave-de-la-casa", "10.0.0.2"), "ok");
  await stationCodeAttempts().note("10.0.0.3");
  assert.equal(await checkCreateKey("mala", "10.0.0.3"), "wrong");
  for (let i = 0; i < 6; i++) await stationCodeAttempts().note("10.0.0.3");
  assert.equal(await checkCreateKey("la-clave-de-la-casa", "10.0.0.3"), "blocked", "un mismo freno para la clave y los códigos");
});
