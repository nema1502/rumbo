// Los datos del evento. Repo es la interfaz; SqlRepo la implementación, sobre la capa de src/server/base, con
// las mismas sentencias para los dos motores: SQLite en el desarrollo y las pruebas, Postgres (Supabase) en
// producción. Nombres y correos viven acá, nunca en la cadena.
import { randomUUID } from "node:crypto";
import { CREDENTIAL_KINDS, isCredentialKind, type CredentialKind } from "../lib/credential-kinds.ts";
import { getDb, jsonParam, readJson, type Db, type Row, type SqlValue } from "./base/index.ts";
import { plainSecrets } from "./base/cifrado.ts";
import { openSqlite } from "./base/sqlite.ts";
import { newPassId } from "./qr.ts";

// ---------- Los datos ----------

export type PassStatus = "pending" | "active" | "checked_in";
export type BenefitKind = "lunch" | "merch" | "prize" | "other";
/** De dónde salió un beneficio de un pase: de su entrada, del sorteo, o dado a mano. */
export type GrantSource = "ticket" | "raffle" | "manual";

// Los tipos de credencial (quién es la persona en el evento) viven en src/lib/credential-kinds.ts.
export { CREDENTIAL_KINDS, isCredentialKind, type CredentialKind };

export interface EventRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** ISO 8601 */
  startsAt: string;
  endsAt: string | null;
  /** Zona horaria IANA del evento, para mostrar la hora como la lee la gente de ahí. */
  timezone: string;
  place: string;
  venue: string | null;
  organizerName: string;
  /** La cuenta de Stellar de quien organiza (clave pública), a donde van los pagos. */
  organizerAccount: string | null;
  /** El contrato rumbo-pass del evento, para los tipos de entrada que no tienen el suyo. */
  contractId: string | null;
  capacity: number | null;
  /** La plantilla de la que salió (src/server/kit/plantillas.ts), o null si se armó a mano. */
  template: string | null;
  /** Un borrador (false) se edita en el panel y no se ve en la página pública. */
  published: boolean;
  /** Si se inscribe por equipos (la hackatón). */
  teamSignup: boolean;
  createdAt: string;
}

export interface NewEvent {
  slug: string;
  name: string;
  description?: string;
  startsAt: string;
  endsAt?: string | null;
  timezone?: string;
  place: string;
  venue?: string | null;
  organizerName: string;
  organizerAccount?: string | null;
  contractId?: string | null;
  capacity?: number | null;
  template?: string | null;
  published?: boolean;
  teamSignup?: boolean;
}

export type EventPatch = Partial<Omit<NewEvent, "slug">>;

export interface TicketType {
  id: string;
  eventId: string;
  name: string;
  /** En USDC de prueba. 0 es inscripción gratis. */
  priceUsdc: number;
  /** El contrato rumbo-pass con ese precio. Si es null se usa el del evento. */
  contractId: string | null;
  sortOrder: number;
  /** Quién es la persona con esta entrada: asistente, jurado, mentora... */
  credentialKind: CredentialKind;
  /** El lugar que ocupa en la plantilla del evento, si salió de una. */
  templateSlot: string | null;
}

export interface NewTicketType {
  eventId: string;
  name: string;
  priceUsdc?: number;
  contractId?: string | null;
  sortOrder?: number;
  credentialKind?: CredentialKind;
  templateSlot?: string | null;
}

export interface TicketTypePatch {
  name?: string;
  priceUsdc?: number;
  contractId?: string | null;
  sortOrder?: number;
  credentialKind?: CredentialKind;
}

export interface Benefit {
  id: string;
  eventId: string;
  name: string;
  kind: BenefitKind;
  /** El puesto donde se canjea ("Mesa del almuerzo"). */
  station: string | null;
  sortOrder: number;
  /** La clave que tiene en la plantilla del evento, si salió de una. */
  templateKey: string | null;
  /** Cuántos hay en total (150 poleras), o null si no hay tope. */
  stock: number | null;
}

export interface NewBenefit {
  eventId: string;
  name: string;
  kind: BenefitKind;
  station?: string | null;
  sortOrder?: number;
  templateKey?: string | null;
  stock?: number | null;
}

export interface BenefitPatch {
  name?: string;
  station?: string | null;
  sortOrder?: number;
  stock?: number | null;
}

export interface Team {
  id: string;
  eventId: string;
  name: string;
  createdAt: string;
}

/** Una importación de lista: de dónde vino y el resumen (JSON) que va sumando la importación en tandas. */
export interface ImportRun {
  id: string;
  eventId: string;
  source: string;
  summary: Record<string, unknown>;
  createdAt: string;
}

/** Un beneficio que trae un tipo de entrada, con su número en el contrato de esa entrada. */
export interface TicketTypeBenefit extends Benefit {
  chainIndex: number;
}

export interface Person {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Pass {
  /** Ocho letras y números (base32): lo que va en el QR. */
  id: string;
  eventId: string;
  personId: string;
  ticketTypeId: string;
  /** La cuenta de Stellar de la persona (clave pública), o null si todavía no se creó. */
  account: string | null;
  status: PassStatus;
  /** La transacción de register o buy. */
  txHash: string | null;
  /** El número de pase que devolvió el contrato. */
  chainNumber: number | null;
  createdAt: string;
  activatedAt: string | null;
  checkedInAt: string | null;
  /** Si aceptó que la comunidad que organiza le escriba sobre sus próximos eventos (la casilla opcional del formulario). */
  contactConsent: boolean;
  contactConsentAt: string | null;
  /** La restricción de dieta que la persona dijo al inscribirse, o null. */
  diet: string | null;
  /** La importación de lista de la que salió, o null si se inscribió sola. */
  importRunId: string | null;
}

export interface NewPass {
  eventId: string;
  personId: string;
  ticketTypeId: string;
  account?: string | null;
  status?: PassStatus;
  diet?: string | null;
  importRunId?: string | null;
}

export interface PassPatch {
  diet?: string | null;
  /** Para retomar una inscripción que quedó pendiente con otra entrada. Solo se cambia en pases pendientes. */
  ticketTypeId?: string;
  account?: string | null;
  status?: PassStatus;
  txHash?: string | null;
  chainNumber?: number | null;
  activatedAt?: string | null;
  checkedInAt?: string | null;
  /** La casilla de contacto: guarda también cuándo se aceptó (o lo borra si se desmarca). */
  contactConsent?: boolean;
}

/** Un beneficio de un pase: de dónde salió y con qué número se canjea en el contrato (null si no está en la cadena). */
export interface PassBenefit extends Benefit {
  source: GrantSource;
  grantedAt: string;
  chainIndex: number | null;
}

/** Un pase con todo lo que hace falta para dibujar la credencial o atender el escáner. */
export interface PassView {
  pass: Pass;
  person: Person;
  event: EventRecord;
  ticketType: TicketType;
  benefits: PassBenefit[];
  /** El contrato que le toca al pase: el de su entrada, o el del evento. */
  contractId: string | null;
}

/** Lo que el escáner registra. `synced` dice si ya llegó al contrato; `duplicate`, si el contrato lo rechazó por repetido. */
export interface CheckIn {
  id: string;
  clientId: string | null;
  eventId: string;
  passId: string;
  scannerId: string | null;
  scannedAt: string;
  synced: boolean;
  duplicate: boolean;
  /** La transacción que lo llevó al contrato. Sin `synced`, la que se mandó y todavía no se sabe cómo terminó. */
  txHash: string | null;
  /** Cuándo se mandó `txHash`. */
  txSentAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface NewCheckIn {
  /** El id de la cola local del escáner: con el mismo id no se registra dos veces. */
  clientId?: string | null;
  eventId: string;
  passId: string;
  scannerId?: string | null;
  scannedAt?: string;
}

export interface Redemption extends CheckIn {
  benefitId: string;
}

export interface NewRedemption extends NewCheckIn {
  benefitId: string;
}

/**
 * El clientId ya está en un registro de otro pase, de otro evento o de otro beneficio. Con el mismo
 * clientId se reintenta lo mismo, nunca otra cosa: quien lo manda no recibe el registro ajeno.
 */
export class ClientIdTaken extends Error {
  readonly clientId: string;
  constructor(clientId: string) {
    super(`El clientId ${clientId} ya es de otro registro`);
    this.name = "ClientIdTaken";
    this.clientId = clientId;
  }
}

export interface SyncMark {
  synced?: boolean;
  duplicate?: boolean;
  txHash?: string | null;
  txSentAt?: string | null;
  error?: string | null;
}

/** SOLO RED DE PRUEBA: la cuenta que el servidor guarda por una persona, con su llave secreta. */
export interface DevAccount {
  personId: string;
  publicKey: string;
  secretKey: string;
  funded: boolean;
  createdAt: string;
}

export interface EventStats {
  passes: number;
  active: number;
  checkedIn: number;
  byTicketType: Array<{ ticketTypeId: string; name: string; passes: number }>;
  byBenefit: Array<{ benefitId: string; name: string; granted: number; redeemed: number; duplicates: number }>;
  /** Check-ins y canjes que el escáner registró y todavía no llegaron al contrato. */
  pendingSync: number;
}

// ---------- La interfaz ----------

export interface Repo {
  // Eventos
  listEvents(): Promise<EventRecord[]>;
  getEventBySlug(slug: string): Promise<EventRecord | null>;
  getEventById(id: string): Promise<EventRecord | null>;
  createEvent(input: NewEvent): Promise<EventRecord>;
  updateEvent(id: string, patch: EventPatch): Promise<EventRecord>;

  // Tipos de entrada
  listTicketTypes(eventId: string): Promise<TicketType[]>;
  getTicketType(id: string): Promise<TicketType | null>;
  createTicketType(input: NewTicketType): Promise<TicketType>;
  updateTicketType(id: string, patch: TicketTypePatch): Promise<TicketType>;
  /** Borra un tipo de entrada sin credenciales (el borrador de un evento). Con credenciales falla. */
  deleteTicketType(id: string): Promise<void>;

  // Beneficios: el catálogo del evento y qué trae cada entrada
  listBenefits(eventId: string): Promise<Benefit[]>;
  getBenefit(id: string): Promise<Benefit | null>;
  createBenefit(input: NewBenefit): Promise<Benefit>;
  updateBenefit(id: string, patch: BenefitPatch): Promise<Benefit>;
  /** Borra un beneficio sin canjes (el borrador de un evento), con lo que de él cuelga. */
  deleteBenefit(id: string): Promise<void>;
  /** Dice que la entrada trae ese beneficio, y con qué número se canjea en su contrato. */
  linkBenefit(ticketTypeId: string, benefitId: string, chainIndex: number): Promise<void>;
  listTicketTypeBenefits(ticketTypeId: string): Promise<TicketTypeBenefit[]>;
  /** Quita todos los beneficios de una entrada (para volver a numerarlos al editar el borrador). */
  clearTicketTypeBenefits(ticketTypeId: string): Promise<void>;

  // Personas
  getPersonById(id: string): Promise<Person | null>;
  getPersonByEmail(email: string): Promise<Person | null>;
  /** Crea la persona o, si el correo ya existe, actualiza el nombre. */
  upsertPerson(input: { name: string; email: string }): Promise<Person>;

  // Pases
  createPass(input: NewPass): Promise<Pass>;
  getPass(id: string): Promise<Pass | null>;
  getPassView(id: string): Promise<PassView | null>;
  findPass(eventId: string, personId: string): Promise<Pass | null>;
  findPassByAccount(eventId: string, account: string): Promise<Pass | null>;
  listPasses(eventId: string): Promise<Pass[]>;
  updatePass(id: string, patch: PassPatch): Promise<Pass>;

  // Beneficios de cada pase
  listPassBenefits(passId: string): Promise<PassBenefit[]>;
  grantBenefit(passId: string, benefitId: string, source: GrantSource): Promise<void>;
  /** Otorga lo que trae la entrada del pase. */
  grantTicketBenefits(passId: string): Promise<PassBenefit[]>;

  // Check-ins (espejo de la cadena)
  /** Registra la entrada, o devuelve la que ya tenía ese clientId. Si el clientId es de otro pase u otro evento, lanza ClientIdTaken. */
  recordCheckIn(input: NewCheckIn): Promise<CheckIn>;
  listCheckIns(eventId: string): Promise<CheckIn[]>;
  listCheckInsForPass(passId: string): Promise<CheckIn[]>;
  markCheckIn(id: string, mark: SyncMark): Promise<CheckIn>;

  // Canjes (espejo de la cadena)
  /** Registra el canje, o devuelve el que ya tenía ese clientId. Si el clientId es de otro pase, evento o beneficio, lanza ClientIdTaken. */
  recordRedemption(input: NewRedemption): Promise<Redemption>;
  listRedemptions(eventId: string): Promise<Redemption[]>;
  listRedemptionsForPass(passId: string): Promise<Redemption[]>;
  markRedemption(id: string, mark: SyncMark): Promise<Redemption>;

  // Cuentas de desarrollo (solo red de prueba)
  getDevAccount(personId: string): Promise<DevAccount | null>;
  saveDevAccount(input: Omit<DevAccount, "createdAt">): Promise<DevAccount>;
  markDevAccountFunded(personId: string): Promise<void>;

  // Equipos (la inscripción de la hackatón)
  /** Crea el equipo, o devuelve el que ya tenía ese nombre en el evento (sin importar mayúsculas). */
  createTeam(eventId: string, name: string): Promise<{ team: Team; created: boolean }>;
  getTeam(id: string): Promise<Team | null>;
  listTeams(eventId: string): Promise<Team[]>;
  /** Pone la credencial en el equipo. Si ya estaba en otro, lo cambia. */
  setPassTeam(passId: string, teamId: string): Promise<void>;
  getPassTeam(passId: string): Promise<Team | null>;
  listTeamPasses(teamId: string): Promise<Pass[]>;
  /** El equipo de cada credencial del evento que tiene uno. */
  listPassTeams(eventId: string): Promise<Array<{ passId: string; team: Team }>>;

  // Importaciones de lista
  createImportRun(input: { eventId: string; source: string; summary: Record<string, unknown> }): Promise<ImportRun>;
  getImportRun(id: string): Promise<ImportRun | null>;
  updateImportRun(id: string, summary: Record<string, unknown>): Promise<ImportRun>;
  listPassesByImportRun(runId: string): Promise<Pass[]>;

  // El informe
  getEventStats(eventId: string): Promise<EventStats>;
}

// ---------- Ayudantes ----------

const now = () => new Date().toISOString();
const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
/** SQLite guarda los booleanos como 1 y 0; Postgres los da como true y false. */
const bool = (v: unknown): boolean => v === true || Number(v) === 1;

function rowToEvent(row: Row): EventRecord {
  return {
    id: str(row.id),
    slug: str(row.slug),
    name: str(row.name),
    description: str(row.description ?? ""),
    startsAt: str(row.starts_at),
    endsAt: strOrNull(row.ends_at),
    timezone: str(row.timezone),
    place: str(row.place),
    venue: strOrNull(row.venue),
    organizerName: str(row.organizer_name),
    organizerAccount: strOrNull(row.organizer_account),
    contractId: strOrNull(row.contract_id),
    capacity: numOrNull(row.capacity),
    template: strOrNull(row.template),
    published: bool(row.published),
    teamSignup: bool(row.team_signup),
    createdAt: str(row.created_at),
  };
}

function rowToTicketType(row: Row): TicketType {
  return {
    id: str(row.id),
    eventId: str(row.event_id),
    name: str(row.name),
    priceUsdc: num(row.price_usdc),
    contractId: strOrNull(row.contract_id),
    sortOrder: num(row.sort_order),
    credentialKind: isCredentialKind(row.credential_kind) ? row.credential_kind : "attendee",
    templateSlot: strOrNull(row.template_slot),
  };
}

function rowToBenefit(row: Row): Benefit {
  return {
    id: str(row.id),
    eventId: str(row.event_id),
    name: str(row.name),
    kind: str(row.kind) as BenefitKind,
    station: strOrNull(row.station),
    sortOrder: num(row.sort_order),
    templateKey: strOrNull(row.template_key),
    stock: numOrNull(row.stock),
  };
}

function rowToTeam(row: Row): Team {
  return { id: str(row.id), eventId: str(row.event_id), name: str(row.name), createdAt: str(row.created_at) };
}

function rowToImportRun(row: Row): ImportRun {
  return {
    id: str(row.id),
    eventId: str(row.event_id),
    source: str(row.source),
    summary: readJson<Record<string, unknown>>(row.summary),
    createdAt: str(row.created_at),
  };
}

function rowToPerson(row: Row): Person {
  return { id: str(row.id), name: str(row.name), email: str(row.email), createdAt: str(row.created_at) };
}

function rowToPass(row: Row): Pass {
  return {
    id: str(row.id),
    eventId: str(row.event_id),
    personId: str(row.person_id),
    ticketTypeId: str(row.ticket_type_id),
    account: strOrNull(row.account),
    status: str(row.status) as PassStatus,
    txHash: strOrNull(row.tx_hash),
    chainNumber: numOrNull(row.chain_number),
    createdAt: str(row.created_at),
    activatedAt: strOrNull(row.activated_at),
    checkedInAt: strOrNull(row.checked_in_at),
    contactConsent: bool(row.contact_consent),
    contactConsentAt: strOrNull(row.contact_consent_at),
    diet: strOrNull(row.diet),
    importRunId: strOrNull(row.import_run_id),
  };
}

function rowToCheckIn(row: Row): CheckIn {
  return {
    id: str(row.id),
    clientId: strOrNull(row.client_id),
    eventId: str(row.event_id),
    passId: str(row.pass_id),
    scannerId: strOrNull(row.scanner_id),
    scannedAt: str(row.scanned_at),
    synced: bool(row.synced),
    duplicate: bool(row.duplicate),
    txHash: strOrNull(row.tx_hash),
    txSentAt: strOrNull(row.tx_sent_at),
    error: strOrNull(row.error),
    createdAt: str(row.created_at),
  };
}

function rowToRedemption(row: Row): Redemption {
  return { ...rowToCheckIn(row), benefitId: str(row.benefit_id) };
}

/** El contexto con el que se cifra la llave de una cuenta de prueba: solo se descifra en la fila de esa persona. */
const devSecretContext = (personId: string) => `dev_accounts.secret_key:${personId}`;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------- La implementación ----------

/**
 * El repo sobre la capa de datos (src/server/base): las mismas sentencias para SQLite y para Postgres. Lo que
 * dos pedidos pueden hacer a la vez (el mismo clientId del escáner, el mismo correo, el mismo equipo) se escribe
 * con ON CONFLICT: en Postgres dos instancias llegan de verdad al mismo tiempo, y la base decide quién fue primero.
 */
export class SqlRepo implements Repo {
  readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /** UPDATE de las columnas dadas, por id. Sin columnas no hace nada. */
  private async update(table: string, id: string, columns: Record<string, SqlValue>): Promise<void> {
    const names = Object.keys(columns);
    if (names.length === 0) return;
    const sets = names.map((n) => `${n} = ?`).join(", ");
    await this.db.run(`UPDATE ${table} SET ${sets} WHERE id = ?`, [...names.map((n) => columns[n] as SqlValue), id]);
  }

  // Eventos

  async listEvents(): Promise<EventRecord[]> {
    return (await this.db.all("SELECT * FROM events ORDER BY starts_at ASC")).map(rowToEvent);
  }

  async getEventBySlug(slug: string): Promise<EventRecord | null> {
    const row = await this.db.one("SELECT * FROM events WHERE slug = ?", [slug]);
    return row ? rowToEvent(row) : null;
  }

  async getEventById(id: string): Promise<EventRecord | null> {
    const row = await this.db.one("SELECT * FROM events WHERE id = ?", [id]);
    return row ? rowToEvent(row) : null;
  }

  async createEvent(input: NewEvent): Promise<EventRecord> {
    const id = randomUUID();
    await this.db.run(
      `INSERT INTO events (id, slug, name, description, starts_at, ends_at, timezone, place, venue, organizer_name,
         organizer_account, contract_id, capacity, created_at, template, published, team_signup)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.slug,
        input.name,
        input.description ?? "",
        input.startsAt,
        input.endsAt ?? null,
        input.timezone ?? "America/La_Paz",
        input.place,
        input.venue ?? null,
        input.organizerName,
        input.organizerAccount ?? null,
        input.contractId ?? null,
        input.capacity ?? null,
        now(),
        input.template ?? null,
        input.published !== false,
        input.teamSignup === true,
      ],
    );
    return (await this.getEventById(id))!;
  }

  async updateEvent(id: string, patch: EventPatch): Promise<EventRecord> {
    const columns: Record<string, SqlValue> = {};
    if (patch.name !== undefined) columns.name = patch.name;
    if (patch.description !== undefined) columns.description = patch.description;
    if (patch.startsAt !== undefined) columns.starts_at = patch.startsAt;
    if (patch.endsAt !== undefined) columns.ends_at = patch.endsAt;
    if (patch.timezone !== undefined) columns.timezone = patch.timezone;
    if (patch.place !== undefined) columns.place = patch.place;
    if (patch.venue !== undefined) columns.venue = patch.venue;
    if (patch.organizerName !== undefined) columns.organizer_name = patch.organizerName;
    if (patch.organizerAccount !== undefined) columns.organizer_account = patch.organizerAccount;
    if (patch.contractId !== undefined) columns.contract_id = patch.contractId;
    if (patch.capacity !== undefined) columns.capacity = patch.capacity;
    if (patch.template !== undefined) columns.template = patch.template;
    if (patch.published !== undefined) columns.published = patch.published;
    if (patch.teamSignup !== undefined) columns.team_signup = patch.teamSignup;
    await this.update("events", id, columns);
    const event = await this.getEventById(id);
    if (!event) throw new Error(`No existe el evento ${id}`);
    return event;
  }

  // Tipos de entrada

  async listTicketTypes(eventId: string): Promise<TicketType[]> {
    return (await this.db.all("SELECT * FROM ticket_types WHERE event_id = ? ORDER BY sort_order, price_usdc", [eventId])).map(rowToTicketType);
  }

  async getTicketType(id: string): Promise<TicketType | null> {
    const row = await this.db.one("SELECT * FROM ticket_types WHERE id = ?", [id]);
    return row ? rowToTicketType(row) : null;
  }

  async createTicketType(input: NewTicketType): Promise<TicketType> {
    const id = randomUUID();
    await this.db.run(
      "INSERT INTO ticket_types (id, event_id, name, price_usdc, contract_id, sort_order, credential_kind, template_slot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.eventId, input.name, input.priceUsdc ?? 0, input.contractId ?? null, input.sortOrder ?? 0, input.credentialKind ?? "attendee", input.templateSlot ?? null],
    );
    return (await this.getTicketType(id))!;
  }

  async updateTicketType(id: string, patch: TicketTypePatch): Promise<TicketType> {
    const columns: Record<string, SqlValue> = {};
    if (patch.name !== undefined) columns.name = patch.name;
    if (patch.priceUsdc !== undefined) columns.price_usdc = patch.priceUsdc;
    if (patch.contractId !== undefined) columns.contract_id = patch.contractId;
    if (patch.sortOrder !== undefined) columns.sort_order = patch.sortOrder;
    if (patch.credentialKind !== undefined) columns.credential_kind = patch.credentialKind;
    await this.update("ticket_types", id, columns);
    const ticketType = await this.getTicketType(id);
    if (!ticketType) throw new Error(`No existe el tipo de entrada ${id}`);
    return ticketType;
  }

  async deleteTicketType(id: string): Promise<void> {
    // passes.ticket_type_id no se borra en cascada: con credenciales, la base se niega y el error sube.
    await this.db.run("DELETE FROM ticket_types WHERE id = ?", [id]);
  }

  // Beneficios

  async listBenefits(eventId: string): Promise<Benefit[]> {
    return (await this.db.all("SELECT * FROM benefits WHERE event_id = ? ORDER BY sort_order, name", [eventId])).map(rowToBenefit);
  }

  async getBenefit(id: string): Promise<Benefit | null> {
    const row = await this.db.one("SELECT * FROM benefits WHERE id = ?", [id]);
    return row ? rowToBenefit(row) : null;
  }

  async createBenefit(input: NewBenefit): Promise<Benefit> {
    const id = randomUUID();
    await this.db.run(
      "INSERT INTO benefits (id, event_id, name, kind, station, sort_order, template_key, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.eventId, input.name, input.kind, input.station ?? null, input.sortOrder ?? 0, input.templateKey ?? null, input.stock ?? null],
    );
    return (await this.getBenefit(id))!;
  }

  async updateBenefit(id: string, patch: BenefitPatch): Promise<Benefit> {
    const columns: Record<string, SqlValue> = {};
    if (patch.name !== undefined) columns.name = patch.name;
    if (patch.station !== undefined) columns.station = patch.station;
    if (patch.sortOrder !== undefined) columns.sort_order = patch.sortOrder;
    if (patch.stock !== undefined) columns.stock = patch.stock;
    await this.update("benefits", id, columns);
    const benefit = await this.getBenefit(id);
    if (!benefit) throw new Error(`No existe el beneficio ${id}`);
    return benefit;
  }

  async deleteBenefit(id: string): Promise<void> {
    // redemptions.benefit_id no se borra en cascada: con canjes, la base se niega y el error sube.
    await this.db.run("DELETE FROM benefits WHERE id = ?", [id]);
  }

  async clearTicketTypeBenefits(ticketTypeId: string): Promise<void> {
    await this.db.run("DELETE FROM ticket_type_benefits WHERE ticket_type_id = ?", [ticketTypeId]);
  }

  async linkBenefit(ticketTypeId: string, benefitId: string, chainIndex: number): Promise<void> {
    await this.db.run(
      `INSERT INTO ticket_type_benefits (ticket_type_id, benefit_id, chain_index) VALUES (?, ?, ?)
       ON CONFLICT (ticket_type_id, benefit_id) DO UPDATE SET chain_index = excluded.chain_index`,
      [ticketTypeId, benefitId, chainIndex],
    );
  }

  async listTicketTypeBenefits(ticketTypeId: string): Promise<TicketTypeBenefit[]> {
    const rows = await this.db.all(
      `SELECT b.*, ttb.chain_index FROM benefits b JOIN ticket_type_benefits ttb ON ttb.benefit_id = b.id
       WHERE ttb.ticket_type_id = ? ORDER BY ttb.chain_index`,
      [ticketTypeId],
    );
    return rows.map((row) => ({ ...rowToBenefit(row), chainIndex: num(row.chain_index) }));
  }

  // Personas

  async getPersonById(id: string): Promise<Person | null> {
    const row = await this.db.one("SELECT * FROM persons WHERE id = ?", [id]);
    return row ? rowToPerson(row) : null;
  }

  async getPersonByEmail(email: string): Promise<Person | null> {
    const row = await this.db.one("SELECT * FROM persons WHERE email = ?", [normalizeEmail(email)]);
    return row ? rowToPerson(row) : null;
  }

  async upsertPerson(input: { name: string; email: string }): Promise<Person> {
    const email = normalizeEmail(input.email);
    const name = input.name.trim();
    const existing = await this.getPersonByEmail(email);
    if (existing) {
      if (name && name !== existing.name) await this.db.run("UPDATE persons SET name = ? WHERE id = ?", [name, existing.id]);
      return (await this.getPersonById(existing.id))!;
    }
    const inserted = await this.db.one("INSERT INTO persons (id, name, email, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING RETURNING *", [
      randomUUID(),
      name,
      email,
      now(),
    ]);
    if (inserted) return rowToPerson(inserted);
    // Otro pedido creó a la misma persona entre la lectura y la escritura: ahora existe, y se sigue con ella.
    return this.upsertPerson(input);
  }

  // Pases

  async createPass(input: NewPass): Promise<Pass> {
    // Un id nuevo hasta que no choque: con 40 bits de azar casi nunca pasa, pero cuesta nada mirar.
    let id = newPassId();
    while (await this.db.one("SELECT 1 AS yes FROM passes WHERE id = ?", [id])) id = newPassId();
    const status = input.status ?? "pending";
    const at = now();
    await this.db.run(
      "INSERT INTO passes (id, event_id, person_id, ticket_type_id, account, status, created_at, activated_at, diet, import_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.eventId, input.personId, input.ticketTypeId, input.account ?? null, status, at, status === "pending" ? null : at, input.diet ?? null, input.importRunId ?? null],
    );
    return (await this.getPass(id))!;
  }

  async getPass(id: string): Promise<Pass | null> {
    const row = await this.db.one("SELECT * FROM passes WHERE id = ?", [id]);
    return row ? rowToPass(row) : null;
  }

  async getPassView(id: string): Promise<PassView | null> {
    const pass = await this.getPass(id);
    if (!pass) return null;
    const [person, event, ticketType, benefits] = await Promise.all([
      this.getPersonById(pass.personId),
      this.getEventById(pass.eventId),
      this.getTicketType(pass.ticketTypeId),
      this.listPassBenefits(pass.id),
    ]);
    if (!person || !event || !ticketType) return null;
    return { pass, person, event, ticketType, benefits, contractId: ticketType.contractId ?? event.contractId };
  }

  async findPass(eventId: string, personId: string): Promise<Pass | null> {
    const row = await this.db.one("SELECT * FROM passes WHERE event_id = ? AND person_id = ?", [eventId, personId]);
    return row ? rowToPass(row) : null;
  }

  async findPassByAccount(eventId: string, account: string): Promise<Pass | null> {
    const row = await this.db.one("SELECT * FROM passes WHERE event_id = ? AND account = ?", [eventId, account]);
    return row ? rowToPass(row) : null;
  }

  async listPasses(eventId: string): Promise<Pass[]> {
    return (await this.db.all("SELECT * FROM passes WHERE event_id = ? ORDER BY created_at", [eventId])).map(rowToPass);
  }

  async updatePass(id: string, patch: PassPatch): Promise<Pass> {
    if (patch.ticketTypeId !== undefined) {
      // La entrada solo cambia mientras el pase está pendiente: una vez activo, el contrato ya es el de su entrada.
      await this.db.run("UPDATE passes SET ticket_type_id = ? WHERE id = ? AND status = 'pending'", [patch.ticketTypeId, id]);
    }
    const columns: Record<string, SqlValue> = {};
    if (patch.account !== undefined) columns.account = patch.account;
    if (patch.diet !== undefined) columns.diet = patch.diet;
    if (patch.status !== undefined) {
      columns.status = patch.status;
      if (patch.status !== "pending" && patch.activatedAt === undefined) columns.activated_at = now();
      if (patch.status === "checked_in" && patch.checkedInAt === undefined) columns.checked_in_at = now();
    }
    if (patch.txHash !== undefined) columns.tx_hash = patch.txHash;
    if (patch.chainNumber !== undefined) columns.chain_number = patch.chainNumber;
    if (patch.activatedAt !== undefined) columns.activated_at = patch.activatedAt;
    if (patch.checkedInAt !== undefined) columns.checked_in_at = patch.checkedInAt;
    if (patch.contactConsent !== undefined) {
      columns.contact_consent = patch.contactConsent;
      columns.contact_consent_at = patch.contactConsent ? now() : null;
    }
    await this.update("passes", id, columns);
    const pass = await this.getPass(id);
    if (!pass) throw new Error(`No existe el pase ${id}`);
    return pass;
  }

  // Beneficios de cada pase

  async listPassBenefits(passId: string): Promise<PassBenefit[]> {
    const rows = await this.db.all(
      `SELECT b.*, pb.source, pb.granted_at, ttb.chain_index
       FROM pass_benefits pb
       JOIN benefits b ON b.id = pb.benefit_id
       JOIN passes p ON p.id = pb.pass_id
       LEFT JOIN ticket_type_benefits ttb ON ttb.benefit_id = b.id AND ttb.ticket_type_id = p.ticket_type_id
       WHERE pb.pass_id = ? ORDER BY b.sort_order, b.name`,
      [passId],
    );
    return rows.map((row) => ({
      ...rowToBenefit(row),
      source: str(row.source) as GrantSource,
      grantedAt: str(row.granted_at),
      chainIndex: numOrNull(row.chain_index),
    }));
  }

  async grantBenefit(passId: string, benefitId: string, source: GrantSource): Promise<void> {
    await this.db.run("INSERT INTO pass_benefits (pass_id, benefit_id, source, granted_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", [passId, benefitId, source, now()]);
  }

  async grantTicketBenefits(passId: string): Promise<PassBenefit[]> {
    const pass = await this.getPass(passId);
    if (!pass) throw new Error(`No existe el pase ${passId}`);
    for (const benefit of await this.listTicketTypeBenefits(pass.ticketTypeId)) await this.grantBenefit(passId, benefit.id, "ticket");
    return this.listPassBenefits(passId);
  }

  // Check-ins

  /** El registro que ya tenía ese clientId, si es de lo mismo. Si es de otra cosa, ClientIdTaken. */
  private sameCheckIn(existing: Row, input: NewCheckIn): CheckIn {
    if (str(existing.event_id) !== input.eventId || str(existing.pass_id) !== input.passId) throw new ClientIdTaken(input.clientId as string);
    return rowToCheckIn(existing);
  }

  async recordCheckIn(input: NewCheckIn): Promise<CheckIn> {
    if (input.clientId) {
      const existing = await this.db.one("SELECT * FROM checkins WHERE client_id = ?", [input.clientId]);
      if (existing) return this.sameCheckIn(existing, input);
    }
    const inserted = await this.db.one(
      "INSERT INTO checkins (id, client_id, event_id, pass_id, scanner_id, scanned_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_id) DO NOTHING RETURNING *",
      [randomUUID(), input.clientId ?? null, input.eventId, input.passId, input.scannerId ?? null, input.scannedAt ?? now(), now()],
    );
    if (inserted) return rowToCheckIn(inserted);
    // Otro pedido con el mismo clientId llegó entre la lectura y la escritura: se devuelve el suyo.
    return this.sameCheckIn((await this.db.one("SELECT * FROM checkins WHERE client_id = ?", [input.clientId as string]))!, input);
  }

  async listCheckIns(eventId: string): Promise<CheckIn[]> {
    return (await this.db.all("SELECT * FROM checkins WHERE event_id = ? ORDER BY scanned_at", [eventId])).map(rowToCheckIn);
  }

  async listCheckInsForPass(passId: string): Promise<CheckIn[]> {
    return (await this.db.all("SELECT * FROM checkins WHERE pass_id = ? ORDER BY scanned_at", [passId])).map(rowToCheckIn);
  }

  async markCheckIn(id: string, mark: SyncMark): Promise<CheckIn> {
    await this.update("checkins", id, syncColumns(mark));
    const row = await this.db.one("SELECT * FROM checkins WHERE id = ?", [id]);
    if (!row) throw new Error(`No existe el check-in ${id}`);
    return rowToCheckIn(row);
  }

  // Canjes

  private sameRedemption(existing: Row, input: NewRedemption): Redemption {
    const same = str(existing.event_id) === input.eventId && str(existing.pass_id) === input.passId && str(existing.benefit_id) === input.benefitId;
    if (!same) throw new ClientIdTaken(input.clientId as string);
    return rowToRedemption(existing);
  }

  async recordRedemption(input: NewRedemption): Promise<Redemption> {
    if (input.clientId) {
      const existing = await this.db.one("SELECT * FROM redemptions WHERE client_id = ?", [input.clientId]);
      if (existing) return this.sameRedemption(existing, input);
    }
    const inserted = await this.db.one(
      "INSERT INTO redemptions (id, client_id, event_id, pass_id, benefit_id, scanner_id, scanned_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_id) DO NOTHING RETURNING *",
      [randomUUID(), input.clientId ?? null, input.eventId, input.passId, input.benefitId, input.scannerId ?? null, input.scannedAt ?? now(), now()],
    );
    if (inserted) return rowToRedemption(inserted);
    return this.sameRedemption((await this.db.one("SELECT * FROM redemptions WHERE client_id = ?", [input.clientId as string]))!, input);
  }

  async listRedemptions(eventId: string): Promise<Redemption[]> {
    return (await this.db.all("SELECT * FROM redemptions WHERE event_id = ? ORDER BY scanned_at", [eventId])).map(rowToRedemption);
  }

  async listRedemptionsForPass(passId: string): Promise<Redemption[]> {
    return (await this.db.all("SELECT * FROM redemptions WHERE pass_id = ? ORDER BY scanned_at", [passId])).map(rowToRedemption);
  }

  async markRedemption(id: string, mark: SyncMark): Promise<Redemption> {
    await this.update("redemptions", id, syncColumns(mark));
    const row = await this.db.one("SELECT * FROM redemptions WHERE id = ?", [id]);
    if (!row) throw new Error(`No existe el canje ${id}`);
    return rowToRedemption(row);
  }

  // Cuentas de desarrollo

  async getDevAccount(personId: string): Promise<DevAccount | null> {
    const row = await this.db.one("SELECT * FROM dev_accounts WHERE person_id = ?", [personId]);
    if (!row) return null;
    return {
      personId: str(row.person_id),
      publicKey: str(row.public_key),
      // En Postgres va cifrada (RUMBO_DATA_KEY); acá vuelve en claro solo para firmar.
      secretKey: this.db.secrets.openText(row.secret_key, devSecretContext(str(row.person_id))),
      funded: bool(row.funded),
      createdAt: str(row.created_at),
    };
  }

  async saveDevAccount(input: Omit<DevAccount, "createdAt">): Promise<DevAccount> {
    await this.db.run("INSERT INTO dev_accounts (person_id, public_key, secret_key, funded, created_at) VALUES (?, ?, ?, ?, ?)", [
      input.personId,
      input.publicKey,
      this.db.secrets.sealText(input.secretKey, devSecretContext(input.personId)),
      input.funded,
      now(),
    ]);
    return (await this.getDevAccount(input.personId))!;
  }

  async markDevAccountFunded(personId: string): Promise<void> {
    await this.db.run("UPDATE dev_accounts SET funded = TRUE WHERE person_id = ?", [personId]);
  }

  // Equipos

  async createTeam(eventId: string, name: string): Promise<{ team: Team; created: boolean }> {
    const clean = name.trim();
    const find = () => this.db.one("SELECT * FROM teams WHERE event_id = ? AND lower(name) = lower(?)", [eventId, clean]);
    const existing = await find();
    if (existing) return { team: rowToTeam(existing), created: false };
    const inserted = await this.db.one("INSERT INTO teams (id, event_id, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING *", [randomUUID(), eventId, clean, now()]);
    if (inserted) return { team: rowToTeam(inserted), created: true };
    // Otro integrante creó el mismo equipo al mismo tiempo: es el mismo.
    return { team: rowToTeam((await find())!), created: false };
  }

  async getTeam(id: string): Promise<Team | null> {
    const row = await this.db.one("SELECT * FROM teams WHERE id = ?", [id]);
    return row ? rowToTeam(row) : null;
  }

  async listTeams(eventId: string): Promise<Team[]> {
    return (await this.db.all("SELECT * FROM teams WHERE event_id = ? ORDER BY created_at", [eventId])).map(rowToTeam);
  }

  async setPassTeam(passId: string, teamId: string): Promise<void> {
    await this.db.run("INSERT INTO pass_teams (pass_id, team_id) VALUES (?, ?) ON CONFLICT (pass_id) DO UPDATE SET team_id = excluded.team_id", [passId, teamId]);
  }

  async getPassTeam(passId: string): Promise<Team | null> {
    const row = await this.db.one("SELECT t.* FROM teams t JOIN pass_teams pt ON pt.team_id = t.id WHERE pt.pass_id = ?", [passId]);
    return row ? rowToTeam(row) : null;
  }

  async listTeamPasses(teamId: string): Promise<Pass[]> {
    return (await this.db.all("SELECT p.* FROM passes p JOIN pass_teams pt ON pt.pass_id = p.id WHERE pt.team_id = ? ORDER BY p.created_at", [teamId])).map(rowToPass);
  }

  async listPassTeams(eventId: string): Promise<Array<{ passId: string; team: Team }>> {
    const rows = await this.db.all("SELECT pt.pass_id, t.* FROM pass_teams pt JOIN teams t ON t.id = pt.team_id WHERE t.event_id = ?", [eventId]);
    return rows.map((row) => ({ passId: str(row.pass_id), team: rowToTeam(row) }));
  }

  // Importaciones de lista

  async createImportRun(input: { eventId: string; source: string; summary: Record<string, unknown> }): Promise<ImportRun> {
    const id = randomUUID();
    await this.db.run(`INSERT INTO import_runs (id, event_id, source, summary, created_at) VALUES (?, ?, ?, ${jsonParam(this.db)}, ?)`, [
      id,
      input.eventId,
      input.source,
      JSON.stringify(input.summary),
      now(),
    ]);
    return (await this.getImportRun(id))!;
  }

  async getImportRun(id: string): Promise<ImportRun | null> {
    const row = await this.db.one("SELECT * FROM import_runs WHERE id = ?", [id]);
    return row ? rowToImportRun(row) : null;
  }

  async updateImportRun(id: string, summary: Record<string, unknown>): Promise<ImportRun> {
    await this.db.run(`UPDATE import_runs SET summary = ${jsonParam(this.db)} WHERE id = ?`, [JSON.stringify(summary), id]);
    const run = await this.getImportRun(id);
    if (!run) throw new Error(`No existe la importación ${id}`);
    return run;
  }

  async listPassesByImportRun(runId: string): Promise<Pass[]> {
    return (await this.db.all("SELECT * FROM passes WHERE import_run_id = ? ORDER BY created_at, id", [runId])).map(rowToPass);
  }

  // El informe

  async getEventStats(eventId: string): Promise<EventStats> {
    const totals = (await this.db.one(
      `SELECT COUNT(*) AS passes,
              SUM(CASE WHEN status IN ('active', 'checked_in') THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN status = 'checked_in' THEN 1 ELSE 0 END) AS checked_in
       FROM passes WHERE event_id = ?`,
      [eventId],
    ))!;
    const byTicketType = (
      await this.db.all(
        `SELECT tt.id AS ticket_type_id, tt.name, COUNT(p.id) AS passes
         FROM ticket_types tt LEFT JOIN passes p ON p.ticket_type_id = tt.id
         WHERE tt.event_id = ? GROUP BY tt.id ORDER BY tt.sort_order`,
        [eventId],
      )
    ).map((r) => ({ ticketTypeId: str(r.ticket_type_id), name: str(r.name), passes: num(r.passes) }));
    const byBenefit = (
      await this.db.all(
        `SELECT b.id AS benefit_id, b.name,
                (SELECT COUNT(*) FROM pass_benefits pb WHERE pb.benefit_id = b.id) AS granted,
                (SELECT COUNT(*) FROM redemptions r WHERE r.benefit_id = b.id AND r.duplicate = FALSE) AS redeemed,
                (SELECT COUNT(*) FROM redemptions r WHERE r.benefit_id = b.id AND r.duplicate = TRUE) AS duplicates
         FROM benefits b WHERE b.event_id = ? ORDER BY b.sort_order, b.name`,
        [eventId],
      )
    ).map((r) => ({ benefitId: str(r.benefit_id), name: str(r.name), granted: num(r.granted), redeemed: num(r.redeemed), duplicates: num(r.duplicates) }));
    const pending = (await this.db.one(
      `SELECT (SELECT COUNT(*) FROM checkins WHERE event_id = ? AND synced = FALSE AND duplicate = FALSE)
            + (SELECT COUNT(*) FROM redemptions WHERE event_id = ? AND synced = FALSE AND duplicate = FALSE) AS pending`,
      [eventId, eventId],
    ))!;
    return {
      passes: num(totals.passes ?? 0),
      active: num(totals.active ?? 0),
      checkedIn: num(totals.checked_in ?? 0),
      byTicketType,
      byBenefit,
      pendingSync: num(pending.pending ?? 0),
    };
  }
}

function syncColumns(mark: SyncMark): Record<string, SqlValue> {
  const columns: Record<string, SqlValue> = {};
  if (mark.synced !== undefined) columns.synced = mark.synced;
  if (mark.duplicate !== undefined) columns.duplicate = mark.duplicate;
  if (mark.txHash !== undefined) columns.tx_hash = mark.txHash;
  if (mark.txSentAt !== undefined) columns.tx_sent_at = mark.txSentAt;
  if (mark.error !== undefined) columns.error = mark.error;
  return columns;
}

/** Una base SQLite propia en `file` (o ":memory:"), con sus migraciones aplicadas al abrirse. La usan las pruebas de las migraciones. */
export class SqliteRepo extends SqlRepo {
  constructor(file: string) {
    super(openSqlite(file, plainSecrets));
  }
}

// ---------- La instancia ----------

declare global {
  // Sobrevive a las recargas en caliente de next dev: un solo repo por proceso, sobre la base del proceso.
  var __rumboRepo: Repo | undefined;
}

/** El repo de la base que pide RUMBO_REPO (src/server/base): SQLite, Postgres o PGlite. */
export function getRepo(): Repo {
  if (globalThis.__rumboRepo) return globalThis.__rumboRepo;
  const repo = new SqlRepo(getDb());
  globalThis.__rumboRepo = repo;
  return repo;
}
