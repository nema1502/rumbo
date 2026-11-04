"use client";
// Copia un enlace de esta misma app con el origen de la página (https://rum.bo/p/...), armado al tocar:
// el servidor no sabe desde qué dirección se abrió la página, el navegador sí.
import { BotonCopiar } from "@/components/panel/BotonCopiar.tsx";

export function BotonCopiarEnlace({ href, etiqueta, listo }: { href: string; etiqueta: string; listo: string }) {
  return <BotonCopiar texto={() => new URL(href, window.location.origin).toString()} etiqueta={etiqueta} listo={listo} chico={false} />;
}
