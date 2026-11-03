// Lo visible, como dice docs/marca.md: cada texto en castellano y en inglés, y sin tecnicismos en pantalla
// (se dice credencial, canje, vale, pase, cuenta, el registro del evento).
import assert from "node:assert/strict";
import { test } from "node:test";

const { comun } = await import("../src/i18n/comun.ts");
const { evento } = await import("../src/i18n/evento.ts");
const { escaner } = await import("../src/i18n/escaner.ts");
const { panel } = await import("../src/i18n/panel.ts");
const { verificacion } = await import("../src/i18n/verificacion.ts");

const AREAS = { comun, evento, escaner, panel, verificacion };

const todos = (lang) => Object.entries(AREAS).flatMap(([area, dict]) => Object.entries(dict[lang]).map(([clave, texto]) => ({ area, clave, texto })));
const conPalabra = (lang, re) => todos(lang).filter(({ texto }) => re.test(texto)).map(({ clave, texto }) => `${clave}: ${texto}`);

test("cada área tiene las mismas claves en castellano y en inglés", () => {
  for (const [area, dict] of Object.entries(AREAS)) {
    assert.deepEqual(Object.keys(dict.en).sort(), Object.keys(dict.es).sort(), `el área ${area} no tiene las mismas claves en los dos idiomas`);
  }
});

test("el panel no habla de la cadena: dice el registro del evento", () => {
  assert.deepEqual(conPalabra("es", /\b(cadena|blockchain)\b/i), []);
  assert.deepEqual(conPalabra("en", /\b(chain|blockchain)\b/i), []);
  assert.equal(panel.es["panel.cadena.boton"], "Verificar el registro del evento");
  assert.equal(panel.en["panel.cadena.boton"], "Verify the event record");
});

test("al voluntario no se le habla de la red sino de la conexión, y nadie habla en primera persona", () => {
  assert.deepEqual(conPalabra("es", /\b(red|redes)\b/i), []);
  assert.deepEqual(conPalabra("en", /\bnetwork\b/i), []);
  assert.deepEqual(conPalabra("es", /\b(pude|puedo|tengo|tuve)\b/i), []);
});

test("la gente no ve comandos de consola: la pista para quien desarrolla va al servidor", () => {
  assert.deepEqual(conPalabra("es", /\b(pnpm|npm|seed|node)\b/i), []);
  assert.deepEqual(conPalabra("en", /\b(pnpm|npm|seed|node)\b/i), []);
  assert.equal(comun.es["inicio.vacio"], "Todavía no hay eventos.");
  assert.equal(comun.en["inicio.vacio"], "No events yet.");
});

test("en el escáner y el panel, la misma cosa se llama igual: credencial en castellano, pass en inglés", () => {
  const enCastellano = [...Object.entries(escaner.es), ...Object.entries(panel.es)].filter(([, texto]) => /\bpases?\b/i.test(texto));
  assert.deepEqual(enCastellano.map(([clave, texto]) => `${clave}: ${texto}`), []);
  const enIngles = [...Object.entries(escaner.en), ...Object.entries(panel.en)].filter(([, texto]) => /\b(credentials?|badges?)\b/i.test(texto));
  assert.deepEqual(enIngles.map(([clave, texto]) => `${clave}: ${texto}`), []);
  assert.equal(panel.es["panel.pases.titulo"], panel.es["panel.contador.credenciales"]);
});

test("en ningún lado: hashes, firmas, direcciones, billeteras, tokens, contratos ni el punto medio", () => {
  assert.deepEqual(conPalabra("es", /\b(hash|hashes|firma digital|ledger|direcci[oó]n|wallet|billetera|token|nft|contrato|xlm)\b/i), []);
  assert.deepEqual(conPalabra("en", /\b(hash|hashes|signature|ledger|address|wallet|token|nft|contract|xlm)\b/i), []);
  assert.deepEqual(conPalabra("es", /·/), []);
  assert.deepEqual(conPalabra("en", /·/), []);
});
