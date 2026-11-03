// Las variables del servidor, leídas al momento de usarlas. Next las carga de app/.env.local;
// los scripts las cargan con process.loadEnvFile antes de importar nada de src/server.
import fs from "node:fs";
import path from "node:path";

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(`Falta ${name} en app/.env.local. Corré: pnpm setup:dev`);
    this.name = "MissingEnvError";
  }
}

export function getEnv(name: string): string | undefined;
export function getEnv(name: string, fallback: string): string;
export function getEnv(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export function requireEnv(name: string): string {
  const value = getEnv(name);
  if (!value) throw new MissingEnvError(name);
  return value;
}

/** Solo la red de prueba. Con otro valor, ninguna operación con la red arranca. */
export function assertTestnet(): void {
  const network = getEnv("STELLAR_NETWORK", "testnet");
  if (network !== "testnet") {
    throw new Error(`Rumbo solo corre en la red de prueba por ahora (STELLAR_NETWORK=${network}).`);
  }
}

/** La carpeta app: next dev y los scripts corren desde ahí. */
export function appDir(): string {
  return process.cwd();
}

/** La raíz del repositorio, donde viven contracts/ y site/. */
export function repoRoot(): string {
  return path.resolve(appDir(), "..");
}

/** Donde viven la base local y los correos de desarrollo. Se crea si no existe. */
export function dataDir(): string {
  const dir = path.resolve(appDir(), getEnv("RUMBO_DATA_DIR", "./data"));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function rpcUrl(): string {
  return getEnv("STELLAR_RPC_URL", "https://soroban-testnet.stellar.org");
}

export function horizonUrl(): string {
  return getEnv("STELLAR_HORIZON_URL", "https://horizon-testnet.stellar.org");
}

export function friendbotUrl(): string {
  return getEnv("STELLAR_FRIENDBOT_URL", "https://friendbot.stellar.org");
}

export function baseUrl(): string {
  return getEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:3000");
}
