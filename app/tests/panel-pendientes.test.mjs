import assert from "node:assert/strict";
import { test } from "node:test";
import { entornoDePrueba, eventoDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { getRepo } = await import("../src/server/repo.ts");
const { getPanelState } = await import("../src/server/panel.ts");

test("el panel distingue pases gratis sin preparar de pases pagos pendientes", async () => {
  const repo = getRepo();
  const d = await eventoDePrueba(repo, { beneficio: false });
  const ticketPaid = await repo.createTicketType({
    eventId: d.event.id,
    name: "Entrada paga",
    priceUsdc: 5,
    contractId: "CPRUEBA",
  });
  const freePerson = await repo.upsertPerson({ name: "Entrada gratis", email: "gratis@example.com" });
  const paidPerson = await repo.upsertPerson({ name: "Entrada paga", email: "paga@example.com" });
  await repo.createPass({ eventId: d.event.id, personId: freePerson.id, ticketTypeId: d.ticket.id, status: "pending" });
  await repo.createPass({ eventId: d.event.id, personId: paidPerson.id, ticketTypeId: ticketPaid.id, status: "pending" });

  const panel = await getPanelState(d.event, repo);

  assert.equal(panel.counters.pendingFree, 1);
  assert.equal(panel.counters.pendingPaid, 1);
  assert.equal(panel.counters.pending, 2);
});
