"use client";
// La invitación a coorganizar, en el navegador: lee la ficha del fragmento (/admin/invitacion#<ficha>), pregunta
// cómo está (POST /api/organizador/invitacion/estado) y, con la sesión de organizador, "Sumarme al equipo de este
// evento" la acepta (POST /api/organizador/invitacion). La ficha va siempre en el cuerpo, nunca en la dirección. Sin
// sesión, la puerta de entrar como organizador: al entrar, la página se vuelve a pedir (la ficha sigue en el
// fragmento) y se pregunta de nuevo. Quien ya está en el equipo, o es la dueña, va derecho a su panel.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EntrarOrganizador } from "@/components/panel/EntrarOrganizador.tsx";
import { Aviso, Boton, BotonEnlace, Pantalla } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";
import type { InviteView } from "@/server/coorganizar.ts";

type Vista = InviteView & { signedIn: boolean };

const ERRORES: Record<string, string> = {
  used: "panel.invitacion.usada",
  expired: "panel.invitacion.vencida",
  revoked: "panel.invitacion.anulada",
  missing: "panel.invitacion.noExiste",
  owner: "panel.invitacion.esTuyo",
  demasiados: "panel.cuenta.error.demasiados",
  general: "panel.equipo.error.general",
};

const post = (url: string, token: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store" });

export function Invitacion({ conSesion, nombre, pollarKey }: { conSesion: boolean; nombre: string; pollarKey: string | null }) {
  const t = useT();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let leida = "";
    try {
      leida = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      leida = "";
    }
    setToken(leida);
  }, []);

  // Se pregunta al abrir y otra vez después de entrar como organizador (conSesion cambia al volver a pedir la página).
  useEffect(() => {
    if (token === null) return;
    if (!token) {
      setVista({ signedIn: conSesion, state: "missing", eventName: null, ownerName: null, role: null, panelPath: null });
      return;
    }
    let vivo = true;
    setError(null);
    post("/api/organizador/invitacion/estado", token)
      .then(async (res) => {
        if (!vivo) return;
        if (res.status === 429) return setError("demasiados");
        if (!res.ok) return setError("general");
        setVista((await res.json()) as Vista);
      })
      .catch(() => {
        if (vivo) setError("general");
      });
    return () => {
      vivo = false;
    };
  }, [token, conSesion]);

  async function aceptar() {
    if (!token || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await post("/api/organizador/invitacion", token);
      if (res.status === 401 && vista) return setVista({ ...vista, signedIn: false });
      const datos = (await res.json().catch(() => null)) as { ok?: boolean; path?: string; error?: string } | null;
      if (datos?.ok && typeof datos.path === "string") {
        router.replace(datos.path);
        return;
      }
      setError(datos?.error ?? "general");
    } catch {
      setError("general");
    } finally {
      setEnviando(false);
    }
  }

  if (!vista) {
    if (error) {
      return <Pantalla titulo={t("panel.invitacion.noSirve")} bajada={t(ERRORES[error] ?? ERRORES.general)} accion={<BotonEnlace href="/admin">{t("panel.cuenta.misEventos")}</BotonEnlace>} />;
    }
    return <Pantalla titulo={t("panel.invitacion.titulo")} bajada={t("panel.invitacion.cargando")} />;
  }

  // Quien ya está en el equipo (o es la dueña) va derecho a su panel, aunque la invitación ya se haya usado.
  if (vista.role && vista.panelPath) {
    return (
      <Pantalla
        titulo={vista.eventName ?? t("panel.invitacion.titulo")}
        bajada={vista.role === "owner" ? t("panel.invitacion.esTuyo") : t("panel.invitacion.yaEstas")}
        accion={<BotonEnlace href={vista.panelPath}>{t("panel.invitacion.irPanel")}</BotonEnlace>}
      />
    );
  }

  if (vista.state !== "open" || !vista.eventName) {
    return (
      <Pantalla titulo={t("panel.invitacion.noSirve")} bajada={t(ERRORES[vista.state] ?? ERRORES.missing)} accion={<BotonEnlace href="/admin">{t("panel.cuenta.misEventos")}</BotonEnlace>}>
        <p>{t("panel.invitacion.pedirOtra")}</p>
      </Pantalla>
    );
  }

  const quienInvita = vista.ownerName ? t("panel.invitacion.bajada", { quien: vista.ownerName, evento: vista.eventName }) : t("panel.invitacion.bajadaSinNombre", { evento: vista.eventName });

  if (!vista.signedIn) {
    if (!pollarKey) {
      return <Pantalla titulo={t("panel.invitacion.titulo")} bajada={t("panel.invitacion.sinCuentas")} accion={<BotonEnlace href="/">{t("noEncontrado.volver")}</BotonEnlace>} />;
    }
    return <EntrarOrganizador pollarKey={pollarKey} bajada={`${quienInvita} ${t("panel.invitacion.entrarPrimero")}`} />;
  }

  return (
    <Pantalla
      titulo={t("panel.invitacion.titulo")}
      bajada={quienInvita}
      accion={
        <Boton onClick={() => void aceptar()} disabled={enviando} aria-busy={enviando} grande>
          {t("panel.invitacion.sumarme")}
        </Boton>
      }
      nota={t("panel.invitacion.nota")}
    >
      {error && <Aviso tono="alerta">{t(ERRORES[error] ?? ERRORES.general)}</Aviso>}
      <p className="invitacion-evento">
        <strong>{vista.eventName}</strong>
      </p>
      <p>{t("panel.invitacion.queHace")}</p>
      <p className="chico apagado">{nombre ? t("panel.cuenta.quien", { nombre }) : t("panel.cuenta.quienSinNombre")}</p>
    </Pantalla>
  );
}
