"use client";
// "Tu equipo" en la credencial: la credencial del grupo. Quien participa arma su equipo con un nombre y le pasa el
// código al resto, o se suma con el código que le pasaron, hasta cinco. Cualquiera del equipo cambia el nombre o se
// va. Si algo falla (sin conexión, la red), la credencial sigue igual: esta tarjeta no toca el QR.
import { useState, type FormEvent } from "react";
import { Aviso, Boton, Campo } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";
import type { PassTeamState } from "@/server/evento/equipo.ts";

type Accion = { action: "create"; name: string } | { action: "join"; code: string } | { action: "rename"; name: string } | { action: "leave" };

export function EquipoCredencial({ passId, accessKey, initial }: { passId: string; accessKey: string; initial: PassTeamState }) {
  const t = useT();
  const [estado, setEstado] = useState<PassTeamState>(initial);
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [renombrando, setRenombrando] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [saliendo, setSaliendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mandar(cuerpo: Accion): Promise<boolean> {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/pase/${encodeURIComponent(passId)}/equipo?k=${encodeURIComponent(accessKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cuerpo),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { state?: PassTeamState; error?: string };
      if (!res.ok || !data.state) {
        setError(t(`evento.equipo.error.${data.error ?? "general"}`));
        return false;
      }
      setEstado(data.state);
      return true;
    } catch {
      setError(t("evento.equipo.error.general"));
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function armar(e: FormEvent) {
    e.preventDefault();
    if (await mandar({ action: "create", name: nombre })) setNombre("");
  }
  async function sumarme(e: FormEvent) {
    e.preventDefault();
    if (await mandar({ action: "join", code: codigo })) setCodigo("");
  }
  async function renombrar(e: FormEvent) {
    e.preventDefault();
    if (await mandar({ action: "rename", name: nuevoNombre })) setRenombrando(false);
  }
  async function salir() {
    if (await mandar({ action: "leave" })) setSaliendo(false);
  }

  if (!estado.allowed) return null;
  const equipo = estado.team;

  return (
    <section className="tarjeta equipo-credencial" aria-labelledby="equipo-titulo">
      <h2 id="equipo-titulo" className="equipo-titulo">
        {t("evento.equipo.titulo")}
      </h2>
      {equipo ? (
        <>
          <p className="equipo-nombre">{equipo.name}</p>
          <div className="equipo-codigo">
            <span className="apagado chico">{t("evento.equipo.codigo")}</span>
            <strong className="equipo-codigo-valor">{equipo.code}</strong>
            <span className="apagado chico">{equipo.full ? t("evento.equipo.lleno", { max: equipo.max }) : t("evento.equipo.pasaloCodigo", { max: equipo.max })}</span>
          </div>
          <ul className="equipo-integrantes">
            {equipo.members.map((m, i) => (
              <li key={`${m.name}-${i}`}>
                {m.name}
                {m.you && <span className="apagado"> {t("evento.equipo.vos")}</span>}
              </li>
            ))}
          </ul>
          {renombrando ? (
            <form className="equipo-form" onSubmit={(e) => void renombrar(e)}>
              <Campo id="equipo-renombrar" etiqueta={t("evento.equipo.nombre")} value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} maxLength={60} required autoComplete="off" />
              <div className="equipo-acciones">
                <Boton type="submit" className="boton-chico" disabled={guardando}>
                  {t("evento.equipo.guardar")}
                </Boton>
                <Boton variante="secundario" className="boton-chico" onClick={() => setRenombrando(false)} disabled={guardando}>
                  {t("evento.equipo.cancelar")}
                </Boton>
              </div>
            </form>
          ) : saliendo ? (
            <div className="equipo-acciones">
              <span className="chico">{t("evento.equipo.seguroSalir")}</span>
              <Boton variante="secundario" className="boton-chico" onClick={() => void salir()} disabled={guardando}>
                {t("evento.equipo.siSalir")}
              </Boton>
              <Boton variante="secundario" className="boton-chico" onClick={() => setSaliendo(false)} disabled={guardando}>
                {t("evento.equipo.cancelar")}
              </Boton>
            </div>
          ) : (
            <div className="equipo-acciones">
              <Boton
                variante="secundario"
                className="boton-chico"
                onClick={() => {
                  setNuevoNombre(equipo.name);
                  setError(null);
                  setRenombrando(true);
                }}
              >
                {t("evento.equipo.cambiarNombre")}
              </Boton>
              <Boton variante="secundario" className="boton-chico" onClick={() => setSaliendo(true)}>
                {t("evento.equipo.salir")}
              </Boton>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="apagado chico">{t("evento.equipo.intro")}</p>
          <form className="equipo-form" onSubmit={(e) => void armar(e)}>
            <Campo id="equipo-nombre" etiqueta={t("evento.equipo.nombre")} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} required autoComplete="off" />
            <Boton type="submit" className="boton-chico" disabled={guardando}>
              {t("evento.equipo.armar")}
            </Boton>
          </form>
          <form className="equipo-form" onSubmit={(e) => void sumarme(e)}>
            <Campo
              id="equipo-codigo"
              etiqueta={t("evento.equipo.codigoParaSumarte")}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              maxLength={12}
              required
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
            <Boton type="submit" variante="secundario" className="boton-chico" disabled={guardando}>
              {t("evento.equipo.sumarme")}
            </Boton>
          </form>
        </>
      )}
      {error && <Aviso tono="alerta">{error}</Aviso>}
    </section>
  );
}
