"use client";
// Abre el diálogo de impresión del navegador. La hoja de impresión está en app/admin/panel.css.
import type { ReactNode } from "react";
import { Boton } from "@/components/ui.tsx";

export function BotonImprimir({ children }: { children: ReactNode }) {
  return <Boton onClick={() => window.print()}>{children}</Boton>;
}
