// pnpm test:pg: las mismas pruebas de pnpm test, con el motor Postgres, dos veces:
//   pglite    Postgres en WASM dentro de cada proceso de pruebas: el dialecto y las migraciones de Supabase.
//   postgres  el driver de producción (postgres, con prepare: false) por la red, contra un Postgres local que
//             tests/lib/postgres-local.mjs levanta para cada archivo, migrado con el código de pnpm db:migrate.
//
//   pnpm test:pg                 las dos
//   pnpm test:pg -- pglite       una sola (pglite o postgres)
import { spawnSync } from "node:child_process";
import { APP_DIR } from "./lib/env.mjs";

const RUNS = {
  pglite: [],
  postgres: ["--import", "./tests/lib/postgres-local.mjs"],
};
const pedidas = process.argv.slice(2).filter((a) => a in RUNS);
const motores = pedidas.length > 0 ? pedidas : Object.keys(RUNS);

const fallaron = [];
for (const motor of motores) {
  console.log(`\n== Las pruebas con RUMBO_TEST_ENGINE=${motor}\n`);
  // --test-force-exit: el pool de Postgres y el servidor local no dejan terminar solo al proceso de cada archivo.
  const run = spawnSync(process.execPath, [...RUNS[motor], "--test", "--test-force-exit", "tests/*.test.mjs"], {
    cwd: APP_DIR,
    env: { ...process.env, RUMBO_TEST_ENGINE: motor },
    stdio: "inherit",
  });
  if (run.status !== 0) fallaron.push(motor);
}
console.log(fallaron.length === 0 ? `\nTodo bien con ${motores.join(" y ")}.` : `\nFallaron: ${fallaron.join(" y ")}.`);
process.exit(fallaron.length === 0 ? 0 : 1);
