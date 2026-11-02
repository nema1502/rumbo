// La capa de datos. Repo es la interfaz; SqliteRepo la implementación local (node:sqlite, Node 24);
// SupabaseRepo queda como esqueleto para producción. Nombres y correos viven acá, nunca en la cadena.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { appDir, dataDir, getEnv } from "./env.ts";
import { newEventQrKey, newPassId } from "./qr.ts";

// ---------- Los datos ----------

export type PassStatus = "pending" | "active" | "checked_in";
export type BenefitKind = "lunch" | "merch" | "prize" | "other";
/** De dónde salió un beneficio de un pase: de su entrada, del sorteo, o dado a mano. */
export type GrantSource = "ticket" | "raffle" | "manual";

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
}

export interface NewTicketType {
  eventId: string;
  name: string;
  priceUsdc?: number;
  contractId?: string | null;
  sortOrder?: number;
}

export interface TicketTypePatch {
  name?: string;
  priceUsdc?: number;
  contractId?: string | null;
  sortOrder?: number;
}

export interface Benefit {
  id: string;
  eventId: string;
  name: string;
  kind: BenefitKind;
  /** El puesto donde se canjea ("Mesa del almuerzo"). */
  station: string | null;
  sortOrder: number;
}

export interface NewBenefit {
  eventId: string;
  name: string;
  kind: BenefitKind;
  station?: string | null;
  sortOrder?: number;
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
}

export interface NewPass {
  eventId: string;
  personId: string;
  ticketTypeId: string;
  account?: string | null;
  status?: PassStatus;
}

export interface PassPatch {
  /** Para retomar una inscripción que quedó pendiente con otra entrada. Solo se cambia en pases pendientes. */
  ticketTypeId?: string;
  account?: string | null;
  status?: PassStatus;
  txHash?: string | null;
  chainNumber?: number | null;
  activatedAt?: string | null;
  checkedInAt?: string | null;
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
  /** La llave con la que se firman los QR del evento. Solo para el servidor y para el escáner del voluntario. */
  getEventQrKey(eventId: string): Promise<Uint8Array>;

  // Tipos de entrada
  listTicketTypes(eventId: string): Promise<TicketType[]>;
  getTicketType(id: string): Promise<TicketType | null>;
  createTicketType(input: NewTicketType): Promise<TicketType>;
  updateTicketType(id: string, patch: TicketTypePatch): Promise<TicketType>;

  // Beneficios: el catálogo del evento y qué trae cada entrada
  listBenefits(eventId: string): Promise<Benefit[]>;
  getBenefit(id: string): Promise<Benefit | null>;
  createBenefit(input: NewBenefit): Promise<Benefit>;
  /** Dice que la entrada trae ese beneficio, y con qué número se canjea en su contrato. */
  linkBenefit(ticketTypeId: string, benefitId: string, chainIndex: number): Promise<void>;
  listTicketTypeBenefits(ticketTypeId: string): Promise<TicketTypeBenefit[]>;

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

  // El informe
  getEventStats(eventId: string): Promise<EventStats>;
}

// ---------- Ayudantes ----------

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => Number(v) === 1;

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

function rowToDevAccount(row: Row): DevAccount {
  return { personId: str(row.person_id), publicKey: str(row.public_key), secretKey: str(row.secret_key), funded: bool(row.funded), createdAt: str(row.created_at) };
}

/** La carpeta con las migraciones .sql (src/server/migrations). next dev y los scripts corren desde app/. */
function migrationsDir(): string {
  const dir = getEnv("RUMBO_MIGRATIONS_DIR") ?? path.join(appDir(), "src", "server", "migrations");
  if (!fs.existsSync(dir)) {
    throw new Error(`No encuentro la carpeta de migraciones de la base (${dir}). Los scripts corren desde la carpeta app.`);
  }
  return dir;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------- SQLite ----------

export class SqliteRepo implements Repo {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    // node:sqlite se carga en tiempo de ejecución para que el empaquetador de Next no tenga que resolverlo.
    const sqlite = process.getBuiltinModule("node:sqlite") as unknown as typeof import("node:sqlite") | undefined;
    if (!sqlite) throw new Error("Esta versión de Node no trae node:sqlite. Hace falta Node 24 o más nuevo.");
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new sqlite.DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    const applied = new Set(this.all("SELECT name FROM schema_migrations").map((r) => str(r.name)));
    const dir = migrationsDir();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      this.db.exec("BEGIN");
      try {
        this.db.exec(sql);
        this.run("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", file, now());
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  private all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  private one(sql: string, ...params: SQLInputValue[]): Row | null {
    return (this.db.prepare(sql).get(...params) as Row | undefined) ?? null;
  }

  private run(sql: string, ...params: SQLInputValue[]): void {
    this.db.prepare(sql).run(...params);
  }

  /** UPDATE de las columnas dadas, por id. Sin columnas no hace nada. */
  private update(table: string, id: string, columns: Record<string, SQLInputValue>): void {
    const names = Object.keys(columns);
    if (names.length === 0) return;
    const sets = names.map((n) => `${n} = ?`).join(", ");
    this.run(`UPDATE ${table} SET ${sets} WHERE id = ?`, ...names.map((n) => columns[n] as SQLInputValue), id);
  }

  // Eventos

  async listEvents(): Promise<EventRecord[]> {
    return this.all("SELECT * FROM events ORDER BY starts_at ASC").map(rowToEvent);
  }

  async getEventBySlug(slug: string): Promise<EventRecord | null> {
    const row = this.one("SELECT * FROM events WHERE slug = ?", slug);
    return row ? rowToEvent(row) : null;
  }

  async getEventById(id: string): Promise<EventRecord | null> {
    const row = this.one("SELECT * FROM events WHERE id = ?", id);
    return row ? rowToEvent(row) : null;
  }

  async createEvent(input: NewEvent): Promise<EventRecord> {
    const id = randomUUID();
    this.run(
      `INSERT INTO events (id, slug, name, description, starts_at, ends_at, timezone, place, venue, organizer_name,
         organizer_account, contract_id, capacity, qr_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      newEventQrKey(),
      now(),
    );
    return (await this.getEventById(id))!;
  }

  async updateEvent(id: string, patch: EventPatch): Promise<EventRecord> {
    const columns: Record<string, SQLInputValue> = {};
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
    this.update("events", id, columns);
    const event = await this.getEventById(id);
    if (!event) throw new Error(`No existe el evento ${id}`);
    return event;
  }

  async getEventQrKey(eventId: string): Promise<Uint8Array> {
    const row = this.one("SELECT qr_key FROM events WHERE id = ?", eventId);
    if (!row) throw new Error(`No existe el evento ${eventId}`);
    return new Uint8Array(row.qr_key as Uint8Array);
  }

  // Tipos de entrada

  async listTicketTypes(eventId: string): Promise<TicketType[]> {
    return this.all("SELECT * FROM ticket_types WHERE event_id = ? ORDER BY sort_order, price_usdc", eventId).map(rowToTicketType);
  }

  async getTicketType(id: string): Promise<TicketType | null> {
    const row = this.one("SELECT * FROM ticket_types WHERE id = ?", id);
    return row ? rowToTicketType(row) : null;
  }

  async createTicketType(input: NewTicketType): Promise<TicketType> {
    const id = randomUUID();
    this.run(
      "INSERT INTO ticket_types (id, event_id, name, price_usdc, contract_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      input.eventId,
      input.name,
      input.priceUsdc ?? 0,
      input.contractId ?? null,
      input.sortOrder ?? 0,
    );
    return (await this.getTicketType(id))!;
  }

  async updateTicketType(id: string, patch: TicketTypePatch): Promise<TicketType> {
    const columns: Record<string, SQLInputValue> = {};
    if (patch.name !== undefined) columns.name = patch.name;
    if (patch.priceUsdc !== undefined) columns.price_usdc = patch.priceUsdc;
    if (patch.contractId !== undefined) columns.contract_id = patch.contractId;
    if (patch.sortOrder !== undefined) columns.sort_order = patch.sortOrder;
    this.update("ticket_types", id, columns);
    const ticketType = await this.getTicketType(id);
    if (!ticketType) throw new Error(`No existe el tipo de entrada ${id}`);
    return ticketType;
  }

  // Beneficios

  async listBenefits(eventId: string): Promise<Benefit[]> {
    return this.all("SELECT * FROM benefits WHERE event_id = ? ORDER BY sort_order, name", eventId).map(rowToBenefit);
  }

  async getBenefit(id: string): Promise<Benefit | null> {
    const row = this.one("SELECT * FROM benefits WHERE id = ?", id);
    return row ? rowToBenefit(row) : null;
  }

  async createBenefit(input: NewBenefit): Promise<Benefit> {
    const id = randomUUID();
    this.run(
      "INSERT INTO benefits (id, event_id, name, kind, station, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      input.eventId,
      input.name,
      input.kind,
      input.station ?? null,
      input.sortOrder ?? 0,
    );
    return (await this.getBenefit(id))!;
  }

  async linkBenefit(ticketTypeId: string, benefitId: string, chainIndex: number): Promise<void> {
    this.run(
      `INSERT INTO ticket_type_benefits (ticket_type_id, benefit_id, chain_index) VALUES (?, ?, ?)
       ON CONFLICT (ticket_type_id, benefit_id) DO UPDATE SET chain_index = excluded.chain_index`,
      ticketTypeId,
      benefitId,
      chainIndex,
    );
  }

  async listTicketTypeBenefits(ticketTypeId: string): Promise<TicketTypeBenefit[]> {
    return this.all(
      `SELECT b.*, ttb.chain_index FROM benefits b JOIN ticket_type_benefits ttb ON ttb.benefit_id = b.id
       WHERE ttb.ticket_type_id = ? ORDER BY ttb.chain_index`,
      ticketTypeId,
    ).map((row) => ({ ...rowToBenefit(row), chainIndex: num(row.chain_index) }));
  }

  // Personas

  async getPersonById(id: string): Promise<Person | null> {
    const row = this.one("SELECT * FROM persons WHERE id = ?", id);
    return row ? rowToPerson(row) : null;
  }

  async getPersonByEmail(email: string): Promise<Person | null> {
    const row = this.one("SELECT * FROM persons WHERE email = ?", normalizeEmail(email));
    return row ? rowToPerson(row) : null;
  }

  async upsertPerson(input: { name: string; email: string }): Promise<Person> {
    const email = normalizeEmail(input.email);
    const name = input.name.trim();
    const existing = await this.getPersonByEmail(email);
    if (existing) {
      if (name && name !== existing.name) this.run("UPDATE persons SET name = ? WHERE id = ?", name, existing.id);
      return (await this.getPersonById(existing.id))!;
    }
    const id = randomUUID();
    this.run("INSERT INTO persons (id, name, email, created_at) VALUES (?, ?, ?, ?)", id, name, email, now());
    return (await this.getPersonById(id))!;
  }

  // Pases

  async createPass(input: NewPass): Promise<Pass> {
    // Un id nuevo hasta que no choque: con 40 bits de azar casi nunca pasa, pero cuesta nada mirar.
    let id = newPassId();
    while (this.one("SELECT 1 FROM passes WHERE id = ?", id)) id = newPassId();
    const status = input.status ?? "pending";
    const at = now();
    this.run(
      "INSERT INTO passes (id, event_id, person_id, ticket_type_id, account, status, created_at, activated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      input.eventId,
      input.personId,
      input.ticketTypeId,
      input.account ?? null,
      status,
      at,
      status === "pending" ? null : at,
    );
    return (await this.getPass(id))!;
  }

  async getPass(id: string): Promise<Pass | null> {
    const row = this.one("SELECT * FROM passes WHERE id = ?", id);
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
    const row = this.one("SELECT * FROM passes WHERE event_id = ? AND person_id = ?", eventId, personId);
    return row ? rowToPass(row) : null;
  }

  async findPassByAccount(eventId: string, account: string): Promise<Pass | null> {
    const row = this.one("SELECT * FROM passes WHERE event_id = ? AND account = ?", eventId, account);
    return row ? rowToPass(row) : null;
  }

  async listPasses(eventId: string): Promise<Pass[]> {
    return this.all("SELECT * FROM passes WHERE event_id = ? ORDER BY created_at", eventId).map(rowToPass);
  }

  async updatePass(id: string, patch: PassPatch): Promise<Pass> {
    if (patch.ticketTypeId !== undefined) {
      // La entrada solo cambia mientras el pase está pendiente: una vez activo, el contrato ya es el de su entrada.
      this.run("UPDATE passes SET ticket_type_id = ? WHERE id = ? AND status = 'pending'", patch.ticketTypeId, id);
    }
    const columns: Record<string, SQLInputValue> = {};
    if (patch.account !== undefined) columns.account = patch.account;
    if (patch.status !== undefined) {
      columns.status = patch.status;
      if (patch.status !== "pending" && patch.activatedAt === undefined) columns.activated_at = now();
      if (patch.status === "checked_in" && patch.checkedInAt === undefined) columns.checked_in_at = now();
    }
    if (patch.txHash !== undefined) columns.tx_hash = patch.txHash;
    if (patch.chainNumber !== undefined) columns.chain_number = patch.chainNumber;
    if (patch.activatedAt !== undefined) columns.activated_at = patch.activatedAt;
    if (patch.checkedInAt !== undefined) columns.checked_in_at = patch.checkedInAt;
    this.update("passes", id, columns);
    const pass = await this.getPass(id);
    if (!pass) throw new Error(`No existe el pase ${id}`);
    return pass;
  }

  // Beneficios de cada pase

  async listPassBenefits(passId: string): Promise<PassBenefit[]> {
    return this.all(
      `SELECT b.*, pb.source, pb.granted_at, ttb.chain_index
       FROM pass_benefits pb
       JOIN benefits b ON b.id = pb.benefit_id
       JOIN passes p ON p.id = pb.pass_id
       LEFT JOIN ticket_type_benefits ttb ON ttb.benefit_id = b.id AND ttb.ticket_type_id = p.ticket_type_id
       WHERE pb.pass_id = ? ORDER BY b.sort_order, b.name`,
      passId,
    ).map((row) => ({
      ...rowToBenefit(row),
      source: str(row.source) as GrantSource,
      grantedAt: str(row.granted_at),
      chainIndex: numOrNull(row.chain_index),
    }));
  }

  async grantBenefit(passId: string, benefitId: string, source: GrantSource): Promise<void> {
    this.run("INSERT OR IGNORE INTO pass_benefits (pass_id, benefit_id, source, granted_at) VALUES (?, ?, ?, ?)", passId, benefitId, source, now());
  }

  async grantTicketBenefits(passId: string): Promise<PassBenefit[]> {
    const pass = await this.getPass(passId);
    if (!pass) throw new Error(`No existe el pase ${passId}`);
    for (const benefit of await this.listTicketTypeBenefits(pass.ticketTypeId)) await this.grantBenefit(passId, benefit.id, "ticket");
    return this.listPassBenefits(passId);
  }

  // Check-ins

  async recordCheckIn(input: NewCheckIn): Promise<CheckIn> {
    if (input.clientId) {
      const existing = this.one("SELECT * FROM checkins WHERE client_id = ?", input.clientId);
      if (existing) {
        if (str(existing.event_id) !== input.eventId || str(existing.pass_id) !== input.passId) throw new ClientIdTaken(input.clientId);
        return rowToCheckIn(existing);
      }
    }
    const id = randomUUID();
    this.run(
      "INSERT INTO checkins (id, client_id, event_id, pass_id, scanner_id, scanned_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      input.clientId ?? null,
      input.eventId,
      input.passId,
      input.scannerId ?? null,
      input.scannedAt ?? now(),
      now(),
    );
    return rowToCheckIn(this.one("SELECT * FROM checkins WHERE id = ?", id)!);
  }

  async listCheckIns(eventId: string): Promise<CheckIn[]> {
    return this.all("SELECT * FROM checkins WHERE event_id = ? ORDER BY scanned_at", eventId).map(rowToCheckIn);
  }

  async listCheckInsForPass(passId: string): Promise<CheckIn[]> {
    return this.all("SELECT * FROM checkins WHERE pass_id = ? ORDER BY scanned_at", passId).map(rowToCheckIn);
  }

  async markCheckIn(id: string, mark: SyncMark): Promise<CheckIn> {
    this.update("checkins", id, syncColumns(mark));
    const row = this.one("SELECT * FROM checkins WHERE id = ?", id);
    if (!row) throw new Error(`No existe el check-in ${id}`);
    return rowToCheckIn(row);
  }

  // Canjes

  async recordRedemption(input: NewRedemption): Promise<Redemption> {
    if (input.clientId) {
      const existing = this.one("SELECT * FROM redemptions WHERE client_id = ?", input.clientId);
      if (existing) {
        const same = str(existing.event_id) === input.eventId && str(existing.pass_id) === input.passId && str(existing.benefit_id) === input.benefitId;
        if (!same) throw new ClientIdTaken(input.clientId);
        return rowToRedemption(existing);
      }
    }
    const id = randomUUID();
    this.run(
      "INSERT INTO redemptions (id, client_id, event_id, pass_id, benefit_id, scanner_id, scanned_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      input.clientId ?? null,
      input.eventId,
      input.passId,
      input.benefitId,
      input.scannerId ?? null,
      input.scannedAt ?? now(),
      now(),
    );
    return rowToRedemption(this.one("SELECT * FROM redemptions WHERE id = ?", id)!);
  }

  async listRedemptions(eventId: string): Promise<Redemption[]> {
    return this.all("SELECT * FROM redemptions WHERE event_id = ? ORDER BY scanned_at", eventId).map(rowToRedemption);
  }

  async listRedemptionsForPass(passId: string): Promise<Redemption[]> {
    return this.all("SELECT * FROM redemptions WHERE pass_id = ? ORDER BY scanned_at", passId).map(rowToRedemption);
  }

  async markRedemption(id: string, mark: SyncMark): Promise<Redemption> {
    this.update("redemptions", id, syncColumns(mark));
    const row = this.one("SELECT * FROM redemptions WHERE id = ?", id);
    if (!row) throw new Error(`No existe el canje ${id}`);
    return rowToRedemption(row);
  }

  // Cuentas de desarrollo

  async getDevAccount(personId: string): Promise<DevAccount | null> {
    const row = this.one("SELECT * FROM dev_accounts WHERE person_id = ?", personId);
    return row ? rowToDevAccount(row) : null;
  }

  async saveDevAccount(input: Omit<DevAccount, "createdAt">): Promise<DevAccount> {
    this.run(
      "INSERT INTO dev_accounts (person_id, public_key, secret_key, funded, created_at) VALUES (?, ?, ?, ?, ?)",
      input.personId,
      input.publicKey,
      input.secretKey,
      input.funded ? 1 : 0,
      now(),
    );
    return (await this.getDevAccount(input.personId))!;
  }

  async markDevAccountFunded(personId: string): Promise<void> {
    this.run("UPDATE dev_accounts SET funded = 1 WHERE person_id = ?", personId);
  }

  // El informe

  async getEventStats(eventId: string): Promise<EventStats> {
    const totals = this.one(
      `SELECT COUNT(*) AS passes,
              SUM(CASE WHEN status IN ('active', 'checked_in') THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN status = 'checked_in' THEN 1 ELSE 0 END) AS checked_in
       FROM passes WHERE event_id = ?`,
      eventId,
    )!;
    const byTicketType = this.all(
      `SELECT tt.id AS ticket_type_id, tt.name, COUNT(p.id) AS passes
       FROM ticket_types tt LEFT JOIN passes p ON p.ticket_type_id = tt.id
       WHERE tt.event_id = ? GROUP BY tt.id ORDER BY tt.sort_order`,
      eventId,
    ).map((r) => ({ ticketTypeId: str(r.ticket_type_id), name: str(r.name), passes: num(r.passes) }));
    const byBenefit = this.all(
      `SELECT b.id AS benefit_id, b.name,
              (SELECT COUNT(*) FROM pass_benefits pb WHERE pb.benefit_id = b.id) AS granted,
              (SELECT COUNT(*) FROM redemptions r WHERE r.benefit_id = b.id AND r.duplicate = 0) AS redeemed,
              (SELECT COUNT(*) FROM redemptions r WHERE r.benefit_id = b.id AND r.duplicate = 1) AS duplicates
       FROM benefits b WHERE b.event_id = ? ORDER BY b.sort_order, b.name`,
      eventId,
    ).map((r) => ({ benefitId: str(r.benefit_id), name: str(r.name), granted: num(r.granted), redeemed: num(r.redeemed), duplicates: num(r.duplicates) }));
    const pending = this.one(
      `SELECT (SELECT COUNT(*) FROM checkins WHERE event_id = ? AND synced = 0 AND duplicate = 0)
            + (SELECT COUNT(*) FROM redemptions WHERE event_id = ? AND synced = 0 AND duplicate = 0) AS pending`,
      eventId,
      eventId,
    )!;
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

function syncColumns(mark: SyncMark): Record<string, SQLInputValue> {
  const columns: Record<string, SQLInputValue> = {};
  if (mark.synced !== undefined) columns.synced = mark.synced ? 1 : 0;
  if (mark.duplicate !== undefined) columns.duplicate = mark.duplicate ? 1 : 0;
  if (mark.txHash !== undefined) columns.tx_hash = mark.txHash;
  if (mark.txSentAt !== undefined) columns.tx_sent_at = mark.txSentAt;
  if (mark.error !== undefined) columns.error = mark.error;
  return columns;
}

// ---------- Supabase (producción) ----------

/**
 * TODO: la implementación con Supabase (Postgres, Realtime y Storage) para producción.
 * Mismas tablas que la migración 001, con acceso por fila. Hasta entonces, SqliteRepo.
 */
export class SupabaseRepo implements Repo {
  constructor(_url: string, _key: string) {}
  private todo(): never {
    throw new Error("TODO: SupabaseRepo todavía no está implementado. Usá RUMBO_REPO=sqlite.");
  }
  listEvents(): Promise<EventRecord[]> { return this.todo(); }
  getEventBySlug(): Promise<EventRecord | null> { return this.todo(); }
  getEventById(): Promise<EventRecord | null> { return this.todo(); }
  createEvent(): Promise<EventRecord> { return this.todo(); }
  updateEvent(): Promise<EventRecord> { return this.todo(); }
  getEventQrKey(): Promise<Uint8Array> { return this.todo(); }
  listTicketTypes(): Promise<TicketType[]> { return this.todo(); }
  getTicketType(): Promise<TicketType | null> { return this.todo(); }
  createTicketType(): Promise<TicketType> { return this.todo(); }
  updateTicketType(): Promise<TicketType> { return this.todo(); }
  listBenefits(): Promise<Benefit[]> { return this.todo(); }
  getBenefit(): Promise<Benefit | null> { return this.todo(); }
  createBenefit(): Promise<Benefit> { return this.todo(); }
  linkBenefit(): Promise<void> { return this.todo(); }
  listTicketTypeBenefits(): Promise<TicketTypeBenefit[]> { return this.todo(); }
  getPersonById(): Promise<Person | null> { return this.todo(); }
  getPersonByEmail(): Promise<Person | null> { return this.todo(); }
  upsertPerson(): Promise<Person> { return this.todo(); }
  createPass(): Promise<Pass> { return this.todo(); }
  getPass(): Promise<Pass | null> { return this.todo(); }
  getPassView(): Promise<PassView | null> { return this.todo(); }
  findPass(): Promise<Pass | null> { return this.todo(); }
  findPassByAccount(): Promise<Pass | null> { return this.todo(); }
  listPasses(): Promise<Pass[]> { return this.todo(); }
  updatePass(): Promise<Pass> { return this.todo(); }
  listPassBenefits(): Promise<PassBenefit[]> { return this.todo(); }
  grantBenefit(): Promise<void> { return this.todo(); }
  grantTicketBenefits(): Promise<PassBenefit[]> { return this.todo(); }
  recordCheckIn(): Promise<CheckIn> { return this.todo(); }
  listCheckIns(): Promise<CheckIn[]> { return this.todo(); }
  listCheckInsForPass(): Promise<CheckIn[]> { return this.todo(); }
  markCheckIn(): Promise<CheckIn> { return this.todo(); }
  recordRedemption(): Promise<Redemption> { return this.todo(); }
  listRedemptions(): Promise<Redemption[]> { return this.todo(); }
  listRedemptionsForPass(): Promise<Redemption[]> { return this.todo(); }
  markRedemption(): Promise<Redemption> { return this.todo(); }
  getDevAccount(): Promise<DevAccount | null> { return this.todo(); }
  saveDevAccount(): Promise<DevAccount> { return this.todo(); }
  markDevAccountFunded(): Promise<void> { return this.todo(); }
  getEventStats(): Promise<EventStats> { return this.todo(); }
}

// ---------- La instancia ----------

declare global {
  // Sobrevive a las recargas en caliente de next dev: una sola conexión por proceso.
  var __rumboRepo: Repo | undefined;
}

export function getRepo(): Repo {
  if (globalThis.__rumboRepo) return globalThis.__rumboRepo;
  const kind = getEnv("RUMBO_REPO", "sqlite");
  const repo: Repo =
    kind === "supabase"
      ? new SupabaseRepo(getEnv("SUPABASE_URL", ""), getEnv("SUPABASE_SERVICE_KEY", ""))
      : new SqliteRepo(path.join(dataDir(), "rumbo.db"));
  globalThis.__rumboRepo = repo;
  return repo;
}
