import assert from "node:assert/strict";
import { test } from "node:test";
import { capturarConsola, entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { eventAllies } = await import("../src/server/evento/aliados.ts");

const config = JSON.stringify({
  "nodo-prueba": {
    grupos: [
      { rol: "Presenta", logos: [{ archivo: "/eventos/nodo-prueba/aliado-1.svg", alt: "Comunidad", ancho: 96 }] },
      {
        rol: "Con el apoyo de",
        logos: [
          { archivo: "/eventos/nodo-prueba/aliado-2.png", alt: "Apoyo Uno", ancho: 120 },
          { archivo: "https://otro-servidor.example.com/logo.png", alt: "De afuera", ancho: 100 },
          { archivo: "//otro-servidor.example.com/logo.png", alt: "Sin esquema", ancho: 100 },
          { archivo: "/eventos/../../secreto.png", alt: "Sube carpetas", ancho: 100 },
        ],
      },
      { rol: "Sede", logos: [] },
    ],
  },
});

test("los aliados del evento salen de la variable, con logos propios y nada de afuera", () => {
  assert.deepEqual(eventAllies({ slug: "nodo-prueba" }, config), [
    { role: "Presenta", logos: [{ src: "/eventos/nodo-prueba/aliado-1.svg", alt: "Comunidad", width: 96, height: 40 }] },
    { role: "Con el apoyo de", logos: [{ src: "/eventos/nodo-prueba/aliado-2.png", alt: "Apoyo Uno", width: 120, height: 40 }] },
  ]);
  assert.equal(eventAllies({ slug: "otro-evento" }, config), null, "otro evento no tiene aliados");
  assert.equal(eventAllies({ slug: "nodo-prueba" }, undefined), null);
  assert.equal(eventAllies({ slug: "nodo-prueba" }, "   "), null);
});

test("una variable rota no rompe la credencial: sale sin aliados y lo dice en el registro", async () => {
  const { resultado, lineas } = await capturarConsola(async () => eventAllies({ slug: "nodo-prueba" }, "{no es json"));
  assert.equal(resultado, null);
  assert.ok(lineas.some((a) => a.includes("RUMBO_EVENT_ALLIES")), JSON.stringify(lineas));
});
