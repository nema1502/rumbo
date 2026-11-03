// Los textos del kit, como dice docs/marca.md: castellano con voseo e inglés en el mismo cambio, sin tecnicismos
// a la vista, sin el punto medio, sin nombrar a Tinkazo, y toda clave que el código usa existe en los dos idiomas.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { entornoDePrueba, APP_DIR } from "./lib/entorno.mjs";

entornoDePrueba();
const { kit } = await import("../src/i18n/kit.ts");
const { CREDENTIAL_KINDS } = await import("../src/lib/credential-kinds.ts");

const todos = (lang) => Object.entries(kit[lang]).map(([clave, texto]) => ({ clave, texto }));
const conPalabra = (lang, re) => todos(lang).filter(({ texto }) => re.test(texto)).map(({ clave, texto }) => `${clave}: ${texto}`);

test("el kit tiene las mismas claves en castellano y en inglés, todas con texto", () => {
  assert.deepEqual(Object.keys(kit.en).sort(), Object.keys(kit.es).sort());
  for (const lang of ["es", "en"]) for (const { clave, texto } of todos(lang)) assert.ok(texto.trim().length > 0, `${lang} ${clave} está vacío`);
  for (const clave of Object.keys(kit.es)) assert.ok(clave.startsWith("kit."), clave);
});

test("las claves del kit que arma el código por partes existen", () => {
  for (const kind of CREDENTIAL_KINDS) assert.ok(kit.es[`kit.tipo.${kind}`] && kit.en[`kit.tipo.${kind}`], kind);
  for (const base of ["breakfast", "lunch", "snack", "dinner"]) {
    for (const lang of ["es", "en"]) assert.ok(kit[lang][`kit.beneficio.${base}`] && kit[lang][`kit.puesto.${base}`], `${lang} ${base}`);
  }
  for (const estado of ["approved", "pending", "waitlist", "declined", "cancelled", "unknown"]) assert.ok(kit.es[`kit.importar.estado.${estado}`] && kit.en[`kit.importar.estado.${estado}`], estado);
  for (const origen of ["luma", "bevy", "otra"]) assert.ok(kit.es[`kit.importar.origen.${origen}`] && kit.en[`kit.importar.origen.${origen}`], origen);
});

function archivos(dir) {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

test("toda clave kit.* que el código escribe entera existe en el diccionario", () => {
  const usadas = new Map();
  for (const ruta of archivos(join(APP_DIR, "src"))) {
    if (ruta.endsWith("kit.ts")) continue;
    const texto = readFileSync(ruta, "utf8");
    for (const m of texto.matchAll(/["'`](kit\.[A-Za-z0-9_.-]+)["'`]/g)) usadas.set(m[1], ruta);
  }
  assert.ok(usadas.size > 20, "el código usa claves del kit");
  const faltan = [...usadas].filter(([clave]) => !(clave in kit.es) || !(clave in kit.en)).map(([clave, ruta]) => `${clave} (${ruta})`);
  assert.deepEqual(faltan, []);
});

test("nada de tecnicismos a la vista, ni el punto medio, ni el nombre de otro producto", () => {
  assert.deepEqual(conPalabra("es", /\b(hash|hashes|firma digital|ledger|direcci[oó]n|wallet|billetera|token|nft|contrato|xlm|cadena|blockchain|red|redes)\b/i), []);
  assert.deepEqual(conPalabra("en", /\b(hash|hashes|signature|ledger|address|wallet|token|nft|contract|xlm|chain|blockchain|network)\b/i), []);
  assert.deepEqual(conPalabra("es", /\b(pnpm|npm|seed|node|api|json|sql)\b/i), []);
  assert.deepEqual([...conPalabra("es", /·/), ...conPalabra("en", /·/)], []);
  assert.deepEqual([...conPalabra("es", /tinkazo/i), ...conPalabra("en", /tinkazo/i)], []);
});

test("credencial en castellano, pass en inglés; y el voseo, no el tuteo", () => {
  assert.deepEqual(conPalabra("es", /\bpases?\b/i), []);
  assert.deepEqual(conPalabra("en", /\b(credentials?|badges?)\b/i), []);
  assert.deepEqual(conPalabra("es", /(?<!\p{L})(tienes|puedes|quieres|necesitas|eres)(?!\p{L})/iu), []);
  assert.deepEqual(conPalabra("es", /\b(pude|puedo|tengo|tuve)\b/i), []);
});
