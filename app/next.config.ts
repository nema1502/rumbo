import type { NextConfig } from "next";

// node:sqlite se carga en tiempo de ejecución con process.getBuiltinModule (ver src/server/repo.ts),
// así que el empaquetador no tiene que resolverlo. No hace falta configurar nada más para la base.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // El SDK de Stellar trae una versión ESM y otra CommonJS. Si el empaquetador mete las dos en el bundle del
  // servidor, los tipos XDR quedan duplicados y firmar una autorización falla ("expected string, Uint8Array,
  // or XdrString"). Fuera del bundle, Node lo carga una sola vez, como en los scripts.
  serverExternalPackages: ["@stellar/stellar-sdk"],
};

export default nextConfig;
