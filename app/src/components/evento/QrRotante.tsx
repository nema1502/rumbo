"use client";
// El QR de la credencial en el celular: se arma solo cada 20 segundos, sin red, con la clave que el servidor
// entregó al abrir la credencial (src/lib/qr-live.ts). Una captura de pantalla vale lo que dura su ventana
// y la siguiente. Si el reloj del celular está desfasado, se corrige con la hora del servidor al abrir con red.
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client.tsx";
import { WINDOW_SECONDS, msUntilNextWindow, windowOf } from "@/lib/qr-codec.ts";
import { buildLivePayload, clockOffset, type LiveGrant } from "@/lib/qr-live.ts";
import { renderQrSvg } from "@/lib/qr-svg.ts";

const CHECK_EVERY_MS = 500;

/** La hora del servidor menos la de este celular, medida con el viaje de ida y vuelta. 0 si no hay red. */
async function medirReloj(): Promise<number> {
  try {
    const before = Date.now();
    const response = await fetch("/api/hora", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    const after = Date.now();
    if (!response.ok) return 0;
    const { now } = (await response.json()) as { now?: number };
    return typeof now === "number" ? clockOffset(now + (after - before) / 2, after) : 0;
  } catch {
    return 0;
  }
}

export function QrRotante({ grant }: { grant: LiveGrant }) {
  const t = useT();
  const [svg, setSvg] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  /** La ventana que se está mostrando y cuántos milisegundos le quedaban cuando se armó, para la barra. */
  const [ventana, setVentana] = useState<{ numero: number; resta: number } | null>(null);
  const desfase = useRef(0);
  const actual = useRef(-1);

  useEffect(() => {
    let vivo = true;
    actual.current = -1;

    async function armar() {
      const ahora = Date.now() + desfase.current;
      const numero = windowOf(ahora);
      if (numero === actual.current) return;
      actual.current = numero;
      try {
        const contenido = await buildLivePayload(grant, ahora);
        if (!vivo) return;
        setSvg(renderQrSvg(contenido, { cellSize: 4, margin: 2 }));
        setVentana({ numero, resta: msUntilNextWindow(ahora) });
        setFallo(false);
      } catch {
        if (vivo) setFallo(true);
      }
    }

    void armar();
    const id = setInterval(() => void armar(), CHECK_EVERY_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") void armar();
    };
    document.addEventListener("visibilitychange", alVolver);
    // Con red, se corrige el reloj; si cambia la ventana, el próximo chequeo arma el QR que corresponde.
    void medirReloj().then((medida) => {
      if (vivo) desfase.current = medida;
    });
    return () => {
      vivo = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [grant]);

  return (
    <div className="credencial-qr-bloque">
      <div className="credencial-qr" role="img" aria-label={t("evento.credencial.qr")}>
        {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="credencial-qr-vacio" />}
      </div>
      {fallo ? (
        <p className="credencial-qr-aviso chico" role="alert">
          {t("evento.credencial.qrFallo")}
        </p>
      ) : (
        <>
          {ventana && (
            <div className="credencial-qr-barra" aria-hidden="true">
              <span key={ventana.numero} style={{ animationDuration: `${ventana.resta}ms` }} />
            </div>
          )}
          <p className="credencial-qr-aviso chico apagado">{t("evento.credencial.qrRota", { segundos: WINDOW_SECONDS })}</p>
        </>
      )}
    </div>
  );
}
