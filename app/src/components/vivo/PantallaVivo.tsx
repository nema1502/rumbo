"use client";
// La pantalla en vivo: grande, oscura y con letra enorme, para proyectar. Tres cifras (quienes entraron, los
// almuerzos y la merch entregados), el ranking de la ruta de stands y el espacio del sorteo. Pide los números
// cada tres segundos mientras la pestaña está a la vista. Nunca muestra correos: el ranking usa el nombre de
// pila o el alias que cada persona eligió. La lista del sorteo se congela desde acá: desde ese momento la que
// se proyecta (con su huella) es la que se sortea, aunque alguien entre después. La misma pantalla tiene dos
// modos (src/lib/pantalla.ts): quien organiza, con su clave del panel, ve además el enlace para el proyector y
// maneja el sorteo; el proyector, con ese enlace, solo mira: sin botones ni enlaces al panel.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LogoRumbo } from "@/components/Marca.tsx";
import { BotonCopiar } from "@/components/panel/BotonCopiar.tsx";
import { useLang, useT } from "@/i18n/client.tsx";
import { LANG_QUERY, formatDate, otherLang } from "@/i18n/index.ts";
import { SCREEN_KEY_QUERY, type ScreenAccess } from "@/lib/pantalla.ts";
import type { LiveState, LiveTally } from "@/server/vivo.ts";

const POLL_MS = 3000;
const MAX_FILAS = 8;
const MIN_FILAS = 3;

type Conexion = "ok" | "sinConexion" | "vencida";

export function PantallaVivo({ slug, initial, acceso }: { slug: string; initial: LiveState; acceso: ScreenAccess }) {
  const t = useT();
  const lang = useLang();
  const pathname = usePathname();
  const proyector = acceso.kind === "screen";
  // El JSON se pide con lo mismo que abrió la página: la cookie del panel, o la clave del enlace del proyector.
  const apiUrl = acceso.kind === "screen" ? `/api/vivo/${slug}?${SCREEN_KEY_QUERY}=${encodeURIComponent(acceso.key)}` : `/api/vivo/${slug}`;
  const [vivo, setVivo] = useState<LiveState>(initial);
  const [conexion, setConexion] = useState<Conexion>("ok");
  const [incluirTodos, setIncluirTodos] = useState(false);
  const [cambiandoLista, setCambiandoLista] = useState(false);
  const [errorLista, setErrorLista] = useState(false);
  // El enlace para el proyector, que solo ve quien organiza: se arma con el origen del navegador y se puede cambiar.
  const [screenKey, setScreenKey] = useState(acceso.kind === "organizer" ? acceso.screenKey : "");
  const [origin, setOrigin] = useState("");
  const [cambiandoEnlace, setCambiandoEnlace] = useState(false);
  const [errorEnlace, setErrorEnlace] = useState(false);
  // El enlace se muestra en un diálogo: la grilla de la pantalla mide lo mismo con él abierto o cerrado.
  const dialogoRef = useRef<HTMLDialogElement>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  // Cuántas filas del ranking entran en el alto que sobra: la pantalla no se desplaza, se muestran las que caben.
  const cajaRef = useRef<HTMLDivElement>(null);
  const [filas, setFilas] = useState(MAX_FILAS);

  useLayoutEffect(() => {
    const caja = cajaRef.current;
    if (!caja) return;
    const medir = () => {
      const fila = caja.querySelector("li");
      // En pantallas angostas la caja no limita el alto (se desplaza la página): se muestran todas.
      if (!fila || getComputedStyle(caja).overflowY === "visible") return setFilas(MAX_FILAS);
      const alto = fila.getBoundingClientRect().height;
      if (alto > 0) setFilas(Math.max(MIN_FILAS, Math.min(MAX_FILAS, Math.floor((caja.clientHeight + 1) / alto))));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caja);
    return () => observador.disconnect();
  }, [vivo.route.ranking.length]);

  const traer = useCallback(async () => {
    try {
      const res = await fetch(apiUrl, { cache: "no-store" });
      if (res.status === 401) return setConexion("vencida");
      if (!res.ok) throw new Error(String(res.status));
      setVivo((await res.json()) as LiveState);
      setConexion("ok");
    } catch {
      setConexion((actual) => (actual === "vencida" ? actual : "sinConexion"));
    }
  }, [apiUrl]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void traer();
    }, POLL_MS);
    const alVolver = () => {
      if (!document.hidden) void traer();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [traer]);

  /** Congela la lista del sorteo de este momento, o vuelve a la viva. Después se vuelven a pedir los números. */
  async function cambiarLista(action: "freeze" | "thaw") {
    setCambiandoLista(true);
    setErrorLista(false);
    try {
      const res = await fetch(`/api/vivo/${slug}/sorteo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "freeze" ? { action, all: incluirTodos } : { action }),
      });
      if (res.status === 401) return setConexion("vencida");
      if (!res.ok) throw new Error(String(res.status));
      await traer();
    } catch {
      setErrorLista(true);
    } finally {
      setCambiandoLista(false);
    }
  }

  /** Un enlace de proyector nuevo: el de antes deja de servir en el acto. */
  async function cambiarEnlace() {
    if (!window.confirm(t("vivo.proyector.confirmarCambiar"))) return;
    setCambiandoEnlace(true);
    setErrorEnlace(false);
    try {
      const res = await fetch(`/api/vivo/${slug}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "screen-link" }) });
      if (res.status === 401) return setConexion("vencida");
      if (!res.ok) throw new Error(String(res.status));
      setScreenKey(((await res.json()) as { screenKey: string }).screenKey);
    } catch {
      setErrorEnlace(true);
    } finally {
      setCambiandoEnlace(false);
    }
  }

  const { event, route, raffle } = vivo;
  const lugar = event.venue ? `${event.venue}, ${event.place}` : event.place;
  const enlaceProyector = `${origin}/vivo/${slug}?${SCREEN_KEY_QUERY}=${screenKey}`;
  // Al cambiar de idioma, el proyector conserva su clave en el enlace.
  const cambioIdioma = new URLSearchParams(acceso.kind === "screen" ? { [SCREEN_KEY_QUERY]: acceso.key, [LANG_QUERY]: otherLang(lang) } : { [LANG_QUERY]: otherLang(lang) }).toString();
  const meta = route.target ?? route.standCount;
  const congelada = raffle.frozen;
  const participan = congelada ? congelada.total : raffle.eligible;
  const todos = congelada ? "" : incluirTodos ? "?todos=1" : "";

  return (
    <div className="vivo" data-tema="noche">
      <header className="viv-cabecera">
        <div className="viv-marca">
          <LogoRumbo />
          <span>Rumbo</span>
        </div>
        <div className="viv-evento">
          <h1>{event.name}</h1>
          <p>
            {formatDate(lang, event.startsAt, event.timezone)}, {lugar}
          </p>
        </div>
        <div className="viv-estado">
          {conexion === "ok" && (
            <span className="viv-chip viv-chip-vivo">
              <span className="viv-punto" aria-hidden="true" />
              {t("vivo.enVivo")}
            </span>
          )}
          {conexion === "sinConexion" && <span className="viv-chip viv-chip-alerta">{t("estado.sinConexion")}</span>}
          {conexion === "vencida" &&
            (proyector ? (
              <span className="viv-chip viv-chip-alerta">{t("vivo.proyector.vencido")}</span>
            ) : (
              <Link className="viv-chip viv-chip-alerta" href={`/admin/${slug}`}>
                {t("vivo.sesionVencida")}
              </Link>
            ))}
          <a className="viv-enlace" href={`${pathname}?${cambioIdioma}`} hrefLang={otherLang(lang)} aria-label={t("nav.idiomaAria")}>
            {t("nav.idioma")}
          </a>
          {!proyector && (
            <>
              <button type="button" className="viv-enlace viv-enlace-boton" onClick={() => dialogoRef.current?.showModal()}>
                {t("vivo.proyector.titulo")}
              </button>
              <Link className="viv-enlace" href={`/admin/${slug}`}>
                {t("vivo.volver")}
              </Link>
            </>
          )}
        </div>
      </header>

      <section className="viv-cifras" aria-label={t("vivo.titulo")}>
        <Cifra
          etiqueta={t("vivo.entraron")}
          valor={vivo.entered}
          detalle={vivo.capacity ? t("vivo.deCupo", { total: vivo.capacity }) : t("vivo.deTotal", { total: vivo.issued })}
          tono="verde"
          total={vivo.capacity ?? vivo.issued}
        />
        <Entregas etiqueta={t("vivo.almuerzos")} tally={vivo.lunch} />
        <Entregas etiqueta={t("vivo.merch")} tally={vivo.merch} tono="amarillo" />
      </section>

      <div className="viv-columnas">
        <section className="viv-tarjeta viv-ruta" aria-labelledby="viv-ruta-titulo">
          <div className="viv-tarjeta-cabecera">
            <h2 id="viv-ruta-titulo">{t("vivo.ruta.titulo")}</h2>
            {route.enabled && <p>{route.target !== null ? t("vivo.ruta.meta", { meta: route.target, total: route.standCount }) : t("vivo.ruta.sinMeta", { total: route.standCount })}</p>}
          </div>
          {!route.enabled ? (
            <p className="viv-vacio">{t("vivo.ruta.sinStands")}</p>
          ) : route.ranking.length === 0 ? (
            <p className="viv-vacio">{t("vivo.ruta.vacio")}</p>
          ) : (
            <div className="viv-ranking-caja" ref={cajaRef}>
            <ol className="viv-ranking">
              {route.ranking.slice(0, filas).map((row) => (
                <li key={row.rank} className={row.completed ? "viv-completo" : undefined}>
                  <span className="viv-puesto">{row.rank}</span>
                  <span className="viv-nombre">{row.label ?? t("vivo.anonimo")}</span>
                  <span className="viv-avance" role="img" aria-label={t("vivo.ruta.avance", { n: Math.min(row.visited, meta), meta })}>
                    {Array.from({ length: meta }, (_, i) => (
                      <span key={i} className={i < row.visited ? "viv-hito viv-hito-lleno" : "viv-hito"} />
                    ))}
                  </span>
                  {row.completed ? <span className="viv-chip viv-chip-ganado">{t("vivo.ruta.completo")}</span> : <span className="viv-cuenta">{t("vivo.ruta.avance", { n: row.visited, meta })}</span>}
                </li>
              ))}
            </ol>
            </div>
          )}
          {route.enabled && route.target !== null && <p className="viv-pie">{t("vivo.ruta.completaron", { n: route.completed })}</p>}
        </section>

        <section className="viv-tarjeta viv-sorteo" aria-labelledby="viv-sorteo-titulo">
          <div className="viv-tarjeta-cabecera">
            <h2 id="viv-sorteo-titulo">{t("vivo.sorteo.titulo")}</h2>
          </div>
          <div className="viv-sorteo-fila">
            <p className="viv-sorteo-cifra" key={participan}>
              {participan}
            </p>
            <p className="viv-sorteo-texto">{participan === 0 ? t("vivo.sorteo.ninguna") : t(participan === 1 ? "vivo.sorteo.participa1" : "vivo.sorteo.participan")}</p>
          </div>
          {congelada ? (
            <div className="viv-congelada" aria-live="polite">
              <p className="viv-congelada-texto">
                {t(congelada.total === 1 ? "vivo.sorteo.congelada1" : "vivo.sorteo.congelada", { hora: formatDate(lang, congelada.at, event.timezone, { hour: "2-digit", minute: "2-digit" }), n: congelada.total })}
              </p>
              <p className="viv-huella">
                <span className="viv-huella-etiqueta">{t("vivo.sorteo.huella")}</span> <code>{congelada.sha256}</code>
              </p>
              <p className="viv-pie">{t("vivo.sorteo.notaCongelada")}</p>
            </div>
          ) : proyector ? null : (
            <label className="viv-opcion">
              <input type="checkbox" checked={incluirTodos} onChange={(e) => setIncluirTodos(e.target.checked)} disabled={cambiandoLista} />
              <span>{t("vivo.sorteo.todos")}</span>
            </label>
          )}
          {/* El proyector solo mira: congelar, descongelar y exportar son de quien organiza */}
          {!proyector && (
            <div className="viv-acciones">
              {congelada ? (
                <button type="button" className="viv-enlace viv-enlace-chico viv-enlace-boton" onClick={() => void cambiarLista("thaw")} disabled={cambiandoLista}>
                  {t("vivo.sorteo.descongelar")}
                </button>
              ) : (
                <button type="button" className="viv-boton" onClick={() => void cambiarLista("freeze")} disabled={cambiandoLista}>
                  {cambiandoLista ? t("vivo.sorteo.congelando") : t("vivo.sorteo.congelar")}
                </button>
              )}
              <a className={congelada ? "viv-boton" : "viv-enlace viv-enlace-chico"} href={`/api/vivo/${slug}/sorteo${todos}`} download>
                {t("vivo.sorteo.exportar")}
              </a>
              <a className="viv-enlace viv-enlace-chico" href={`/api/vivo/${slug}/sorteo?formato=csv${todos ? "&todos=1" : ""}`} download>
                {t("vivo.sorteo.csv")}
              </a>
            </div>
          )}
          {errorLista && <p className="viv-chip viv-chip-alerta">{t("vivo.sorteo.error")}</p>}
          <p className="viv-pie">{congelada ? t("vivo.sorteo.nota") : `${t("vivo.sorteo.soloAsistentes")} ${t("vivo.sorteo.nota")}`}</p>
        </section>
      </div>

      <p className="viv-actualiza">{conexion === "sinConexion" ? t("vivo.sinConexion") : t("vivo.actualiza")}</p>

      {/* El enlace para el proyector, solo para quien organiza: en un diálogo, para que no quede a la vista si esta pantalla se proyecta */}
      {acceso.kind === "organizer" && (
        <dialog
          ref={dialogoRef}
          className="viv-dialogo"
          aria-labelledby="viv-proyector-titulo"
          onClick={(e) => {
            if (e.target === e.currentTarget) e.currentTarget.close();
          }}
        >
          <div className="viv-dialogo-caja">
            <h2 id="viv-proyector-titulo">{t("vivo.proyector.titulo")}</h2>
            <p>{t("vivo.proyector.ayuda")}</p>
            <p className="viv-proyector-enlace">
              <code>{enlaceProyector}</code>
            </p>
            <div className="viv-acciones">
              <BotonCopiar texto={enlaceProyector} etiqueta={t("vivo.proyector.copiar")} listo={t("vivo.proyector.copiado")} aria-label={t("vivo.proyector.copiarAria")} />
              <button type="button" className="viv-enlace viv-enlace-chico viv-enlace-boton" onClick={() => void cambiarEnlace()} disabled={cambiandoEnlace}>
                {t("vivo.proyector.cambiar")}
              </button>
              <button type="button" className="viv-enlace viv-enlace-chico viv-enlace-boton" onClick={() => dialogoRef.current?.close()}>
                {t("vivo.proyector.cerrar")}
              </button>
            </div>
            {errorEnlace && <p className="viv-chip viv-chip-alerta">{t("vivo.proyector.error")}</p>}
          </div>
        </dialog>
      )}
    </div>
  );
}

function Cifra({ etiqueta, valor, detalle, tono, total }: { etiqueta: string; valor: number; detalle: string; tono: "verde" | "amarillo"; total: number }) {
  const porcentaje = total > 0 ? Math.min(100, Math.round((valor / total) * 100)) : 0;
  return (
    <div className={`viv-cifra viv-cifra-${tono}`} role="group" aria-label={etiqueta}>
      <span className="viv-cifra-etiqueta">{etiqueta}</span>
      <span className="viv-cifra-valor" key={valor}>
        {valor}
      </span>
      <span className="viv-cifra-detalle">{detalle}</span>
      <div className="viv-barra" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={valor}>
        <span style={{ width: `${porcentaje}%` }} />
      </div>
    </div>
  );
}

function Entregas({ etiqueta, tally, tono = "verde" }: { etiqueta: string; tally: LiveTally; tono?: "verde" | "amarillo" }) {
  const t = useT();
  return <Cifra etiqueta={etiqueta} valor={tally.delivered} detalle={tally.granted > 0 ? t("vivo.de", { total: tally.granted }) : t("vivo.ninguno")} tono={tono} total={tally.granted} />;
}
