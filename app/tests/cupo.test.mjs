// El cupo que dice el contrato de una entrada: "Agotada" solo cuando emitió tantas credenciales como puede, el
// cupo que se muestra es el menor entre la base y el contrato, y el contrato se lee una vez por minuto aunque
// lo pidan varias pantallas a la vez. Si la red no contesta, no se sabe y la pantalla sigue con la base.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const stellar = await import("../src/server/stellar.ts");
const { forgetContractCapacities, isSoldOut, readContractCapacity, smallestCapacity } = await import("../src/server/evento/cupo.ts");

test("agotada solo cuando el contrato emitió todo su cupo", () => {
  assert.equal(isSoldOut(null), false, "sin dato no se dice agotada");
  assert.equal(isSoldOut({ capacity: 50, issued: 49 }), false);
  assert.equal(isSoldOut({ capacity: 50, issued: 50 }), true);
  assert.equal(isSoldOut({ capacity: 50, issued: 51 }), true);
  assert.equal(isSoldOut({ capacity: 0, issued: 0 }), false, "un contrato sin cupo fijado no está agotado");
});

test("el cupo que se muestra es el menor entre la base y los contratos que se conocen", () => {
  assert.equal(smallestCapacity(200, { capacity: 50, issued: 3 }), 50);
  assert.equal(smallestCapacity(200, null), 200);
  assert.equal(smallestCapacity(200, { capacity: 1000, issued: 0 }, { capacity: 1000, issued: 0 }), 200);
  assert.equal(smallestCapacity(null, { capacity: 1000, issued: 0 }, { capacity: 300, issued: 0 }), 300);
  assert.equal(smallestCapacity(null, null), null);
});

test("el contrato se lee una vez por minuto, aunque lo pidan varias pantallas a la vez", async () => {
  forgetContractCapacities();
  const original = stellar.rumboPass.info;
  let lecturas = 0;
  stellar.rumboPass.info = async () => {
    lecturas++;
    return { capacity: 50, issued: 50 };
  };
  try {
    const [a, b] = await Promise.all([readContractCapacity("CCONTRATO"), readContractCapacity("CCONTRATO")]);
    assert.deepEqual(a, { capacity: 50, issued: 50 });
    assert.deepEqual(b, a);
    assert.deepEqual(await readContractCapacity("CCONTRATO"), a);
    assert.equal(lecturas, 1, "tres pedidos, una lectura");
    assert.equal(await readContractCapacity(null), null, "sin contrato no hay nada que leer");

    stellar.rumboPass.info = async () => {
      throw new Error("sin red");
    };
    assert.equal(await readContractCapacity("COTRO"), null, "si la red falla, no se sabe");
  } finally {
    stellar.rumboPass.info = original;
    forgetContractCapacities();
  }
});

test("si la red tarda, la pantalla no espera, pero la lectura termina y la próxima carga la encuentra", async () => {
  forgetContractCapacities();
  const original = stellar.rumboPass.info;
  let lecturas = 0;
  stellar.rumboPass.info = () =>
    new Promise((resolve) => {
      lecturas++;
      setTimeout(() => resolve({ capacity: 1, issued: 1 }), 150);
    });
  try {
    assert.equal(await readContractCapacity("CLENTO", 20), null, "a los 20 ms la pantalla sigue con la base");
    assert.equal(await readContractCapacity("CLENTO", 20), null, "y no empieza otra lectura mientras la primera sigue");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(await readContractCapacity("CLENTO", 20), { capacity: 1, issued: 1 }, "la lectura terminó sola y quedó recordada");
    assert.equal(lecturas, 1);
  } finally {
    stellar.rumboPass.info = original;
    forgetContractCapacities();
  }
});
