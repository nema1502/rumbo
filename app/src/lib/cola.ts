// La cola local del escáner del voluntario. Vive en IndexedDB, en el celular, y guarda dos cosas:
// la sesión del puesto (el código con que se abrió y la foto del evento: su clave pública, el puesto y los
// pases), para seguir trabajando y hasta volver a abrir la página sin red; y cada entrada o canje
// que el voluntario registró, con su estado: pendiente de llegar al servidor, sincronizado, doble
// (el contrato dijo que ya estaba hecho) o rechazado. Si el navegador no deja usar IndexedDB (una
// ventana privada), todo queda en memoria y vale mientras la página esté abierta.
import type { LocalUsage, ScanAction, ScanItem, ScanSnapshot } from "./escaner-api.ts";
import { normalizeStationCode } from "./station-code.ts";

export type QueueStatus = "pending" | "synced" | "duplicate" | "rejected";

export interface QueueEntry extends ScanItem {
  eventId: string;
  stationId: string;
  /**
   * El código del puesto en que se registró. Viaja con el registro al sincronizar, así llega aunque el
   * voluntario haya cerrado ese puesto y abierto otro (el servidor solo acepta de cada código lo de su
   * puesto). Los registros de una versión anterior no lo tienen.
   */
  code?: string;
  status: QueueStatus;
  /** Cuántas veces se intentó llevar al servidor sin lograrlo. */
  attempts: number;
  lastError: string | null;
  txHash: string | null;
  updatedAt: string;
}

export type QueuePatch = Partial<Pick<QueueEntry, "status" | "attempts" | "lastError" | "txHash">>;

export interface QueueCounts {
  pending: number;
  synced: number;
  duplicate: number;
  rejected: number;
}

/** El puesto abierto en este celular. Una sola sesión por vez. */
export interface ScanSession {
  /** El código del puesto con que se abrió: hace falta para volver a sincronizar. */
  code: string;
  /** Un id de este celular, para que el panel sepa qué puesto registró cada cosa. */
  scannerId: string;
  snapshot: ScanSnapshot;
  savedAt: string;
  /**
   * Cuánto hay que sumarle al reloj de este celular para tener la hora del servidor, medido cuando llegó la
   * última foto del evento (0 si el reloj está bien). Con eso se decide si el QR que rota está en su ventana.
   */
  clockOffsetMs?: number;
}

export interface ColaLocal {
  readonly persistent: boolean;
  getSession(): Promise<ScanSession | null>;
  saveSession(session: ScanSession): Promise<void>;
  clearSession(): Promise<void>;
  add(entry: QueueEntry): Promise<void>;
  update(clientId: string, patch: QueuePatch): Promise<void>;
  list(eventId: string): Promise<QueueEntry[]>;
  listPending(eventId: string): Promise<QueueEntry[]>;
  /** Lo pendiente de todos los eventos y puestos de este celular, para mandar cada cosa con su código. */
  listPendingAll(): Promise<QueueEntry[]>;
  counts(eventId: string): Promise<QueueCounts>;
  /** Lo que este escáner registró de cada pase (pendiente, sincronizado o doble: todo cuenta como usado). */
  usage(eventId: string): Promise<Map<string, LocalUsage>>;
}

const DB_NAME = "rumbo-escaner";
const DB_VERSION = 1;
const STORE_QUEUE = "cola";
const STORE_SESSION = "sesion";
const SESSION_KEY = "actual";

const now = () => new Date().toISOString();
const byScannedAt = (a: QueueEntry, b: QueueEntry) => a.scannedAt.localeCompare(b.scannedAt);

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB fallo al leer o escribir"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB fallo al leer o escribir"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB cancelo la operacion"));
  });
}

function countsOf(entries: QueueEntry[]): QueueCounts {
  const counts: QueueCounts = { pending: 0, synced: 0, duplicate: 0, rejected: 0 };
  for (const entry of entries) counts[entry.status]++;
  return counts;
}

function usageOf(entries: QueueEntry[]): Map<string, LocalUsage> {
  const usage = new Map<string, LocalUsage>();
  for (const entry of [...entries].sort(byScannedAt)) {
    if (entry.status === "rejected") continue;
    const current = usage.get(entry.passId) ?? { checkedInAt: null, redeemed: {}, visited: {} };
    const visited = (current.visited ??= {});
    if (entry.action === "checkin") current.checkedInAt ??= entry.scannedAt;
    else if (entry.action === "visit") visited[entry.stationId] ??= entry.scannedAt;
    else if (entry.benefitId) current.redeemed[entry.benefitId] ??= entry.scannedAt;
    usage.set(entry.passId, current);
  }
  return usage;
}

class ColaIndexedDb implements ColaLocal {
  readonly persistent = true;
  private readonly db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(): Promise<ColaIndexedDb> {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, { keyPath: "clientId" });
        store.createIndex("eventId", "eventId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SESSION)) db.createObjectStore(STORE_SESSION);
    };
    const db = await request(req);
    return new ColaIndexedDb(db);
  }

  async getSession(): Promise<ScanSession | null> {
    const tx = this.db.transaction(STORE_SESSION, "readonly");
    const value = (await request(tx.objectStore(STORE_SESSION).get(SESSION_KEY))) as ScanSession | undefined;
    // Una sesión guardada por una versión anterior de la página, sin la foto o sin el código, no sirve.
    return value && value.code && value.snapshot?.station && value.snapshot.event ? value : null;
  }

  async saveSession(session: ScanSession): Promise<void> {
    const tx = this.db.transaction(STORE_SESSION, "readwrite");
    tx.objectStore(STORE_SESSION).put(session, SESSION_KEY);
    await done(tx);
  }

  async clearSession(): Promise<void> {
    const tx = this.db.transaction(STORE_SESSION, "readwrite");
    tx.objectStore(STORE_SESSION).delete(SESSION_KEY);
    await done(tx);
  }

  async add(entry: QueueEntry): Promise<void> {
    const tx = this.db.transaction(STORE_QUEUE, "readwrite");
    tx.objectStore(STORE_QUEUE).put(entry);
    await done(tx);
  }

  async update(clientId: string, patch: QueuePatch): Promise<void> {
    const tx = this.db.transaction(STORE_QUEUE, "readwrite");
    const store = tx.objectStore(STORE_QUEUE);
    const current = (await request(store.get(clientId))) as QueueEntry | undefined;
    if (current) store.put({ ...current, ...patch, updatedAt: now() });
    await done(tx);
  }

  async list(eventId: string): Promise<QueueEntry[]> {
    const tx = this.db.transaction(STORE_QUEUE, "readonly");
    const entries = (await request(tx.objectStore(STORE_QUEUE).index("eventId").getAll(eventId))) as QueueEntry[];
    return entries.sort(byScannedAt);
  }

  async listPending(eventId: string): Promise<QueueEntry[]> {
    return (await this.list(eventId)).filter((e) => e.status === "pending");
  }

  async listPendingAll(): Promise<QueueEntry[]> {
    const tx = this.db.transaction(STORE_QUEUE, "readonly");
    const entries = (await request(tx.objectStore(STORE_QUEUE).getAll())) as QueueEntry[];
    return entries.filter((e) => e.status === "pending").sort(byScannedAt);
  }

  async counts(eventId: string): Promise<QueueCounts> {
    return countsOf(await this.list(eventId));
  }

  async usage(eventId: string): Promise<Map<string, LocalUsage>> {
    return usageOf(await this.list(eventId));
  }
}

/** Sin IndexedDB: todo en memoria, mientras la página esté abierta. */
class ColaMemoria implements ColaLocal {
  readonly persistent = false;
  private session: ScanSession | null = null;
  private readonly entries = new Map<string, QueueEntry>();

  async getSession(): Promise<ScanSession | null> {
    return this.session;
  }
  async saveSession(session: ScanSession): Promise<void> {
    this.session = session;
  }
  async clearSession(): Promise<void> {
    this.session = null;
  }
  async add(entry: QueueEntry): Promise<void> {
    this.entries.set(entry.clientId, entry);
  }
  async update(clientId: string, patch: QueuePatch): Promise<void> {
    const current = this.entries.get(clientId);
    if (current) this.entries.set(clientId, { ...current, ...patch, updatedAt: now() });
  }
  async list(eventId: string): Promise<QueueEntry[]> {
    return [...this.entries.values()].filter((e) => e.eventId === eventId).sort(byScannedAt);
  }
  async listPending(eventId: string): Promise<QueueEntry[]> {
    return (await this.list(eventId)).filter((e) => e.status === "pending");
  }
  async listPendingAll(): Promise<QueueEntry[]> {
    return [...this.entries.values()].filter((e) => e.status === "pending").sort(byScannedAt);
  }
  async counts(eventId: string): Promise<QueueCounts> {
    return countsOf(await this.list(eventId));
  }
  async usage(eventId: string): Promise<Map<string, LocalUsage>> {
    return usageOf(await this.list(eventId));
  }
}

/** Abre la cola: IndexedDB si se puede, memoria si no. */
export async function abrirCola(): Promise<ColaLocal> {
  if (typeof indexedDB === "undefined") return new ColaMemoria();
  try {
    return await ColaIndexedDb.open();
  } catch {
    return new ColaMemoria();
  }
}

/**
 * Una entrada nueva para la cola, lista para registrar, con el código del puesto en que se hizo. `qr` es el
 * texto leído: viaja con cada lectura, para que el servidor vuelva a comprobar la firma; solo falta en una
 * entrada marcada a mano en la puerta (`via: "manual"`). `at` es la hora de la lectura: el reloj de este celular
 * corregido con la hora del servidor, si se la conoce.
 */
export function nuevaEntrada(input: {
  eventId: string;
  stationId: string;
  code: string;
  action: ScanAction;
  passId: string;
  benefitId: string | null;
  scannerId: string;
  qr?: string;
  via?: "manual";
  at?: number;
}): QueueEntry {
  const at = input.at === undefined || !Number.isFinite(input.at) ? now() : new Date(input.at).toISOString();
  return {
    clientId: nuevoId(),
    eventId: input.eventId,
    stationId: input.stationId,
    code: input.code,
    action: input.action,
    passId: input.passId,
    benefitId: input.benefitId,
    scannedAt: at,
    scannerId: input.scannerId,
    ...(input.qr ? { qr: input.qr } : {}),
    ...(input.via ? { via: input.via } : {}),
    status: "pending",
    attempts: 0,
    lastError: null,
    txHash: null,
    // Con el reloj de este celular, sin corregir: la espera entre reintentos se mide con ese mismo reloj.
    updatedAt: now(),
  };
}

/** Un id al azar. randomUUID pide contexto seguro; si no está, alcanza con getRandomValues. */
export function nuevoId(): string {
  const webCrypto = globalThis.crypto as Crypto | undefined;
  if (webCrypto && typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (webCrypto) webCrypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cuánto esperar antes de volver a intentar un registro que falló: 10 s, 20 s, 40 s, hasta 2 minutos. */
export function listoParaReintentar(entry: QueueEntry, at = Date.now()): boolean {
  if (entry.attempts === 0) return true;
  const wait = Math.min(120_000, 10_000 * 2 ** (entry.attempts - 1));
  return at - new Date(entry.updatedAt).getTime() >= wait;
}

/** Lo pendiente de un puesto, que va junto al servidor con el código de ese puesto. */
export interface GrupoParaSincronizar {
  code: string;
  /** Si es el puesto abierto ahora: su respuesta trae la foto fresca que usa la pantalla. */
  actual: boolean;
  entries: QueueEntry[];
}

/**
 * Agrupa lo pendiente por el código del puesto en que se registró: cada registro viaja con su propio
 * código, porque el servidor solo acepta de un código de puerta entradas y de uno de mesa canjes de su
 * beneficio. Mandar lo de un puesto con el código de otro haría que se rechace para siempre. Un registro
 * sin código (de una versión anterior) va con el de la sesión si es de su mismo evento y puesto; si no,
 * espera a que se vuelva a abrir ese puesto. El grupo del puesto abierto va primero.
 */
export function agruparParaSincronizar(pendientes: QueueEntry[], sesion: { code: string; eventId: string; stationId: string }): GrupoParaSincronizar[] {
  const grupos = new Map<string, GrupoParaSincronizar>();
  const codigoSesion = normalizeStationCode(sesion.code);
  for (const entry of pendientes) {
    const esDeLaSesion = entry.eventId === sesion.eventId && entry.stationId === sesion.stationId;
    const code = entry.code ? normalizeStationCode(entry.code) : esDeLaSesion ? codigoSesion : null;
    if (!code) continue;
    const grupo = grupos.get(code) ?? { code, actual: code === codigoSesion, entries: [] };
    grupo.entries.push(entry);
    grupos.set(code, grupo);
  }
  return [...grupos.values()].sort((a, b) => Number(b.actual) - Number(a.actual));
}
