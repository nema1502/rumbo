"use client";
// Copia un texto al portapapeles y lo dice durante un momento.
import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { Boton } from "@/components/ui.tsx";

interface BotonCopiarProps extends Omit<ComponentPropsWithoutRef<"button">, "onClick" | "children"> {
  /** Lo que se copia: el texto, o una función que lo arma al tocar (el QR vigente, un enlace con el origen de la página). */
  texto: string | (() => string);
  etiqueta: string;
  /** Lo que dice el botón apenas copió. */
  listo: string;
  /** Cuánto dura la marca de copiado, en milisegundos. */
  duracionMs?: number;
  /** Por defecto es un botón chico (el del panel). Con false, del tamaño de los demás. */
  chico?: boolean;
}

export function BotonCopiar({ texto, etiqueta, listo, duracionMs = 1800, chico = true, className, ...rest }: BotonCopiarProps) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copiar() {
    const valor = typeof texto === "function" ? texto() : texto;
    try {
      await navigator.clipboard.writeText(valor);
    } catch {
      // Sin permiso para el portapapeles (o sin https): se copia a la vieja usanza.
      const area = document.createElement("textarea");
      area.value = valor;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopiado(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiado(false), duracionMs);
  }

  return (
    <Boton variante="secundario" className={[chico && "boton-chico", className].filter(Boolean).join(" ")} onClick={copiar} aria-live="polite" {...rest}>
      {copiado ? listo : etiqueta}
    </Boton>
  );
}
