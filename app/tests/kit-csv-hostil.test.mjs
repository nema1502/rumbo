// Un archivo roto o armado para hacer trabajar de más al servidor no lo tumba: una celda de miles de puntos no
// cuesta segundos, los topes de celda, columnas y filas se avisan con claridad, las líneas vacías no son filas,
// una coma final no corre las columnas, un byte suelto no convierte todo el archivo a Windows-1252 y un NUL se va.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const imp = await import("../src/server/kit/importar.ts");
const csv = await import("../src/server/kit/csv.ts");

const enc = (s) => new TextEncoder().encode(s);
const MIB = 1024 * 1024;

/** Lo que tarda fn, en milisegundos, y lo que devolvió (o el error). */
function medir(fn) {
  const t0 = performance.now();
  try {
    return { ms: performance.now() - t0, valor: fn() };
  } catch (error) {
    return { ms: performance.now() - t0, error };
  }
}

const codigo = (r) => r.error?.code;

test("una celda con miles de puntos no cuesta segundos: la expresión del correo no se prueba sobre textos largos", () => {
  // Debajo del tope de la celda: se lee rápido, y la celda no es un correo.
  const corta = medir(() => imp.parseGuests(`Name,Email\nPedro,"a@${".".repeat(900)},b"\nAna,ana@example.com\n`));
  assert.ok(!corta.error, "se lee");
  assert.ok(corta.ms < 1500, `tardó ${corta.ms.toFixed(0)} ms`);
  // Por encima del tope: se rechaza enseguida, no se recorre con la expresión.
  const larga = medir(() => imp.parseGuests(`Name,Email\nPedro,"a@${".".repeat(40000)},b"\nAna,ana@example.com\n`));
  assert.equal(codigo(larga), "cell_too_long");
  assert.ok(larga.ms < 1500, `tardó ${larga.ms.toFixed(0)} ms`);
});

test("los topes: más de mil letras en una celda, más de cien columnas o más de cinco mil filas se rechazan con un aviso claro", () => {
  assert.equal(codigo(medir(() => imp.parseGuests(`Name,Email\n${"x".repeat(1001)},a@example.com\n`))), "cell_too_long");
  assert.ok(!medir(() => imp.parseGuests(`Name,Email\n${"x".repeat(1000)},a@example.com\n`)).error, "mil justas entran");

  const anchas = ["Name,Email" + ",x".repeat(99), "Ana,ana@example.com"].join("\n");
  assert.equal(codigo(medir(() => imp.parseGuests(anchas))), "too_many_columns");
  assert.ok(!medir(() => imp.parseGuests(["Name,Email" + ",x".repeat(98), "Ana,ana@example.com"].join("\n"))).error, "cien columnas entran");

  const filas = (n) => ["Name,Email", ...Array.from({ length: n }, (_, i) => `P${i},p${i}@example.com`)].join("\n");
  const cinco = medir(() => imp.parseGuests(filas(5000)));
  assert.equal(cinco.valor.rows.length, 5000);
  assert.equal(codigo(medir(() => imp.parseGuests(filas(5001)))), "too_many_rows");
  assert.deepEqual(csv.TABLE_LIMITS, { maxCell: 1000, maxColumns: 100, maxRows: 5000 });
  assert.ok(new imp.ImportFormatError("too_many_rows") instanceof Error);
});

test("una cabecera de miles de columnas con filas cortas no se rellena fila por fila: se rechaza antes de costar memoria", () => {
  const header = "Name,Email" + ",x".repeat(4998);
  let body = "";
  for (let i = 0; i < 3000; i++) body += `P${i},p${i}@example.com\n`;
  const antes = process.memoryUsage().heapUsed;
  const r = medir(() => imp.parseGuests(header + "\n" + body));
  assert.equal(codigo(r), "too_many_columns");
  assert.ok(r.ms < 3000, `tardó ${r.ms.toFixed(0)} ms`);
  assert.ok(process.memoryUsage().heapUsed - antes < 200 * MIB, "sin inflar la memoria");
});

test("las líneas vacías no son filas: dos megas de saltos de línea y una tabla chica se leen enseguida", () => {
  const r = medir(() => imp.parseGuestFile(enc("\n".repeat(2 * MIB - 40) + "Name,Email\nAna,ana@example.com\n")));
  assert.ok(!r.error, String(r.error?.message));
  assert.equal(r.valor.rows.length, 1);
  assert.ok(r.ms < 4000, `tardó ${r.ms.toFixed(0)} ms`);
  assert.equal(csv.parseTable("\n\n\nName,Email\n\nAna,a@example.com\n\n").rows.length, 1);
});

test("una coma final en cada fila (o también en la cabecera) no corre las columnas ni deja la fila como vacía", () => {
  const datos = imp.parseGuests("Name,Email,Status\nAna Uno,ana1@example.com,approved,\nBeto Dos,beto2@example.com,approved,\nCaro Tres,caro3@example.com,approved,\n");
  assert.deepEqual(datos.rows.map((r) => [r.name, r.email, r.status]), [["Ana Uno", "ana1@example.com", "approved"], ["Beto Dos", "beto2@example.com", "approved"], ["Caro Tres", "caro3@example.com", "approved"]]);
  assert.deepEqual(datos.skippedLines, []);
  const ambas = imp.parseGuests("Name,Email,Status,\nAna Uno,ana1@example.com,approved,\nBeto Dos,beto2@example.com,approved,\n");
  assert.deepEqual(ambas.rows.map((r) => [r.name, r.email, r.status]), [["Ana Uno", "ana1@example.com", "approved"], ["Beto Dos", "beto2@example.com", "approved"]]);
  // Y la coma sin comillas dentro de un nombre se sigue arreglando como antes.
  const coma = imp.parseGuests("Name,Email,Status\nSalvatierra, Rodrigo,rod@example.com,approved\nAna Uno,ana1@example.com,approved\n");
  assert.deepEqual(coma.rows.map((r) => r.email), ["rod@example.com", "ana1@example.com"]);
});

test("un archivo UTF-8 con un solo byte suelto de Latin-1 no se lee entero como Windows-1252; uno en Windows-1252 de verdad, sí", () => {
  const mezcla = new Uint8Array(Buffer.concat([Buffer.from("Name,Email\nMaría Pérez,maria@example.com\nJos"), Buffer.from([0xe9]), Buffer.from(" Ñandú,jose@example.com\n")]));
  const leido = imp.parseGuestFile(mezcla);
  assert.equal(leido.rows[0].name, "María Pérez", "las tildes del resto del archivo quedan bien");
  assert.ok(leido.rows[1].name.includes("Ñandú"));
  const latin = imp.parseGuestFile(new Uint8Array(Buffer.from("Name,Email\nMar\xEDa P\xE9rez,maria@example.com\n", "latin1")));
  assert.equal(latin.rows[0].name, "María Pérez");
});

test("un NUL dentro de un nombre se descarta al leer, y la importación lo cuenta como una persona más", () => {
  const texto = "Name,Email\nAna Uno,ana1@example.com\nBeto Dos,beto2@example.com\nCaro\u0000Tres,caro3@example.com\nDani Cuatro,dani4@example.com\n";
  const bytes = new Uint8Array([0xff, 0xfe, ...Buffer.from(texto, "utf16le")]);
  const leido = imp.parseGuestFile(bytes);
  assert.equal(leido.rows.length, 4);
  assert.ok(leido.rows.every((r) => !r.name.includes("\u0000") && !r.email.includes("\u0000")));
  assert.equal(imp.tidyName("Caro\u0000 \u0007Tres"), "Caro Tres");
});
