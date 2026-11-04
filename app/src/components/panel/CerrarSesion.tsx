"use client";
// Cerrar sesión como organizador: primero la cuenta de Pollar en este navegador (si quedara abierta, la próxima
// persona que use el navegador entraría con un toque, porque Pollar firma el desafío sin preguntar), después la
// sesión de Rumbo, y de vuelta a /admin. Si Pollar no carga o no contesta, igual se cierra la de Rumbo.
import { useState } from "react";
import { loadPollar } from "@/components/evento/usePollar.ts";
import { useT } from "@/i18n/client.tsx";

export function CerrarSesion({ pollarKey }: { pollarKey: string | null }) {
  const t = useT();
  const [cerrando, setCerrando] = useState(false);

  async function cerrar() {
    if (cerrando) return;
    setCerrando(true);
    if (pollarKey) {
      try {
        await (await loadPollar(pollarKey)).logout();
      } catch (error) {
        console.warn("[pollar] No se pudo cerrar la cuenta en este navegador", error);
      }
    }
    try {
      await fetch("/api/organizador/salir", { method: "POST", credentials: "same-origin" });
    } catch {
      /* sin red: /admin dice si la sesión sigue */
    }
    window.location.assign("/admin");
  }

  return (
    <div className="panel-salir">
      <button type="button" className="enlace" onClick={cerrar} disabled={cerrando} aria-busy={cerrando}>
        {cerrando ? t("panel.cuenta.cerrando") : t("panel.cuenta.salir")}
      </button>
      <span className="apagado chico">{t("panel.cuenta.salirAyuda")}</span>
    </div>
  );
}
