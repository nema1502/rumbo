// Las plantillas de evento: DevFest, Build with AI, Día de la Mujer, hackatón, meetup y taller. Cada una
// trae los beneficios típicos (almuerzo, refrigerio, merch, café del auspiciante, el premio del sorteo), los
// tipos de credencial con lo que le toca a cada uno y los puestos del escáner, que salen de los beneficios.
// Todo es solo una propuesta: el evento nace como borrador y se edita en /admin/<evento>/armar (borrador.ts).
// Los eventos son gratis por defecto; lo pago (entrada con polera, kit del taller) es opcional y viene apagado.
import { randomBytes } from "node:crypto";
import { translate, type Lang } from "../../i18n/index.ts";
import type { CredentialKind } from "../../lib/credential-kinds.ts";
import type { Benefit, BenefitKind, EventRecord, Repo } from "../repo.ts";
import { defaultDraft, saveDraft } from "./borrador.ts";
import { SLUG_MIN, isReservedSlug, isSlugTaken } from "./direccion.ts";

export const TEMPLATE_IDS = ["devfest", "build-with-ai", "iwd", "hackaton", "meetup", "taller"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && (TEMPLATE_IDS as readonly string[]).includes(value);
}

/** Los lugares de credencial que ofrece una plantilla: uno por tipo, y una entrada paga opcional. */
export type Slot = "attendee" | "attendeePaid" | "speaker" | "mentor" | "judge" | "volunteer" | "organizer" | "sponsor";
export const SLOTS: readonly Slot[] = ["attendee", "attendeePaid", "speaker", "mentor", "judge", "volunteer", "organizer", "sponsor"];

export const SLOT_KIND: Record<Slot, CredentialKind> = {
  attendee: "attendee",
  attendeePaid: "attendee",
  speaker: "speaker",
  mentor: "mentor",
  judge: "judge",
  volunteer: "volunteer",
  organizer: "organizer",
  sponsor: "sponsor",
};

export function isSlot(value: unknown): value is Slot {
  return typeof value === "string" && (SLOTS as readonly string[]).includes(value);
}

/** Lo que cuesta la entrada paga cuando se la enciende, en USDC de prueba. */
export const DEFAULT_PAID_PRICE = 10;

export interface SlotSpec {
  /** Si la plantilla la propone encendida. */
  included: boolean;
  /** Los beneficios que trae, por clave y en el orden en que se canjean. */
  benefits: string[];
  /** La clave del nombre propio de este tipo en esta plantilla ("Participante" en la hackatón). */
  nameKey?: string;
}

export interface TemplateSpec {
  id: TemplateId;
  nameKey: string;
  descriptionKey: string;
  /** Cuántos días dura: las comidas se canjean una por franja y por día. */
  days: number;
  /** Cuántas horas dura el último día, para proponer la hora de fin. */
  hours: number;
  capacity: number;
  /** Se inscribe por equipos (la hackatón). */
  teamSignup: boolean;
  /** Todos los beneficios que alguna credencial de la plantilla puede traer, en orden. */
  benefitOrder: string[];
  slots: Record<Slot, SlotSpec>;
}

// ---------- Los beneficios ----------

export interface BenefitDef {
  key: string;
  kind: BenefitKind;
  name: string;
  /** Dónde se canjea: el puesto del escáner. */
  place: string;
}

const MEAL_BASES = ["breakfast", "lunch", "snack", "dinner"] as const;
type MealBase = (typeof MEAL_BASES)[number];

const MEAL_KIND: Record<MealBase, BenefitKind> = { breakfast: "other", lunch: "lunch", snack: "other", dinner: "other" };

interface FixedBenefit {
  kind: BenefitKind;
  nameKey: string;
  placeKey: string;
}

const FIXED_BENEFITS: Record<string, FixedBenefit> = {
  merch: { kind: "merch", nameKey: "kit.beneficio.polera", placeKey: "kit.puesto.merch" },
  staffMerch: { kind: "merch", nameKey: "kit.beneficio.poleraStaff", placeKey: "kit.puesto.merch" },
  sponsorCoffee: { kind: "other", nameKey: "kit.beneficio.cafe", placeKey: "kit.puesto.auspiciante" },
  prize: { kind: "prize", nameKey: "kit.beneficio.premio", placeKey: "kit.puesto.premios" },
};

const MEAL_KEY_RE = /^(breakfast|lunch|snack|dinner)(?:-(\d+))?$/;

/** "lunch" o "lunch-2": la comida y, si el evento dura varios días, el día. */
function parseMeal(key: string): { base: MealBase; day: number | null } | null {
  const match = MEAL_KEY_RE.exec(key);
  return match ? { base: match[1] as MealBase, day: match[2] ? Number(match[2]) : null } : null;
}

/** Si una clave de plantilla es una comida: desayuno, almuerzo, refrigerio o cena, de cualquier día. */
export function isMealKey(key: string | null | undefined): boolean {
  return Boolean(key && MEAL_KEY_RE.test(key));
}

/**
 * Si un beneficio es comida. Ahí, y solo ahí, el escáner de su mesa recibe la dieta de cada persona. Lo dice el
 * tipo "lunch" o la clave de comida que le puso la plantilla: el desayuno, el refrigerio y la cena son de tipo
 * "other", igual que el café del auspiciante o una taza, que no son comida y no tienen por qué saber la dieta.
 */
export function isFoodBenefit(benefit: Pick<Benefit, "kind" | "templateKey"> | null | undefined): boolean {
  if (!benefit) return false;
  return benefit.kind === "lunch" || isMealKey(benefit.templateKey);
}

/** El beneficio de esa clave, con su nombre y su puesto en el idioma pedido. Null si la clave no existe. */
export function benefitDef(key: string, lang: Lang, templateId?: TemplateId | null): BenefitDef | null {
  const meal = parseMeal(key);
  if (meal) {
    const comida = translate(lang, `kit.beneficio.${meal.base}`);
    const name = meal.day ? translate(lang, "kit.beneficio.comidaDia", { comida, dia: meal.day }) : comida;
    return { key, kind: MEAL_KIND[meal.base], name, place: translate(lang, `kit.puesto.${meal.base}`) };
  }
  const fixed = FIXED_BENEFITS[key];
  if (!fixed) return null;
  // El taller entrega un kit en vez de una polera.
  const nameKey = key === "merch" && templateId === "taller" ? "kit.beneficio.kitTaller" : fixed.nameKey;
  return { key, kind: fixed.kind, name: translate(lang, nameKey), place: translate(lang, fixed.placeKey) };
}

// ---------- Las plantillas ----------

/** Las claves de las comidas de un evento de `days` días: una por franja y por día. */
function mealKeys(days: number, bases: readonly MealBase[]): string[] {
  const keys: string[] = [];
  for (let day = 1; day <= days; day++) {
    for (const base of MEAL_BASES) if (bases.includes(base)) keys.push(days > 1 ? `${base}-${day}` : base);
  }
  return keys;
}

interface Recipe {
  id: TemplateId;
  days?: number;
  hours: number;
  capacity: number;
  teamSignup?: boolean;
  /** Las comidas de quienes vienen al evento. */
  attendeeMeals: readonly MealBase[];
  /** Las comidas de quien hace el evento (oradores, mentoría, jurado, voluntarios, organización). */
  staffMeals: readonly MealBase[];
  /** Las comidas de quien auspicia. */
  sponsorMeals: readonly MealBase[];
  /** Los tipos que la plantilla propone encendidos (además del asistente). */
  on: readonly Slot[];
  /** Quién se lleva cena. */
  dinner: readonly Slot[];
  attendeeNameKey?: string;
  paidNameKey?: string;
}

function build(recipe: Recipe): TemplateSpec {
  const days = recipe.days ?? 1;
  const attendeeMeals = mealKeys(days, recipe.attendeeMeals);
  const staffMeals = mealKeys(days, recipe.staffMeals);
  const sponsorMeals = mealKeys(days, recipe.sponsorMeals);
  // La cena de quien la lleva se suma a sus comidas si no estaba (un meetup no da cena a nadie más).
  const dinnerOf = (slot: Slot, meals: string[]): string[] => {
    if (!recipe.dinner.includes(slot)) return meals;
    const dinners = mealKeys(days, ["dinner"]).filter((k) => !meals.includes(k));
    return [...meals, ...dinners];
  };
  const slots: Record<Slot, SlotSpec> = {
    attendee: { included: true, benefits: [...attendeeMeals, "sponsorCoffee"], nameKey: recipe.attendeeNameKey },
    attendeePaid: { included: false, benefits: [...attendeeMeals, "sponsorCoffee", "merch"], nameKey: recipe.paidNameKey ?? "kit.entrada.conPolera" },
    speaker: { included: recipe.on.includes("speaker"), benefits: [...dinnerOf("speaker", staffMeals), "merch"] },
    mentor: { included: recipe.on.includes("mentor"), benefits: dinnerOf("mentor", staffMeals) },
    judge: { included: recipe.on.includes("judge"), benefits: dinnerOf("judge", staffMeals) },
    volunteer: { included: recipe.on.includes("volunteer"), benefits: [...dinnerOf("volunteer", staffMeals), "staffMerch"] },
    organizer: { included: recipe.on.includes("organizer"), benefits: [...dinnerOf("organizer", staffMeals), "staffMerch"] },
    sponsor: { included: recipe.on.includes("sponsor"), benefits: [...sponsorMeals, "sponsorCoffee"] },
  };
  // El orden de los beneficios: las comidas por día y franja, y después lo demás.
  const used = new Set<string>(SLOTS.flatMap((slot) => slots[slot].benefits));
  const ordered = [...mealKeys(days, MEAL_BASES).filter((k) => used.has(k)), ...["merch", "staffMerch", "sponsorCoffee"].filter((k) => used.has(k)), "prize"];
  return {
    id: recipe.id,
    nameKey: `kit.plantilla.${recipe.id}.nombre`,
    descriptionKey: `kit.plantilla.${recipe.id}.descripcion`,
    days,
    hours: recipe.hours,
    capacity: recipe.capacity,
    teamSignup: recipe.teamSignup ?? false,
    benefitOrder: ordered,
    slots,
  };
}

export const TEMPLATES: Record<TemplateId, TemplateSpec> = {
  devfest: build({
    id: "devfest",
    hours: 9,
    capacity: 300,
    attendeeMeals: ["lunch", "snack"],
    staffMeals: ["lunch", "snack"],
    sponsorMeals: ["lunch", "snack"],
    on: ["speaker", "mentor", "volunteer", "organizer", "sponsor"],
    dinner: ["speaker", "mentor", "organizer"],
  }),
  "build-with-ai": build({
    id: "build-with-ai",
    hours: 8,
    capacity: 150,
    attendeeMeals: ["lunch", "snack"],
    staffMeals: ["lunch", "snack"],
    sponsorMeals: ["lunch", "snack"],
    on: ["speaker", "mentor", "volunteer", "organizer", "sponsor"],
    dinner: ["mentor", "organizer"],
  }),
  iwd: build({
    id: "iwd",
    hours: 7,
    capacity: 120,
    attendeeMeals: ["lunch", "snack"],
    staffMeals: ["lunch", "snack"],
    sponsorMeals: ["lunch", "snack"],
    on: ["speaker", "mentor", "volunteer", "organizer", "sponsor"],
    dinner: ["speaker", "mentor", "organizer"],
  }),
  hackaton: build({
    id: "hackaton",
    days: 2,
    hours: 6,
    capacity: 200,
    teamSignup: true,
    // Cada comida de cada día es un canje distinto: el panel muestra cuántas se canjearon en cada franja.
    attendeeMeals: ["breakfast", "lunch", "snack", "dinner"],
    staffMeals: ["breakfast", "lunch", "snack", "dinner"],
    sponsorMeals: ["lunch"],
    on: ["mentor", "judge", "volunteer", "organizer", "sponsor"],
    dinner: [],
    attendeeNameKey: "kit.tipo.participante",
    paidNameKey: "kit.entrada.participanteConPolera",
  }),
  meetup: build({
    id: "meetup",
    hours: 3,
    capacity: 60,
    attendeeMeals: ["snack"],
    staffMeals: ["snack"],
    sponsorMeals: ["snack"],
    on: ["speaker", "volunteer", "organizer", "sponsor"],
    dinner: [],
  }),
  taller: build({
    id: "taller",
    hours: 4,
    capacity: 40,
    attendeeMeals: ["snack"],
    staffMeals: ["snack"],
    sponsorMeals: ["snack"],
    on: ["speaker", "mentor", "volunteer", "organizer", "sponsor"],
    dinner: [],
    paidNameKey: "kit.entrada.conKit",
  }),
};

export function getTemplate(id: string | null | undefined): TemplateSpec | null {
  return isTemplateId(id) ? TEMPLATES[id] : null;
}

/** El nombre de cada lugar de credencial de la plantilla: "Participante" en la hackatón, el tipo en los demás. */
export function slotName(spec: TemplateSpec, slot: Slot, lang: Lang): string {
  const own = spec.slots[slot].nameKey;
  return own ? translate(lang, own) : translate(lang, `kit.tipo.${SLOT_KIND[slot]}`);
}

/** Los puestos del escáner que la plantilla arma, con su lugar: la puerta y uno por cada beneficio de las credenciales encendidas. */
export function templateStations(spec: TemplateSpec, lang: Lang): Array<{ name: string; place: string | null }> {
  const keys = new Set<string>();
  for (const slot of SLOTS) if (spec.slots[slot].included) for (const key of spec.slots[slot].benefits) keys.add(key);
  keys.add("prize");
  const stations: Array<{ name: string; place: string | null }> = [{ name: translate(lang, "kit.puesto.puerta"), place: null }];
  for (const key of spec.benefitOrder) {
    if (!keys.has(key)) continue;
    const def = benefitDef(key, lang, spec.id);
    if (def) stations.push({ name: def.name, place: def.place });
  }
  return stations;
}

// ---------- La hora ----------

/** La diferencia entre la hora de pared de una zona y UTC en ese momento, en minutos ("-04:00" es -240). */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** "2026-11-28T09:00" en una zona horaria, como instante ISO con su desfase ("2026-11-28T09:00:00-04:00"). */
export function localToIso(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (Number.isNaN(guess.getTime())) return null;
  // Se corrige una vez con el desfase de la zona en ese día (sirve aunque la zona cambie de hora).
  const offset = offsetMinutes(timeZone, new Date(guess.getTime() - offsetMinutes(timeZone, guess) * 60000));
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** El sábado siguiente, a las nueve de la mañana, al menos dos semanas adelante: lo que se propone en el formulario. */
export function suggestedStart(from: Date = new Date()): string {
  const date = new Date(from.getTime() + 14 * 24 * 3600 * 1000);
  date.setUTCDate(date.getUTCDate() + ((6 - date.getUTCDay() + 7) % 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T09:00`;
}

// ---------- Crear el evento ----------

export interface NewEventFromTemplate {
  template: TemplateId;
  lang: Lang;
  /** Si falta, el de la plantilla. */
  name?: string;
  /** "2026-11-28T09:00", en la zona horaria del evento. */
  startsAtLocal: string;
  place: string;
  venue?: string | null;
  organizerName: string;
  capacity?: number | null;
  timezone?: string;
  /** La cuenta de quien organiza, a donde van los pagos. En la red de prueba, la del despliegue. */
  organizerAccount?: string | null;
  /** La cuenta de organizador que lo crea (src/server/organizador.ts), si entró con la suya; el MCP y la clave de la casa no la tienen. */
  organizerId?: string | null;
}

export type TemplateError = "name" | "place" | "organizer" | "date" | "capacity";

export class TemplateInputError extends Error {
  readonly field: TemplateError;
  constructor(field: TemplateError) {
    super(`Dato inválido: ${field}`);
    this.name = "TemplateInputError";
    this.field = field;
  }
}

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

async function uniqueSlug(repo: Repo, base: string): Promise<string> {
  // Un nombre corto ("AI") o que es una ruta de la app ("Nuevo") lleva el sufijo: /admin/nuevo es crear un evento.
  const root = !base ? "mi-evento" : base.length >= SLUG_MIN && !isReservedSlug(base) ? base : `${base}-evento`;
  let slug = root;
  for (let n = 2; await isSlugTaken(repo, slug); n++) slug = `${root}-${n}`;
  return slug;
}

/** Cuántas veces se prueba otro slug si dos creaciones a la vez eligieron el mismo. */
const SLUG_TRIES = 4;

export const MAX_CAPACITY = 1000;

/**
 * Crea el evento de la plantilla como borrador: el evento, sus tipos de credencial, sus beneficios y lo que
 * trae cada tipo. Todavía no tiene contratos ni se ve en la página pública (eso lo hace publicar, publicar.ts).
 */
export async function createEventFromTemplate(repo: Repo, input: NewEventFromTemplate): Promise<EventRecord> {
  const checked = checkTemplateInput(input);
  const { spec, lang, name } = checked;
  // uniqueSlug mira y después se escribe: dos creaciones a la vez con el mismo nombre eligen el mismo slug y la
  // segunda choca con la restricción única. Esa no entra (createEventIfSlugFree) y vuelve a probar con un sufijo al
  // azar: nunca termina en un error.
  for (let attempt = 0; ; attempt++) {
    const base = attempt === 0 ? slugify(name) : `${slugify(name).slice(0, 34) || "evento"}-${randomBytes(3).toString("hex")}`;
    const event = await repo.createEventIfSlugFree({
      slug: await uniqueSlug(repo, base),
      name,
      description: translate(lang, spec.descriptionKey),
      startsAt: checked.startsAt,
      endsAt: checked.endsAt,
      timezone: checked.timezone,
      place: checked.place,
      venue: input.venue?.trim() || null,
      organizerName: checked.organizerName,
      organizerAccount: input.organizerAccount ?? null,
      organizerId: input.organizerId ?? null,
      capacity: checked.capacity,
      template: spec.id,
      published: false,
      teamSignup: spec.teamSignup,
    });
    if (!event) {
      if (attempt + 1 < SLUG_TRIES) continue;
      throw new Error(`No quedó un slug libre para ${name} en ${SLUG_TRIES} vueltas`);
    }
    await saveDraft(repo, event, defaultDraft(spec, lang), lang);
    return event;
  }
}

/**
 * Revisa los datos de la plantilla sin escribir nada y los devuelve limpios, o tira TemplateInputError con el campo
 * que está mal. Crear con la cuenta lo llama antes de gastar un turno de su tope.
 */
export function checkTemplateInput(input: NewEventFromTemplate) {
  const spec = TEMPLATES[input.template];
  const lang = input.lang;
  const timezone = input.timezone ?? "America/La_Paz";
  const name = (input.name ?? "").trim() || translate(lang, spec.nameKey);
  if (name.length < 3 || name.length > 80) throw new TemplateInputError("name");
  const place = input.place.trim();
  if (!place || place.length > 80) throw new TemplateInputError("place");
  const organizerName = input.organizerName.trim();
  if (!organizerName || organizerName.length > 80) throw new TemplateInputError("organizer");
  const startsAt = localToIso(input.startsAtLocal, timezone);
  if (!startsAt) throw new TemplateInputError("date");
  const capacity = input.capacity ?? spec.capacity;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) throw new TemplateInputError("capacity");

  // La hora de fin: los días que dura la plantilla, y las horas del último.
  const endLocal = addHours(input.startsAtLocal, (spec.days - 1) * 24 + spec.hours);
  const endsAt = localToIso(endLocal, timezone);
  return { spec, lang, timezone, name, place, organizerName, startsAt, endsAt, capacity };
}

function addHours(local: string, hours: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim()) as RegExpExecArray;
  const base = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])));
  const end = new Date(base.getTime() + hours * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}T${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}`;
}
