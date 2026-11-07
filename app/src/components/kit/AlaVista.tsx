"use client";
// Lo que dice cómo salió lo último que se hizo (guardado, el enlace nuevo, un cambio que no se guardó): al llegar,
// queda a la vista y con el foco, para que lo lea el lector de pantalla. Hace falta porque volver de guardar o de
// publicar conserva el scroll de donde estaba el botón, al pie de un borrador largo. Quien lo usa le da una key que
// cambia en cada llegada, así corre otra vez aunque el aviso sea el mismo.
import { useEffect, useRef, type ReactNode } from "react";

export function AlaVista({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: quieto ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className="a-la-vista">
      {children}
    </div>
  );
}
