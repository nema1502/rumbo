import { BUSY } from "../compartido.ts";
import { ensureStationCodes } from "../panel.ts";
import type { Benefit, EventRecord, Repo, TicketType } from "../repo.ts";
import { rumboPass } from "../stellar.ts";
import { STOCK_MAX, cleanText } from "./borrador.ts";
import { CONTRACT_BENEFIT_SLOTS, withPublishTurn } from "./publicar.ts";

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

export interface BenefitAdd {
  name: string;
  station?: string;
  stock: number | null;
  ticketTypeIds: string[];
  /** Un premio (para los equipos que ganan): tiene su lugar en el contrato de esos tipos, pero no se le da a nadie hasta que se gana. */
  prize?: boolean;
}

export type BenefitAddError = "name" | "stock" | "types" | "not_found" | "full" | "busy";

export type BenefitAddResult = { ok: true; benefit: Benefit; chainIndexes: Record<string, number> } | { ok: false; error: BenefitAddError; ticketTypeName?: string };

export type BenefitSlotsReader = (contractId: string) => Promise<number>;

const chainBenefitSlots: BenefitSlotsReader = async (contractId) => (await rumboPass.info(contractId)).benefits;

export async function addBenefit(repo: Repo, event: EventRecord, add: BenefitAdd, readSlots: BenefitSlotsReader = chainBenefitSlots): Promise<BenefitAddResult> {
  const name = cleanText(add.name, "");
  if (!name) return { ok: false, error: "name" };
  const { stock } = add;
  if (stock !== null && (!Number.isInteger(stock) || stock < 1 || stock > STOCK_MAX)) return { ok: false, error: "stock" };
  const wanted = [...new Set(add.ticketTypeIds)];
  if (wanted.length === 0) return { ok: false, error: "types" };
  const types = await repo.listTicketTypes(event.id);
  const chosen = wanted.map((id) => types.find((t) => t.id === id));
  if (chosen.some((t) => !t)) return { ok: false, error: "not_found" };

  const result = await withPublishTurn(event.id, async (): Promise<BenefitAddResult> => {
    const next = new Map<string, number>();
    for (const type of chosen as TicketType[]) {
      const linked = await repo.listTicketTypeBenefits(type.id);
      const index = linked.reduce((max, b) => Math.max(max, b.chainIndex), -1) + 1;
      const contractId = type.contractId ?? event.contractId;
      const slots = contractId ? await readSlots(contractId) : CONTRACT_BENEFIT_SLOTS;
      if (index >= slots) return { ok: false, error: "full", ticketTypeName: type.name };
      next.set(type.id, index);
    }
    const sortOrder = (await repo.listBenefits(event.id)).reduce((max, b) => Math.max(max, b.sortOrder), -1) + 1;
    const benefit = await repo.createBenefit({ eventId: event.id, name, kind: add.prize ? "prize" : "other", station: cleanText(add.station, "") || null, sortOrder, stock });
    for (const [typeId, index] of next) await repo.linkBenefit(typeId, benefit.id, index);
    if (!add.prize) {
      for (const pass of await repo.listPasses(event.id)) {
        if (pass.status !== "pending" && next.has(pass.ticketTypeId)) await repo.grantBenefit(pass.id, benefit.id, "ticket");
      }
    }
    await ensureStationCodes(event, repo);
    return { ok: true, benefit, chainIndexes: Object.fromEntries(next) };
  });
  return result === BUSY ? { ok: false, error: "busy" } : result;
}
