// La marca: la brújula junto al nombre (docs/marca.md). El anillo y la aguja de atrás toman el
// color del texto; la punta siempre es naranja.
import Link from "next/link";
import type { SVGProps } from "react";

export function LogoRumbo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...props}>
      <circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="3" opacity=".5" />
      <g transform="rotate(35 32 32)">
        <path d="M32 4 L41 32 L32 28 L23 32 Z" fill="#E8541E" />
        <path d="M32 60 L23 32 L32 36 L41 32 Z" fill="currentColor" opacity=".85" />
      </g>
      <circle cx="32" cy="32" r="4" fill="currentColor" />
    </svg>
  );
}

/** El enlace de la cabecera: la brújula y "Rumbo", de vuelta al inicio. */
export function Marca({ etiqueta }: { etiqueta: string }) {
  return (
    <Link className="marca" href="/" aria-label={etiqueta}>
      <LogoRumbo />
      Rumbo
    </Link>
  );
}
