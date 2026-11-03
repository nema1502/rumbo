"use client";
// La pantalla en vivo: grande, oscura y con letra enorme, para proyectar. Tres cifras (quienes entraron, los
// almuerzos y la merch entregados), el ranking de la ruta de stands y el espacio del sorteo. Pide los números
// cada tres segundos mientras la pestaña está a la vista. Nunca muestra correos: el ranking usa el nombre de
// pila o el alias que cada persona eligió.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LogoRumbo } from "@/components/Marca.tsx";
import { useLang, useT } from "@/i18n/client.tsx";
import { LANG_QUERY, formatDate, otherLang } from "@/i18n/index.ts";
import type { LiveState, LiveTally } from "@/server/vivo.ts";

const POLL_MS = 3000;
const MAX_FILAS = 8;
const MIN_FILAS = 3;

type Conexion = "ok" | "sinConexion" | "vencida";

export function PantallaVivo({ slug, initial }: { slug: string; initial: LiveState }) {
  const t = useT();
  const lang = useLang();
  const pathname = usePathname();
  const [vivo, setVivo] = useState<LiveState>(initial);
  const [conexion, setConexion] = useState<Conexion>("ok");
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
      const res = await fetch(`/api/vivo/${slug}`, { cache: "no-store" });
      if (res.status === 401) return setConexion("vencida");
      if (!res.ok) throw new Error(String(res.status));
      setVivo((await res.json()) as LiveState);
      setConexion("ok");
    } catch {
      setConexion((actual) => (actual === "vencida" ? actual : "sinConexion"));
    }
  }, [slug]);

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

  const { event, route, raffle } = vivo;
  const lugar = event.venue ? `${event.venue}, ${event.place}` : event.place;
  const meta = route.target ?? route.standCount;

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
          {conexion === "vencida" && (
            <Link className="viv-chip viv-chip-alerta" href={`/admin/${slug}`}>
              {t("vivo.sesionVencida")}
            </Link>
          )}
          <a className="viv-enlace" href={`${pathname}?${LANG_QUERY}=${otherLang(lang)}`} hrefLang={otherLang(lang)} aria-label={t("nav.idiomaAria")}>
            {t("nav.idioma")}
          </a>
          <Link className="viv-enlace" href={`/admin/${slug}`}>
            {t("vivo.volver")}
          </Link>
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
            <p className="viv-sorteo-cifra" key={raffle.eligible}>
              {raffle.eligible}
            </p>
            <p className="viv-sorteo-texto">{raffle.eligible === 0 ? t("vivo.sorteo.ninguna") : t(raffle.eligible === 1 ? "vivo.sorteo.participa1" : "vivo.sorteo.participan")}</p>
          </div>
          <div className="viv-acciones">
            <a className="viv-boton" href={`/api/vivo/${slug}/sorteo`} download>
              {t("vivo.sorteo.exportar")}
            </a>
            <a className="viv-enlace viv-enlace-chico" href={`/api/vivo/${slug}/sorteo?formato=csv`} download>
              {t("vivo.sorteo.csv")}
            </a>
          </div>
          <p className="viv-pie">{t("vivo.sorteo.nota")}</p>
        </section>
      </div>

      <p className="viv-actualiza">{conexion === "sinConexion" ? t("vivo.sinConexion") : t("vivo.actualiza")}</p>
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
