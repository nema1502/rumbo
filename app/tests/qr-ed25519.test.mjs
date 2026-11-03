// El QR de la credencial va firmado con una llave pública (Ed25519): el escáner solo tiene la clave pública
// del evento, y el QR del celular rota cada 20 segundos. Sin red, sin Next: la firma, la ventana de tiempo, la
// credencial impresa, el respaldo cuando el navegador no sabe Ed25519 y que el QR sigue siendo legible.
import assert from "node:assert/strict";
import { test } from "node:test";
import jsQR from "jsqr";
import { entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const qr = await import("../src/server/qr.ts");
const { getRepo } = await import("../src/server/repo.ts");
const { getEventQrKeys, getEventPublicKey } = await import("../src/server/qr-keys.ts");
const codec = await import("../src/lib/qr-codec.ts");
const { verifyQrPayloadInBrowser, importEventKey } = await import("../src/lib/qr-verify.ts");
const { buildLivePayload, clockOffset } = await import("../src/lib/qr-live.ts");
const { ed25519Sign, ed25519Verify, usarRespaldo } = await import("../src/lib/ed25519.ts");
const { renderQrMatrix } = await import("../src/lib/qr-svg.ts");
const { decideVerdict, GATE_STATION } = await import("../src/lib/escaner-api.ts");

const SECOND = 1000;
const WINDOW_MS = codec.WINDOW_SECONDS * SECOND;
/** Un instante en medio de una ventana, así sumar o restar ventanas enteras no cae en un borde. */
const T0 = (Math.floor(1_800_000_000_000 / WINDOW_MS) + 0.5) * WINDOW_MS;

const keys = qr.newEventQrKeys();
const otherKeys = qr.newEventQrKeys();
const passA = qr.newPassId();
const passB = qr.newPassId();
const grantA = qr.buildLiveGrant(passA, keys);
const grantB = qr.buildLiveGrant(passB, keys);
const verificar = (payload, now = T0, key = keys.publicKey) => verifyQrPayloadInBrowser(payload, key, now);

// ---------- La credencial impresa ----------

test("la credencial impresa lleva la firma del evento, vale siempre y se distingue de la del celular", async () => {
  const printed = qr.buildPrintedPayload(passA, keys);
  assert.match(printed, /^[A-Z2-7]{8}\.[A-Z2-7]{103}$/);
  const hoy = await verificar(printed);
  assert.deepEqual(hoy, { ok: true, passId: passA, via: "printed" });
  // sin vencimiento: meses después sigue valiendo
  assert.deepEqual(await verificar(printed, T0 + 90 * 24 * 3600 * SECOND), { ok: true, passId: passA, via: "printed" });
  // en minúsculas, como lo escribiría un lector
  assert.equal((await verificar(printed.toLowerCase())).ok, true);
});

test("la credencial impresa de otro pase, de otro evento o alterada no pasa", async () => {
  const printed = qr.buildPrintedPayload(passA, keys);
  const [, sig] = printed.split(".");
  assert.deepEqual(await verificar(`${passB}.${sig}`), { ok: false, reason: "bad_signature" }, "la firma de A no sirve para B");
  assert.deepEqual(await verificar(printed, T0, otherKeys.publicKey), { ok: false, reason: "bad_signature" }, "firmada por otro evento");
  const alterada = printed.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  assert.equal((await verificar(alterada)).ok, false);
  const cambiada = `${printed.slice(0, 12)}${printed[12] === "A" ? "B" : "A"}${printed.slice(13)}`;
  assert.equal((await verificar(cambiada)).ok, false);
});

test("lo que no tiene la forma del QR es malformado, incluido el formato viejo con llave compartida", async () => {
  for (const basura of ["", "hola", "ABCD2345", `${passA}.`, `${passA}.ABCDEFGHIJKLMNOP`, `${passA}.${"A".repeat(103)}.`, `${passA}.a.b.c.d`, "ABCD234!.AAAA"]) {
    assert.deepEqual(await verificar(basura), { ok: false, reason: "malformed" }, JSON.stringify(basura));
  }
  // un base32 con bits de sobra distintos de cero no es el de una firma de 64 bytes
  const printed = qr.buildPrintedPayload(passA, keys);
  assert.deepEqual(await verificar(`${printed.slice(0, -1)}9`), { ok: false, reason: "malformed" });
});

// ---------- El QR que rota ----------

test("el QR del celular tiene la forma esperada y cambia con cada ventana", async () => {
  const uno = await buildLivePayload(grantA, T0);
  const otro = await buildLivePayload(grantA, T0 + WINDOW_MS);
  assert.match(uno, /^[A-Z2-7]{8}\.[A-Z2-7]{6}\.[A-Z2-7]{154}\.[A-Z2-7]{103}$/);
  assert.notEqual(uno, otro);
  assert.equal(uno, await buildLivePayload(grantA, T0 + 1000), "dentro de la misma ventana sale el mismo (Ed25519 es determinista)");
  assert.deepEqual(await verificar(uno), { ok: true, passId: passA, via: "live" });
});

test("el escáner acepta la ventana actual y la anterior, y rechaza una más vieja con el pase a la vista", async () => {
  const antes = (n) => buildLivePayload(grantA, T0 - n * WINDOW_MS);
  assert.deepEqual(await verificar(await antes(0)), { ok: true, passId: passA, via: "live" }, "la actual");
  assert.deepEqual(await verificar(await antes(1)), { ok: true, passId: passA, via: "live" }, "la anterior (hora desfasada)");
  assert.deepEqual(await verificar(await antes(2)), { ok: false, reason: "expired", passId: passA }, "una captura de hace 40 segundos");
  assert.deepEqual(await verificar(await antes(50)), { ok: false, reason: "expired", passId: passA }, "una captura de hace 17 minutos");
});

test("una ventana que viene del futuro solo se tolera la siguiente (el celular de la persona va adelantado)", async () => {
  assert.equal((await verificar(await buildLivePayload(grantA, T0 + WINDOW_MS))).ok, true);
  assert.deepEqual(await verificar(await buildLivePayload(grantA, T0 + 2 * WINDOW_MS)), { ok: false, reason: "expired", passId: passA });
});

test("la ventana vieja no se arregla cambiando el número de la ventana: la firma lo cubre", async () => {
  const vieja = await buildLivePayload(grantA, T0 - 5 * WINDOW_MS);
  const actual = codec.windowToBase32(codec.windowOf(T0));
  const [id, , cert, sig] = vieja.split(".");
  assert.deepEqual(await verificar(`${id}.${actual}.${cert}.${sig}`), { ok: false, reason: "bad_signature" });
});

test("nadie arma el QR de otro pase: ni con la llave de la propia credencial, ni mezclando certificados", async () => {
  const live = async (grant, now) => (await buildLivePayload(grant, now)).split(".");
  const [, ventana, certA, sigA] = await live(grantA, T0);
  const [, , certB] = await live(grantB, T0);
  // A pone el id de B con su propio certificado y su propia firma
  assert.equal((await verificar(`${passB}.${ventana}.${certA}.${sigA}`)).ok, false);
  // A pone el certificado de B (público, está en cada QR de B) con su propia firma de ventana
  assert.equal((await verificar(`${passA}.${ventana}.${certB}.${sigA}`)).ok, false);
  assert.equal((await verificar(`${passB}.${ventana}.${certB}.${sigA}`)).ok, false);
  // A firma la ventana de B con la llave de A y trae el certificado de B
  const sigAParaB = await ed25519Sign(codec.base64urlToBytes(grantA.seed), codec.windowMessage(passB, codec.windowOf(T0)));
  assert.equal((await verificar(`${passB}.${ventana}.${certB}.${codec.base32Encode(sigAParaB)}`)).ok, false);
  // A se inventa su propia llave y se certifica a sí misma: el evento no firmó ese certificado
  const semilla = new Uint8Array(32).fill(7);
  const clavePropia = qr.publicKeyFromSeed(semilla);
  const certificadoFalso = new Uint8Array(96);
  certificadoFalso.set(clavePropia);
  certificadoFalso.set(qr.signWithSeed(semilla, codec.certificateMessage(passB, clavePropia)), 32);
  const falsa = { passId: passB, seed: bytesB64(semilla), certificate: codec.base32Encode(certificadoFalso) };
  assert.equal((await verificar(await buildLivePayload(falsa, T0))).ok, false);
  // el QR de otro evento tampoco
  assert.equal((await verificar(await buildLivePayload(qr.buildLiveGrant(passA, otherKeys), T0))).ok, false);
});

function bytesB64(bytes) {
  return codec.bytesToBase64url(bytes);
}

test("lo que recibe la persona es de su pase y no deja deducir la llave del evento ni la de otro pase", () => {
  assert.notEqual(grantA.seed, grantB.seed, "cada credencial tiene su llave");
  const raiz = codec.bytesToBase64url(keys.credentialRoot);
  const privada = codec.bytesToBase64url(keys.privateKey);
  for (const grant of [grantA, grantB]) {
    const texto = JSON.stringify(grant);
    assert.ok(!texto.includes(raiz) && !texto.includes(privada), "ni la raíz ni la llave privada del evento viajan");
    assert.equal(codec.base64urlToBytes(grant.seed).length, 32);
    assert.equal(grant.certificate.length, codec.CERTIFICATE_LENGTH);
  }
  assert.equal(grantA.seed, qr.buildLiveGrant(passA, keys).seed, "se deriva igual cada vez: el servidor no guarda nada por credencial");
  assert.notEqual(grantA.seed, qr.buildLiveGrant(passA, otherKeys).seed, "y depende de la raíz del evento");
});

test("el veredicto distingue la impresa, el QR vencido y el que no es de este evento", async () => {
  const printed = await verificar(qr.buildPrintedPayload(passA, keys));
  const vivo = await verificar(await buildLivePayload(grantA, T0));
  const vencido = await verificar(await buildLivePayload(grantA, T0 - 9 * WINDOW_MS));
  const ajeno = await verificar(await buildLivePayload(qr.buildLiveGrant(passA, otherKeys), T0));
  const pase = { id: passA, name: "Ana Prueba", benefits: [], checkedInAt: null, redeemed: {} };
  const visto = (v) => decideVerdict(v, GATE_STATION, pase, undefined);
  // En la puerta el veredicto dice también quién es (asistente, sin equipo) y nunca la dieta; de un QR que no vale, nada.
  const quien = { credential: "attendee", team: null, diet: null };
  const nadie = { credential: null, team: null, diet: null };
  assert.deepEqual(visto(printed), { kind: "ok", action: "checkin", passId: passA, name: "Ana Prueba", via: "printed", ...quien });
  assert.deepEqual(visto(vivo), { kind: "ok", action: "checkin", passId: passA, name: "Ana Prueba", ...quien });
  assert.deepEqual(visto(vencido), { kind: "no", reason: "expired", passId: passA, name: "Ana Prueba", ...nadie });
  assert.deepEqual(visto(ajeno), { kind: "no", reason: "invalid", passId: null, name: null, ...nadie });
  const yaEntro = decideVerdict(printed, GATE_STATION, { ...pase, checkedInAt: "2026-11-22T09:10:00-04:00" }, undefined);
  assert.equal(yaEntro.kind, "already");
  assert.equal(yaEntro.via, "printed");
});

// ---------- La hora ----------

test("un reloj desfasado se corrige con la hora del servidor; uno casi bien se deja", () => {
  assert.equal(clockOffset(1_000_000, 1_000_500), 0);
  assert.equal(clockOffset(1_000_000, 1_000_000 - 2_999), 0);
  assert.equal(clockOffset(1_000_000, 700_000), 300_000);
  assert.equal(clockOffset(1_000_000, 1_300_000), -300_000);
});

test("con la hora corregida, un celular con el reloj cinco minutos atrasado igual arma el QR de la ventana que se espera", async () => {
  const relojDelCelular = T0 - 5 * 60 * SECOND;
  const offset = clockOffset(T0, relojDelCelular);
  const sinCorregir = await buildLivePayload(grantA, relojDelCelular);
  const corregido = await buildLivePayload(grantA, relojDelCelular + offset);
  assert.equal((await verificar(sinCorregir)).ok, false);
  assert.equal((await verificar(corregido)).ok, true);
});

// ---------- Ed25519 en el navegador y el respaldo ----------

test("sin https (sin crypto.subtle, la app abierta por la IP de la red local) la credencial igual firma y el escáner comprueba", async () => {
  const real = globalThis.crypto;
  const mensaje = codec.windowMessage(passA, 123456);
  const semilla = codec.base64urlToBytes(grantA.seed);
  const esperada = qr.signWithSeed(semilla, mensaje);
  try {
    Object.defineProperty(globalThis, "crypto", { value: { getRandomValues: (a) => real.getRandomValues(a) }, configurable: true, writable: true });
    usarRespaldo(true);
    const firma = await ed25519Sign(semilla, mensaje);
    assert.deepEqual(Array.from(firma), Array.from(esperada), "la misma firma que la de node:crypto");
    assert.equal(await ed25519Verify(qr.publicKeyFromSeed(semilla), mensaje, firma), true);
    assert.equal(await ed25519Verify(qr.publicKeyFromSeed(semilla), codec.windowMessage(passA, 123457), firma), false);
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: real, configurable: true, writable: true });
    usarRespaldo(false);
  }
});


test("el respaldo (@noble/ed25519) firma y comprueba lo mismo que WebCrypto, en los dos sentidos", async () => {
  const mensaje = codec.windowMessage(passA, 123456);
  const semilla = codec.base64urlToBytes(grantA.seed);
  const clave = qr.publicKeyFromSeed(semilla);
  try {
    usarRespaldo(false);
    const conWebCrypto = await ed25519Sign(semilla, mensaje);
    usarRespaldo(true);
    const conRespaldo = await ed25519Sign(semilla, mensaje);
    assert.deepEqual(Array.from(conRespaldo), Array.from(conWebCrypto), "la misma firma, bit a bit");
    assert.deepEqual(Array.from(conRespaldo), Array.from(qr.signWithSeed(semilla, mensaje)), "y la misma que la de node:crypto");
    assert.equal(await ed25519Verify(clave, mensaje, conWebCrypto), true);
    assert.equal(await ed25519Verify(clave, codec.windowMessage(passA, 123457), conWebCrypto), false);
    usarRespaldo(false);
    assert.equal(await ed25519Verify(clave, mensaje, conRespaldo), true);

    // y el escáner entero con el respaldo
    usarRespaldo(true);
    assert.deepEqual(await verificar(await buildLivePayload(grantA, T0)), { ok: true, passId: passA, via: "live" });
    assert.deepEqual(await verificar(qr.buildPrintedPayload(passA, keys)), { ok: true, passId: passA, via: "printed" });
    assert.equal((await verificar(await buildLivePayload(grantA, T0 - 3 * WINDOW_MS))).ok, false);
  } finally {
    usarRespaldo(false);
  }
});

test("una clave pública que no es de 32 bytes no se acepta", () => {
  assert.throws(() => importEventKey("AAAA"));
  assert.throws(() => importEventKey(new Uint8Array(31)));
  assert.equal(importEventKey(codec.bytesToBase64url(keys.publicKey)).length, 32);
});

// ---------- Que el QR se lee ----------

/** Dibuja el QR como lo haría una pantalla, a 4 píxeles por módulo y con margen, y lo lee con jsQR. */
function leer(payload, escala = 4) {
  const matriz = renderQrMatrix(payload);
  const margen = 4;
  const lado = (matriz.length + margen * 2) * escala;
  const rgba = new Uint8ClampedArray(lado * lado * 4).fill(255);
  for (let r = 0; r < matriz.length; r++) {
    for (let c = 0; c < matriz.length; c++) {
      if (!matriz[r][c]) continue;
      for (let y = 0; y < escala; y++) {
        for (let x = 0; x < escala; x++) {
          const i = (((r + margen) * escala + y) * lado + (c + margen) * escala + x) * 4;
          rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
        }
      }
    }
  }
  return { texto: jsQR(rgba, lado, lado)?.data ?? null, modulos: matriz.length };
}

test("los dos QR siguen siendo legibles: caben en una versión chica y jsQR los lee", async () => {
  const vivo = await buildLivePayload(grantA, T0);
  const impreso = qr.buildPrintedPayload(passA, keys);
  assert.equal(vivo.length, 8 + 1 + 6 + 1 + 154 + 1 + 103);
  assert.equal(impreso.length, 8 + 1 + 103);
  const rotante = leer(vivo);
  const fijo = leer(impreso);
  assert.equal(rotante.texto, vivo);
  assert.equal(fijo.texto, impreso);
  assert.ok(rotante.modulos <= 57, `el QR del celular tiene ${rotante.modulos} módulos por lado (versión 10 o menos)`);
  assert.ok(fijo.modulos <= 41, `el QR impreso tiene ${fijo.modulos} módulos por lado (versión 6 o menos)`);
});

// ---------- Las llaves del evento ----------

test("las llaves del evento se crean una vez, se guardan y la pública es la de la privada", async () => {
  const repo = getRepo();
  const event = await repo.createEvent({ slug: `llaves-${Date.now().toString(36)}`, name: "Llaves", startsAt: "2026-11-22T09:00:00-04:00", place: "Santa Cruz", organizerName: "La comunidad" });
  const primera = getEventQrKeys(event.id);
  const segunda = getEventQrKeys(event.id);
  assert.deepEqual(Array.from(primera.privateKey), Array.from(segunda.privateKey));
  assert.deepEqual(Array.from(primera.publicKey), Array.from(qr.publicKeyFromSeed(primera.privateKey)));
  assert.deepEqual(Array.from(getEventPublicKey(event.id)), Array.from(primera.publicKey));
  const otro = await repo.createEvent({ slug: `llaves2-${Date.now().toString(36)}`, name: "Otro", startsAt: "2026-11-22T09:00:00-04:00", place: "Santa Cruz", organizerName: "La comunidad" });
  assert.notDeepEqual(Array.from(getEventQrKeys(otro.id).privateKey), Array.from(primera.privateKey));
  // lo que se firma con las guardadas lo comprueba la pública, y la llave privada nunca es la pública
  const impreso = qr.buildPrintedPayload(passA, primera);
  assert.equal((await verificar(impreso, T0, primera.publicKey)).ok, true);
  assert.notDeepEqual(Array.from(primera.privateKey), Array.from(primera.publicKey));
});
