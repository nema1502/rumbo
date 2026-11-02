// Los pedidos del escáner no quedan colgados: con un servidor que no contesta (el wifi del evento sin
// salida, un portal cautivo), el pedido se corta en su tiempo y el escáner sigue con lo que sabe.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";

const { OPEN_TIMEOUT_MS, READ_REFRESH_TIMEOUT_MS, RequestTimeout, SYNC_TIMEOUT_MS, postJson } = await import("../src/lib/http.ts");

const colgados = [];
const servidor = createServer((req, res) => {
  if (req.url === "/ok") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ hola: "puesto" }));
  } else if (req.url === "/a-medias") {
    // contesta la cabecera y nunca termina el cuerpo
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"hola":');
    colgados.push(res);
  } else {
    // no contesta nunca
    colgados.push(res);
  }
});
await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${servidor.address().port}`;
after(() => {
  for (const res of colgados) res.destroy();
  servidor.close();
});

test("un servidor que no contesta corta el pedido en su tiempo", async () => {
  const inicio = Date.now();
  await assert.rejects(postJson(`${base}/colgado`, { code: "X" }, 300), RequestTimeout);
  const tardo = Date.now() - inicio;
  assert.ok(tardo >= 250 && tardo < 3000, `tardó ${tardo} ms`);
});

test("un cuerpo que no termina de llegar también se corta", async () => {
  const inicio = Date.now();
  await assert.rejects(postJson(`${base}/a-medias`, {}, 300), RequestTimeout);
  assert.ok(Date.now() - inicio < 3000);
});

test("con un servidor que contesta, devuelve el estado y el cuerpo", async () => {
  assert.deepEqual(await postJson(`${base}/ok`, { code: "X" }, 2000), { status: 200, data: { hola: "puesto" } });
});

test("los tiempos del escáner: la lectura no espera más de unos segundos, la sincronización sí", () => {
  assert.ok(READ_REFRESH_TIMEOUT_MS <= 5_000, "una lectura no puede quedar frenada mucho tiempo");
  assert.ok(OPEN_TIMEOUT_MS <= 20_000);
  assert.ok(SYNC_TIMEOUT_MS >= 60_000 && SYNC_TIMEOUT_MS <= 180_000, "un lote son varias transacciones de la red de prueba");
});
