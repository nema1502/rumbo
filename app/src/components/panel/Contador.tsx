// Un contador del panel: la etiqueta, el número grande, de cuánto, y la barra. Sin estado: sirve en el
// servidor (el informe) y en el cliente (el panel en vivo).
import type { ReactNode } from "react";

interface ContadorProps {
  etiqueta: string;
  valor: number;
  /** Sobre cuánto se dibuja la barra. Sin total, o con total 0, la barra queda vacía. */
  total: number | null;
  detalle: ReactNode;
  /** Una segunda línea chica, como "Pendientes de pago: 2". */
  extra?: ReactNode;
  tono?: "acento" | "verde" | "amarillo";
}

export function Contador({ etiqueta, valor, total, detalle, extra, tono = "acento" }: ContadorProps) {
  const porcentaje = total && total > 0 ? Math.min(100, Math.round((valor / total) * 100)) : 0;
  return (
    <div className="contador" role="group" aria-label={etiqueta}>
      <span className="contador-etiqueta">{etiqueta}</span>
      <span className="contador-valor">{valor}</span>
      <span className="contador-detalle">{detalle}</span>
      {extra && <span className="contador-extra">{extra}</span>}
      <div className={`barra barra-${tono}`} role="progressbar" aria-valuemin={0} aria-valuemax={total ?? 0} aria-valuenow={valor}>
        <span style={{ width: `${porcentaje}%` }} />
      </div>
    </div>
  );
}
