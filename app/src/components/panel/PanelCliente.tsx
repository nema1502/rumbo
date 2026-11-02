"use client";
// El panel en vivo: pinta el estado que le dio el servidor y lo vuelve a pedir cada cinco segundos
// (cuando la pestaña está a la vista). "Verificar el registro del evento" contrasta el espejo con el
// contrato y trae lo que falte.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Aviso, Boton, BotonEnlace, Chip, Tarjeta } from "@/components/ui.tsx";
import { useLang, useT } from "@/i18n/client.tsx";
import { formatDate, type Lang } from "@/i18n/index.ts";
import { formatStationCode } from "@/lib/station-code.ts";
import type { ChainSyncSummary, PanelPass, PanelState } from "@/server/panel.ts";
import { BotonCopiar } from "./BotonCopiar.tsx";
import { Contador } from "./Contador.tsx";

const POLL_MS = 5000;
const LOCALES: Record<Lang, string> = { es: "es-BO", en: "en-US" };

type Conexion = "ok" | "sinConexion" | "vencida";

interface EstadoCadena {
  busy: boolean;
  result: ChainSyncSummary | null;
  error: string | null;
}

/** La hora, con segundos, en el reloj de quien mira el panel. */
function hora(lang: Lang, iso: string): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: lang === "es" ? "h23" : "h12" }).format(new Date(iso));
}

/** Día y hora cortos, en el reloj de quien mira el panel. */
function fechaHora(lang: Lang, iso: string): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: lang === "es" ? "h23" : "h12" }).format(new Date(iso));
}

export function PanelCliente({ slug, initial }: { slug: string; initial: PanelState }) {
  const t = useT();
  const lang = useLang();
  const [state, setState] = useState<PanelState>(initial);
  const [conexion, setConexion] = useState<Conexion>("ok");
  const [cadena, setCadena] = useState<EstadoCadena>({ busy: false, result: initial.lastChainSync, error: null });
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/${slug}`, { cache: "no-store" });
      if (res.status === 401) {
        setConexion("vencida");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setState((await res.json()) as PanelState);
      setConexion("ok");
    } catch {
      setConexion((actual) => (actual === "vencida" ? actual : "sinConexion"));
    }
  }, [slug]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void refetch();
    }, POLL_MS);
    const alVolver = () => {
      if (!document.hidden) void refetch();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [refetch]);

  async function actualizarDesdeCadena() {
    setCadena((actual) => ({ ...actual, busy: true, error: null }));
    try {
      const res = await fetch(`/api/admin/${slug}/cadena`, { method: "POST" });
      if (res.status === 401) {
        setConexion("vencida");
        setCadena((actual) => ({ ...actual, busy: false }));
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { sync: ChainSyncSummary; state: PanelState };
      setState(data.state);
      setCadena({ busy: false, result: data.sync, error: null });
    } catch {
      setCadena((actual) => ({ ...actual, busy: false, error: t("panel.cadena.error") }));
    }
  }

  const q = query.trim().toLowerCase();
  const visibles = useMemo(
    () => (q ? state.passes.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : state.passes),
    [state.passes, q],
  );
  const nombreDe = (passId: string) => state.passes.find((p) => p.id === passId)?.name ?? passId;

  const { counters, event } = state;
  const lugar = event.venue ? `${event.venue}, ${event.place}` : event.place;

  return (
    <section className="panel">
      <header className="panel-cabecera">
        <p className="panel-sobre">
          <span>{t("panel.titulo")}</span>
          {conexion === "ok" && <Chip estado="listo">{t("panel.enVivo")}</Chip>}
          {conexion === "sinConexion" && <Chip estado="alerta">{t("estado.sinConexion")}</Chip>}
          {conexion === "vencida" && <Chip estado="alerta">{t("panel.sesionVencidaCorta")}</Chip>}
          <span className="apagado chico" suppressHydrationWarning>
            {t("panel.actualizado", { hora: hora(lang, state.generatedAt) })}
          </span>
          {state.pendingSync > 0 && <Chip estado="pendiente">{t("panel.porSincronizar", { n: state.pendingSync })}</Chip>}
        </p>
        <h1>{event.name}</h1>
        <p className="bajada">
          {formatDate(lang, event.startsAt, event.timezone)}, {lugar}. {t("panel.bajada")}
        </p>
      </header>

      {conexion === "vencida" && (
        <Aviso tono="alerta">
          {t("panel.sesionVencida")}{" "}
          <Link className="enlace" href={`/admin/${slug}`}>
            {t("panel.volverAEntrar")}
          </Link>
        </Aviso>
      )}
      {conexion === "sinConexion" && <Aviso tono="alerta">{t("panel.sinConexion")}</Aviso>}

      <div className="contadores">
        <Contador
          etiqueta={t("panel.contador.credenciales")}
          valor={counters.issued}
          total={counters.capacity}
          detalle={counters.capacity ? t("panel.contador.deCupo", { total: counters.capacity }) : t("panel.contador.sinCupo")}
          extra={counters.pending > 0 ? t("panel.contador.pendientesDePago", { n: counters.pending }) : undefined}
        />
        <Contador
          etiqueta={t("panel.contador.entraron")}
          valor={counters.checkedIn}
          total={counters.issued}
          detalle={t("panel.contador.de", { total: counters.issued })}
          tono="verde"
        />
        <Contador
          etiqueta={t("panel.contador.almuerzos")}
          valor={counters.lunch.redeemed}
          total={counters.lunch.granted}
          detalle={counters.lunch.granted > 0 ? t("panel.contador.de", { total: counters.lunch.granted }) : t("panel.contador.ninguno")}
          tono="verde"
        />
        <Contador
          etiqueta={t("panel.contador.premios")}
          valor={counters.prizes.redeemed}
          total={counters.prizes.granted}
          detalle={counters.prizes.granted > 0 ? t("panel.contador.de", { total: counters.prizes.granted }) : t("panel.contador.ninguno")}
          tono="amarillo"
        />
      </div>

      <DetalleCadena cadena={cadena} nombreDe={nombreDe} />

      <div className="panel-columnas">
        <Tarjeta>
          <h2>{t("panel.puestos.titulo")}</h2>
          <p className="chico">{t("panel.puestos.bajada")}</p>
          <ul className="puestos">
            {state.stations.map((station) => {
              const puesto = station.kind === "gate" ? t("panel.puestos.puerta") : (station.benefitName ?? "");
              const codigo = formatStationCode(station.code);
              return (
                <li key={station.code} className="puesto">
                  <div>
                    <span className="puesto-nombre">{puesto}</span>
                    {station.station && <span className="puesto-donde">{station.station}</span>}
                  </div>
                  <span className="codigo">{codigo}</span>
                  <BotonCopiar
                    texto={t("panel.puestos.mensaje", { puesto, evento: event.name, url: `${origin}/scan`, codigo })}
                    etiqueta={t("panel.puestos.copiar")}
                    listo={t("panel.puestos.copiado")}
                    aria-label={t("panel.puestos.copiarAria", { puesto })}
                  />
                </li>
              );
            })}
          </ul>
        </Tarjeta>

        <Tarjeta>
          <h2>
            {t("panel.dobles.titulo")}
            {state.duplicates.length > 0 && ` (${state.duplicates.length})`}
          </h2>
          <p className="chico">{t("panel.dobles.bajada")}</p>
          {state.duplicates.length === 0 ? (
            <p className="apagado chico">{t("panel.dobles.vacio")}</p>
          ) : (
            <ul className="dobles">
              {state.duplicates.map((d) => (
                <li key={d.id} className="doble">
                  <Chip estado="alerta">{t("estado.doble")}</Chip>
                  <span className="doble-quien">{d.name}</span>
                  <span className="doble-que">{d.kind === "checkin" ? t("panel.dobles.entrada") : d.benefitName}</span>
                  <span className="apagado chico" suppressHydrationWarning>
                    {fechaHora(lang, d.scannedAt)}
                    {d.scannerId ? `, ${t("panel.dobles.escaner", { id: d.scannerId })}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>

      <section className="panel-seccion">
        <div className="pases-cabecera">
          <h2>
            {t("panel.pases.titulo")} ({state.passes.length})
          </h2>
          <div className="campo">
            <label className="oculto-visual" htmlFor="buscar-pase">
              {t("panel.pases.buscar")}
            </label>
            <input id="buscar-pase" type="search" placeholder={t("panel.pases.buscar")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="fila">
            <a className="boton boton-secundario boton-chico" href={`/api/admin/${slug}/csv`} download>
              {t("panel.pases.exportar")}
            </a>
            <BotonEnlace variante="secundario" className="boton-chico" href={`/admin/${slug}/informe`}>
              {t("panel.pases.informe")}
            </BotonEnlace>
          </div>
        </div>
        {state.passes.length === 0 ? (
          <Aviso>{t("panel.pases.vacio")}</Aviso>
        ) : visibles.length === 0 ? (
          <p className="apagado">{t("panel.pases.sinResultados")}</p>
        ) : (
          <ul className="tabla-pases">
            {visibles.map((pass) => (
              <FilaPase key={pass.id} pass={pass} />
            ))}
          </ul>
        )}
      </section>

      <form className="panel-salir" method="post" action={`/api/admin/${slug}/salir`}>
        <button type="submit" className="enlace">
          {t("panel.acceso.salir")}
        </button>
      </form>

      <div className="panel-accion">
        <p className="panel-accion-estado" suppressHydrationWarning>
          {cadena.result ? t("panel.cadena.ultima", { fecha: fechaHora(lang, cadena.result.syncedAt) }) : t("panel.cadena.nunca")}
        </p>
        <Boton onClick={actualizarDesdeCadena} disabled={cadena.busy} aria-busy={cadena.busy}>
          {cadena.busy ? t("panel.cadena.trabajando") : t("panel.cadena.boton")}
        </Boton>
      </div>
    </section>
  );
}

function FilaPase({ pass }: { pass: PanelPass }) {
  const t = useT();
  return (
    <li className="pase-fila">
      <span className="pase-nombre">{pass.name}</span>
      <span className="pase-entrada">{pass.ticketTypeName}</span>
      <span className="pase-estado">
        {pass.status === "checked_in" ? (
          <Chip estado="listo">{t("panel.pase.entro")}</Chip>
        ) : pass.status === "active" ? (
          <Chip estado="neutro">{t("panel.pase.activo")}</Chip>
        ) : (
          <Chip estado="pendiente">{t("panel.pase.pendiente")}</Chip>
        )}
      </span>
      <span className="pase-canjes">
        {pass.benefits.map((b) => {
          const estado = b.redeemed ? "listo" : b.source === "raffle" ? "ganado" : "pendiente";
          const clave = b.redeemed ? "panel.pase.canje.canjeado" : b.source === "raffle" ? "panel.pase.canje.ganado" : "panel.pase.canje.pendiente";
          return (
            <Chip key={b.benefitId} estado={estado}>
              {t(clave, { beneficio: b.name })}
            </Chip>
          );
        })}
      </span>
    </li>
  );
}

/** Lo que trajo el último contraste con la cadena, con las diferencias para revisar. */
function DetalleCadena({ cadena, nombreDe }: { cadena: EstadoCadena; nombreDe: (passId: string) => string }) {
  const t = useT();
  const lang = useLang();
  if (cadena.error) return <Aviso tono="alerta">{cadena.error}</Aviso>;
  const result = cadena.result;
  if (!result) return null;
  const coincide = result.checkInsAdded === 0 && result.redemptionsAdded === 0 && result.passesFixed === 0 && result.pendingSync === 0 && result.mismatches.length === 0;
  return (
    <Tarjeta className="cadena-detalle">
      <p suppressHydrationWarning>
        <strong>{t("panel.cadena.ultima", { fecha: fechaHora(lang, result.syncedAt) })}</strong>
      </p>
      <p>
        {coincide
          ? t("panel.cadena.coincide")
          : t("panel.cadena.resumen", {
              entradas: result.checkInsAdded,
              canjes: result.redemptionsAdded,
              pendientes: result.pendingSync,
              diferencias: result.mismatches.length,
            })}
      </p>
      <ul>
        {result.contracts.map((c) => (
          <li key={c.contractId}>{c.error ? `${c.label}: ${t("panel.cadena.error")}` : t("panel.cadena.contrato", { nombre: c.label, emitidos: c.issued, entraron: c.checkedIn })}</li>
        ))}
        <li>{t("panel.cadena.consultados", { n: result.passesChecked })}</li>
        {result.unknownOnChain > 0 && <li>{t("panel.cadena.desconocidos", { n: result.unknownOnChain })}</li>}
      </ul>
      {result.mismatches.length > 0 && (
        <>
          <h3>{t("panel.cadena.diferencias")}</h3>
          <ul>
            {result.mismatches.map((m, i) => (
              <li key={`${m.passId}-${i}`}>
                {nombreDe(m.passId)}: {t(`panel.cadena.diferencia.${m.reason}`, { detalle: m.detail ?? "" })}
              </li>
            ))}
          </ul>
        </>
      )}
    </Tarjeta>
  );
}
