// La hora del servidor medida desde el navegador (src/lib/reloj.ts), sin red ni Next: la medida es un número cuando
// se pudo medir, también 0 (el reloj está bien, o volvió a estarlo), y null cuando no (sin conexión, el servidor no
// contestó o contestó algo que no es una hora). La credencial (QrRotante.tsx) y el escáner (Escaner.tsx) conservan
// la última medida buena ante un null y aplican un 0 medido: antes un 0 se descartaba como si fuera "sin red", y
// un celular que se sincronizaba solo y volvía a la hora buena seguía corrigiendo con el desfase viejo, así que
// mostraba (o exigía) el QR de una ventana que ya no era la del servidor, para siempre.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { CLOCK_JUMP_MS, clockJumpSince, clockMark, measureClockOffset } = await import("../src/lib/reloj.ts");

const MINUTE = 60_000;
const T = 1_800_000_000_000;
/** Un servidor de mentira que contesta lo que se le diga, y un reloj local fijo. */
const servidor = (cuerpo, ok = true) => async () => ({ ok, json: async () => cuerpo });
const reloj = (ms) => () => ms;
const sinConexion = async () => {
  throw new TypeError("fetch failed");
};

test("una medida buena es un número, también cuando es cero", async () => {
  assert.equal(await measureClockOffset(servidor({ now: T }), reloj(T)), 0, "el reloj está bien: cero, no null");
  assert.equal(await measureClockOffset(servidor({ now: T }), reloj(T + 2000)), 0, "dos segundos de diferencia se dejan");
  assert.equal(await measureClockOffset(servidor({ now: T }), reloj(T + 10 * MINUTE)), -10 * MINUTE, "adelantado diez minutos");
  assert.equal(await measureClockOffset(servidor({ now: T }), reloj(T - 25 * MINUTE)), 25 * MINUTE, "atrasado veinticinco");
});

test("el viaje de ida y vuelta se compensa: lo que dijo el servidor vale para la mitad del viaje", async () => {
  // El pedido sale en T y vuelve en T + 400 ms; el servidor contestó a mitad de camino, con su reloj cinco minutos atrás.
  let miradas = 0;
  const ahora = () => (miradas++ === 0 ? T : T + 400);
  assert.equal(await measureClockOffset(servidor({ now: T - 5 * MINUTE + 200 }), ahora), -5 * MINUTE);
});

test("sin medida es null, no cero: sin conexión, el servidor no contesta bien o no manda una hora", async () => {
  assert.equal(await measureClockOffset(sinConexion, reloj(T)), null, "sin conexión");
  assert.equal(await measureClockOffset(servidor({ now: T }, false), reloj(T)), null, "una respuesta que no es 200");
  for (const cuerpo of [{}, { now: String(T) }, { now: Infinity }, { now: NaN }, { now: null }, null, [], "texto"]) {
    assert.equal(await measureClockOffset(servidor(cuerpo), reloj(T)), null, JSON.stringify(cuerpo));
  }
  const rota = async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError("no es JSON");
    },
  });
  assert.equal(await measureClockOffset(rota, reloj(T)), null, "un cuerpo que no es JSON");
});

test("quien mide conserva la última medida ante un null y aplica un cero medido: el reloj que vuelve a estar bien deja de corregirse", async () => {
  // La regla de QrRotante.tsx (desfase.current) y de Escaner.tsx (clockOffsetMs, con la hora de la foto si no hay medida).
  let desfase = 0;
  const aplicar = (medida) => {
    if (medida !== null) desfase = medida;
  };
  aplicar(await measureClockOffset(servidor({ now: T }), reloj(T + 10 * MINUTE)));
  assert.equal(desfase, -10 * MINUTE, "el celular va diez minutos adelantado: se corrige");
  aplicar(await measureClockOffset(sinConexion, reloj(T + 10 * MINUTE)));
  assert.equal(desfase, -10 * MINUTE, "sin conexión no hay medida: queda la anterior");
  aplicar(await measureClockOffset(servidor({ now: T }), reloj(T)));
  assert.equal(desfase, 0, "el reloj se sincronizó solo y volvió a estar bien: la corrección se va");

  // Las dos pantallas aplican toda medida que no sea null; ninguna descarta el cero.
  const credencial = readFileSync(new URL("../src/components/evento/QrRotante.tsx", import.meta.url), "utf8");
  const escaner = readFileSync(new URL("../src/components/escaner/Escaner.tsx", import.meta.url), "utf8");
  assert.match(credencial, /medida !== null\) desfase\.current = medida/);
  assert.match(escaner, /return medida \?\? clockOffset\(/);
  for (const fuente of [credencial, escaner]) assert.doesNotMatch(fuente, /medida !== 0/);
});

test("un salto del reloj de pared se nota contra el monotónico; el paso normal del tiempo, no", () => {
  const antes = { wall: 1000, mono: 50 };
  assert.equal(clockJumpSince(antes, { wall: 2000, mono: 1050 }), 0, "un segundo en los dos relojes");
  assert.equal(clockJumpSince(antes, { wall: 1000 + 25 * MINUTE, mono: 1050 }), 25 * MINUTE - 1000, "el de pared saltó adelante");
  assert.equal(clockJumpSince(antes, { wall: 2000 - 25 * MINUTE, mono: 1050 }), -25 * MINUTE, "y atrás");
  assert.equal(clockJumpSince(antes, { wall: 2000 + CLOCK_JUMP_MS, mono: 1050 }), 0, "hasta cinco segundos no cuenta como salto");
  const marca = clockMark();
  assert.ok(Number.isFinite(marca.wall) && Number.isFinite(marca.mono));
});
