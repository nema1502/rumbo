// Las pantallas de quien organiza comparten estos estilos: el panel y el informe, con su hoja de impresión.
import type { ReactNode } from "react";
import "./panel.css";
import "@/components/kit/kit.css";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
