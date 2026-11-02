// El CSV de quien organiza no deja fórmulas: lo que escribió quien se inscribe (el nombre, el correo) no
// se ejecuta al abrir la lista en Excel o en Sheets.
import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { buildPassesCsv, csvCell } = await import("../src/server/panel.ts");

test("una celda que empieza como fórmula va con comilla simple adelante", () => {
  assert.equal(csvCell('=HYPERLINK("http://malo.example","clic")'), `"'=HYPERLINK(""http://malo.example"",""clic"")"`);
  assert.equal(csvCell("=cmd|' /C calc'!A0"), "'=cmd|' /C calc'!A0");
  assert.equal(csvCell("+54 9 11"), "'+54 9 11");
  assert.equal(csvCell("-2+3"), "'-2+3");
  assert.equal(csvCell("@SUMA(A1)"), "'@SUMA(A1)");
  assert.equal(csvCell("\t=1+1"), "'\t=1+1");
  assert.equal(csvCell("\r=1+1"), `"'\r=1+1"`);
});

test("el texto común y los números quedan como estaban", () => {
  assert.equal(csvCell("Ana Quiroga"), "Ana Quiroga");
  assert.equal(csvCell("Quiroga, Ana"), '"Quiroga, Ana"');
  assert.equal(csvCell('Ana "la de la puerta"'), '"Ana ""la de la puerta"""');
  assert.equal(csvCell("ana@example.com"), "ana@example.com");
  assert.equal(csvCell("Ana = organizadora"), "Ana = organizadora");
  assert.equal(csvCell(-5), "-5");
});

test("en el CSV del evento, un nombre y un correo con fórmula llegan como texto", async () => {
  const repo = getRepo();
  const datos = await eventoDePrueba(repo);
  await paseDePrueba(repo, datos, { name: '=HYPERLINK("http://malo.example","clic")', email: "=1+1@example.com" });
  await paseDePrueba(repo, datos, { name: "Beto Prueba", email: "beto@example.com" });
  const csv = await buildPassesCsv(datos.event, "es", repo);
  const filas = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
  assert.equal(filas.length, 3);
  const malo = filas.find((f) => f.includes("HYPERLINK"));
  assert.ok(malo.includes(`"'=HYPERLINK(""http://malo.example"",""clic"")"`), malo);
  assert.ok(malo.includes(",'=1+1@example.com,"), malo);
  // ninguna celda, ya sin comillas, empieza como fórmula
  for (const fila of filas) {
    for (const celda of fila.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, ""))) {
      assert.ok(!/^[=+\-@\t\r]/.test(celda), `celda con fórmula: ${celda}`);
    }
  }
  assert.ok(filas.some((f) => f.includes(",Beto Prueba,beto@example.com,")));
});
