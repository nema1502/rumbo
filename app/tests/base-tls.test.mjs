// La conexión a Postgres en producción verifica el certificado del servidor: "require" a secas cifraba sin
// comprobar quién estaba del otro lado. El pooler de Supabase lo firma su propia autoridad (Supabase Root 2021
// CA, que no está en el sistema), así que la CA se carga por RUMBO_PG_CA; el servidor local de las pruebas no tiene TLS.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { entornoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { tlsOptions } = await import("../src/server/base/postgres.ts");

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
const REMOTA = "postgres://postgres.x:clave@aws-0-us-west-2.pooler.supabase.com:6543/postgres";

test("sin TLS solo contra esta máquina; afuera, siempre con el certificado verificado", () => {
  delete process.env.RUMBO_PG_CA;
  assert.equal(tlsOptions("postgres://rumbo@localhost:5432/postgres"), false);
  assert.equal(tlsOptions("postgres://rumbo@127.0.0.1:54329/postgres"), false);
  assert.deepEqual(tlsOptions(REMOTA), { rejectUnauthorized: true });
  assert.deepEqual(tlsOptions("no es una url"), { rejectUnauthorized: true }, "lo que no se entiende no se trata como local");
});

test("RUMBO_PG_CA suma la autoridad propia del servidor: el PEM entero, o la ruta a su archivo", () => {
  process.env.RUMBO_PG_CA = PEM;
  assert.deepEqual(tlsOptions(REMOTA), { rejectUnauthorized: true, ca: PEM });
  const archivo = join(mkdtempSync(join(tmpdir(), "rumbo-ca-")), "supabase.crt");
  writeFileSync(archivo, PEM);
  process.env.RUMBO_PG_CA = archivo;
  assert.deepEqual(tlsOptions(REMOTA), { rejectUnauthorized: true, ca: PEM });
  delete process.env.RUMBO_PG_CA;
});
