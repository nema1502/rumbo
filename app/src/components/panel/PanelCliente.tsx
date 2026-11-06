"use client";
// El panel en vivo: pinta el estado que le dio el servidor y lo vuelve a pedir cada cinco segundos
// (cuando la pestaña está a la vista). "Verificar el registro del evento" contrasta el espejo con el
// contrato y trae lo que falte.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Aviso, Boton, BotonEnlace, Chip, Tarjeta } from "@/components/ui.tsx";
import { useLang, useT } from "@/i18n/client.tsx";
import type { Lang } from "@/i18n/index.ts";
import { kindLabelKey } from "@/lib/credential-kinds.ts";
import { isManualScannerId } from "@/lib/escaner-api.ts";
import { formatStationCode, stationCodesExpired } from "@/lib/station-code.ts";
import { formatEventWhen, formatEventWhere } from "@/server/evento/fecha.ts";
import type { ChainSyncSummary, PanelDuplicate, PanelPass, PanelState } from "@/server/panel.ts";
import type { EventTeam } from "@/server/coorganizar.ts";
import type { PanelVia } from "@/server/panel-sesion.ts";
import { BotonCopiar } from "./BotonCopiar.tsx";
import { CerrarSesion } from "./CerrarSesion.tsx";
import { CompartirPanel } from "./CompartirPanel.tsx";
import { Contador } from "./Contador.tsx";
import { TuEquipo } from "./TuEquipo.tsx";

const POLL_MS = 5000;
const LOCALES: Record<Lang, string> = { es: "es-BO", en: "en-US" };

type Conexion = "ok" | "sinConexion" | "vencida";

interface EstadoCadena {
  busy: boolean;
  result: ChainSyncSummary | null;
  error: string | null;
}

// Las horas van en la zona del evento, no en la del reloj de quien mira: el servidor (en Vercel, en UTC) y el
// navegador tienen que escribir lo mismo, y quien organiza piensa en la hora de su ciudad.

/** La hora, con segundos, en la zona del evento. */
function hora(lang: Lang, timeZone: string, iso: string): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: lang === "es" ? "h23" : "h12", timeZone }).format(new Date(iso));
}

/** Día y hora cortos, en la zona del evento. */
function fechaHora(lang: Lang, timeZone: string, iso: string): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: lang === "es" ? "h23" : "h12", timeZone }).format(new Date(iso));
}

export function PanelCliente({
  slug,
  initial,
  publicado = false,
  porPreparar = 0,
  via = "key",
  pollarKey = null,
  equipo = null,
}: {
  slug: string;
  initial: PanelState;
  publicado?: boolean;
  /** Cuántas credenciales del equipo quedan por preparar (se cerró la pestaña de publicar antes de terminar). */
  porPreparar?: number;
  via?: PanelVia;
  /** Con la cuenta: la clave publicable de Pollar, para cerrar también su sesión en este navegador. */
  pollarKey?: string | null;
  /** Para la dueña del evento: su equipo, con lo que hace falta para sumar y sacar personas. Para el resto, null. */
  equipo?: EventTeam | null;
}) {
  const t = useT();
  const lang = useLang();
  const [state, setState] = useState<PanelState>(initial);
  const [conexion, setConexion] = useState<Conexion>("ok");
  const [cadena, setCadena] = useState<EstadoCadena>({ busy: false, result: initial.lastChainSync, error: null });
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState("");
  /** El código de puesto que se está cambiando, y si el último cambio falló. */
  const [cambiando, setCambiando] = useState<string | null>(null);
  const [errorPuesto, setErrorPuesto] = useState(false);

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

  /** Un código de puesto nuevo: el de ahora deja de abrir el escáner en el acto. */
  async function cambiarCodigo(code: string, puesto: string) {
    if (!window.confirm(t("panel.puestos.confirmarCambiar", { puesto }))) return;
    setCambiando(code);
    setErrorPuesto(false);
    try {
      const res = await fetch(`/api/admin/${slug}/puestos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      if (res.status === 401) {
        setConexion("vencida");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setState(((await res.json()) as { state: PanelState }).state);
    } catch {
      setErrorPuesto(true);
    } finally {
      setCambiando(null);
    }
  }

  const q = query.trim().toLowerCase();
  const visibles = useMemo(
    () => (q ? state.passes.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) : state.passes),
    [state.passes, q],
  );
  const nombreDe = (passId: string) => state.passes.find((p) => p.id === passId)?.name ?? passId;

  const { counters, event } = state;
  const when = formatEventWhen(lang, event);
  const lugar = formatEventWhere(event);

  // Dónde se registró un doble: el puesto, no el id del celular. Un canje trae la mesa de su beneficio; una
  // entrada es la puerta, con el escáner o marcada a mano; si no se sabe, "en otro escáner". Y con qué se leyó
  // la credencial (el QR del celular o el impreso), si el servidor lo comprobó.
  const dondeDoble = (d: PanelDuplicate) => {
    if (d.via === "manual" || isManualScannerId(d.scannerId)) return t("panel.dobles.aMano");
    const donde = d.kind === "checkin" ? t("panel.dobles.puesto", { puesto: t("panel.puestos.puerta") }) : d.station ? t("panel.dobles.puesto", { puesto: d.station }) : t("panel.dobles.otroEscaner");
    return d.via ? `${donde}, ${t(`panel.dobles.via.${d.via}`)}` : donde;
  };

  return (
    <section className="panel">
      <header className="panel-cabecera">
        {via === "organizer" && (
          <Link className="enlace panel-mis-eventos" href="/admin">
            {t("panel.cuenta.misEventos")}
          </Link>
        )}
        <p className="panel-sobre">
          <span>{t("panel.titulo")}</span>
          {conexion === "ok" && <Chip estado="listo">{t("panel.enVivo")}</Chip>}
          {conexion === "sinConexion" && <Chip estado="alerta">{t("estado.sinConexion")}</Chip>}
          {conexion === "vencida" && <Chip estado="alerta">{t("panel.sesionVencidaCorta")}</Chip>}
          <span className="apagado chico" suppressHydrationWarning>
            {t("panel.actualizado", { hora: hora(lang, state.event.timezone, state.generatedAt) })}
          </span>
          {state.pendingSync > 0 && <Chip estado="pendiente">{t("panel.porSincronizar", { n: state.pendingSync })}</Chip>}
        </p>
        <h1>{event.name}</h1>
        <p className="bajada">
          {when.date}, {when.time}, {lugar}. {t("panel.bajada")}
        </p>
      </header>

      {publicado && <Aviso tono="listo">{t("kit.armar.publicado")}</Aviso>}
      {porPreparar > 0 && (
        <div className="aviso panel-por-preparar" role="status">
          <span>{porPreparar === 1 ? t("kit.panel.faltaUna") : t("kit.panel.faltan", { n: porPreparar })}</span>
          <BotonEnlace href={`/admin/${encodeURIComponent(slug)}/publicando`} variante="secundario" className="boton-chico">
            {t("kit.panel.terminar")}
          </BotonEnlace>
        </div>
      )}
      {conexion === "vencida" && (
        <Aviso tono="alerta">
          {via === "organizer" ? t("panel.sesionVencidaCuenta") : t("panel.sesionVencida")}{" "}
          {/* Con la cuenta, la vuelta es entrar como organizador y caer de nuevo acá; con la clave, la puerta del panel. */}
          <Link className="enlace" href={via === "organizer" ? `/admin?volver=${encodeURIComponent(`/admin/${slug}`)}` : `/admin/${slug}`}>
            {via === "organizer" ? t("panel.cuenta.titulo") : t("panel.volverAEntrar")}
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

      <DetalleCadena cadena={cadena} nombreDe={nombreDe} timezone={state.event.timezone} />

      {state.benefits.length > 0 && (
        <Tarjeta>
          <h2>{t("kit.panel.franjas")}</h2>
          <p className="chico">{t("kit.panel.franjasAyuda")}</p>
          <ul className="panel-franjas">
            {state.benefits.map((b) => {
              const porcentaje = b.granted > 0 ? Math.min(100, Math.round((b.redeemed / b.granted) * 100)) : 0;
              return (
                <li key={b.id} className="panel-franja">
                  <span className="panel-franja-nombre">{b.name}</span>
                  <span className="panel-franja-cifra">{t("kit.panel.canjeados", { canjeados: b.redeemed, otorgados: b.granted })}</span>
                  <div className="barra barra-verde" role="img" aria-label={`${b.name}: ${porcentaje}%`}>
                    <span style={{ width: `${porcentaje}%` }} />
                  </div>
                  {b.stock !== null && b.remaining !== null && (
                    <span className="panel-franja-stock">
                      <Chip estado={b.remaining === 0 ? "alerta" : b.remaining <= Math.ceil(b.stock / 10) ? "pendiente" : "neutro"}>
                        {b.exceeded > 0 ? t("kit.panel.pasadas", { n: b.exceeded }) : b.remaining === 0 ? t("kit.panel.agotado") : t("kit.panel.quedan", { n: b.remaining, total: b.stock })}
                      </Chip>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      )}

      <div className="panel-columnas">
        <Tarjeta>
          <h2>{t("panel.puestos.titulo")}</h2>
          <p className="chico">{t("panel.puestos.bajada")}</p>
          {stationCodesExpired(event) && <Aviso>{t("panel.puestos.vencidos")}</Aviso>}
          {errorPuesto && <Aviso tono="alerta">{t("panel.puestos.errorCambiar")}</Aviso>}
          <ul className="puestos">
            {state.stations.map((station) => {
              const puesto = station.kind === "gate" ? t("panel.puestos.puerta") : station.kind === "stand" ? t("stands.escaner.titulo", { nombre: station.standName ?? "" }) : (station.benefitName ?? "");
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
                  <Boton variante="secundario" className="boton-chico" onClick={() => void cambiarCodigo(station.code, puesto)} disabled={cambiando !== null} aria-label={t("panel.puestos.cambiarAria", { puesto })}>
                    {cambiando === station.code ? t("panel.puestos.cambiando") : t("panel.puestos.cambiar")}
                  </Boton>
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
                    {fechaHora(lang, state.event.timezone, d.scannedAt)}
                    {d.scannerId ? `, ${dondeDoble(d)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>

      {/* Sumar o sacar personas es de la dueña: quien coorganiza o entró con la clave no ve esto. */}
      {equipo && <TuEquipo slug={slug} initial={equipo} />}
      {equipo && <CompartirPanel slug={slug} />}

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
            <a className="boton boton-secundario boton-chico" href={`/api/admin/${slug}/asistencia`} download>
              {t("kit.panel.asistencia")}
            </a>
            <BotonEnlace variante="secundario" className="boton-chico" href={`/admin/${slug}/importar`}>
              {t("kit.panel.importar")}
            </BotonEnlace>
            <BotonEnlace variante="secundario" className="boton-chico" href={`/admin/${slug}/informe`}>
              {t("panel.pases.informe")}
            </BotonEnlace>
            <BotonEnlace variante="secundario" className="boton-chico" href={`/admin/${slug}/stands`}>
              {t("stands.admin.enlace")}
            </BotonEnlace>
            <BotonEnlace variante="secundario" className="boton-chico" href={`/vivo/${slug}`}>
              {t("vivo.enlace")}
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

      {/* Con la clave se sale de este panel; con la cuenta se cierra la sesión en este navegador (Mis eventos queda arriba). */}
      {via === "organizer" ? (
        <CerrarSesion pollarKey={pollarKey} />
      ) : (
        <form className="panel-salir" method="post" action={`/api/admin/${slug}/salir`}>
          <button type="submit" className="enlace">
            {t("panel.acceso.salir")}
          </button>
        </form>
      )}

      <div className="panel-accion">
        <p className="panel-accion-estado" suppressHydrationWarning>
          {cadena.result ? t("panel.cadena.ultima", { fecha: fechaHora(lang, state.event.timezone, cadena.result.syncedAt) }) : t("panel.cadena.nunca")}
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
      <span className="pase-entrada">
        {pass.kind === "attendee" ? pass.ticketTypeName : t(kindLabelKey(pass.kind))}
        {pass.team && <span className="apagado chico"> {t("kit.panel.equipo", { nombre: pass.team })}</span>}
      </span>
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
function DetalleCadena({ cadena, nombreDe, timezone }: { cadena: EstadoCadena; nombreDe: (passId: string) => string; timezone: string }) {
  const t = useT();
  const lang = useLang();
  if (cadena.error) return <Aviso tono="alerta">{cadena.error}</Aviso>;
  const result = cadena.result;
  if (!result) return null;
  // "Coincide" solo si se pudo leer todo y no quedó nada afuera: con una consulta fallida o con entradas del
  // contrato que no son de este panel, decirlo sería mentir.
  const parcial = result.errors.length > 0 || result.contracts.some((c) => c.error !== null);
  const coincide =
    !parcial &&
    result.unknownOnChain === 0 &&
    result.checkInsAdded === 0 &&
    result.redemptionsAdded === 0 &&
    result.passesFixed === 0 &&
    result.pendingSync === 0 &&
    result.mismatches.length === 0;
  return (
    <Tarjeta className="cadena-detalle">
      <p suppressHydrationWarning>
        <strong>{t("panel.cadena.ultima", { fecha: fechaHora(lang, timezone, result.syncedAt) })}</strong>
      </p>
      <p>
        {parcial
          ? t("panel.cadena.parcial")
          : coincide
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
