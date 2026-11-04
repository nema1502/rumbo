// Mandar una transacción a la red: lo que el nodo contesta al enviarla no siempre es un error.
// DUPLICATE quiere decir "ya está en camino" (se sigue esperando el resultado por su hash) y TRY_AGAIN_LATER
// quiere decir "ocupado, reintentá después" (se vuelve a mandar con espera, y si sigue ocupado queda como
// algo para reintentar, no como un error de la transacción). Sin red: el nodo y el reloj son de mentira.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Account, Networks, Operation, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { entornoDePrueba, eventoDePrueba, paseDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const stellar = await import("../src/server/stellar.ts");
const { getRepo } = await import("../src/server/repo.ts");
const { processScanItems } = await import("../src/server/escaner.ts");
const { GATE_STATION } = await import("../src/lib/escaner-api.ts");

const { sendAndWait, SEND_RETRY_DELAYS_MS, ContractError, isContractError } = stellar;

/**
 * Una transacción cualquiera, armada pero no mandada a ninguna parte (solo hace falta su hash). Sin vencimiento,
 * para que dos llamadas den el mismo hash: con setTimeout(60) el tope de tiempo sale de "ahora" y el hash
 * cambia si la prueba cruza un segundo (pasó con la máquina cargada).
 */
function transaccion() {
  const cuenta = new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "100");
  return new TransactionBuilder(cuenta, { fee: "100", networkPassphrase: Networks.TESTNET }).addOperation(Operation.bumpSequence({ bumpTo: "200" })).setTimeout(0).build();
}
const HASH = Buffer.from(transaccion().hash()).toString("hex");

/** Un nodo de mentira: contesta lo que se le dice, en orden, y anota cuántas veces le mandaron la transacción. */
function nodo(respuestas, resultado = { status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 77, returnValue: undefined }) {
  const visto = { envios: 0, consultas: [] };
  return {
    visto,
    sendTransaction: async () => {
      const respuesta = respuestas[Math.min(visto.envios, respuestas.length - 1)];
      visto.envios++;
      return { hash: HASH, latestLedger: 1, latestLedgerCloseTime: 1, ...respuesta };
    },
    pollTransaction: async (hash) => {
      visto.consultas.push(hash);
      return resultado;
    },
  };
}
const sinEspera = () => {
  const esperas = [];
  return { esperas, sleep: async (ms) => void esperas.push(ms) };
};

test("PENDING: se espera el resultado por el hash y se devuelve", async () => {
  const red = nodo([{ status: "PENDING" }]);
  const { esperas, sleep } = sinEspera();
  const tx = await sendAndWait(red, transaccion(), {}, { sleep });
  assert.deepEqual({ hash: tx.hash, ledger: tx.ledger }, { hash: HASH, ledger: 77 });
  assert.equal(red.visto.envios, 1);
  assert.deepEqual(red.visto.consultas, [HASH]);
  assert.deepEqual(esperas, []);
});

test("DUPLICATE: ya está en camino, no es un error; se sigue esperando el resultado por el hash", async () => {
  const red = nodo([{ status: "DUPLICATE" }]);
  const { esperas, sleep } = sinEspera();
  const tx = await sendAndWait(red, transaccion(), {}, { sleep });
  assert.equal(tx.hash, HASH);
  assert.equal(tx.ledger, 77);
  assert.equal(red.visto.envios, 1, "no se vuelve a mandar");
  assert.deepEqual(red.visto.consultas, [HASH], "se pregunta por el hash");
  assert.deepEqual(esperas, [], "y sin esperas de más");
});

test("si tras los sondeos la red todavía no sabe de la transacción, se espera a que venza antes de darla por perdida (y de soltar el turno)", async () => {
  // Una transacción con vencimiento, como las de verdad (TX_TIMEOUT_SECONDS): el tope sale de "ahora".
  const conVencimiento = () =>
    new TransactionBuilder(new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "100"), { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.bumpSequence({ bumpTo: "200" }))
      .setTimeout(stellar.TX_TIMEOUT_SECONDS)
      .build();
  const desconocida = { status: rpc.Api.GetTransactionStatus.NOT_FOUND };
  const entro = { status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 78, returnValue: undefined };
  // El nodo no la encuentra en la primera tanda de sondeos y sí después de la espera.
  const tarde = nodo([{ status: "PENDING" }]);
  const vistas = [];
  tarde.pollTransaction = async (hash, opciones) => {
    vistas.push(opciones?.attempts);
    return vistas.length === 1 ? desconocida : entro;
  };
  const { esperas, sleep } = sinEspera();
  const tx = await sendAndWait(tarde, conVencimiento(), {}, { sleep });
  assert.equal(tx.ledger, 78);
  assert.deepEqual(vistas, [40, 1], "cuarenta sondeos, la espera, y una mirada más");
  assert.equal(esperas.length, 1);
  assert.ok(esperas[0] > 50_000 && esperas[0] <= (stellar.TX_TIMEOUT_SECONDS + 5) * 1000, `esperó ${esperas[0]} ms: hasta que la transacción venció`);

  // Si ni después de vencer se sabe de ella, recién ahí es "no se confirmó a tiempo".
  const nunca = nodo([{ status: "PENDING" }], desconocida);
  const segunda = sinEspera();
  await assert.rejects(sendAndWait(nunca, conVencimiento(), {}, { sleep: segunda.sleep }), /no se confirmó a tiempo/);
  assert.equal(segunda.esperas.length, 1);

  // Sin vencimiento no hay nada que esperar: una sola tanda de sondeos.
  const sinVencer = nodo([{ status: "PENDING" }], desconocida);
  const tercera = sinEspera();
  await assert.rejects(sendAndWait(sinVencer, transaccion(), {}, { sleep: tercera.sleep }), /no se confirmó a tiempo/);
  assert.deepEqual([sinVencer.visto.consultas.length, tercera.esperas], [1, []]);
});

test("DUPLICATE sin hash en la respuesta: se usa el de la transacción", async () => {
  const red = nodo([{ status: "DUPLICATE", hash: "" }]);
  const tx = await sendAndWait(red, transaccion(), {}, { sleep: async () => {} });
  assert.equal(tx.hash, HASH);
  assert.deepEqual(red.visto.consultas, [HASH]);
});

test("DUPLICATE y la transacción terminó mal: es el error de la transacción, no de haberla mandado dos veces", async () => {
  const red = nodo([{ status: "DUPLICATE" }], {
    status: rpc.Api.GetTransactionStatus.FAILED,
    resultXdr: { result: { type: "txFailed" } },
    diagnosticEventsXdr: undefined,
  });
  await assert.rejects(sendAndWait(red, transaccion(), {}, { sleep: async () => {} }), (error) => isContractError(error) && /falló en la red/.test(error.message));
});

test("TRY_AGAIN_LATER: espera y vuelve a mandar la misma transacción hasta que la tomen", async () => {
  const red = nodo([{ status: "TRY_AGAIN_LATER" }, { status: "TRY_AGAIN_LATER" }, { status: "PENDING" }]);
  const { esperas, sleep } = sinEspera();
  const rechazadas = [];
  const tx = await sendAndWait(red, transaccion(), { onRejected: () => void rechazadas.push(1) }, { sleep });
  assert.equal(tx.hash, HASH);
  assert.equal(red.visto.envios, 3);
  assert.deepEqual(esperas, SEND_RETRY_DELAYS_MS.slice(0, 2), "las esperas crecen: 1 s, 2 s");
  assert.deepEqual(red.visto.consultas, [HASH]);
  assert.deepEqual(rechazadas, [], "tomada, no se avisa que fue rechazada");
});

test("TRY_AGAIN_LATER sin parar: queda como algo para reintentar después, no como un error de la transacción", async () => {
  const red = nodo([{ status: "TRY_AGAIN_LATER" }]);
  const { esperas, sleep } = sinEspera();
  const rechazadas = [];
  await assert.rejects(
    sendAndWait(red, transaccion(), { onRejected: () => void rechazadas.push(1) }, { sleep }),
    (error) => {
      assert.ok(error instanceof ContractError);
      assert.equal(error.errorName, null, "sin código de contrato: no es permanente");
      assert.match(error.message, /reintent/);
      return true;
    },
  );
  assert.equal(red.visto.envios, SEND_RETRY_DELAYS_MS.length + 1);
  assert.deepEqual(esperas, [...SEND_RETRY_DELAYS_MS]);
  assert.deepEqual(red.visto.consultas, [], "una transacción que el nodo no tomó no se consulta");
  assert.deepEqual(rechazadas, [1], "se avisa una vez que no entró ni va a entrar");
  const total = SEND_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
  assert.ok(total < 60_000, `las esperas (${total} ms) caben dentro de lo que vale la transacción (60 s)`);
});

test("ERROR: la red la rechazó, no se reintenta", async () => {
  const red = nodo([{ status: "ERROR", errorResult: { result: { type: "txBadSeq" } } }]);
  await assert.rejects(sendAndWait(red, transaccion(), {}, { sleep: async () => {} }), (error) => isContractError(error) && /txBadSeq/.test(error.message));
  assert.equal(red.visto.envios, 1);
});

test("el escáner deja pendiente un registro cuando la red está ocupada, y olvida el hash de la transacción que no entró", async () => {
  const repo = getRepo();
  const datos = await eventoDePrueba(repo);
  const ana = await paseDePrueba(repo, datos);
  const item = { clientId: "ocupada-1", action: "checkin", passId: ana.pass.id, benefitId: null, scannedAt: new Date().toISOString(), scannerId: "prueba" };

  let intento = 0;
  const cadena = {
    checkIn: async (contractId, account, hooks) => {
      intento++;
      await hooks.onSubmitted("h-no-entro");
      if (intento === 1) {
        // lo que hace sendAndWait cuando el nodo no la toma ni después de reintentar
        await hooks.onRejected();
        throw new ContractError("La red está ocupada y no tomó la transacción: reintentá más tarde", null);
      }
      return { hash: "h-entro" };
    },
    redeem: async () => ({ hash: "no" }),
    outcome: async () => "missing",
  };

  const [primero] = await processScanItems(repo, datos.event, GATE_STATION, [item], cadena);
  assert.equal(primero.status, "retry", "se reintenta después, no es un rechazo");
  const fila = (await repo.listCheckInsForPass(ana.pass.id))[0];
  assert.equal(fila.txHash, null, "el hash de la que no entró se olvida");
  assert.equal(fila.synced, false);

  // el próximo intento no espera los 90 segundos de la transacción que nunca entró: manda otra
  const [segundo] = await processScanItems(repo, datos.event, GATE_STATION, [item], cadena);
  assert.equal(segundo.status, "synced");
  assert.equal(segundo.txHash, "h-entro");
  assert.equal(intento, 2);
});
