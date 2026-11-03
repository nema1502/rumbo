// El lector de CSV del kit (src/server/kit/csv.ts). Viene del lector de Tinkazo (licencia MIT), y estas son sus
// pruebas, pasadas de vitest a node:test, menos las del sorteo (filtros de asistencia, lista de nombres, homónimos),
// que el kit no usa. Se suman las de Bevy y las de encontrar la columna por nombre.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { parseTable, looksTabular, decodeText, detectSource, fixCase, findColumn, statusColumn, emailColumn, presentColumn } = await import("../src/server/kit/csv.ts");

/** Lo que exporta Luma: la primera columna es el identificador, no el nombre. */
const LUMA = `api_id,name,email,created_at,checked_in_at
evt-guest-a1,Ana Quispe,ana@example.org,2026-09-01T14:02:00Z,2026-09-03T18:10:00Z
evt-guest-b2,"Mejía, Nicolás",nico@example.org,2026-09-01T15:40:00Z,
evt-guest-c3,Rodrigo Mamani,rodrigo@example.org,2026-09-02T09:12:00Z,2026-09-03T18:22:00Z`;

describe("parseTable", () => {
  test("lee la cabecera y no la cuenta como participante", () => {
    const t = parseTable(LUMA);
    assert.equal(t.headerDetected, true);
    assert.deepEqual(t.columns, ["api_id", "name", "email", "created_at", "checked_in_at"]);
    assert.equal(t.rows.length, 3);
  });

  test("elige la columna de nombres, no la primera", () => {
    const t = parseTable(LUMA);
    assert.equal(t.suggested, 1);
    assert.equal(t.columns[t.suggested], "name");
  });

  test("no parte un nombre que tiene una coma adentro", () => {
    assert.equal(parseTable(LUMA).rows[1][1], "Mejía, Nicolás");
  });

  test("acepta punto y coma, que es lo que sale de Excel en español", () => {
    const t = parseTable("Nombre;Correo\nAna Quispe;ana@example.org\nLuis Choque;luis@example.org");
    assert.deepEqual(t.columns, ["Nombre", "Correo"]);
    assert.equal(t.suggested, 0);
    assert.equal(t.rows.length, 2);
  });

  test("acepta tabulaciones, que es lo que sale de pegar una hoja de cálculo", () => {
    const t = parseTable("Ana Quispe\tana@example.org\nLuis Choque\tluis@example.org");
    assert.equal(t.headerDetected, false);
    assert.deepEqual(t.columns, ["Columna 1", "Columna 2"]);
    assert.equal(t.rows.length, 2);
  });

  test("sin cabecera, la deduce por la forma de los datos", () => {
    const t = parseTable("1001,Ana Quispe\n1002,Luis Choque\n1003,Rodrigo Mamani");
    assert.equal(t.headerDetected, false);
    assert.equal(t.suggested, 1);
  });

  test("entiende las comillas dobles escapadas", () => {
    assert.equal(parseTable('nombre,alias\nAna Quispe,"la ""Chola"" Quispe"\nLuis Choque,tuto').rows[0][1], 'la "Chola" Quispe');
  });

  test("quita el BOM que pone Excel al inicio del archivo", () => {
    assert.equal(parseTable("﻿nombre,correo\nAna Quispe,ana@example.org").columns[0], "nombre");
  });

  test("una lista suelta de nombres no es una tabla", () => {
    assert.equal(looksTabular("Ana Quispe\nLuis Choque\nRodrigo Mamani"), false);
  });

  test("un texto vacío no es una tabla", () => {
    assert.equal(parseTable("   \n  "), null);
  });

  test("filas de ancho distinto no son una tabla", () => {
    assert.equal(looksTabular("a,b,c\nd,e\nf"), false);
  });
});

describe("la codificación del archivo", () => {
  const latin1 = (s) => [...s].map((c) => c.charCodeAt(0));
  const utf8 = (s) => [...new TextEncoder().encode(s)];
  const utf16 = (s, bigEndian = false) =>
    [...s].flatMap((c) => {
      const n = c.charCodeAt(0);
      return bigEndian ? [n >> 8, n & 0xff] : [n & 0xff, n >> 8];
    });
  const bytes = (...parts) => Uint8Array.from(parts.flat());

  test("lee un CSV de Excel en Windows (ANSI) sin dejar «Mar�a»", () => {
    const text = decodeText(bytes(latin1("Nombre;Correo\nMaría Peña;maria@example.org\nÓscar Limachi;oscar@example.org")));
    assert.ok(!text.includes("�"));
    assert.deepEqual(parseTable(text).rows.map((r) => r[0]), ["María Peña", "Óscar Limachi"]);
  });

  test("en Windows-1252, lo de 0x80 a 0x9F son letras y no controles", () => {
    assert.equal(decodeText(bytes(latin1("Pat O"), [0x92], latin1("Brien"))), "Pat O’Brien");
  });

  test("UTF-8, con o sin BOM, queda igual y sin el BOM", () => {
    assert.equal(decodeText(bytes(utf8("nombre\nSofía Aguilar"))), "nombre\nSofía Aguilar");
    assert.equal(decodeText(bytes([0xef, 0xbb, 0xbf], utf8("nombre\nSofía Aguilar"))), "nombre\nSofía Aguilar");
  });

  test("UTF-16 con BOM, que es el «Texto Unicode» de Excel, en los dos órdenes", () => {
    const tsv = "Nombre\tCorreo\nFranco Ibáñez\tfranco@example.org";
    assert.equal(decodeText(bytes([0xff, 0xfe], utf16(tsv))), tsv);
    assert.equal(decodeText(bytes([0xfe, 0xff], utf16(tsv, true))), tsv);
  });

  test("UTF-16 sin BOM, por los ceros", () => {
    assert.equal(decodeText(bytes(utf16("Camila Suárez\nAndrés Villca"))), "Camila Suárez\nAndrés Villca");
  });

  test("una planilla de Excel, un PDF o algo binario no son texto", () => {
    assert.equal(decodeText(bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])), null);
    assert.equal(decodeText(bytes(latin1("%PDF-1.7\n"))), null);
    assert.equal(decodeText(bytes(latin1("Ana"), [0x00, 0x00, 0x00, 0x01, 0xff], latin1("Luis"))), null);
  });

  test("los finales de línea de Windows y de Mac quedan en \\n", () => {
    assert.equal(decodeText(bytes(latin1("Ana Vargas\r\nDiego Rojas\rElena Condori"))), "Ana Vargas\nDiego Rojas\nElena Condori");
  });

  test("un archivo vacío es texto vacío", () => {
    assert.equal(decodeText(new Uint8Array()), "");
  });
});

describe("el encabezado no es un participante", () => {
  test("en una tabla, «Participantes» también es encabezado aunque no haya números", () => {
    const t = parseTable("Participantes;Carrera\nMaría Quispe;Sistemas\nJorge Mamani;Civil");
    assert.equal(t.headerDetected, true);
    assert.deepEqual(t.rows.map((r) => r[0]), ["María Quispe", "Jorge Mamani"]);
  });

  test("un archivo con solo el encabezado no tiene a nadie", () => {
    const t = parseTable("Nombre,Correo\n");
    assert.equal(t.headerDetected, true);
    assert.deepEqual(t.rows, []);
  });
});

describe("una fila que no encaja no descarta la tabla", () => {
  test("una coma sin comillas en el nombre se arregla", () => {
    const t = parseTable("Nombre,Correo\nAna Vargas,ana@example.org\nMejía, Nicolás,nico@example.org\nPablo Gutiérrez,pablo@example.org");
    assert.deepEqual(t.columns, ["Nombre", "Correo"]);
    assert.deepEqual(t.rows, [
      ["Ana Vargas", "ana@example.org"],
      ["Mejía, Nicolás", "nico@example.org"],
      ["Pablo Gutiérrez", "pablo@example.org"],
    ]);
    assert.deepEqual(t.skipped, []);
  });

  test("en un export de Luma, también: la coma estaba en el nombre y no en el código", () => {
    const t = parseTable(LUMA.replace('"Mejía, Nicolás"', "Mejía, Nicolás"));
    assert.deepEqual(t.skipped, []);
    assert.deepEqual(t.rows[1].slice(0, 3), ["evt-guest-b2", "Mejía, Nicolás", "nico@example.org"]);
  });

  test("si la coma pudo estar en dos columnas, no adivina: salta la fila y dice en qué línea está", () => {
    const t = parseTable("Nombre,Dirección,Correo\nAna Vargas,Calle 1,ana@example.org\nLuis Choque,Calle 2, Zona Sur,luis@example.org\nRodrigo Peña,Calle 3,rodrigo@example.org");
    assert.deepEqual(t.rows.map((r) => r[0]), ["Ana Vargas", "Rodrigo Peña"]);
    assert.deepEqual(t.skipped, [3]);
  });

  test("las líneas se cuentan bien aunque una celda entre comillas tenga saltos de línea", () => {
    const t = parseTable('Nombre,Dirección,Correo\nAna Vargas,"Calle 1\nZona Sur",ana@example.org\nLuis Choque,Calle 2, Zona Sur,luis@example.org');
    assert.equal(t.rows.length, 1);
    assert.deepEqual(t.skipped, [4]);
  });

  test("una fila corta se completa con celdas vacías, como en cualquier planilla", () => {
    const t = parseTable("nombre,correo\nAna Vargas,ana@example.org\nLuis Choque\nRodrigo Peña,rodrigo@example.org");
    assert.deepEqual(t.rows[1], ["Luis Choque", ""]);
    assert.deepEqual(t.skipped, []);
  });

  test("una comilla que nunca cierra no se traga el resto del archivo", () => {
    const t = parseTable('nombre,correo\n"Ana Vargas,ana@example.org\nLuis Choque,luis@example.org\nRodrigo Peña,rodrigo@example.org');
    assert.deepEqual(t.rows.map((r) => r[0]), ["Ana Vargas", "Luis Choque", "Rodrigo Peña"]);
  });

  test("una lista con alguna coma suelta sigue siendo una lista", () => {
    assert.equal(looksTabular("Mejía, Nicolás\nAna Vargas\nLuis Choque"), false);
  });

  test("el punto y coma de Excel en español gana aunque los nombres tengan comas", () => {
    const t = parseTable("Nombre;Correo\nMejía, Nicolás;nico@example.org\nQuispe, María;maria@example.org");
    assert.deepEqual(t.columns, ["Nombre", "Correo"]);
    assert.deepEqual(t.rows.map((r) => r[0]), ["Mejía, Nicolás", "Quispe, María"]);
  });
});

/** Un export de Luma como el de verdad: los nombres son inventados; los casos no. */
const LUMA_REAL = `guest_id,name,first_name,last_name,email,approval_status,checked_in_at,referrer,referred_by,ticket_name
gst-1,Ana Quispe,Ana,Quispe,ana@example.org,approved,2026-08-22T15:05:39Z,,,Standard
gst-2,Luis Choque,Luis,Choque,luis@example.org,approved,,GMail,,Standard
gst-6,Rosa Villca,Rosa,Villca,rosa@example.org,pending_approval,,,,Standard
gst-7,Mario Apaza,Mario,Apaza,mario@example.org,invited,,,,`;

describe("de dónde viene la lista", () => {
  test("reconoce un export de Luma", () => {
    assert.equal(detectSource(parseTable(LUMA_REAL)), "luma");
    assert.equal(detectSource(parseTable(LUMA)), "luma");
    assert.equal(detectSource(parseTable("nombre,correo\nAna,ana@example.org\nLuis,luis@example.org")), null);
  });

  test("reconoce un export de Bevy por el capítulo o por el estado del asistente", () => {
    const conCapitulo = parseTable("First Name,Last Name,Email,Ticket Type,Chapter\nSofía,Aguilar,sofia@example.org,General,GDG Tarija\nLuis,Choque,luis@example.org,General,GDG Tarija");
    assert.equal(detectSource(conCapitulo), "bevy");
    const conEstado = parseTable("First Name,Last Name,Email,Attendee Status\nSofía,Aguilar,sofia@example.org,Registered\nLuis,Choque,luis@example.org,Cancelled");
    assert.equal(detectSource(conEstado), "bevy");
  });

  test("encuentra la columna aunque cambien las mayúsculas, las tildes y el guion bajo", () => {
    const t = parseTable("Correo electrónico,ESTADO,First_Name\nana@example.org,Aprobado,Ana\nluis@example.org,Pendiente,Luis");
    assert.equal(emailColumn(t), 0);
    assert.equal(statusColumn(t), 1);
    assert.equal(findColumn(t, ["first name"]), 2);
    assert.equal(presentColumn(t), -1);
  });

  test("sin cabecera no se adivinan columnas por nombre", () => {
    assert.equal(emailColumn(parseTable("Ana,ana@example.org\nLuis,luis@example.org")), -1);
  });
});

describe("las mayúsculas de los nombres", () => {
  test("arregla las mayúsculas solo de lo que llegó todo igual", () => {
    assert.equal(fixCase("jorge mamani"), "Jorge Mamani");
    assert.equal(fixCase("ELENA CONDORI"), "Elena Condori");
    assert.equal(fixCase("maría de la cruz"), "María de la Cruz");
    assert.equal(fixCase("ana-lucía flores"), "Ana-Lucía Flores");
    // Mezcladas: así las escribió la persona.
    assert.equal(fixCase("Ronald McDonald"), "Ronald McDonald");
    assert.equal(fixCase("de la Fuente"), "de la Fuente");
  });
});
