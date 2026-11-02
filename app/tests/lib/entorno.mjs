// Lo que comparten las pruebas de la app (node --test, sin red): cada archivo corre desde app/, con su
// propia carpeta de datos vacía (la base SQLite y los correos) y ninguna llave de la red de prueba.
// Se llama antes de importar nada de src/server, porque la base y el correo se abren una vez por proceso.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export function entornoDePrueba() {
  process.chdir(APP_DIR);
  const datos = mkdtempSync(join(tmpdir(), "rumbo-prueba-"));
  process.env.RUMBO_DATA_DIR = datos;
  process.env.RUMBO_REPO = "sqlite";
  process.env.RUMBO_MAILER = "dev";
  process.env.STELLAR_NETWORK = "testnet";
  // Que ninguna prueba hable con la red por accidente: sin llaves, cualquier operación falla enseguida.
  for (const name of ["STELLAR_SPONSOR_SECRET", "STELLAR_GATE_SECRET", "STELLAR_ISSUER_SECRET"]) delete process.env[name];
  process.on("exit", () => {
    try {
      rmSync(datos, { recursive: true, force: true });
    } catch {
      /* la base puede seguir abierta en Windows: queda en la carpeta temporal */
    }
  });
  return datos;
}

/** Un evento con una entrada (gratis o paga), su contrato de mentira y, si se pide, un beneficio canjeable. */
export async function eventoDePrueba(repo, { slug = `prueba-${Date.now().toString(36)}`, precio = 0, beneficio = true } = {}) {
  const event = await repo.createEvent({ slug, name: "Evento de prueba", startsAt: "2026-11-22T09:00:00-04:00", place: "Santa Cruz", organizerName: "La comunidad", contractId: "CPRUEBA" });
  const ticket = await repo.createTicketType({ eventId: event.id, name: precio ? "Con almuerzo" : "Inscripción", priceUsdc: precio, contractId: "CPRUEBA" });
  let lunch = null;
  if (beneficio) {
    lunch = await repo.createBenefit({ eventId: event.id, name: "Almuerzo", kind: "lunch", station: "Mesa del almuerzo" });
    await repo.linkBenefit(ticket.id, lunch.id, 0);
  }
  return { event, ticket, lunch };
}

/** Una persona con su pase activo (como si el contrato ya la hubiera inscripto) y los beneficios de su entrada. */
export async function paseDePrueba(repo, { event, ticket }, { name = "Ana Prueba", email, account } = {}) {
  const person = await repo.upsertPerson({ name, email: email ?? `${Math.random().toString(36).slice(2)}@example.com` });
  let pass = await repo.createPass({ eventId: event.id, personId: person.id, ticketTypeId: ticket.id, status: "pending" });
  pass = await repo.updatePass(pass.id, { account: account ?? `G${Math.random().toString(36).slice(2).toUpperCase().padEnd(55, "A")}`, status: "active" });
  await repo.grantTicketBenefits(pass.id);
  return { person, pass };
}
