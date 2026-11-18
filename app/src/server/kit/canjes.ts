import type { Benefit, EventRecord, Repo } from "../repo.ts";
import { STOCK_MAX, cleanText } from "./borrador.ts";

export interface BenefitEdit {
  benefitId: string;
  name?: string;
  station?: string;
  stock: number | null;
}

export type BenefitEditResult = { ok: true; benefit: Benefit } | { ok: false; error: "not_found" | "stock" };

export async function editBenefit(repo: Repo, event: EventRecord, edit: BenefitEdit): Promise<BenefitEditResult> {
  const current = await repo.getBenefit(edit.benefitId);
  if (!current || current.eventId !== event.id) return { ok: false, error: "not_found" };
  const { stock } = edit;
  if (stock !== null && (!Number.isInteger(stock) || stock < 1 || stock > STOCK_MAX)) return { ok: false, error: "stock" };
  const name = cleanText(edit.name, current.name);
  const station = cleanText(edit.station, current.station ?? "") || null;
  return { ok: true, benefit: await repo.updateBenefit(current.id, { name, station, stock }) };
}
