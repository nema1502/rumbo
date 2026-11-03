// Imprime el enlace para entrar al panel de un evento, con su clave de organizador, y los códigos de
// puesto con los que los voluntarios abren el escáner. Crea lo que falte. No toca la red.
// Uso: node scripts/panel-clave.mjs [slug]        (por defecto, el evento de muestra)
import { APP_DIR, loadEnv } from "./lib/env.mjs";

process.chdir(APP_DIR);
loadEnv();

const { getRepo } = await import("../src/server/repo.ts");
const { ensureStationCodes, getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { formatStationCode } = await import("../src/lib/station-code.ts");
const { getStand } = await import("../src/server/stands.ts");

const slug = process.argv[2] ?? "hackaton-comunidad";
const repo = getRepo();
const event = await repo.getEventBySlug(slug);
if (!event) {
  console.error(`No hay ningún evento con slug "${slug}". Para crear el de muestra: pnpm seed`);
  process.exit(1);
}

const key = await getOrCreateOrganizerKey(event.id);
const stations = await ensureStationCodes(event, repo);
const benefits = new Map((await repo.listBenefits(event.id)).map((b) => [b.id, b]));
const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

console.log(`${event.name}
  El panel:    ${base}/admin/${event.slug}?k=${key}
  El informe:  ${base}/admin/${event.slug}/informe
  (la clave queda en una cookie del navegador; el enlace con ?k= se comparte solo con quien organiza)

Códigos de puesto: cada voluntario abre ${base}/scan y escribe el suyo.`);
for (const station of stations) {
  const nombre =
    station.kind === "gate" ? "Puerta" : station.kind === "stand" ? `Stand de ${(await getStand(station.standId))?.name ?? station.standId}` : (benefits.get(station.benefitId)?.name ?? station.benefitId);
  console.log(`  ${formatStationCode(station.code)}  ${nombre}`);
}

// Con Postgres el pool deja las conexiones abiertas un rato: se cierra, así el script termina enseguida.
const { closeDb } = await import("../src/server/base/index.ts");
await closeDb();
