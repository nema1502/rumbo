// Las cabeceras de seguridad de las páginas que llevan algo de alguien, y robots.txt: lo que no se indexa, no manda
// referente (la clave o el código viajan en la dirección) y no se mete en un marco ajeno.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { APP_DIR } from "./lib/entorno.mjs";

const { default: config } = await import("../next.config.ts");

const PRIVADAS = ["/v/:path*", "/p/:path*", "/stand/:path*", "/vivo/:path*", "/admin/:path*", "/api/:path*", "/scan", "/scan/:path*"];

test("cada ruta privada manda sin referente, sin indexar, sin adivinar el tipo y sin marco", async () => {
  const reglas = await config.headers();
  const de = (source) => Object.fromEntries(reglas.filter((r) => r.source === source).flatMap((r) => r.headers).map((h) => [h.key, h.value]));
  for (const source of PRIVADAS) {
    const h = de(source);
    assert.equal(h["Referrer-Policy"], "no-referrer", source);
    assert.equal(h["X-Robots-Tag"], "noindex, nofollow", source);
    assert.equal(h["X-Content-Type-Options"], "nosniff", source);
    assert.equal(h["X-Frame-Options"], "DENY", source);
  }
  // la credencial solo carga imágenes propias
  assert.equal(de("/p/:path*")["Content-Security-Policy"], "img-src 'self' data:");
  // lo que ya estaba sigue
  assert.deepEqual(config.serverExternalPackages, ["@stellar/stellar-sdk", "postgres"]);
  assert.deepEqual(config.outputFileTracingIncludes, { "/**": ["./deploy/testnet.json"] });
  assert.equal(config.poweredByHeader, false);
});

test("robots.txt no deja indexar las credenciales, la verificación, los stands, la pantalla en vivo, el panel, la API ni el escáner", () => {
  const robots = readFileSync(`${APP_DIR}/public/robots.txt`, "utf8");
  assert.match(robots, /^User-agent: \*$/m);
  for (const ruta of ["/p", "/v", "/stand", "/vivo", "/admin", "/api", "/scan"]) assert.match(robots, new RegExp(`^Disallow: ${ruta}$`, "m"), ruta);
  assert.ok(!/^Disallow: \/$/m.test(robots), "la página del evento sí se indexa");
});
