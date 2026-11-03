// Leer y escribir app/.env.local desde los scripts, conservando los comentarios.
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** La carpeta app, que es donde corren pnpm dev y los scripts. */
export const APP_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const ENV_PATH = join(APP_DIR, ".env.local");
export const ENV_EXAMPLE_PATH = join(APP_DIR, ".env.example");

/** Crea .env.local a partir de .env.example si todavía no existe. */
export function ensureEnvFile() {
  if (!existsSync(ENV_PATH)) {
    copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
    console.log(`Creé ${ENV_PATH} a partir de .env.example`);
  }
}

/** Carga .env.local en process.env (sin pisar lo que ya esté definido). */
export function loadEnv() {
  ensureEnvFile();
  process.loadEnvFile(ENV_PATH);
}

/** Lee las variables del archivo como objeto, sin tocar process.env. */
export function readEnvFile() {
  const out = {};
  if (!existsSync(ENV_PATH)) return out;
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * Escribe valores en .env.local: reemplaza la línea de cada variable que ya exista (aunque esté vacía)
 * y agrega al final las que no. También los deja en process.env.
 */
export function upsertEnv(values) {
  ensureEnvFile();
  const lines = readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  const pending = new Map(Object.entries(values));
  const result = lines.map((line) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match && pending.has(match[1])) {
      const value = pending.get(match[1]);
      pending.delete(match[1]);
      return `${match[1]}=${value}`;
    }
    return line;
  });
  if (pending.size > 0) {
    if (result[result.length - 1] !== "") result.push("");
    for (const [key, value] of pending) result.push(`${key}=${value}`);
    result.push("");
  }
  writeFileSync(ENV_PATH, result.join("\n"), "utf8");
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}
