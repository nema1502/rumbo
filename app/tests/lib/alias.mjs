// Lo que Next resuelve solo y Node no, para que las pruebas puedan importar las rutas de la API tal como
// las importa Next: el alias "@/" de tsconfig (src/) y las entradas de next sin extensión ("next/server").
// Lo registra entorno.mjs con module.register.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "src");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(pathToFileURL(join(SRC, specifier.slice(2))).href, context);
  if (/^next\/[a-z-]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
  return nextResolve(specifier, context);
}
