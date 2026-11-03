"use client";
// Cambia el idioma con ?lang=es|en en la misma página. Es un enlace común, no un Link de Next,
// a propósito: con una navegación completa el layout vuelve a leer el idioma y la cookie queda puesta.
import { usePathname, useSearchParams } from "next/navigation";
import { useLang, useT } from "@/i18n/client.tsx";
import { LANG_QUERY, otherLang } from "@/i18n/index.ts";

export function SelectorIdioma() {
  const lang = useLang();
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const next = new URLSearchParams(params.toString());
  next.set(LANG_QUERY, otherLang(lang));
  return (
    <a className="boton-icono" href={`${pathname}?${next.toString()}`} aria-label={t("nav.idiomaAria")} hrefLang={otherLang(lang)}>
      {t("nav.idioma")}
    </a>
  );
}
