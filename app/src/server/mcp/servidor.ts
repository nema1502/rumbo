// El servidor MCP de Rumbo: las herramientas de herramientas.ts registradas con su esquema y su descripción (en
// inglés, que es lo que lee el modelo), más el prompt "describe_your_event", que guía al asistente para armar un
// evento desde una frase: pedir lo básico, elegir la plantilla, crear el borrador, mostrar el enlace para revisarlo
// y publicar recién cuando la persona aprueba. Un servidor por pedido: lo crean la ruta HTTP (src/app/api/mcp/route.ts,
// sin estado) y las pruebas (con un transporte en memoria). El puente por stdio (scripts/mcp.mjs) habla con la ruta
// HTTP, no con este módulo, así las herramientas viven en un solo lugar.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DEFAULT_LANG, LANGS } from "../../i18n/index.ts";
import { RESEND_MAX_BATCH_SIZE } from "../evento/recordatorio.ts";
import { GUEST_STATUSES, MAX_BATCH_SIZE, type GuestStatus } from "../kit/importar.ts";
import { MAX_CAPACITY, TEMPLATE_IDS } from "../kit/plantillas.ts";
import { networkProvisioner } from "../kit/publicar.ts";
import { describeForLog } from "../log.ts";
import { getRepo, type Repo } from "../repo.ts";
import {
  McpToolError,
  chapterPackageSummary,
  continueImport,
  createEventDraft,
  drawList,
  eventStatus,
  getEvent,
  importGuestList,
  listTemplates,
  publishDraft,
  resendLinks,
  sponsorReport,
  type McpContext,
} from "./herramientas.ts";

export const MCP_SERVER_NAME = "rumbo";
export const MCP_SERVER_VERSION = "0.1.0";

/** Lo que el servidor le cuenta al asistente al conectarse: qué es Rumbo, qué clave pide cada cosa y qué no hace. */
export const MCP_INSTRUCTIONS = [
  "Rumbo runs community events: free registration (paid tickets are optional), a QR credential per person, check-in at the door, one-time redemptions at each table (lunch, snack, swag, prizes), live numbers for the organizer, a sponsor report with numbers only, and a verifiable list for the draw. Everything runs on the Stellar test network: each credential type gets its own contract when the event is published.",
  "Keys: creating an event needs the server's house key (create_key, or the X-Rumbo-Create-Key header). Everything about one event needs that event's organizer key: pass organizer_key, or open the session with it (Authorization: Bearer <key>). create_event_draft returns the new event's organizer key; keep it for the next calls.",
  "Flow: list_templates, create_event_draft, show the review link, publish_event only when the organizer approves, then import_guest_list (preview first, then confirm: true, then continue_import until nothing is pending), resend_links before the event, event_status during it, sponsor_report, draw_list and chapter_package_summary after it.",
  "The tools never return attendee names or emails, and nothing personal goes on chain. Use the describe_your_event prompt to set up an event from a sentence.",
].join("\n");

/** GUEST_STATUSES es una lista de solo lectura; z.enum quiere saber que tiene al menos un valor. */
const STATUS_VALUES = GUEST_STATUSES as unknown as [GuestStatus, ...GuestStatus[]];

// ---------- Los argumentos que se repiten ----------

const eventSlug = z.string().trim().min(1).max(80).describe("The event's slug, the last part of its public address /e/<slug> (for example build-with-ai).");
const organizerKey = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .optional()
  .describe("The organizer key of this event: the one in the panel link (?k=...), returned by create_event_draft. Not needed when the session was opened with it (Authorization: Bearer <key>, or RUMBO_ORGANIZER_KEY for the stdio bridge).");
const lang = z.enum(LANGS).optional().describe("Language for names and emails: es (default) or en.");
const batchSize = (max: number, fallback: number) =>
  z.number().int().min(1).max(max).optional().describe(`How many people this call handles (${fallback} by default, up to ${max}). Lower it if your client times out: on the test network each credential takes a few seconds.`);

// ---------- Lo que comparten todas las herramientas ----------

export interface RumboMcpOptions extends Partial<Omit<McpContext, "repo">> {
  repo?: Repo;
}

type ToolData = Record<string, unknown>;

function asResult(value: ToolData): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function asError(code: string, message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `${code}: ${message}` }] };
}

/**
 * Corre una herramienta y arma su resultado. Un error conocido vuelve como resultado con isError, con su código y su
 * mensaje, para que el modelo lo explique; uno desconocido va al registro del servidor y al modelo le llega solo que falló.
 */
async function safely(name: string, run: () => Promise<ToolData> | ToolData): Promise<CallToolResult> {
  try {
    return asResult(await run());
  } catch (error) {
    if (error instanceof McpToolError) return asError(error.code, error.message);
    console.error(`[mcp] ${name}: ${describeForLog(error)}`);
    return asError("internal_error", "The tool failed on the server; the server log has the detail.");
  }
}

const readOnly: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const writes = (idempotent: boolean): ToolAnnotations => ({ readOnlyHint: false, destructiveHint: false, idempotentHint: idempotent, openWorldHint: false });

/** Crea el servidor con sus herramientas y su prompt. Las opciones que faltan toman lo del servidor de siempre. */
export function createRumboMcpServer(options: RumboMcpOptions = {}): McpServer {
  const ctx: McpContext = {
    repo: options.repo ?? getRepo(),
    lang: options.lang ?? DEFAULT_LANG,
    origin: options.origin ?? null,
    organizerKey: options.organizerKey ?? null,
    createKey: options.createKey ?? null,
    provisioner: options.provisioner ?? networkProvisioner,
    importDeps: options.importDeps,
    mailer: options.mailer,
  };
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: "Rumbo" }, { instructions: MCP_INSTRUCTIONS });

  server.registerTool(
    "list_templates",
    {
      title: "List event templates",
      description:
        "The six event templates (DevFest, Build with AI, Women's Day, hackathon, meetup, workshop) with what each one proposes: duration, suggested capacity, credential types with what each includes, the optional paid ticket, the raffle prize and the scanner stations. Public, no key needed. Call it before create_event_draft to pick the closest template.",
      inputSchema: { lang },
      annotations: readOnly,
    },
    (args) => safely("list_templates", () => listTemplates(ctx, args)),
  );

  server.registerTool(
    "create_event_draft",
    {
      title: "Create an event draft from a template",
      description:
        "Creates the event as a draft from a template, with its credential types, redemptions and stations as the template proposes. Needs the server's house key (RUMBO_CREATE_KEY) unless the session already carries it. Returns the draft, the new event's organizer key (keep it: every other tool needs it) and the link where the organizer reviews and edits the draft. The event is not public until publish_event.",
      inputSchema: {
        template: z.enum(TEMPLATE_IDS).describe("The template id, from list_templates."),
        name: z.string().trim().min(3).max(80).optional().describe("The event's name. Defaults to the template's name."),
        starts_at: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use the shape 2026-11-28T09:00")
          .describe("Start date and time in the event's local time, shaped 2026-11-28T09:00. The end is proposed from the template's duration."),
        timezone: z.string().trim().min(1).max(64).optional().describe("IANA time zone of the event (America/La_Paz by default)."),
        city: z.string().trim().min(1).max(80).describe("City."),
        venue: z.string().trim().max(80).optional().describe("Venue, optional."),
        organizer: z.string().trim().min(1).max(80).describe("Who organizes: the community or the chapter."),
        capacity: z.number().int().min(1).max(MAX_CAPACITY).optional().describe(`How many people fit (1 to ${MAX_CAPACITY}). Defaults to the template's suggestion.`),
        lang,
        create_key: z.string().trim().min(1).max(200).optional().describe("The server's house key (RUMBO_CREATE_KEY), if this server asks for one to create events."),
      },
      annotations: writes(false),
    },
    (args) => safely("create_event_draft", () => createEventDraft(ctx, args)),
  );

  server.registerTool(
    "publish_event",
    {
      title: "Publish the event",
      description:
        "Publishes a draft: deploys one rumbo-pass contract per credential type on the Stellar test network (price, capacity and number of redemptions are fixed per contract) and makes the public page live, so people can register. Ask the organizer before calling it. Needs the event's organizer key. Publishing again does nothing. If a deployment fails, the draft stays as it was and the next call continues from the contracts already created.",
      inputSchema: { event: eventSlug, organizer_key: organizerKey },
      annotations: writes(true),
    },
    (args) => safely("publish_event", () => publishDraft(ctx, args)),
  );

  server.registerTool(
    "get_event",
    {
      title: "Read an event",
      description:
        "What is public about an event: when and where, the tickets people can register for (with what each includes), the catalog of redemptions and the stations. With the organizer key it also shows a draft, the invitation-only credential types, the contract of each ticket and the organizer's links.",
      inputSchema: { event: eventSlug, organizer_key: organizerKey, lang },
      annotations: readOnly,
    },
    (args) => safely("get_event", () => getEvent(ctx, args)),
  );

  server.registerTool(
    "import_guest_list",
    {
      title: "Import a guest list (Luma, Bevy or any CSV with emails)",
      description:
        "Takes the exported list as CSV text. Without confirm it only previews: which platform it looks like, which columns were read, how many people would get a credential by status, which credential type each ticket maps to, duplicates and invalid emails. Nothing is created. With confirm: true it creates one pending credential per person (people already in the event are left untouched: check-ins are never overwritten) and prepares the first batch: the Stellar account, the contract registration and the email with the personal link, five people per call by default. Then call continue_import until remaining is 0. Needs the event's organizer key and a published event. Only free credential types can be imported into.",
      inputSchema: {
        event: eventSlug,
        organizer_key: organizerKey,
        csv: z.string().min(1).max(2_000_000).describe("The whole CSV as text, header included, as exported by Luma, Bevy or a spreadsheet (up to 2 MB)."),
        confirm: z.boolean().optional().describe("false or absent: preview only. true: import and send the first batch."),
        statuses: z
          .array(z.enum(STATUS_VALUES))
          .optional()
          .describe('Which statuses get a credential. Default ["approved"] (approved in Luma; registered, checked in or attended in Bevy). Others: pending, waitlist, declined, cancelled, unknown.'),
        mapping: z.record(z.string(), z.string()).optional().describe('Ticket label in the list to credential type id of this event, for example {"Speaker": "<type id>"}. Defaults to the preview\'s suggestion.'),
        default_type_id: z.string().trim().min(1).optional().describe("Credential type for people whose ticket is not in mapping. Defaults to the preview's suggestion (the free attendee)."),
        batch_size: batchSize(MAX_BATCH_SIZE, 5),
        lang,
      },
      annotations: writes(false),
    },
    (args) => safely("import_guest_list", () => importGuestList(ctx, args)),
  );

  server.registerTool(
    "continue_import",
    {
      title: "Send the next batch of an import",
      description:
        "Prepares and emails the next batch of pending credentials of an import started with import_guest_list (confirm: true): account, contract registration and email, five people per call by default. Call it until remaining is 0. If another batch of the same import is running, it answers busy and you call again in a moment. Needs the event's organizer key.",
      inputSchema: { event: eventSlug, organizer_key: organizerKey, run_id: z.string().trim().min(1).describe("The run_id returned by import_guest_list."), batch_size: batchSize(MAX_BATCH_SIZE, 5), lang },
      annotations: writes(false),
    },
    (args) => safely("continue_import", () => continueImport(ctx, args)),
  );

  server.registerTool(
    "resend_links",
    {
      title: "Resend credential links to people who have not checked in",
      description:
        "Emails again the personal credential link to everyone who has a credential and has not checked in yet: the reminder before the event. Respects the existing brake: one resend per person and event every ten minutes (those get skipped, not emailed). Twenty people per call by default; call again while remaining is more than 0. Where the server has no email service, nothing goes out: it answers with notConfigured and counts no email as sent. Needs the event's organizer key. Returns counts only.",
      inputSchema: { event: eventSlug, organizer_key: organizerKey, batch_size: batchSize(RESEND_MAX_BATCH_SIZE, 20), lang },
      annotations: writes(false),
    },
    (args) => safely("resend_links", () => resendLinks(ctx, args)),
  );

  server.registerTool(
    "event_status",
    {
      title: "Live numbers of the event",
      description:
        "What the organizer's panel shows, as numbers: credentials issued and pending, how many checked in, redemptions per benefit and per time slot (granted, redeemed, duplicates, stock and what is left), duplicates to review (by credential code, without names), the station codes the volunteers use to open the scanner, and the last contrast with the chain. Needs the event's organizer key. Never returns names or emails.",
      inputSchema: { event: eventSlug, organizer_key: organizerKey, lang },
      annotations: readOnly,
    },
    (args) => safely("event_status", () => eventStatus(ctx, args)),
  );

  server.registerTool(
    "sponsor_report",
    {
      title: "Sponsor report (numbers only)",
      description:
        "The report for sponsors: credentials issued, people who checked in, redemptions per benefit (the headline is the lunch), duplicates rejected, and the booth route: visits per stand, the sponsor's benefit redemptions, how many people agreed to share their contact (a number, never who) and how many completed the route. With stand_id, one stand only. Needs the event's organizer key. Never returns names or emails.",
      inputSchema: { event: eventSlug, organizer_key: organizerKey, stand_id: z.string().trim().min(1).optional().describe("One stand's id (from the full report) to get only that sponsor's numbers.") },
      annotations: readOnly,
    },
    (args) => safely("sponsor_report", () => sponsorReport(ctx, args)),
  );

  server.registerTool(
    "draw_list",
    {
      title: "Verifiable list for the draw",
      description:
        "The list for the draw, in a verifiable shape: only credential codes, sorted, with the SHA-256 of the list. If the organizer froze the list from the live screen, this is that frozen list (the one being drawn); otherwise the live list right now, of attendee credentials that checked in (all: true includes speakers, staff and sponsors). The same list the live screen shows. Publish the hash before drawing; anyone can recompute it afterwards. This tool does not draw. Needs the event's organizer key.",
      inputSchema: { event: eventSlug, organizer_key: organizerKey, all: z.boolean().optional().describe("Include every credential that checked in, not only attendees (ignored when a frozen list exists)") },
      annotations: readOnly,
    },
    (args) => safely("draw_list", () => drawList(ctx, args)),
  );

  server.registerTool(
    "chapter_package_summary",
    {
      title: "Stellar ambassador program check",
      description:
        "A yes or no per requirement of the Stellar ambassador program for this event: at least 20 verified attendees (checked in through the door, once each), at least 20 minutes of Stellar content (you pass the minutes), food per person within the US$25 cap (you pass the spend), plus how many people agreed to hear from the chapter (a count) and the contract links. Needs the event's organizer key.",
      inputSchema: {
        event: eventSlug,
        organizer_key: organizerKey,
        stellar_minutes: z.number().int().min(0).max(100_000).optional().describe("Minutes of Stellar content in the agenda, as the organizer reports them."),
        food_spend_usd: z.number().min(0).max(10_000_000).optional().describe("Total spent on food, in US dollars, as the organizer reports it."),
      },
      annotations: readOnly,
    },
    (args) => safely("chapter_package_summary", () => chapterPackageSummary(ctx, args)),
  );

  server.registerPrompt(
    "describe_your_event",
    {
      title: "Describe your event",
      description: "Set up an event from a sentence: ask what is missing, pick a template, create the draft, show the review link, and publish only when the organizer approves.",
      argsSchema: { description: z.string().max(2000).optional().describe("What the organizer said, in their words: for example 'a Build with AI for 150 people on November 28 in Santa Cruz'.") },
    },
    ({ description }) => ({ messages: [{ role: "user", content: { type: "text", text: describeYourEvent(description) } }] }),
  );

  return server;
}

/** El guion del prompt: lo que el asistente tiene que hacer, paso por paso, y dónde frenar a pedir aprobación. */
export function describeYourEvent(description?: string): string {
  const said = description?.trim() ? `The organizer said: "${description.trim()}"\n\n` : "";
  return `${said}You are helping someone set up a community event on Rumbo. Work with the Rumbo tools, in this order, and keep the organizer in control:

1. Gather the basics, asking only for what is missing: the event's name, date and start time (local), city and venue, who organizes (the community or chapter), and how many people are expected. Do not invent any of these.
2. Call list_templates and choose the closest template (DevFest, Build with AI, Women's Day, hackathon, meetup or workshop). Say in one line why. If none fits, pick the closest by duration and size and say what the organizer may want to change.
3. Call create_event_draft with the template and the basics (if this server asks for a house key, ask the organizer for it). Then show, in plain words: the credential types the draft includes and what each one gets (lunch, snack, swag, dinner), the redemption stations, the capacity, and the review link, where they can rename things, turn credential types on or off and set stock. Remind them that registration is free by default and the paid ticket is optional and off. Keep the organizer_key the tool returned: every other tool about this event needs it.
4. Stop and ask for approval. Publishing is a real step: it deploys one contract per credential type on the Stellar test network and opens the public page. Call publish_event only after an explicit yes.
5. After publishing, offer the next steps: import the list from Luma or Bevy (import_guest_list previews first; confirm only after they agree with the mapping; then continue_import until nothing is pending), share the station codes with the volunteers (event_status), resend the links before the event (resend_links), and after the event read event_status, sponsor_report, draw_list and chapter_package_summary.

Never ask for or repeat attendee names or emails beyond what the organizer pastes to import; the tools return numbers and codes, not people.`;
}
