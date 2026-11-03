"use client";
// Copia un texto al portapapeles y lo dice durante un momento.
import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { Boton } from "@/components/ui.tsx";

interface BotonCopiarProps extends Omit<ComponentPropsWithoutRef<"button">, "onClick" | "children"> {
  texto: string;
  etiqueta: string;
  /** Lo que dice el botón apenas copió. */
  listo: string;
}

export function BotonCopiar({ texto, etiqueta, listo, className, ...rest }: BotonCopiarProps) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      // Sin permiso para el portapapeles (o sin https): se copia a la vieja usanza.
      const area = document.createElement("textarea");
      area.value = texto;
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
    timer.current = setTimeout(() => setCopiado(false), 1800);
  }

  return (
    <Boton variante="secundario" className={["boton-chico", className].filter(Boolean).join(" ")} onClick={copiar} aria-live="polite" {...rest}>
      {copiado ? listo : etiqueta}
    </Boton>
  );
}
