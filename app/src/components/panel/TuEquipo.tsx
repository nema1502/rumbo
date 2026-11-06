"use client";
// "Tu equipo", para la dueña del evento: sumar a quien coorganiza con un enlace de invitación (de un solo uso, vence a
// los siete días) o autorizando su cuenta, y ver y sacar a quienes ya están. Habla con /api/admin/<evento>/equipo.
// El enlace de una invitación se ve una sola vez, recién creado: en la base queda solo su huella. Sin <form>
// propio: en el borrador vive adentro del formulario del evento, y Enter en la cuenta no tiene que mandar ese.
import { useState } from "react";
import { Aviso, Boton, Campo, Tarjeta } from "@/components/ui.tsx";
import { useLang, useT } from "@/i18n/client.tsx";
import type { Lang } from "@/i18n/index.ts";
import type { EventTeam } from "@/server/coorganizar.ts";
import { BotonCopiar } from "./BotonCopiar.tsx";

const LOCALES: Record<Lang, string> = { es: "es-BO", en: "en-US" };
const corta = (cuenta: string) => (cuenta.length > 12 ? `${cuenta.slice(0, 4)}...${cuenta.slice(-4)}` : cuenta);

type ErrorEquipo = "limit" | "invalid" | "self" | "already" | "general";

export function TuEquipo({ slug, initial }: { slug: string; initial: EventTeam }) {
  const t = useT();
  const lang = useLang();
  const [equipo, setEquipo] = useState<EventTeam>(initial);
  const [enlace, setEnlace] = useState<string | null>(null);
  const [cuenta, setCuenta] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<ErrorEquipo | null>(null);
  const [autorizada, setAutorizada] = useState(false);

  const fecha = (iso: string) => new Intl.DateTimeFormat(LOCALES[lang], { day: "numeric", month: "long" }).format(new Date(iso));

  async function pedir(accion: string, cuerpo: Record<string, string>): Promise<Record<string, unknown> | null> {
    setOcupado(accion);
    setError(null);
    try {
      const res = await fetch(`/api/admin/${encodeURIComponent(slug)}/equipo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accion, ...cuerpo }),
      });
      const datos = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (datos.team) setEquipo(datos.team as EventTeam);
      if (!res.ok) {
        const motivo = datos.error;
        setError(motivo === "limit" || motivo === "invalid" || motivo === "self" || motivo === "already" ? motivo : "general");
        return null;
      }
      return datos;
    } catch {
      setError("general");
      return null;
    } finally {
      setOcupado(null);
    }
  }

  async function invitar() {
    const datos = await pedir("invitar", {});
    if (datos && typeof datos.path === "string") setEnlace(`${window.location.origin}${datos.path}`);
  }

  async function autorizar() {
    if (ocupado !== null || cuenta.trim() === "") return;
    setAutorizada(false);
    if (await pedir("autorizar", { cuenta })) {
      setCuenta("");
      setAutorizada(true);
    }
  }

  const vacio = equipo.members.length === 0 && equipo.invites.length === 0 && equipo.grants.length === 0;

  return (
    <Tarjeta className="tu-equipo">
      <h2>{t("panel.equipo.titulo")}</h2>
      <p className="chico">{t("panel.equipo.ayuda")}</p>
      {error && <Aviso tono="alerta">{t(`panel.equipo.error.${error}`)}</Aviso>}

      <div className="tu-equipo-bloque">
        <h3>{t("panel.equipo.invitar")}</h3>
        {enlace ? (
          <>
            <div className="compartir-enlace">
              <label className="oculto-visual" htmlFor={`invitacion-${slug}`}>
                {t("panel.equipo.invitar")}
              </label>
              <input id={`invitacion-${slug}`} type="text" readOnly value={enlace} onFocus={(e) => e.currentTarget.select()} spellCheck={false} />
              <BotonCopiar texto={enlace} etiqueta={t("panel.equipo.copiar")} listo={t("panel.puestos.copiado")} />
            </div>
            <p className="chico apagado">{t("panel.equipo.enlaceNota")}</p>
            <button type="button" className="enlace chico" onClick={() => setEnlace(null)}>
              {t("panel.equipo.otroEnlace")}
            </button>
          </>
        ) : (
          <>
            <p className="chico apagado">{t("panel.equipo.invitarAyuda")}</p>
            <Boton variante="secundario" className="boton-chico" onClick={() => void invitar()} disabled={ocupado !== null} aria-busy={ocupado === "invitar" || undefined}>
              {t("panel.equipo.crearEnlace")}
            </Boton>
          </>
        )}
      </div>

      <div className="tu-equipo-bloque">
        <h3>{t("panel.equipo.autorizar")}</h3>
        <Campo
          id={`cuenta-${slug}`}
          etiqueta={t("panel.equipo.cuenta")}
          ayuda={t("panel.equipo.cuentaAyuda")}
          value={cuenta}
          onChange={(e) => setCuenta(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={70}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void autorizar();
          }}
        />
        {autorizada && <Aviso tono="listo">{t("panel.equipo.autorizada")}</Aviso>}
        <Boton variante="secundario" className="boton-chico" onClick={() => void autorizar()} disabled={ocupado !== null || cuenta.trim() === ""} aria-busy={ocupado === "autorizar" || undefined}>
          {t("panel.equipo.autorizarBoton")}
        </Boton>
      </div>

      <div className="tu-equipo-bloque">
        <h3>{t("panel.equipo.quienes")}</h3>
        {vacio ? (
          <p className="chico apagado">{t("panel.equipo.vacio")}</p>
        ) : (
          <ul className="tu-equipo-lista">
            {equipo.members.map((m) => (
              <li key={m.organizerId}>
                <span>
                  <strong>{m.name || corta(m.publicKey)}</strong>
                  <span className="chico apagado" suppressHydrationWarning>
                    {" "}
                    {m.name ? `${corta(m.publicKey)}, ` : ""}
                    {t("panel.equipo.desde", { fecha: fecha(m.addedAt) })}
                  </span>
                </span>
                <button
                  type="button"
                  className="enlace"
                  disabled={ocupado !== null}
                  onClick={() => {
                    if (window.confirm(t("panel.equipo.confirmarSacar", { nombre: m.name || corta(m.publicKey) }))) void pedir("sacar", { organizador: m.organizerId });
                  }}
                >
                  {t("panel.equipo.sacar")}
                </button>
              </li>
            ))}
            {equipo.invites.map((i) => (
              <li key={i.id}>
                <span>
                  <strong>{t("panel.equipo.invitacionAbierta")}</strong>
                  <span className="chico apagado" suppressHydrationWarning>
                    {" "}
                    {t("panel.equipo.vence", { fecha: fecha(i.expiresAt) })}
                  </span>
                </span>
                <button type="button" className="enlace" disabled={ocupado !== null} onClick={() => void pedir("anular", { invitacion: i.id })}>
                  {t("panel.equipo.anular")}
                </button>
              </li>
            ))}
            {equipo.grants.map((g) => (
              <li key={g.publicKey}>
                <span>
                  <strong>{corta(g.publicKey)}</strong>
                  <span className="chico apagado"> {t("panel.equipo.autorizadaSinEntrar")}</span>
                </span>
                <button type="button" className="enlace" disabled={ocupado !== null} onClick={() => void pedir("anular", { cuenta: g.publicKey })}>
                  {t("panel.equipo.anular")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Tarjeta>
  );
}
