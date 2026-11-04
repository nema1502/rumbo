// Lista (y con --borrar, borra) las lecturas del espejo con una hora que no existe o de antes del año 2000: una
// fila así, guardada antes de que el servidor validara la hora de cada lectura, rompía la lectura de todo el
// evento con Postgres (el driver no sabe leer un año de menos de cien) y la pantalla con SQLite. Mira checkins,
// redemptions y stand_visits; en passes, una hora de entrada así se deja en blanco (la credencial sigue entrada).
// No toca la red. Usa la base de RUMBO_REPO (SQLite por defecto; Postgres con DATABASE_URL y RUMBO_DATA_KEY).
//
//   node scripts/sanear-fechas.mjs            solo lista
//   node scripts/sanear-fechas.mjs --borrar   lista y borra
import { APP_DIR, loadEnv } from "./lib/env.mjs";

process.chdir(APP_DIR);
loadEnv();

const borrar = process.argv.includes("--borrar");

const { getDb, closeDb } = await import("../src/server/base/index.ts");
const { SCANNED_TABLES, listBadScannedAt, deleteBadScannedAt, listBadCheckedInAt, clearBadCheckedInAt } = await import("../src/server/sanear-fechas.ts");

const db = getDb();
let total = 0;
for (const tabla of SCANNED_TABLES) {
  const filas = await listBadScannedAt(db, tabla);
  total += filas.length;
  console.log(`${tabla}: ${filas.length} con una hora que no existe o de antes del 2000`);
  for (const r of filas) console.log(`  ${r.id}  clientId=${r.clientId ?? "(sin id)"}  scanned_at=${r.scannedAt}`);
  if (borrar && filas.length > 0) console.log(`  borradas ${await deleteBadScannedAt(db, tabla)}`);
}
const pases = await listBadCheckedInAt(db);
total += pases.length;
console.log(`passes: ${pases.length} con una hora de entrada así`);
for (const r of pases) console.log(`  ${r.id}  checked_in_at=${r.checkedInAt}`);
if (borrar && pases.length > 0) console.log(`  en blanco ${await clearBadCheckedInAt(db)}`);

if (total === 0) console.log("Nada que sanear.");
else if (!borrar) console.log("Para borrarlas: node scripts/sanear-fechas.mjs --borrar");

await closeDb();
