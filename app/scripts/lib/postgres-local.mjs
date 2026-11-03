// Un Postgres de verdad por la red, sin instalar nada: PGlite (Postgres compilado a WASM) servido por TCP con
// @electric-sql/pglite-socket. Sirve para probar el driver de producción (postgres, con prepare: false) y para
// que varios procesos compartan la misma base (el servidor de Next, el seed y el e2e), cosa que una carpeta de
// PGlite sola no permite. Es para pruebas: no es un servidor para producción.
//
// PGlite tiene una sola sesión. La fila de mensajes de la librería deja pasar a otra conexión entre el Parse y
// el Sync de una consulta, y con varias conexiones a la vez eso mezcla las consultas. Esta fila le da la sesión
// a una conexión hasta que Postgres contesta ReadyForQuery con la sesión libre ("I"): una consulta entera, o una
// transacción entera, sin que nadie se meta en el medio.
import { mkdirSync } from "node:fs";

const PGLITE = "@electric-sql/pglite";
const SOCKET = "@electric-sql/pglite-socket";

/** ReadyForQuery: 'Z', largo 5, y el estado ("I" libre, "T" en una transacción, "E" en una transacción que falló). */
const READY = 0x5a;
const IDLE = 0x49;

class SessionQueue {
  constructor(db) {
    this.db = db;
    this.queue = [];
    this.owner = null;
    this.processing = false;
  }

  enqueue(handlerId, message, onData) {
    return new Promise((resolve, reject) => {
      this.queue.push({ handlerId, message, onData, resolve, reject });
      void this.pump();
    });
  }

  async pump() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const index = this.owner === null ? 0 : this.queue.findIndex((item) => item.handlerId === this.owner);
        // La conexión que tiene la sesión todavía no mandó lo que sigue: las demás esperan.
        if (index < 0) break;
        const [item] = this.queue.splice(index, 1);
        let tail = new Uint8Array(0);
        let bytes = 0;
        try {
          await this.db.runExclusive(() =>
            this.db.execProtocolRawStream(item.message, {
              onRawData: (chunk) => {
                bytes += chunk.length;
                const joined = new Uint8Array(tail.length + chunk.length);
                joined.set(tail);
                joined.set(chunk, tail.length);
                tail = joined.slice(-6);
                item.onData(chunk);
              },
            }),
          );
        } catch (error) {
          item.reject(error);
          continue;
        }
        const ready = tail.length === 6 && tail[0] === READY && tail[4] === 5;
        this.owner = ready && tail[5] === IDLE ? null : item.handlerId;
        item.resolve(bytes);
      }
    } finally {
      this.processing = false;
    }
  }

  getQueueLength() {
    return this.queue.length;
  }

  clearQueueForHandler(handlerId) {
    this.queue = this.queue.filter((item) => {
      if (item.handlerId !== handlerId) return true;
      item.reject(new Error("La conexión se cerró"));
      return false;
    });
  }

  async clearTransactionIfNeeded(handlerId) {
    if (this.owner !== handlerId) return;
    if (this.db.isInTransaction()) await this.db.exec("ROLLBACK");
    this.owner = null;
    void this.pump();
  }
}

/**
 * Levanta el servidor. `dir` es la carpeta de la base (null: en memoria). Devuelve la cadena de conexión
 * (DATABASE_URL) y cómo apagarlo.
 */
export async function startLocalPostgres({ dir = null, port = 0, host = "127.0.0.1" } = {}) {
  const { PGlite } = await import(PGLITE);
  const { PGLiteSocketServer } = await import(SOCKET);
  if (dir) mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir ?? undefined);
  const server = new PGLiteSocketServer({ db, port, host, maxConnections: 64 });
  server.queryQueue = new SessionQueue(db);
  await server.start();
  const url = `postgres://postgres@${server.getServerConn()}/postgres`;
  return {
    url,
    server,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}
