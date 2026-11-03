"use client";
// El panel de quien atiende un stand (/stand/<código>): cuántas personas pasaron, cuántas aceptaron compartir su
// contacto y, de esas, su nombre y su correo, con una calificación de 1 a 5 y una nota que escribe quien atiende.
// De quien no contestó, o dijo que no, no hay nada que ver: solo cuenta la visita. Se vuelve a pedir cada
// cinco segundos mientras la pantalla está a la vista.
import { useCallback, useEffect, useRef, useState } from "react";
import { Aviso, Chip } from "@/components/ui.tsx";
import { useLang, useT } from "@/i18n/client.tsx";
import { formatDate, type Lang } from "@/i18n/index.ts";
import type { StandContact, StandPanel } from "@/server/stands.ts";
import { Logo } from "./RutaCredencial.tsx";

const POLL_MS = 5000;

export function PanelStandCliente({ codigo, initial }: { codigo: string; initial: StandPanel }) {
  const t = useT();
  const lang = useLang();
  const [panel, setPanel] = useState<StandPanel>(initial);
  const [sinConexion, setSinConexion] = useState(false);

  const traer = useCallback(async () => {
    try {
      const res = await fetch(`/api/stand/${encodeURIComponent(codigo)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setPanel((await res.json()) as StandPanel);
      setSinConexion(false);
    } catch {
      setSinConexion(true);
    }
  }, [codigo]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void traer();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [traer]);

  const { stand, event, numbers, benefit, contacts } = panel;
  const lugar = event.venue ? `${event.venue}, ${event.place}` : event.place;

  return (
    <section className="panel stand-panel">
      <header className="panel-cabecera">
        <p className="panel-sobre">
          <span>{t("stands.panel.sobre")}</span>
          {sinConexion ? <Chip estado="alerta">{t("estado.sinConexion")}</Chip> : <Chip estado="listo">{t("panel.enVivo")}</Chip>}
        </p>
        <div className="stand-titulo">
          <Logo stand={stand} />
          <h1>{stand.name}</h1>
        </div>
        <p className="bajada">{event.name}</p>
        <p className="secundario">
          {formatDate(lang, event.startsAt, event.timezone)}, {lugar}
        </p>
      </header>

      {sinConexion && <Aviso tono="alerta">{t("stands.panel.sinConexion")}</Aviso>}

      <div className="contadores stand-contadores">
        <Cifra etiqueta={t("stands.panel.visitas")} valor={numbers.visits} />
        <Cifra etiqueta={t("stands.panel.aceptaron")} valor={numbers.accepted} tono="verde" />
        <Cifra etiqueta={t("stands.panel.esperando")} valor={numbers.waiting} />
        {benefit && <Cifra etiqueta={t("stands.panel.canjes", { beneficio: benefit.name })} valor={benefit.redeemed} detalle={benefit.granted > 0 ? t("stands.panel.canjesDe", { total: benefit.granted }) : undefined} tono="amarillo" />}
      </div>

      <section className="panel-seccion">
        <div className="pases-cabecera">
          <h2>
            {t("stands.panel.contactos")} ({contacts.length})
          </h2>
          <a className="boton boton-secundario boton-chico" href={`/api/stand/${encodeURIComponent(codigo)}/csv`} download>
            {t("stands.panel.exportar")}
          </a>
        </div>
        <p className="chico secundario">{t("stands.panel.uso")}</p>
        {contacts.length === 0 ? (
          <Aviso>{t("stands.panel.vacio")}</Aviso>
        ) : (
          <ul className="contactos">
            {contacts.map((contact) => (
              <Contacto key={contact.passId} codigo={codigo} contact={contact} lang={lang} timezone={event.timezone} />
            ))}
          </ul>
        )}
      </section>

      <div className="panel-accion">
        <a className="enlace" href="/scan">
          {t("stands.panel.volver")}
        </a>
      </div>
    </section>
  );
}

function Cifra({ etiqueta, valor, detalle, tono = "acento" }: { etiqueta: string; valor: number; detalle?: string; tono?: "acento" | "verde" | "amarillo" }) {
  return (
    <div className="contador" role="group" aria-label={etiqueta}>
      <span className="contador-etiqueta">{etiqueta}</span>
      <span className="contador-valor">{valor}</span>
      <span className={`contador-detalle${tono === "verde" ? " contador-verde" : ""}`}>{detalle ?? " "}</span>
    </div>
  );
}

/** Un contacto: nombre y correo, la calificación de 1 a 5 y la nota. Cada cosa se guarda al instante. */
function Contacto({ codigo, contact, lang, timezone }: { codigo: string; contact: StandContact; lang: Lang; timezone: string }) {
  const t = useT();
  const [rating, setRating] = useState<number | null>(contact.rating);
  const [note, setNote] = useState(contact.note);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState(false);
  const sucia = useRef(false);

  // Si llega un cambio desde el servidor y quien atiende no está escribiendo, se toma.
  useEffect(() => {
    setRating(contact.rating);
    if (!sucia.current) setNote(contact.note);
  }, [contact.rating, contact.note]);

  async function guardar(cambio: { rating?: number | null; note?: string }) {
    setError(false);
    try {
      const res = await fetch(`/api/stand/${encodeURIComponent(codigo)}/contacto`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passId: contact.passId, ...cambio }),
      });
      if (!res.ok) throw new Error(String(res.status));
      if (cambio.note !== undefined) sucia.current = false;
      setGuardado(true);
      setTimeout(() => setGuardado(false), 1800);
    } catch {
      setError(true);
    }
  }

  const aria = `${contact.name}: ${t("stands.panel.calificacion")}`;
  return (
    <li className="contacto">
      <div className="contacto-quien">
        <strong>{contact.name}</strong>
        <a className="contacto-correo" href={`mailto:${contact.email}`}>
          {contact.email}
        </a>
        <span className="apagado chico" suppressHydrationWarning>
          {t("stands.panel.visito", { hora: formatDate(lang, contact.visitedAt, timezone, { hour: "2-digit", minute: "2-digit" }) })}
        </span>
      </div>

      <div className="contacto-puntaje">
        <div className="contacto-calificacion" role="radiogroup" aria-label={aria}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={t("stands.panel.calificar", { n })}
              className={`estrella${rating !== null && n <= rating ? " estrella-llena" : ""}`}
              onClick={() => {
                const nuevo = rating === n ? null : n;
                setRating(nuevo);
                void guardar({ rating: nuevo });
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 3 1.1-6.1L3.2 9.6l6.1-.8z" />
              </svg>
            </button>
          ))}
        </div>
        <p className="contacto-estado chico" aria-live="polite">
          {error ? <span className="campo-error">{t("stands.panel.error")}</span> : guardado ? <Chip estado="listo">{t("stands.panel.guardado")}</Chip> : null}
        </p>
      </div>

      <div className="campo contacto-nota">
        <label className="campo-etiqueta" htmlFor={`nota-${contact.passId}`}>
          {t("stands.panel.nota")}
        </label>
        <textarea
          id={`nota-${contact.passId}`}
          rows={2}
          maxLength={500}
          value={note}
          placeholder={t("stands.panel.notaAyuda")}
          onChange={(e) => {
            sucia.current = true;
            setNote(e.target.value);
          }}
          onBlur={() => {
            if (sucia.current) void guardar({ note });
          }}
        />
      </div>
    </li>
  );
}
