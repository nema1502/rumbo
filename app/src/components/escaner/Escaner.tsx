"use client";
// El escáner del voluntario. Primero abre su puesto con el código que le dio quien organiza (hace
// falta red una vez): baja la llave del evento, su puesto y los pases. Después lee credenciales con
// la cámara o a mano y decide en el momento, sin red: verifica la firma con WebCrypto y mira lo que
// el servidor sabía y lo que este mismo escáner registró. Cada entrada o canje va a la cola local
// (src/lib/cola.ts) y, cuando hay red, a /api/scan/sync, que lo lleva al contrato.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Aviso, Boton, Campo, Chip, Pantalla } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";
import { abrirCola, listoParaReintentar, nuevaEntrada, nuevoId, type ColaLocal, type QueueCounts, type ScanSession } from "@/lib/cola.ts";
import { SYNC_BATCH_SIZE, decideVerdict, type ScanSnapshot, type ScanStation, type SyncResponse, type Verdict } from "@/lib/escaner-api.ts";
import { importQrKey, verifyQrPayloadInBrowser } from "@/lib/qr-verify.ts";
import { Camara, type CameraProblem } from "./Camara.tsx";
import { Veredicto } from "./Veredicto.tsx";

const SCANNER_ID_KEY = "rumbo.escaner";
/** Cada cuánto se intenta vaciar la cola cuando hay red. */
const SYNC_EVERY_MS = 5000;
/** Cada cuánto se vuelve a pedir la foto del evento aunque no haya nada pendiente (lo que registraron otros puestos). */
const REFRESH_EVERY_MS = 60000;
/** Dos lecturas iguales de la cámara dentro de este tiempo son la misma credencial frente al lente. */
const SAME_READ_MS = 4000;

type Fase = "cargando" | "elegir" | "escanear";

const EMPTY_COUNTS: QueueCounts = { pending: 0, synced: 0, duplicate: 0, rejected: 0 };

/** Un id de este celular, para que el panel sepa qué puesto registró cada cosa. */
function deviceId(): string {
  try {
    let id = localStorage.getItem(SCANNER_ID_KEY);
    if (!id) {
      id = nuevoId().slice(0, 8);
      localStorage.setItem(SCANNER_ID_KEY, id);
    }
    return id;
  } catch {
    return nuevoId().slice(0, 8);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<{ status: number; data: T | null }> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = response.headers.get("content-type")?.includes("json") ? ((await response.json()) as T) : null;
  return { status: response.status, data };
}

function vibrar(kind: Verdict["kind"]): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(kind === "ok" ? 80 : kind === "already" ? [60, 60, 60] : [40, 40, 40, 40, 40]);
  } catch {
    /* sin vibración */
  }
}

/**
 * Registra el service worker con alcance /scan y le pasa todo lo que la página ya cargó (la lista
 * de recursos del navegador: scripts, estilos, fuentes), para que la próxima vez abra sin red.
 */
function registrarServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("/sw.js", { scope: "/scan" })
    .then(async (registration) => {
      await navigator.serviceWorker.ready;
      const urls = new Set<string>([location.pathname + location.search, "/scan", "/scan/manifest.webmanifest", "/scan/icono-192.png"]);
      for (const entry of performance.getEntriesByType("resource")) {
        if (!entry.name.includes("/api/")) urls.add(entry.name);
      }
      document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => urls.add(s.src));
      document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet][href]").forEach((l) => urls.add(l.href));
      (registration.active ?? navigator.serviceWorker.controller)?.postMessage({ type: "warm", urls: [...urls] });
    })
    .catch(() => {
      /* sin service worker la página funciona igual, pero no abre sin red */
    });
}

export function Escaner() {
  const t = useT();
  const [fase, setFase] = useState<Fase>("cargando");
  const [cola, setCola] = useState<ColaLocal | null>(null);
  const [codigo, setCodigo] = useState("");
  const [errorAbrir, setErrorAbrir] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [sesion, setSesion] = useState<ScanSession | null>(null);
  const [conteo, setConteo] = useState<QueueCounts>(EMPTY_COUNTS);
  const [veredicto, setVeredicto] = useState<Verdict | null>(null);
  const [online, setOnline] = useState(true);
  const [simularOffline, setSimularOffline] = useState(false);
  const [fallaRed, setFallaRed] = useState(false);
  const [sesionInvalida, setSesionInvalida] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [modoTexto, setModoTexto] = useState(false);
  const [textoCredencial, setTextoCredencial] = useState("");
  const [camara, setCamara] = useState<"ok" | CameraProblem>("ok");

  const colaRef = useRef<ColaLocal | null>(null);
  const sesionRef = useRef<ScanSession | null>(null);
  const claveRef = useRef<CryptoKey | null>(null);
  const enLineaRef = useRef(true);
  const sincronizandoRef = useRef(false);
  const procesandoRef = useRef(false);
  const ultimaLecturaRef = useRef<{ texto: string; at: number } | null>(null);
  const ultimoRefreshRef = useRef(0);

  const puedeSincronizar = online && !simularOffline;
  enLineaRef.current = puedeSincronizar;
  const desconectado = !online || simularOffline || fallaRed;

  const refrescarLocal = useCallback(async () => {
    const c = colaRef.current;
    const s = sesionRef.current;
    if (!c || !s) return;
    setConteo(await c.counts(s.snapshot.event.id));
  }, []);

  const adoptarSesion = useCallback(
    async (nueva: ScanSession) => {
      sesionRef.current = nueva;
      setSesion(nueva);
      claveRef.current = await importQrKey(nueva.snapshot.key);
      await refrescarLocal();
    },
    [refrescarLocal],
  );

  const actualizarSnapshot = useCallback(async (snapshot: ScanSnapshot) => {
    const s = sesionRef.current;
    if (!s) return;
    const nueva: ScanSession = { ...s, snapshot, savedAt: new Date().toISOString() };
    sesionRef.current = nueva;
    setSesion(nueva);
    await colaRef.current?.saveSession(nueva);
  }, []);

  /**
   * Vacía la cola contra el servidor, de a pocos: cada registro es una transacción. Lo que vuelve
   * como "retry" espera a la próxima vuelta. Si no hay nada pendiente, cada tanto pide igual la foto
   * fresca del evento, para enterarse de lo que registraron los otros puestos.
   */
  const sincronizar = useCallback(
    async (forzarRefresh = false) => {
      const c = colaRef.current;
      const s = sesionRef.current;
      if (!c || !s || sincronizandoRef.current || !enLineaRef.current) return;
      const eventId = s.snapshot.event.id;
      const pendientes = (await c.listPending(eventId)).filter((e) => listoParaReintentar(e));
      const necesitaRefresh = forzarRefresh || Date.now() - ultimoRefreshRef.current > REFRESH_EVERY_MS;
      if (pendientes.length === 0 && !necesitaRefresh) return;
      sincronizandoRef.current = true;
      setSincronizando(true);
      try {
        let lote = pendientes.slice(0, SYNC_BATCH_SIZE);
        const hechos = new Set<string>();
        do {
          const { status, data } = await postJson<SyncResponse>("/api/scan/sync", {
            code: s.code,
            items: lote.map(({ clientId, action, passId, benefitId, scannedAt, scannerId }) => ({ clientId, action, passId, benefitId, scannedAt, scannerId })),
          });
          if (status === 401 || status === 404) {
            setSesionInvalida(true);
            break;
          }
          if (!data || status !== 200) throw new Error(`HTTP ${status}`);
          for (const result of data.results) {
            hechos.add(result.clientId);
            if (result.status === "retry") {
              const entry = lote.find((e) => e.clientId === result.clientId);
              await c.update(result.clientId, { attempts: (entry?.attempts ?? 0) + 1, lastError: result.error });
            } else {
              await c.update(result.clientId, { status: result.status, txHash: result.txHash, lastError: result.error });
            }
          }
          await actualizarSnapshot(data.snapshot);
          ultimoRefreshRef.current = Date.now();
          setFallaRed(false);
          setSesionInvalida(false);
          await refrescarLocal();
          lote = (await c.listPending(eventId)).filter((e) => !hechos.has(e.clientId) && listoParaReintentar(e)).slice(0, SYNC_BATCH_SIZE);
        } while (lote.length > 0 && enLineaRef.current);
      } catch {
        setFallaRed(true);
      } finally {
        sincronizandoRef.current = false;
        setSincronizando(false);
        await refrescarLocal();
      }
    },
    [actualizarSnapshot, refrescarLocal],
  );

  // Al cargar: la cola, y la sesión guardada si la hay (así abre sin red).
  useEffect(() => {
    let activo = true;
    registrarServiceWorker();
    void (async () => {
      const c = await abrirCola();
      if (!activo) return;
      colaRef.current = c;
      setCola(c);
      const guardada = await c.getSession();
      if (guardada) {
        await adoptarSesion(guardada);
        setFase("escanear");
      } else {
        setFase("elegir");
      }
    })();
    return () => {
      activo = false;
    };
  }, [adoptarSesion]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // La sincronización periódica, mientras el puesto está abierto y hay red.
  useEffect(() => {
    if (fase !== "escanear" || !puedeSincronizar) return;
    void sincronizar(true);
    const id = setInterval(() => void sincronizar(), SYNC_EVERY_MS);
    return () => clearInterval(id);
  }, [fase, puedeSincronizar, sincronizar]);

  async function abrirPuesto(event: FormEvent) {
    event.preventDefault();
    if (abriendo || !codigo.trim()) return;
    setAbriendo(true);
    setErrorAbrir(null);
    try {
      const code = codigo.trim().toUpperCase();
      const { status, data } = await postJson<ScanSnapshot>("/api/scan/open", { code });
      if (status === 401) return setErrorAbrir(t("escaner.codigoMal"));
      if (status === 429) return setErrorAbrir(t("escaner.demasiadosIntentos"));
      if (!data || status !== 200) return setErrorAbrir(t("escaner.errorRed"));
      const nueva: ScanSession = { code, scannerId: deviceId(), snapshot: data, savedAt: new Date().toISOString() };
      await colaRef.current?.saveSession(nueva);
      await adoptarSesion(nueva);
      ultimoRefreshRef.current = Date.now();
      setSesionInvalida(false);
      setFase("escanear");
    } catch {
      setErrorAbrir(t("escaner.errorRed"));
    } finally {
      setAbriendo(false);
    }
  }

  async function cerrarPuesto() {
    if (conteo.pending > 0 && !window.confirm(t("escaner.salirConPendientes", { n: conteo.pending }))) return;
    await colaRef.current?.clearSession();
    sesionRef.current = null;
    claveRef.current = null;
    setSesion(null);
    setConteo(EMPTY_COUNTS);
    setVeredicto(null);
    setSesionInvalida(false);
    setCodigo("");
    setFase("elegir");
  }

  /**
   * Una lectura, de la cámara o escrita: se verifica, se decide y, si corresponde, se encola.
   * La cámara ve la misma credencial muchos cuadros seguidos: esas repeticiones se ignoran un rato.
   */
  const procesarLectura = useCallback(
    async (texto: string, desdeCamara = false) => {
      const s = sesionRef.current;
      const c = colaRef.current;
      const key = claveRef.current;
      const limpio = texto.trim();
      if (!s || !c || !key || !limpio || procesandoRef.current) return;
      const ahora = Date.now();
      const ultima = ultimaLecturaRef.current;
      if (desdeCamara && ultima && ultima.texto === limpio && ahora - ultima.at < SAME_READ_MS) return;
      ultimaLecturaRef.current = { texto: limpio, at: ahora };
      procesandoRef.current = true;
      try {
        const verification = await verifyQrPayloadInBrowser(limpio, key);
        let snapshot = s.snapshot;
        let pass = verification.ok ? snapshot.passes.find((p) => p.id === verification.passId) : undefined;
        if (verification.ok && !pass && enLineaRef.current) {
          // Un pase que no estaba al abrir el puesto: con red, se pide la foto fresca una vez.
          try {
            const { status, data } = await postJson<ScanSnapshot>("/api/scan/open", { code: s.code });
            if (status === 200 && data) {
              await actualizarSnapshot(data);
              ultimoRefreshRef.current = Date.now();
              snapshot = data;
              pass = data.passes.find((p) => p.id === verification.passId);
            }
          } catch {
            /* sin red: se decide con lo que hay */
          }
        }
        const station = snapshot.station;
        const local = verification.ok ? (await c.usage(snapshot.event.id)).get(verification.passId) : undefined;
        const resultado = decideVerdict(verification, station, pass, local);
        if (resultado.kind === "ok") {
          await c.add(
            nuevaEntrada({
              eventId: snapshot.event.id,
              stationId: station.id,
              action: resultado.action,
              passId: resultado.passId,
              benefitId: station.kind === "benefit" ? station.id : null,
              scannerId: s.scannerId,
            }),
          );
          await refrescarLocal();
          setTimeout(() => void sincronizar(), 250);
        }
        vibrar(resultado.kind);
        setVeredicto(resultado);
      } finally {
        procesandoRef.current = false;
      }
    },
    [actualizarSnapshot, refrescarLocal, sincronizar],
  );

  const cerrarVeredicto = useCallback(() => setVeredicto(null), []);

  function enviarTexto(event: FormEvent) {
    event.preventDefault();
    const texto = textoCredencial;
    setTextoCredencial("");
    void procesarLectura(texto);
  }

  const nombrePuesto = (station: ScanStation) => (station.kind === "gate" ? t("escaner.puerta") : station.name);

  if (fase === "cargando") {
    return (
      <Pantalla titulo={t("escaner.titulo")}>
        <p className="apagado">{t("estado.cargando")}</p>
      </Pantalla>
    );
  }

  if (fase === "elegir" || !sesion) {
    return (
      <form onSubmit={abrirPuesto}>
        <Pantalla
          titulo={t("escaner.titulo")}
          bajada={t("escaner.bajada")}
          accion={
            <Boton type="submit" grande disabled={abriendo || !codigo.trim()}>
              {abriendo ? t("escaner.abriendo") : t("escaner.abrir")}
            </Boton>
          }
          nota={t("escaner.codigoAyuda")}
        >
          {!online && <Aviso tono="alerta">{t("escaner.sinRedParaAbrir")}</Aviso>}
          <Campo
            id="esc-codigo"
            className="esc-campo-codigo"
            etiqueta={t("escaner.codigo")}
            error={errorAbrir ?? undefined}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            maxLength={9}
            required
          />
        </Pantalla>
      </form>
    );
  }

  const { snapshot } = sesion;
  const puesto = snapshot.station;
  const sinCamara = camara !== "ok";
  const escribiendo = modoTexto || sinCamara;

  return (
    <section className="pantalla esc-pantalla">
      <header className="esc-cabecera">
        <p className="esc-evento-nombre chico apagado">{snapshot.event.name}</p>
        <h1 className="esc-puesto-titulo">{nombrePuesto(puesto)}</h1>
        {puesto.place && <p className="esc-puesto-lugar chico">{puesto.place}</p>}
        <div className="fila esc-chips" aria-live="polite">
          {desconectado && <Chip estado="alerta">{t("estado.sinConexion")}</Chip>}
          {conteo.pending > 0 ? (
            <Chip estado="pendiente">{t(conteo.pending === 1 ? "escaner.pendiente1" : "escaner.pendientes", { n: conteo.pending })}</Chip>
          ) : (
            !desconectado && <Chip estado="listo">{t("escaner.alDia")}</Chip>
          )}
          {conteo.duplicate > 0 && <Chip estado="ganado">{t(conteo.duplicate === 1 ? "escaner.doble1" : "escaner.dobles", { n: conteo.duplicate })}</Chip>}
          {conteo.rejected > 0 && <Chip estado="alerta">{t(conteo.rejected === 1 ? "escaner.rechazado1" : "escaner.rechazados", { n: conteo.rejected })}</Chip>}
          {sincronizando && <span className="chico apagado">{t("escaner.sincronizando")}</span>}
        </div>
      </header>

      <div className="pantalla-cuerpo esc-cuerpo">
        {sesionInvalida && (
          <Aviso tono="alerta">
            {t("escaner.puestoCerrado")}{" "}
            <button type="button" className="enlace" onClick={() => void cerrarPuesto()}>
              {t("escaner.salir")}
            </button>
          </Aviso>
        )}
        {escribiendo ? (
          <form className="esc-texto" onSubmit={enviarTexto}>
            {sinCamara && <Aviso tono="alerta">{t(camara === "permiso" ? "escaner.camaraPermiso" : "escaner.camaraNo")}</Aviso>}
            <Campo
              id="esc-credencial"
              etiqueta={t("escaner.codigoCredencial")}
              ayuda={t("escaner.codigoCredencialAyuda")}
              value={textoCredencial}
              onChange={(e) => setTextoCredencial(e.target.value)}
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            <Boton type="submit" grande disabled={!textoCredencial.trim()}>
              {t("escaner.verificar")}
            </Boton>
          </form>
        ) : (
          <>
            <Camara activa={!veredicto} etiqueta={t("escaner.apunta")} onLectura={(texto) => void procesarLectura(texto, true)} onError={setCamara} />
            <p className="esc-ayuda apagado chico">{t("escaner.apunta")}</p>
          </>
        )}

        <div className="esc-acciones">
          {!sinCamara && (
            <Boton variante="secundario" onClick={() => setModoTexto((m) => !m)}>
              {modoTexto ? t("escaner.usarCamara") : t("escaner.escribir")}
            </Boton>
          )}
          <label className="esc-switch">
            <input type="checkbox" role="switch" checked={simularOffline} onChange={(e) => setSimularOffline(e.target.checked)} />
            <span className="esc-switch-pista" aria-hidden="true" />
            <span>{t("escaner.simular")}</span>
          </label>
        </div>

        {cola && !cola.persistent && <Aviso>{t("escaner.sinPersistencia")}</Aviso>}

        <div className="fila esc-pie">
          <button type="button" className="enlace" onClick={() => void cerrarPuesto()}>
            {t("escaner.salir")}
          </button>
        </div>
      </div>

      {veredicto && <Veredicto veredicto={veredicto} puesto={puesto} timezone={snapshot.event.timezone} onCerrar={cerrarVeredicto} />}
    </section>
  );
}
