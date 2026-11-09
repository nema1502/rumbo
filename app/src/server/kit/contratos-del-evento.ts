// Cada contrato que publicar creó para un evento (event_contracts, 020-direcciones-y-contratos.sql), se haya usado o
// no. Un borrador que publicó a medias y después cambia el precio o los canjes de una credencial ya preparada (o la
// apaga) deja ese contrato sin usar, y el paso siguiente crea otro: sin tope, sacar y poner un canje una y otra vez
// creaba un contrato por vuelta, que paga la cuenta patrocinadora y ocupa su turno. Con este registro, guardar el
// borrador deja de descartar contratos después de MAX_DISCARDED (borrador.ts) y publicar no crea más de los que
// el evento puede necesitar (publicar.ts).
import { getDb } from "../base/index.ts";

/** Cuántos contratos ya creados puede dejar sin usar un borrador al cambiar lo que estaba preparado. */
export const MAX_DISCARDED = 3;

/** Anota un contrato recién creado para el evento (y el tipo para el que se creó). */
export async function noteEventContract(eventId: string, ticketTypeId: string, contractId: string): Promise<void> {
  await getDb().run("INSERT INTO event_contracts (contract_id, event_id, ticket_type_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", [
    contractId,
    eventId,
    ticketTypeId,
    new Date().toISOString(),
  ]);
}

/** Cuántos contratos se crearon para el evento, usados o no. */
export async function countEventContracts(eventId: string): Promise<number> {
  const row = await getDb().one("SELECT COUNT(*) AS n FROM event_contracts WHERE event_id = ?", [eventId]);
  return Number(row?.n ?? 0);
}

/** Cuántos de los contratos creados para el evento ya no los usa ninguno de sus tipos de credencial. */
export async function countDiscardedContracts(eventId: string): Promise<number> {
  const row = await getDb().one(
    "SELECT COUNT(*) AS n FROM event_contracts c WHERE c.event_id = ? AND NOT EXISTS (SELECT 1 FROM ticket_types t WHERE t.event_id = c.event_id AND t.contract_id = c.contract_id)",
    [eventId],
  );
  return Number(row?.n ?? 0);
}
