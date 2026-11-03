import type { NextConfig } from "next";

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
};

export default nextConfig;
