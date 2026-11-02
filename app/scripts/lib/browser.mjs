/**
 * Chrome headless por DevTools Protocol, sin dependencias.
 * Node 22+ trae WebSocket y fetch, así que no hace falta Puppeteer.
 *
 * Lo usan el smoke, todos los auditores y las capturas. Cada Chrome tiene su
 * perfil temporal, y `close()` lo borra cuando Chrome ya lo soltó: hay que
 * esperarlo (`await browser.close()`) antes de un process.exit.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.CHROME,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const chrome = CANDIDATES.find((p) => existsSync(p));
  if (!chrome) throw new Error("no encontré Chrome ni Edge; definí CHROME=<ruta>");
  return chrome;
}

/** Cliente mínimo del DevTools Protocol sobre un WebSocket. */
export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.consoleErrors = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.exceptions.push(d.exception?.description || d.text);
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
      }
    });
    // Si la página se cae, lo que estaba esperando su respuesta falla en vez
    // de quedarse esperando para siempre.
    ws.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("se cerró la conexión con la página"));
      this.pending.clear();
    });
  }

  /**
   * Manda un comando y espera la respuesta. Si la página deja de contestar,
   * falla a los `ms` milisegundos: el 5 de octubre de 2026 el auditor de
   * emoción se quedó hora y media esperando una respuesta que nunca llegó.
   */
  send(method, params = {}, ms = 300_000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: la página no contestó en ${ms / 1000} s`));
      }, ms);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
    });
  }

  /** Evalúa una expresión en la página y devuelve su valor. */
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
  }

  /** Espera a que la expresión sea verdadera. Devuelve si lo logró y cuánto tardó. */
  async waitFor(expression, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        if (await this.eval(`!!(${expression})`)) return { ok: true, elapsed: Date.now() - t0 };
      } catch {
        /* la página puede estar navegando */
      }
      await sleep(400);
    }
    return { ok: false, elapsed: Date.now() - t0 };
  }

  async screenshot(path) {
    const { writeFile } = await import("node:fs/promises");
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path, Buffer.from(data, "base64"));
  }
}

/**
 * Abre Chrome, devuelve `{ open(url), close() }`.
 * `open` entrega una CDP nueva por pestaña, ya navegada.
 */
/**
 * Los perfiles temporales de Chrome. Cada uno anota qué proceso de Node lo
 * creó, para que una corrida nueva pueda borrar los que quedaron de corridas
 * cortadas sin tocar los que otra auditoría está usando en paralelo.
 */
const PREFIJO = "rumbo-chrome-";
const DUENO = "rumbo-dueno";
const vivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/**
 * Borra los perfiles que dejaron corridas anteriores: los de un proceso que
 * ya no existe y, sin dueño anotado, los de más de una hora (los de antes de
 * este arreglo). Hasta cuarenta por vez, para que ninguna corrida tarde por
 * limpiar. Hasta el 5 de octubre de 2026 cada auditoría dejaba su perfil de
 * unos 60 MB: se habían juntado casi dos mil, más de 120 GB en el disco.
 */
function limpiarViejos() {
  let nombres = [];
  try {
    nombres = readdirSync(tmpdir()).filter((n) => n.startsWith(PREFIJO));
  } catch {
    return;
  }
  let borrados = 0;
  for (const n of nombres) {
    if (borrados >= 40) break;
    const dir = join(tmpdir(), n);
    try {
      let dueno = 0;
      try {
        dueno = Number(readFileSync(join(dir, DUENO), "utf8"));
      } catch {
        /* sin dueño anotado */
      }
      if (dueno ? vivo(dueno) : Date.now() - statSync(dir).mtimeMs < 3_600_000) continue;
      // Un Chrome que sigue vivo aunque su dueño murió tiene tomado el
      // `lockfile` del perfil (en Windows): borrarlo tira y el perfil queda
      // para la próxima. Sin esto se le sacaban archivos a un Chrome en uso.
      const lock = join(dir, "lockfile");
      if (existsSync(lock)) rmSync(lock);
      rmSync(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      borrados++;
    } catch {
      /* en uso: queda para la próxima */
    }
  }
}

/** ¿Ya hay un Chrome escuchando en ese puerto? */
async function puertoOcupado(port) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}

export async function launch({ port = Number(process.env.CDP_PORT || 9222), width = 1280, height = 900, args = [] } = {}) {
  limpiarViejos();
  // Con el puerto ya tomado (otra auditoría, o un Chrome que quedó suelto), la
  // espera de abajo se enganchaba a ese Chrome, que no es nuestro: cualquier
  // otra corrida podía borrarle el perfil y la página se cerraba a mitad de
  // camino (le pasó a una auditoría en paralelo el 19 de octubre de 2026).
  if (await puertoOcupado(port)) throw new Error(`el puerto ${port} ya tiene un Chrome: usá otro CDP_PORT`);
  const profile = mkdtempSync(join(tmpdir(), PREFIJO));
  writeFileSync(join(profile, DUENO), String(process.pid));
  const proc = spawn(
    findChrome(),
    [
      "--headless=new",
      // Con RUMBO_GPU=1 se usa la placa de video: el motor nuevo dibuja con
      // WebGL, y sin placa Chrome lo hace por software, a unos 17 cuadros por
      // segundo. Medir la fluidez así sería medir la computadora del auditor.
      ...(process.env.RUMBO_GPU === "1" ? ["--enable-gpu", "--ignore-gpu-blocklist"] : ["--disable-gpu"]),
      // Con RUMBO_SIN_WEBGL=1 el navegador no tiene WebGL, como un equipo
      // viejo: para comprobar que el sorteo cae solo al motor anterior.
      ...(process.env.RUMBO_SIN_WEBGL === "1" ? ["--disable-3d-apis"] : []),
      // El idioma de una persona de acá: sin esto el navegador sin interfaz
      // toma el del sistema, y la página elige idioma según el navegador.
      "--lang=es-BO",
      "--no-first-run",
      "--no-default-browser-check",
      // Sin esto el contexto de audio nace suspendido y no avanza su reloj: el
      // auditor de sonido mediría todas las notas en el instante cero. En una
      // sesión real el primer sonido sale de un clic, así que esto se parece
      // más a la verdad que lo contrario.
      "--autoplay-policy=no-user-gesture-required",
      // Y silenciado, porque con lo de arriba solo los seis juegos empiezan a
      // sonar de verdad por los parlantes de quien esté corriendo la auditoría.
      // Esto apaga la salida sin apagar el grafo de WebAudio: los osciladores
      // se siguen creando y el reloj del contexto sigue corriendo, que es lo
      // único que el auditor de sonido necesita.
      "--mute-audio",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      // Lo que pida quien llama (por ejemplo, una cámara de mentira para el escáner).
      ...args,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const salio = new Promise((r) => proc.once("exit", r));
  // Si el script termina sin cerrar (un error, un process.exit antes de
  // tiempo), Chrome no queda vivo. El perfil lo borra la corrida siguiente.
  const alSalir = () => {
    try {
      proc.kill();
    } catch {
      /* ya cerrado */
    }
  };
  process.once("exit", alSalir);

  /** Cierra Chrome, espera a que suelte los archivos y borra el perfil. */
  const cerrar = async () => {
    process.removeListener("exit", alSalir);
    try {
      proc.kill();
    } catch {
      /* ya cerrado */
    }
    // En Windows, borrar el perfil en el mismo instante en que se mata a
    // Chrome falla: todavía tiene archivos abiertos.
    await Promise.race([salio, sleep(5000)]);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch (e) {
      console.warn(`no se pudo borrar ${profile}: ${e.code}`);
    }
  };

  for (let i = 0; ; i++) {
    // Si el nuestro se cerró al arrancar, el que contestaría es de otro.
    if (proc.exitCode !== null) {
      await cerrar();
      throw new Error(`Chrome se cerró al arrancar (¿el puerto ${port} quedó tomado?)`);
    }
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {
      /* todavía no levantó */
    }
    if (i > 60) {
      await cerrar();
      throw new Error("Chrome no expuso DevTools");
    }
    await sleep(200);
  }

  const sockets = [];
  return {
    async open(url) {
      const target = await (
        await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
      ).json();
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((res, rej) => {
        ws.addEventListener("open", res);
        ws.addEventListener("error", rej);
      });
      sockets.push(ws);
      const cdp = new CDP(ws);
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      await cdp.send("Page.navigate", { url });
      return cdp;
    },
    /** Hay que esperarlo (`await browser.close()`) antes de un process.exit. */
    async close() {
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          /* ya cerrado */
        }
      }
      await cerrar();
    },
  };
}
