"use client";
// "Compartir el panel", para quien entró con su cuenta: el enlace con la clave del evento, que abre este panel sin
// cuenta (para quien coorganiza). La clave se pide al servidor recién al tocar "Ver el enlace"
// (/api/admin/<evento>/compartir): mientras nadie la pide, el evento no tiene ninguna.
import { useState } from "react";
import { Aviso, Boton, Tarjeta } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";
import { BotonCopiar } from "./BotonCopiar.tsx";

export function CompartirPanel({ slug }: { slug: string }) {
  const t = useT();
  const [enlace, setEnlace] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState(false);

  async function pedir() {
    setPidiendo(true);
    setError(false);
    try {
      const res = await fetch(`/api/admin/${encodeURIComponent(slug)}/compartir`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const { path } = (await res.json()) as { path: string };
      setEnlace(`${window.location.origin}${path}`);
    } catch {
      setError(true);
    } finally {
      setPidiendo(false);
    }
  }

  return (
    <Tarjeta className="compartir-panel">
      <h2>{t("panel.compartir.titulo")}</h2>
      <p className="chico">{t("panel.compartir.ayuda")}</p>
      {error && <Aviso tono="alerta">{t("panel.compartir.error")}</Aviso>}
      {enlace ? (
        <div className="compartir-enlace">
          <label className="oculto-visual" htmlFor={`compartir-${slug}`}>
            {t("panel.compartir.titulo")}
          </label>
          <input id={`compartir-${slug}`} type="text" readOnly value={enlace} onFocus={(e) => e.currentTarget.select()} spellCheck={false} />
          <BotonCopiar texto={enlace} etiqueta={t("panel.compartir.copiar")} listo={t("panel.puestos.copiado")} />
        </div>
      ) : (
        <Boton variante="secundario" className="boton-chico" onClick={() => void pedir()} disabled={pidiendo} aria-busy={pidiendo || undefined}>
          {t("panel.compartir.ver")}
        </Boton>
      )}
    </Tarjeta>
  );
}
