import type { NextConfig } from "next";

// node:sqlite se carga en tiempo de ejecución con process.getBuiltinModule (ver src/server/repo.ts),
// así que el empaquetador no tiene que resolverlo. No hace falta configurar nada más para la base.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
