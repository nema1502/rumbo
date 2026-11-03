// El borrador de un evento que salió de una plantilla: lo que se puede editar antes de publicar (qué tipos de
// credencial hay, cuánto cuesta la entrada paga, qué trae cada tipo, cómo se llama cada beneficio, dónde se
// canjea y cuántos hay) y cómo se guarda. Guardar deja la base igual a lo que dice el formulario: crea lo que
// falta, cambia lo que cambió y borra lo que se apagó. Los números de canje de cada tipo (0, 1, 2...) se
// asignan por orden, que es como los pide el contrato de cada entrada.
import type { Lang } from "../../i18n/index.ts";
import type { Benefit, EventRecord, Repo, TicketType } from "../repo.ts";
import {
  DEFAULT_PAID_PRICE,
  SLOTS,
  SLOT_KIND,
  benefitDef,
  getTemplate,
  slotName,
  type Slot,
  type TemplateSpec,
} from "./plantillas.ts";

export interface DraftSlotInput {
  included: boolean;
  name: string;
  /** Solo cuenta en la entrada paga. */
  price: number;
  /** Las claves de los beneficios que trae. */
  benefits: string[];
}

export interface DraftBenefitInput {
  name: string;
  place: string;
  /** Cuántos hay, o null si no hay tope. */
  stock: number | null;
}

export interface DraftInput {
  teamSignup: boolean;
  slots: Partial<Record<Slot, DraftSlotInput>>;
  benefits: Record<string, DraftBenefitInput>;
}

export type DraftErrorCode = "published" | "template" | "price" | "stock" | "name";

export class DraftError extends Error {
  readonly code: DraftErrorCode;
  readonly slot: Slot | null;
  constructor(code: DraftErrorCode, slot: Slot | null = null) {
    super(`Borrador inválido: ${code}${slot ? ` (${slot})` : ""}`);
    this.name = "DraftError";
    this.code = code;
    this.slot = slot;
  }
}

const NAME_MAX = 60;
export const PRICE_MAX = 1000;
export const STOCK_MAX = 100_000;

/** Lo que la plantilla propone, listo para guardar. */
export function defaultDraft(spec: TemplateSpec, lang: Lang): DraftInput {
  const slots: Partial<Record<Slot, DraftSlotInput>> = {};
  for (const slot of SLOTS) {
    const s = spec.slots[slot];
    slots[slot] = { included: s.included, name: slotName(spec, slot, lang), price: slot === "attendeePaid" ? DEFAULT_PAID_PRICE : 0, benefits: [...s.benefits] };
  }
  const benefits: Record<string, DraftBenefitInput> = {};
  for (const key of spec.benefitOrder) {
    const def = benefitDef(key, lang, spec.id);
    if (def) benefits[key] = { name: def.name, place: def.place, stock: null };
  }
  return { teamSignup: spec.teamSignup, slots, benefits };
}

function cleanText(text: string | undefined, fallback: string): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  return clean || fallback;
}

/**
 * Deja la base como dice el borrador. Solo un evento sin publicar, de una plantilla. La entrada del asistente
 * gratis siempre está y siempre es gratis; los demás tipos de credencial no se cobran.
 */
export async function saveDraft(repo: Repo, event: EventRecord, input: DraftInput, lang: Lang): Promise<void> {
  if (event.published) throw new DraftError("published");
  const spec = getTemplate(event.template);
  if (!spec) throw new DraftError("template");
  const defaults = defaultDraft(spec, lang);

  // Los tipos de credencial que quedan, en el orden de la plantilla.
  const wanted: Array<{ slot: Slot; name: string; price: number; benefits: string[] }> = [];
  for (const slot of SLOTS) {
    const given = input.slots[slot];
    const fallback = defaults.slots[slot] as DraftSlotInput;
    const included = slot === "attendee" ? true : Boolean(given?.included);
    if (!included) continue;
    const name = cleanText(given?.name, fallback.name);
    let price = 0;
    if (slot === "attendeePaid") {
      price = Number(given?.price ?? fallback.price);
      if (!Number.isFinite(price) || price <= 0 || price > PRICE_MAX) throw new DraftError("price", slot);
      price = Math.round(price * 100) / 100;
    }
    const chosen = new Set(given?.benefits ?? (slot === "attendee" ? fallback.benefits : []));
    // En el orden de la plantilla, sin el premio (que se otorga después, por el sorteo) ni claves que no existen.
    const benefits = spec.benefitOrder.filter((key) => key !== "prize" && chosen.has(key));
    wanted.push({ slot, name, price, benefits });
  }

  // Los beneficios que hacen falta: los que trae algún tipo, y el premio del sorteo.
  const needed = new Set<string>(["prize"]);
  for (const w of wanted) for (const key of w.benefits) needed.add(key);

  const existingBenefits = new Map((await repo.listBenefits(event.id)).filter((b) => b.templateKey).map((b) => [b.templateKey as string, b] as const));
  const benefitByKey = new Map<string, Benefit>();
  for (const [index, key] of spec.benefitOrder.entries()) {
    const current = existingBenefits.get(key);
    if (!needed.has(key)) continue;
    const def = benefitDef(key, lang, spec.id);
    if (!def) continue;
    const given = input.benefits[key];
    const name = cleanText(given?.name, current?.name ?? def.name);
    const place = cleanText(given?.place, current?.station ?? def.place);
    const stock = given ? given.stock : (current?.stock ?? null);
    if (stock !== null && (!Number.isInteger(stock) || stock < 1 || stock > STOCK_MAX)) throw new DraftError("stock");
    if (current) benefitByKey.set(key, await repo.updateBenefit(current.id, { name, station: place, sortOrder: index, stock }));
    else benefitByKey.set(key, await repo.createBenefit({ eventId: event.id, name, kind: def.kind, station: place, sortOrder: index, templateKey: key, stock }));
  }

  // Los tipos de credencial: crear, cambiar o borrar, y volver a numerar lo que trae cada uno.
  const existingTypes = new Map((await repo.listTicketTypes(event.id)).filter((t) => t.templateSlot).map((t) => [t.templateSlot as string, t] as const));
  const keep = new Set<string>();
  for (const [index, w] of wanted.entries()) {
    keep.add(w.slot);
    const current = existingTypes.get(w.slot);
    let type: TicketType;
    if (current) type = await repo.updateTicketType(current.id, { name: w.name, priceUsdc: w.price, sortOrder: index, credentialKind: SLOT_KIND[w.slot] });
    else type = await repo.createTicketType({ eventId: event.id, name: w.name, priceUsdc: w.price, sortOrder: index, credentialKind: SLOT_KIND[w.slot], templateSlot: w.slot });
    await repo.clearTicketTypeBenefits(type.id);
    for (const [chainIndex, key] of w.benefits.entries()) {
      const benefit = benefitByKey.get(key);
      if (benefit) await repo.linkBenefit(type.id, benefit.id, chainIndex);
    }
  }
  for (const [slot, type] of existingTypes) if (!keep.has(slot)) await repo.deleteTicketType(type.id);
  for (const [key, benefit] of existingBenefits) if (!needed.has(key)) await repo.deleteBenefit(benefit.id);

  if (event.teamSignup !== input.teamSignup) await repo.updateEvent(event.id, { teamSignup: input.teamSignup });
}

// ---------- Lo que muestra la pantalla ----------

export interface DraftSlotView {
  slot: Slot;
  kind: (typeof SLOT_KIND)[Slot];
  included: boolean;
  /** El asistente gratis no se apaga. */
  locked: boolean;
  name: string;
  price: number;
  benefits: string[];
}

export interface DraftBenefitView {
  key: string;
  name: string;
  place: string;
  stock: number | null;
  /** El premio del sorteo no lo trae ninguna credencial: se otorga después. */
  perCredential: boolean;
}

export interface DraftView {
  template: TemplateSpec;
  teamSignup: boolean;
  slots: DraftSlotView[];
  benefits: DraftBenefitView[];
}

/** El borrador como está guardado, completo con lo que la plantilla ofrece y todavía está apagado. */
export async function readDraft(repo: Repo, event: EventRecord, lang: Lang): Promise<DraftView | null> {
  const spec = getTemplate(event.template);
  if (!spec) return null;
  const defaults = defaultDraft(spec, lang);
  const [types, benefits] = await Promise.all([repo.listTicketTypes(event.id), repo.listBenefits(event.id)]);
  const typeBySlot = new Map(types.filter((t) => t.templateSlot).map((t) => [t.templateSlot as string, t] as const));
  const benefitByKey = new Map(benefits.filter((b) => b.templateKey).map((b) => [b.templateKey as string, b] as const));

  const slots: DraftSlotView[] = [];
  for (const slot of SLOTS) {
    const fallback = defaults.slots[slot] as DraftSlotInput;
    const type = typeBySlot.get(slot);
    let keys = fallback.benefits;
    if (type) {
      const linked = await repo.listTicketTypeBenefits(type.id);
      keys = linked.map((b) => b.templateKey).filter((k): k is string => Boolean(k));
    }
    slots.push({
      slot,
      kind: SLOT_KIND[slot],
      included: Boolean(type),
      locked: slot === "attendee",
      name: type?.name ?? fallback.name,
      price: type?.priceUsdc ?? fallback.price,
      benefits: keys,
    });
  }
  const benefitViews: DraftBenefitView[] = [];
  for (const key of spec.benefitOrder) {
    const current = benefitByKey.get(key);
    const fallback = defaults.benefits[key];
    if (!fallback) continue;
    benefitViews.push({
      key,
      name: current?.name ?? fallback.name,
      place: current?.station ?? fallback.place,
      stock: current ? current.stock : fallback.stock,
      perCredential: key !== "prize",
    });
  }
  return { template: spec, teamSignup: event.teamSignup, slots, benefits: benefitViews };
}

// ---------- El formulario ----------

interface FormLike {
  get(name: string): unknown;
}

const field = (form: FormLike, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

function parseNumber(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Lee el formulario de /admin/<evento>/armar. Los campos se llaman `tipo.<lugar>` (la casilla de incluir),
 * `nombre.<lugar>`, `precio.<lugar>`, `trae.<lugar>.<beneficio>`, `bnombre.<beneficio>`, `blugar.<beneficio>`,
 * `bstock.<beneficio>` y `equipos`. Un stock que no es un entero positivo se pasa tal cual (NaN) para que
 * saveDraft lo rechace.
 */
export function parseDraftForm(form: FormLike, spec: TemplateSpec): DraftInput {
  const slots: Partial<Record<Slot, DraftSlotInput>> = {};
  for (const slot of SLOTS) {
    const benefits = spec.benefitOrder.filter((key) => field(form, `trae.${slot}.${key}`) === "on");
    slots[slot] = {
      included: field(form, `tipo.${slot}`) === "on",
      name: field(form, `nombre.${slot}`),
      price: parseNumber(field(form, `precio.${slot}`)) ?? 0,
      benefits,
    };
  }
  const benefits: Record<string, DraftBenefitInput> = {};
  for (const key of spec.benefitOrder) {
    if (form.get(`bnombre.${key}`) === null) continue;
    benefits[key] = { name: field(form, `bnombre.${key}`), place: field(form, `blugar.${key}`), stock: parseNumber(field(form, `bstock.${key}`)) };
  }
  return { teamSignup: field(form, "equipos") === "on", slots, benefits };
}
