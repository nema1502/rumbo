// Copia lo público del despliegue del contrato (contracts/rumbo-pass/deploy/testnet.json) a app/deploy/, para que
// entre en el paquete que se sube a Vercel: con la carpeta raíz en app/, lo que está afuera no viaja. Corre antes
// de next build (pnpm build). Si no encuentra el original (una compilación sin el resto del repositorio), deja la
// copia que haya y no falla. La app lo lee con RUMBO_DEPLOY_JSON=./deploy/testnet.json (src/server/stellar.ts).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origen = join(appDir, "..", "contracts", "rumbo-pass", "deploy", "testnet.json");
const destino = join(appDir, "deploy", "testnet.json");

if (existsSync(origen)) {
  mkdirSync(dirname(destino), { recursive: true });
  copyFileSync(origen, destino);
  console.log("deploy/testnet.json copiado del contrato");
} else if (existsSync(destino)) {
  console.log("deploy/testnet.json: se usa la copia que ya había");
} else {
  console.warn("deploy/testnet.json: no hay original ni copia; publicar eventos nuevos desde una plantilla no va a andar");
}
