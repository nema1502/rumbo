// La credencial para imprimir (100 por 150 milímetros): las filas de canjes nunca se pisan con la frase del pie,
// también con un nombre de dos líneas; lo que no entra se resume en "+N".
import assert from "node:assert/strict";
import { test } from "node:test";

const { renderCredentialSvg } = await import("../src/server/evento/credencial-svg.ts");

const PIE_MINIMO = 20;

/** Una credencial de muestra, sin base ni red: alcanza con lo que dibuja el SVG. */
function vista(nombre, beneficios) {
  return {
    pass: { id: "PASEPRUEBA12" },
    person: { name: nombre },
    event: { name: "Hackatón de la comunidad", startsAt: "2026-11-22T09:00:00-04:00", endsAt: "2026-11-22T19:00:00-04:00", timezone: "America/La_Paz", place: "Santa Cruz de la Sierra", venue: null },
    ticketType: { name: "Con almuerzo" },
    kind: "attendee",
    team: null,
    number: 3,
    total: 200,
    paid: true,
    checkedIn: false,
    benefits: beneficios.map((name, i) => ({ name, state: i === 0 ? "pagada" : "pendiente" })),
    qrPayload: "PASEPRUEBA12.FIRMAFIRMAFIRMAFIRMAFIRMAFIRMA",
    live: { passId: "PASEPRUEBA12", key: "", keyId: "" },
    chainChecked: false,
  };
}

/** Las alturas (y) de las filas de canjes (en tinta) y del "+N" (apagado): los textos de 12 que empiezan en el margen izquierdo. */
function filas(svg) {
  return [...svg.matchAll(/<text x="32" y="([\d.]+)" font-family="[^"]*" font-weight="500" font-size="12" fill="(?:#0F1C2E|#5B6675)"/g)].map((m) => Number(m[1]));
}
function pie(svg) {
  const m = /<text x="200" y="([\d.]+)" font-family="[^"]*" font-size="10.5"/.exec(svg);
  assert.ok(m, "la frase del pie está");
  return Number(m[1]);
}

test("con un nombre de dos líneas y tres canjes, las tres filas entran arriba del pie", () => {
  const svg = renderCredentialSvg(vista("Jorge Luis Rodriguez Pena", ["Almuerzo", "Polera talle M", "Premio del sorteo"]), "es");
  const ys = filas(svg);
  assert.equal(ys.length, 3);
  assert.ok(Math.max(...ys) <= pie(svg) - PIE_MINIMO, `la última fila (${Math.max(...ys)}) se pisa con el pie (${pie(svg)})`);
  assert.doesNotMatch(svg, />\+\d+</, "nada quedó afuera");
});

test("con un nombre de una línea entran cuatro canjes; el quinto va al +N, también arriba del pie", () => {
  const cuatro = renderCredentialSvg(vista("Ana Quiroga", ["Almuerzo", "Polera talle M", "Premio del sorteo", "Refrigerio"]), "es");
  assert.equal(filas(cuatro).length, 4);
  assert.ok(Math.max(...filas(cuatro)) <= pie(cuatro) - PIE_MINIMO);
  assert.doesNotMatch(cuatro, />\+\d+</);

  const seis = renderCredentialSvg(vista("Ana Quiroga", ["Desayuno", "Almuerzo", "Refrigerio", "Cena", "Polera talle M", "Premio del sorteo"]), "es");
  assert.match(seis, />\+3</, "tres filas y +3");
  assert.ok(Math.max(...filas(seis)) <= pie(seis) - PIE_MINIMO, "el +N también entra arriba del pie");
});

test("con un nombre de dos líneas y seis canjes quedan dos filas y +4", () => {
  const svg = renderCredentialSvg(vista("María Fernanda Gutiérrez Salvatierra", ["Desayuno", "Almuerzo", "Refrigerio", "Cena", "Polera talle M", "Premio del sorteo"]), "en");
  assert.match(svg, />\+4</);
  assert.ok(Math.max(...filas(svg)) <= pie(svg) - PIE_MINIMO);
});
