// Las herramientas del servidor MCP: lo que un asistente puede hacer por quien organiza, con las mismas funciones
// del servidor que usan las pantallas, nunca una copia. Cada herramienta recibe el contexto del pedido (la base, el
// idioma, de dónde se pidió y las claves de la sesión) y sus argumentos ya validados (servidor.ts los valida con
// su esquema), y devuelve datos simples que el modelo pueda leer. Qué protege cada cosa:
//   - crear un evento: la clave de la casa (RUMBO_CREATE_KEY, src/server/kit/acceso.ts), como el formulario;
//   - todo lo demás de un evento: la clave de organizador de ese evento (src/server/panel.ts), la misma del panel.
// Ninguna herramienta devuelve nombres ni correos: la lista de personas sigue en el panel, en el navegador. Y a la
// cadena no va nada personal, como siempre.
import { translate, type Lang } from "../../i18n/index.ts";
import { isPublicKind } from "../../lib/credential-kinds.ts";
import { formatStationCode } from "../../lib/station-code.ts";
import { chapterSummary } from "../embajadores.ts";
import { baseUrl } from "../env.ts";
import { RESEND_BATCH_SIZE, resendCredentialLinks } from "../evento/recordatorio.ts";
import { explorerUrl, reportNetwork } from "../explorador.ts";
import { buildEventReportData } from "../informe.ts";
import { createGate, verifyCreateKey } from "../kit/acceso.ts";
import { readDraft } from "../kit/borrador.ts";
import {
  BATCH_SIZE,
  ImportFormatError,
  ImportOptionsError,
  activateBatch,
  defaultImportDeps,
  importStatus,
  labelKey,
  parseGuests,
  prepareImport,
  previewGuests,
  type BatchResult,
  type GuestPreview,
  type GuestStatus,
  type ImportDeps,
  type ImportFormatCode,
  type ImportOptionsCode,
  type ImportSummary,
} from "../kit/importar.ts";
import {
  DEFAULT_PAID_PRICE,
  MAX_CAPACITY,
  SLOTS,
  SLOT_KIND,
  TEMPLATES,
  TEMPLATE_IDS,
  TemplateInputError,
  benefitDef,
  createEventFromTemplate,
  getTemplate,
  slotName,
  templateStations,
  type TemplateError,
  type TemplateId,
  type TemplateSpec,
} from "../kit/plantillas.ts";
import { publishEvent, type ContractProvisioner, type PublishFailure } from "../kit/publicar.ts";
import { getMailer, type Mailer } from "../mailer.ts";
import { ensureStationCodes, getOrCreateOrganizerKey, getPanelState, getSponsorReport, listChapterContacts, verifyOrganizerKey } from "../panel.ts";
import type { EventRecord, Repo } from "../repo.ts";
import { getEventStandsReport, getStand, getStandReport } from "../stands.ts";
import { readDeployInfo } from "../stellar.ts";
import { buildRaffleList } from "../vivo.ts";

// ---------- El contexto y los errores ----------

export interface McpContext {
  repo: Repo;
  /** El idioma de los nombres que se crean y de los correos, si la herramienta no dice otro. */
  lang: Lang;
  /** De dónde se pidió ("http://localhost:3000"): en desarrollo los enlaces salen de ahí. */
  origin: string | null;
  /** La clave de organizador con la que se abrió la sesión (Authorization: Bearer), si la hay. */
  organizerKey: string | null;
  /** La clave de la casa con la que se abrió la sesión (X-Rumbo-Create-Key), si la hay. */
  createKey: string | null;
  /** Quien crea el contrato de cada entrada al publicar: el de la red de prueba, o uno de mentira en las pruebas. */
  provisioner: ContractProvisioner;
  /** Lo que la importación necesita de afuera; sin esto, lo de siempre (cuentas, contrato y correo del servidor). */
  importDeps?: (lang: Lang) => ImportDeps;
  /** El correo del reenvío; sin esto, el del servidor. */
  mailer?: Pick<Mailer, "send">;
}

export type McpToolCode = "not_found" | "unauthorized" | "closed" | "invalid_input" | "draft" | "publish_failed";

/** Un pedido que no se puede cumplir, con un código estable y un mensaje que el modelo pueda explicar. */
export class McpToolError extends Error {
  readonly code: McpToolCode;
  constructor(code: McpToolCode, message: string) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
  }
}

const KEY_HINT = "pass organizer_key, or open the session with it (Authorization: Bearer <key> on /api/mcp, or RUMBO_ORGANIZER_KEY for the stdio bridge)";

/** El evento del slug, si la clave (la del argumento, o la de la sesión) abre su panel. */
async function resolveEvent(ctx: McpContext, slug: string, key: string | undefined): Promise<{ event: EventRecord; key: string }> {
  const event = await ctx.repo.getEventBySlug(slug.trim());
  if (!event) throw new McpToolError("not_found", `There is no event with slug "${slug}".`);
  const given = key ?? ctx.organizerKey;
  if (!given) throw new McpToolError("unauthorized", `This tool needs the organizer key of "${event.slug}": ${KEY_HINT}.`);
  if (!(await verifyOrganizerKey(event.id, given))) throw new McpToolError("unauthorized", `That organizer key does not open the event "${event.slug}".`);
  return { event, key: given.trim().toUpperCase() };
}

// ---------- Lo que comparten ----------

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** De dónde salen los enlaces: el servidor desde el que se pidió si es local, si no NEXT_PUBLIC_BASE_URL (como el correo). */
function linkBase(ctx: McpContext): string {
  const base = ctx.origin && LOCAL_ORIGIN.test(ctx.origin) ? ctx.origin : baseUrl();
  return base.replace(/\/+$/, "");
}

function eventSummary(event: EventRecord) {
  const { slug, name, description, startsAt, endsAt, timezone, place, venue, organizerName, capacity, published, teamSignup, template } = event;
  return { slug, name, description, startsAt, endsAt, timezone, place, venue, organizerName, capacity, published, teamSignup, template };
}

/** Los enlaces de quien organiza, con su clave: el panel y lo que toca según el momento del evento. */
function adminLinks(ctx: McpContext, event: EventRecord, key: string) {
  const base = linkBase(ctx);
  const slug = encodeURIComponent(event.slug);
  const k = `?k=${encodeURIComponent(key)}`;
  const admin = `${base}/admin/${slug}`;
  return event.published
    ? { page: `${base}/e/${slug}`, panel: `${admin}${k}`, importGuests: `${admin}/importar${k}`, sponsorReport: `${admin}/informe${k}`, liveScreen: `${base}/vivo/${slug}${k}` }
    : { page: `${base}/e/${slug}`, review: `${admin}/armar${k}`, panel: `${admin}${k}` };
}

const nameOfBenefit = (spec: TemplateSpec, key: string, lang: Lang): string => benefitDef(key, lang, spec.id)?.name ?? key;

/** El borrador como está guardado: cada tipo de credencial con lo que trae, cada canje con su puesto y su tope. */
async function describeDraft(ctx: McpContext, event: EventRecord, lang: Lang) {
  const draft = await readDraft(ctx.repo, event, lang);
  if (!draft) return null;
  const name = (key: string) => draft.benefits.find((b) => b.key === key)?.name ?? key;
  return {
    template: draft.template.id,
    teamSignup: draft.teamSignup,
    credentialTypes: draft.slots.map((s) => ({
      slot: s.slot,
      kind: s.kind,
      name: s.name,
      included: s.included,
      alwaysOn: s.locked,
      priceUsdc: s.slot === "attendeePaid" ? s.price : 0,
      benefits: s.benefits.map(name),
    })),
    benefits: draft.benefits.map((b) => ({ key: b.key, name: b.name, place: b.place, stock: b.stock, perCredential: b.perCredential })),
    stations: templateStations(draft.template, lang),
  };
}

// ---------- list_templates ----------

function describeTemplate(spec: TemplateSpec, lang: Lang) {
  return {
    id: spec.id,
    name: translate(lang, spec.nameKey),
    description: translate(lang, spec.descriptionKey),
    days: spec.days,
    hoursOnLastDay: spec.hours,
    suggestedCapacity: spec.capacity,
    teamSignup: spec.teamSignup,
    credentialTypes: SLOTS.map((slot) => ({
      slot,
      kind: SLOT_KIND[slot],
      name: slotName(spec, slot, lang),
      included: spec.slots[slot].included,
      optionalPaid: slot === "attendeePaid",
      priceUsdc: slot === "attendeePaid" ? DEFAULT_PAID_PRICE : 0,
      benefits: spec.slots[slot].benefits.map((key) => nameOfBenefit(spec, key, lang)),
    })),
    rafflePrize: nameOfBenefit(spec, "prize", lang),
    stations: templateStations(spec, lang),
  };
}

export function listTemplates(ctx: McpContext, args: { lang?: Lang }) {
  const lang = args.lang ?? ctx.lang;
  return {
    templates: TEMPLATE_IDS.map((id) => describeTemplate(TEMPLATES[id], lang)),
    notes: [
      "Every template is free by default: the attendee registration costs nothing. The paid ticket (with a t-shirt or a kit) is optional and starts off.",
      "Only attendees register from the public page; speakers, mentors, judges, volunteers, organizers and sponsors receive their credentials by invitation (import_guest_list).",
      "The raffle prize is not part of any credential: it goes to whoever wins the draw (draw_list gives the verifiable list).",
      "Everything a template proposes can be changed in the draft before publishing: names, which credential types exist, what each one includes, stock per redemption.",
    ],
  };
}

// ---------- create_event_draft ----------

export interface CreateDraftArgs {
  template: TemplateId;
  name?: string;
  /** "2026-11-28T09:00", en la hora local del evento. */
  starts_at: string;
  timezone?: string;
  city: string;
  venue?: string;
  organizer: string;
  capacity?: number;
  lang?: Lang;
  create_key?: string;
}

const FIELD_MESSAGES: Record<TemplateError, string> = {
  name: "name must have between 3 and 80 characters.",
  place: "city is required, up to 80 characters.",
  organizer: "organizer is required, up to 80 characters.",
  date: "starts_at must look like 2026-11-28T09:00 (the event's local time).",
  capacity: `capacity must be a whole number between 1 and ${MAX_CAPACITY}.`,
};

function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export async function createEventDraft(ctx: McpContext, args: CreateDraftArgs) {
  const lang = args.lang ?? ctx.lang;
  const houseKey = args.create_key ?? ctx.createKey;
  if (!verifyCreateKey(houseKey)) {
    if (!createGate().open) throw new McpToolError("closed", "This server does not allow creating events.");
    throw new McpToolError(
      "unauthorized",
      houseKey
        ? "That house key is not the one this server expects."
        : "Creating an event on this server needs its house key (RUMBO_CREATE_KEY): pass it as create_key, or set RUMBO_CREATE_KEY for the stdio bridge.",
    );
  }
  if (args.timezone !== undefined && !isTimeZone(args.timezone)) throw new McpToolError("invalid_input", `timezone must be an IANA name such as America/La_Paz (got "${args.timezone}").`);

  // En la red de prueba, los pagos van a la cuenta de quien organiza del despliegue de muestra, como en el formulario.
  let organizerAccount: string | null = null;
  try {
    organizerAccount = readDeployInfo()?.accounts.organizer ?? null;
  } catch {
    organizerAccount = null;
  }

  let event: EventRecord;
  try {
    event = await createEventFromTemplate(ctx.repo, {
      template: args.template,
      lang,
      name: args.name,
      startsAtLocal: args.starts_at,
      place: args.city,
      venue: args.venue ?? null,
      organizerName: args.organizer,
      capacity: args.capacity ?? null,
      timezone: args.timezone,
      organizerAccount,
    });
  } catch (error) {
    if (error instanceof TemplateInputError) throw new McpToolError("invalid_input", FIELD_MESSAGES[error.field]);
    throw error;
  }
  const key = await getOrCreateOrganizerKey(event.id);
  return {
    event: eventSummary(event),
    organizer_key: key,
    links: adminLinks(ctx, event, key),
    draft: await describeDraft(ctx, event, lang),
    next: "The event is a draft: nobody can see it or register yet. Show the organizer what the draft includes and the review link (there they can rename credentials, turn types on or off and set stock). Keep organizer_key: every other tool about this event needs it. Call publish_event only when the organizer approves.",
  };
}

// ---------- publish_event ----------

export interface EventArgs {
  event: string;
  organizer_key?: string;
}

const PUBLISH_MESSAGES: Record<PublishFailure, string> = {
  no_attendee: "The draft has no attendee credential type.",
  no_free_attendee: "The draft needs a free attendee registration (paid tickets are optional).",
  no_capacity: `The event needs a capacity between 1 and ${MAX_CAPACITY}.`,
  deploy_failed: "Deploying a contract on the test network failed",
};

async function contractsOf(ctx: McpContext, event: EventRecord) {
  const network = reportNetwork();
  return (await ctx.repo.listTicketTypes(event.id))
    .filter((t) => t.contractId)
    .map((t) => ({ ticketType: t.name, kind: t.credentialKind, priceUsdc: t.priceUsdc, contractId: t.contractId as string, explorer: explorerUrl(network, "contract", t.contractId as string) }));
}

export async function publishDraft(ctx: McpContext, args: EventArgs) {
  const { event, key } = await resolveEvent(ctx, args.event, args.organizer_key);
  const network = reportNetwork();
  if (event.published) {
    return { ok: true, alreadyPublished: true, deployed: 0, network, contracts: await contractsOf(ctx, event), event: eventSummary(event), links: adminLinks(ctx, event, key) };
  }
  const result = await publishEvent(ctx.repo, event, ctx.provisioner);
  if (!result.ok) {
    throw new McpToolError("publish_failed", `${PUBLISH_MESSAGES[result.reason]}${result.detail ? `: ${result.detail}` : ""}. The event is still a draft; the contracts already created are kept for the next attempt.`);
  }
  const published = (await ctx.repo.getEventById(event.id)) ?? event;
  return {
    ok: true,
    alreadyPublished: false,
    deployed: result.deployed,
    network,
    contracts: await contractsOf(ctx, published),
    event: eventSummary(published),
    links: adminLinks(ctx, published, key),
    next: "The event is live: attendees register at links.page. Next steps: import_guest_list for the people already registered elsewhere, event_status for the live numbers, the station codes for the volunteers are in event_status.stations.",
  };
}

// ---------- get_event ----------

export async function getEvent(ctx: McpContext, args: EventArgs & { lang?: Lang }) {
  const lang = args.lang ?? ctx.lang;
  const event = await ctx.repo.getEventBySlug(args.event.trim());
  if (!event) throw new McpToolError("not_found", `There is no event with slug "${args.event}".`);
  const given = args.organizer_key ?? ctx.organizerKey;
  const organizer = given ? await verifyOrganizerKey(event.id, given) : false;
  if (args.organizer_key && !organizer) throw new McpToolError("unauthorized", `That organizer key does not open the event "${event.slug}".`);
  if (!event.published && !organizer) throw new McpToolError("not_found", `There is no published event with slug "${event.slug}" (a draft is only visible with its organizer key).`);

  const [types, benefits] = await Promise.all([ctx.repo.listTicketTypes(event.id), ctx.repo.listBenefits(event.id)]);
  const tickets = await Promise.all(
    types
      .filter((t) => organizer || isPublicKind(t.credentialKind))
      .map(async (t) => ({
        id: t.id,
        name: t.name,
        kind: t.credentialKind,
        priceUsdc: t.priceUsdc,
        free: t.priceUsdc === 0,
        publicRegistration: isPublicKind(t.credentialKind),
        ...(organizer ? { contractId: t.contractId ?? event.contractId } : {}),
        benefits: (await ctx.repo.listTicketTypeBenefits(t.id)).map((b) => ({ id: b.id, name: b.name, kind: b.kind })),
      })),
  );
  const spec = getTemplate(event.template);
  const stations = spec
    ? templateStations(spec, lang)
    : [{ name: translate(lang, "kit.puesto.puerta"), place: null as string | null }, ...benefits.map((b) => ({ name: b.name, place: b.station }))];
  return {
    event: eventSummary(event),
    tickets,
    benefits: benefits.map((b) => ({ id: b.id, name: b.name, kind: b.kind, station: b.station, stock: b.stock })),
    stations,
    links: organizer && given ? adminLinks(ctx, event, given.trim().toUpperCase()) : { page: `${linkBase(ctx)}/e/${encodeURIComponent(event.slug)}` },
  };
}

// ---------- import_guest_list y continue_import ----------

export interface ImportArgs extends EventArgs {
  csv: string;
  confirm?: boolean;
  statuses?: GuestStatus[];
  /** Cada entrada de la lista ("Speaker") → el id del tipo de credencial de acá. */
  mapping?: Record<string, string>;
  default_type_id?: string;
  batch_size?: number;
  lang?: Lang;
}

const FORMAT_MESSAGES: Record<ImportFormatCode, string> = {
  empty: "The list is empty.",
  no_text: "The list is not text (an .xlsx has to be exported as CSV).",
  no_email: "The list has no column with emails.",
};

const OPTIONS_MESSAGES: Record<ImportOptionsCode, string> = {
  draft: "This event is still a draft: publish it first.",
  no_type: "default_type_id is required: a free credential type of this event.",
  bad_type: "A credential type in mapping or default_type_id does not belong to this event.",
  paid_type: "Guests can only be imported into free credential types.",
  no_contract: "That credential type has no contract yet: publish the event first.",
};

function describePreview(preview: GuestPreview, statuses: GuestStatus[]) {
  const type = (id: string | null) => (id ? (preview.types.find((t) => t.id === id) ?? null) : null);
  return {
    source: preview.source,
    columnsRead: preview.columns,
    columnsIgnored: preview.ignored,
    rows: preview.total,
    linesSkipped: preview.skippedLines,
    byStatus: preview.buckets,
    selectedStatuses: statuses,
    wouldImport: statuses.reduce((n, s) => n + (preview.buckets[s]?.valid ?? 0), 0),
    tickets: preview.tickets.map((t) => ({ label: t.label || "(no ticket column)", key: t.key, people: t.count, credentialType: type(t.suggestedTypeId) })),
    credentialTypes: preview.types,
    defaultCredentialType: type(preview.defaultTypeId),
  };
}

function describeSummary(summary: ImportSummary, preview: GuestPreview) {
  const name = (id: string) => preview.types.find((t) => t.id === id)?.name ?? id;
  return {
    source: summary.source,
    rows: summary.read,
    notSelected: summary.notSelected,
    invalidEmail: summary.invalidEmail,
    duplicatesInFile: summary.duplicatesInFile,
    alreadyHere: summary.alreadyHere,
    created: summary.created,
    byCredentialType: Object.fromEntries(Object.entries(summary.byType).map(([id, n]) => [name(id), n])),
  };
}

function nextAfterBatch(batch: BatchResult, runId: string): string {
  if (batch.busy) return `Another batch of this import is running right now: call continue_import with run_id "${runId}" again in a moment.`;
  if (batch.remaining > 0) return `${batch.remaining} credentials are still pending: call continue_import with run_id "${runId}" until remaining is 0. Each call prepares one batch (account, contract, email).`;
  return batch.failed > 0 ? "No credentials left to send; some failed and were retried in this batch, see failed." : "All credentials of this import were prepared and emailed.";
}

async function runBatch(ctx: McpContext, event: EventRecord, runId: string, size: number | undefined, lang: Lang): Promise<BatchResult> {
  const deps = ctx.importDeps ? ctx.importDeps(lang) : defaultImportDeps(lang, ctx.origin, ctx.repo);
  return activateBatch(ctx.repo, event, runId, size ?? BATCH_SIZE, deps);
}

export async function importGuestList(ctx: McpContext, args: ImportArgs) {
  const lang = args.lang ?? ctx.lang;
  const { event } = await resolveEvent(ctx, args.event, args.organizer_key);
  if (!event.published) throw new McpToolError("draft", "This event is still a draft: publish it first (publish_event), then import the list.");

  let parsed;
  try {
    parsed = parseGuests(args.csv);
  } catch (error) {
    if (error instanceof ImportFormatError) throw new McpToolError("invalid_input", FORMAT_MESSAGES[error.code]);
    throw error;
  }
  const preview = await previewGuests(ctx.repo, event, parsed);
  const statuses = args.statuses && args.statuses.length > 0 ? args.statuses : (["approved"] as GuestStatus[]);
  const view = describePreview(preview, statuses);

  if (!args.confirm) {
    return {
      preview: true,
      ...view,
      next: "Nothing was created. Show the organizer what was read and who would get which credential. To import, call again with confirm: true (and, if they want to change the proposal, statuses, mapping or default_type_id).",
    };
  }

  // Lo que la vista propone es lo que se usa si no se dice otra cosa, igual que la pantalla.
  const mapping: Record<string, string> = Object.fromEntries(preview.tickets.filter((t) => t.suggestedTypeId).map((t) => [t.key, t.suggestedTypeId as string]));
  for (const [label, typeId] of Object.entries(args.mapping ?? {})) mapping[labelKey(label)] = typeId;
  const defaultTypeId = args.default_type_id ?? preview.defaultTypeId;
  if (!defaultTypeId) throw new McpToolError("invalid_input", "This event has no free credential type to import into.");

  let prepared;
  try {
    prepared = await prepareImport(ctx.repo, event, parsed, { statuses, mapping, defaultTypeId });
  } catch (error) {
    if (error instanceof ImportOptionsError) throw new McpToolError(error.code === "draft" ? "draft" : "invalid_input", OPTIONS_MESSAGES[error.code]);
    throw error;
  }
  const batch = await runBatch(ctx, event, prepared.run.id, args.batch_size, lang);
  return {
    imported: true,
    run_id: prepared.run.id,
    summary: describeSummary(prepared.summary, preview),
    batch,
    next: nextAfterBatch(batch, prepared.run.id),
  };
}

export async function continueImport(ctx: McpContext, args: EventArgs & { run_id: string; batch_size?: number; lang?: Lang }) {
  const lang = args.lang ?? ctx.lang;
  const { event } = await resolveEvent(ctx, args.event, args.organizer_key);
  const run = await ctx.repo.getImportRun(args.run_id);
  if (!run || run.eventId !== event.id) throw new McpToolError("not_found", `There is no import "${args.run_id}" in the event "${event.slug}".`);
  const batch = await runBatch(ctx, event, run.id, args.batch_size, lang);
  const status = await importStatus(ctx.repo, run.id);
  const totals = status?.summary;
  return {
    run_id: run.id,
    batch,
    totals: totals ? { created: totals.created, activated: totals.activated, emailsSent: totals.emailsSent, emailsFailed: totals.emailsFailed, pending: status.remaining } : null,
    next: nextAfterBatch(batch, run.id),
  };
}

// ---------- resend_links ----------

export async function resendLinks(ctx: McpContext, args: EventArgs & { batch_size?: number; lang?: Lang }) {
  const lang = args.lang ?? ctx.lang;
  const { event } = await resolveEvent(ctx, args.event, args.organizer_key);
  const result = await resendCredentialLinks(event, args.batch_size ?? RESEND_BATCH_SIZE, { mailer: ctx.mailer ?? getMailer(), lang, origin: ctx.origin }, ctx.repo);
  return {
    ...result,
    next:
      result.remaining > 0
        ? `${result.remaining} people are left for the next batch: call resend_links again.`
        : result.skipped > 0
          ? `${result.skipped} people got their link less than ten minutes ago and were not emailed again.`
          : "Everyone who has not checked in yet got their link again.",
  };
}

// ---------- event_status ----------

export async function eventStatus(ctx: McpContext, args: EventArgs & { lang?: Lang }) {
  const lang = args.lang ?? ctx.lang;
  const { event } = await resolveEvent(ctx, args.event, args.organizer_key);
  // Los códigos de puesto se crean la primera vez que alguien abre el panel; acá igual.
  await ensureStationCodes(event, ctx.repo);
  const state = await getPanelState(event, ctx.repo);
  const gate = translate(lang, "kit.puesto.puerta");
  const sync = state.lastChainSync;
  return {
    generatedAt: state.generatedAt,
    event: state.event,
    counters: state.counters,
    pendingSync: state.pendingSync,
    ticketTypes: state.ticketTypes,
    // Un renglón por canje: en un evento de varios días, uno por comida y por día (la franja).
    redemptions: state.benefits,
    duplicates: {
      total: state.duplicates.length,
      checkIns: state.duplicates.filter((d) => d.kind === "checkin").length,
      redemptions: state.duplicates.filter((d) => d.kind === "redemption").length,
      latest: state.duplicates.slice(0, 20).map(({ id, kind, passId, benefitName, scannedAt, scannerId }) => ({ id, kind, passId, benefitName, scannedAt, scannerId })),
    },
    stations: state.stations.map((s) => ({
      code: formatStationCode(s.code),
      kind: s.kind,
      name: s.kind === "gate" ? gate : s.kind === "stand" ? s.standName : s.benefitName,
      place: s.station,
    })),
    lastChainSync: sync
      ? {
          syncedAt: sync.syncedAt,
          passesChecked: sync.passesChecked,
          checkInsAdded: sync.checkInsAdded,
          redemptionsAdded: sync.redemptionsAdded,
          passesFixed: sync.passesFixed,
          pendingSync: sync.pendingSync,
          unknownOnChain: sync.unknownOnChain,
          mismatches: sync.mismatches.length,
          errors: sync.errors.length,
        }
      : null,
  };
}

// ---------- sponsor_report ----------

export async function sponsorReport(ctx: McpContext, args: EventArgs & { stand_id?: string }) {
  const { event } = await resolveEvent(ctx, args.event, args.organizer_key);
  if (args.stand_id) {
    const stand = await getStand(args.stand_id);
    if (!stand || stand.eventId !== event.id) throw new McpToolError("not_found", `There is no stand "${args.stand_id}" in the event "${event.slug}".`);
    return { generatedAt: new Date().toISOString(), event: { slug: event.slug, name: event.name }, stand: await getStandReport(stand.id, ctx.repo) };
  }
  const [report, stands] = await Promise.all([getSponsorReport(event, ctx.repo), getEventStandsReport(event, ctx.repo)]);
  return {
    generatedAt: report.generatedAt,
    event: report.event,
    issued: report.issued,
    checkedIn: report.checkedIn,
    ticketTypes: report.ticketTypes,
    benefits: report.benefits,
    headline: report.headline,
    duplicatesRejected: report.duplicatesRejected,
    route: stands.route,
    stands: stands.stands,
  };
}

// ---------- draw_list ----------

export async function drawList(ctx: McpContext, args: EventArgs) {
  const { event } = await resolveEvent(ctx, args.event, args.organizer_key);
  const list = await buildRaffleList(event);
  return {
    ...list,
    note: "Credential codes of everyone who checked in, sorted, with the SHA-256 of the codes joined by newlines in this order. Publish the hash before the draw; anyone can recompute it afterwards. This tool does not draw: the draw happens elsewhere, with verifiable randomness, and the winner's name is looked up by code in the panel.",
  };
}

// ---------- chapter_package_summary ----------

export async function chapterPackageSummary(ctx: McpContext, args: EventArgs & { stellar_minutes?: number; food_spend_usd?: number }) {
  const { event } = await resolveEvent(ctx, args.event, args.organizer_key);
  const [data, contacts] = await Promise.all([buildEventReportData(event, ctx.repo), listChapterContacts(event, ctx.repo)]);
  const summary = chapterSummary(data, { stellarMinutes: args.stellar_minutes ?? null, foodSpendUsd: args.food_spend_usd ?? null, contactsShared: contacts.length });
  return {
    event: { slug: data.event.slug, name: data.event.name, community: data.event.community, startsAt: data.event.startsAt, city: data.event.place },
    network: data.network,
    issued: data.issued,
    checkedIn: data.checkedIn,
    contracts: data.contracts.map((c) => ({ ...c, explorer: explorerUrl(data.network, "contract", c.id) })),
    chainCheck: data.chainCheck,
    ...summary,
    next: "pnpm paquete-embajadores -- --evento <slug> --minutos-stellar <n> --gasto-comida <usd> writes the PDF report, the row for the chapter's Airtable and the contacts CSV (only people who agreed to hear from the chapter).",
  };
}
