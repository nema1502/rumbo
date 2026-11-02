"use client";
// El botón de día y noche. Lo elegido se recuerda en el navegador; sin elección, manda el sistema.
// El layout tiene un script que aplica lo recordado antes de pintar, para que no parpadee.
import { useT } from "@/i18n/client.tsx";

export const THEME_STORAGE_KEY = "rumbo.theme";

export function BotonTema() {
  const t = useT();
  function alternar() {
    const root = document.documentElement;
    const actual = root.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const siguiente = actual === "dark" ? "light" : "dark";
    root.dataset.theme = siguiente;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, siguiente);
    } catch {
      /* sin almacenamiento: vale solo para esta página */
    }
  }
  return (
    <button className="boton-icono" type="button" onClick={alternar} aria-label={t("nav.tema")}>
      <svg className="solo-dia" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
      <svg className="solo-noche" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
      </svg>
    </button>
  );
}
