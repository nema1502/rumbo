"use client";
// La ruta de stands en la credencial: cuántos stands lleva la persona, cuáles faltan, el premio, y la
// pregunta de permiso. Cuando quien atiende un stand escanea la credencial, la pregunta "¿querés compartir
// tu contacto con este stand?" aparece acá, en el celular de la persona, y solo ella la contesta: el
// auspiciante no ve nada hasta que diga que sí. Sondea al servidor cada tres segundos mientras la pantalla
// está a la vista, así la pregunta llega en el momento del escaneo.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Aviso, Boton, Chip } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";
import type { ConsentState } from "@/lib/escaner-api.ts";
import type { PassRoute, PassRouteStand } from "@/server/stands.ts";

const POLL_MS = 3000;

type Guardando = { tipo: "permiso"; standId: string } | { tipo: "pantalla" } | null;

export function RutaCredencial({ passId, accessKey, initial }: { passId: string; accessKey: string; initial: PassRoute }) {
  const t = useT();
  const [ruta, setRuta] = useState<PassRoute>(initial);
  const [guardando, setGuardando] = useState<Guardando>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [alias, setAlias] = useState(initial.display.alias ?? "");
  const [oculto, setOculto] = useState(initial.display.hidden);
  const [pantallaGuardada, setPantallaGuardada] = useState(false);
  const ocupado = useRef(false);

  const url = `/api/pase/${encodeURIComponent(passId)}/ruta`;

  const traer = useCallback(async () => {
    if (ocupado.current) return;
    try {
      const res = await fetch(`${url}?k=${encodeURIComponent(accessKey)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { route: PassRoute | null };
      if (data.route) setRuta(data.route);
    } catch {
      /* sin conexión: se reintenta en el próximo ciclo */
    }
  }, [url, accessKey]);

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

  async function mandar(cuerpo: Record<string, unknown>, que: Exclude<Guardando, null>, error: string): Promise<boolean> {
    ocupado.current = true;
    setGuardando(que);
    setFallo(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ k: accessKey, ...cuerpo }) });
      if (!res.ok) {
        setFallo(error);
        return false;
      }
      const data = (await res.json()) as { route: PassRoute | null };
      if (data.route) setRuta(data.route);
      return true;
    } catch {
      setFallo(t("stands.error.red"));
      return false;
    } finally {
      ocupado.current = false;
      setGuardando(null);
    }
  }

  const contestar = (standId: string, answer: Exclude<ConsentState, "pending">) =>
    mandar({ action: "consent", standId, answer }, { tipo: "permiso", standId }, t("stands.error.red"));

  async function guardarPantalla(event: FormEvent) {
    event.preventDefault();
    setPantallaGuardada(false);
    const bien = await mandar({ action: "display", alias, hidden: oculto }, { tipo: "pantalla" }, t("stands.error.alias"));
    if (bien) {
      setPantallaGuardada(true);
      setTimeout(() => setPantallaGuardada(false), 2500);
    }
  }

  const visitados = ruta.stands.filter((s) => s.visitedAt);
  const preguntas = ruta.stands.filter((s) => s.consent === "pending");
  const meta = ruta.target ?? ruta.total;
  const porcentaje = Math.min(100, Math.round((ruta.visited / Math.max(1, meta)) * 100));
  const premio = ruta.prize?.name ?? "";
  const faltan = Math.max(0, (ruta.target ?? 0) - ruta.visited);

  return (
    <>
      <section className="tarjeta ruta" aria-labelledby="ruta-titulo">
        <div className="ruta-cabecera">
          <h2 id="ruta-titulo">{t("stands.ruta.titulo")}</h2>
          {ruta.completed && <Chip estado="ganado">{t("stands.ruta.completa")}</Chip>}
        </div>
        <p className="ruta-bajada">
          {ruta.target !== null && ruta.prize
            ? t("stands.ruta.meta", { meta: ruta.target, total: ruta.total, premio })
            : t("stands.ruta.sinMeta")}
        </p>

        <div className="ruta-avance">
          <strong>{t("stands.ruta.avance", { n: Math.min(ruta.visited, meta), meta })}</strong>
          <div className="barra barra-verde" role="progressbar" aria-valuemin={0} aria-valuemax={meta} aria-valuenow={Math.min(ruta.visited, meta)}>
            <span style={{ width: `${porcentaje}%` }} />
          </div>
        </div>

        <ul className="ruta-stands">
          {ruta.stands.map((stand) => (
            <li key={stand.id}>
              <Logo stand={stand} />
              <span className="ruta-stand-nombre">{stand.name}</span>
              {stand.visitedAt ? <Chip estado="listo">{t("stands.ruta.visitado")}</Chip> : <Chip estado="neutro">{t("stands.ruta.falta")}</Chip>}
            </li>
          ))}
        </ul>

        {ruta.prize && ruta.target !== null && (
          <p className={`ruta-premio${ruta.prize.granted ? " ruta-premio-ganado" : ""}`}>
            {ruta.prize.redeemed
              ? t("stands.ruta.canjeado", { premio })
              : ruta.prize.granted
                ? t("stands.ruta.ganado", { premio })
                : t(faltan === 1 ? "stands.ruta.falta1" : "stands.ruta.faltan", { n: faltan, premio })}
          </p>
        )}

        {visitados.length > 0 && (
          <div className="ruta-contactos">
            <h3>{t("stands.contacto.titulo")}</h3>
            <ul>
              {visitados.map((stand) => (
                <li key={stand.id}>
                  <span className="ruta-stand-nombre">{stand.name}</span>
                  <Chip estado={stand.consent === "granted" ? "listo" : stand.consent === "declined" ? "neutro" : "pendiente"}>
                    {t(stand.consent === "granted" ? "stands.contacto.compartido" : stand.consent === "declined" ? "stands.contacto.noCompartido" : "stands.contacto.sinResponder")}
                  </Chip>
                  <Boton
                    variante="secundario"
                    className="boton-chico"
                    disabled={guardando?.tipo === "permiso" && guardando.standId === stand.id}
                    onClick={() => void contestar(stand.id, stand.consent === "granted" ? "declined" : "granted")}
                  >
                    {t(stand.consent === "granted" ? "stands.contacto.dejar" : "stands.contacto.compartir")}
                  </Boton>
                </li>
              ))}
            </ul>
          </div>
        )}

        <details className="ruta-pantalla">
          <summary>{t("stands.pantalla.titulo")}</summary>
          <form onSubmit={guardarPantalla} className="ruta-pantalla-form">
            <p className="chico apagado">{t("stands.pantalla.ayuda")}</p>
            <div className="campo">
              <label className="campo-etiqueta" htmlFor="ruta-alias">
                {t("stands.pantalla.alias")}
              </label>
              <input
                id="ruta-alias"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                maxLength={20}
                autoComplete="off"
                placeholder={ruta.display.shownAs ?? ""}
                disabled={oculto}
                aria-describedby="ruta-alias-ayuda"
              />
              <p className="campo-ayuda" id="ruta-alias-ayuda">
                {t("stands.pantalla.aliasAyuda")}
              </p>
            </div>
            <label className="ruta-ocultar">
              <input type="checkbox" checked={oculto} onChange={(e) => setOculto(e.target.checked)} />
              <span>{t("stands.pantalla.ocultar")}</span>
            </label>
            <div className="fila">
              <Boton type="submit" variante="secundario" disabled={guardando?.tipo === "pantalla"}>
                {t("stands.pantalla.guardar")}
              </Boton>
              {pantallaGuardada && <Chip estado="listo">{t("stands.pantalla.guardado")}</Chip>}
            </div>
          </form>
        </details>

        {fallo && <Aviso tono="alerta">{fallo}</Aviso>}
      </section>

      {preguntas[0] && (
        <div className="ruta-pregunta" role="alertdialog" aria-labelledby="ruta-pregunta-titulo" aria-describedby="ruta-pregunta-detalle">
          <h2 id="ruta-pregunta-titulo">{t("stands.pregunta.titulo", { auspiciante: preguntas[0].name })}</h2>
          <p id="ruta-pregunta-detalle">{t("stands.pregunta.detalle")}</p>
          <div className="ruta-pregunta-botones">
            {/* Las dos respuestas pesan lo mismo y ninguna viene elegida */}
            <Boton variante="secundario" grande disabled={guardando?.tipo === "permiso"} onClick={() => void contestar(preguntas[0]!.id, "declined")}>
              {t("stands.pregunta.no")}
            </Boton>
            <Boton variante="secundario" grande disabled={guardando?.tipo === "permiso"} onClick={() => void contestar(preguntas[0]!.id, "granted")}>
              {t("stands.pregunta.si")}
            </Boton>
          </div>
          <p className="chico apagado">{t("stands.pregunta.cambio")}</p>
        </div>
      )}
    </>
  );
}

/** El logo del auspiciante, o su inicial si no cargó uno. */
export function Logo({ stand }: { stand: Pick<PassRouteStand, "name" | "logoUrl"> }) {
  if (stand.logoUrl) {
    return <img className="stand-logo" src={stand.logoUrl} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" />;
  }
  return (
    <span className="stand-logo stand-logo-inicial" aria-hidden="true">
      {[...stand.name][0]?.toUpperCase()}
    </span>
  );
}
