import type { NextConfig } from "next";

// Las páginas y las rutas que llevan algo de alguien (una credencial, el panel de un stand, la pantalla en vivo,
// el panel, la verificación de un certificado, la API, el escáner) no se indexan, no mandan referente (el código o
// la clave viajan en la dirección) y no se dejan meter en un marco de otro sitio. public/robots.txt dice lo mismo.
const PRIVATE_PATHS = ["/v/:path*", "/p/:path*", "/stand/:path*", "/vivo/:path*", "/admin/:path*", "/api/:path*", "/scan", "/scan/:path*"];
const PRIVATE_HEADERS = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

// La base (src/server/base): node:sqlite se carga en tiempo de ejecución con process.getBuiltinModule, así que
// el empaquetador no lo resuelve y con RUMBO_REPO=postgres no se carga. El driver de Postgres va fuera del bundle,
// como el SDK de Stellar, y PGlite (solo para pruebas) se importa con un nombre que el empaquetador no sigue.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // El SDK de Stellar trae una versión ESM y otra CommonJS. Si el empaquetador mete las dos en el bundle del
  // servidor, los tipos XDR quedan duplicados y firmar una autorización falla ("expected string, Uint8Array,
  // or XdrString"). Fuera del bundle, Node lo carga una sola vez, como en los scripts.
  serverExternalPackages: ["@stellar/stellar-sdk", "postgres"],
  // Lo público del despliegue del contrato (la copia que arma scripts/copiar-despliegue.mjs en pnpm build) viaja
  // con cada función: en Vercel la app lo lee con RUMBO_DEPLOY_JSON=./deploy/testnet.json para publicar eventos nuevos.
  outputFileTracingIncludes: { "/**": ["./deploy/testnet.json"] },
  async headers() {
    return [
      ...PRIVATE_PATHS.map((source) => ({ source, headers: PRIVATE_HEADERS })),
      // La vista previa de un borrador (/e/<evento>?vista=1) es solo para quien organiza: como las páginas privadas.
      { source: "/e/:slug", has: [{ type: "query" as const, key: "vista" }], headers: PRIVATE_HEADERS },
      // La credencial solo muestra imágenes propias (el QR va dibujado, el logo de un stand es una ruta de la app):
      // ningún servidor ajeno se entera de quién la abre ni cuándo.
      { source: "/p/:path*", headers: [{ key: "Content-Security-Policy", value: "img-src 'self' data:" }] },
    ];
  },
};

export default nextConfig;
