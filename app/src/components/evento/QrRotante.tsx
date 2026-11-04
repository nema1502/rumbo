"use client";
// El QR de la credencial en el celular: se arma solo cada 20 segundos, sin red, con la clave que el servidor
// entregó al abrir la credencial (src/lib/qr-live.ts). Una captura de pantalla vale lo que dura su ventana
// y la siguiente. Si el reloj del celular está desfasado, se corrige con la hora del servidor (src/lib/reloj.ts):
// al abrir, cada minuto mientras la pantalla está a la vista, al volver a ella y apenas se nota que el reloj
// saltó (el monotónico no salta: si los dos avanzaron distinto, el de pared se movió).
// Debajo, "Copiar el código" copia el texto del QR vigente: con eso un escáner sin cámara (una laptop, un
// celular por http) lo pega en "Escribir el código".
import { useEffect, useRef, useState } from "react";
import { BotonCopiar } from "@/components/panel/BotonCopiar.tsx";
import { useT } from "@/i18n/client.tsx";
import { WINDOW_SECONDS, msUntilNextWindow, windowOf } from "@/lib/qr-codec.ts";
import { buildLivePayload, type LiveGrant } from "@/lib/qr-live.ts";
import { renderQrSvg } from "@/lib/qr-svg.ts";
import { CLOCK_REMEASURE_MS, clockJumpSince, clockMark, measureClockOffset } from "@/lib/reloj.ts";

const CHECK_EVERY_MS = 500;
/** Cuánto dura la marca de "Copiado". */
const COPIED_MS = 2000;

export function QrRotante({ grant }: { grant: LiveGrant }) {
  const t = useT();
  const [svg, setSvg] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  /** La ventana que se está mostrando y cuántos milisegundos le quedaban cuando se armó, para la barra. */
  const [ventana, setVentana] = useState<{ numero: number; resta: number } | null>(null);
  const desfase = useRef(0);
  const actual = useRef(-1);
  /** El texto del QR que está en pantalla: lo que copia "Copiar el código". */
  const contenido = useRef("");

  useEffect(() => {
    let vivo = true;
    let midiendo = false;
    actual.current = -1;
    let marca = clockMark();

    async function medir() {
      if (midiendo) return;
      midiendo = true;
      const medida = await measureClockOffset();
      midiendo = false;
      // Sin red la medida es 0: se conserva la última que sí se midió.
      if (vivo && medida !== 0) desfase.current = medida;
    }

    async function armar() {
      // Si el reloj de pared saltó desde la última mirada, lo que se midió ya no vale: se vuelve a medir.
      const ahoraMarca = clockMark();
      if (clockJumpSince(marca, ahoraMarca) !== 0) void medir();
      marca = ahoraMarca;
      const ahora = Date.now() + desfase.current;
      const numero = windowOf(ahora);
      if (numero === actual.current) return;
      actual.current = numero;
      try {
        const texto = await buildLivePayload(grant, ahora);
        if (!vivo) return;
        contenido.current = texto;
        setSvg(renderQrSvg(texto, { cellSize: 4, margin: 2 }));
        setVentana({ numero, resta: msUntilNextWindow(ahora) });
        setFallo(false);
      } catch {
        if (vivo) setFallo(true);
      }
    }

    void armar();
    const id = setInterval(() => void armar(), CHECK_EVERY_MS);
    const cadaMinuto = setInterval(() => {
      if (document.visibilityState === "visible") void medir();
    }, CLOCK_REMEASURE_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") {
        void medir();
        void armar();
      }
    };
    document.addEventListener("visibilitychange", alVolver);
    // Con red, se corrige el reloj; si cambia la ventana, el próximo chequeo arma el QR que corresponde.
    void medir();
    return () => {
      vivo = false;
      clearInterval(id);
      clearInterval(cadaMinuto);
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
          {svg && (
            <BotonCopiar
              className="credencial-qr-copiar"
              texto={() => contenido.current}
              etiqueta={t("evento.credencial.copiarCodigo")}
              listo={t("evento.credencial.codigoCopiado")}
              duracionMs={COPIED_MS}
              title={t("evento.credencial.copiarCodigoAria")}
            />
          )}
          <p className="credencial-qr-aviso chico apagado">{t("evento.credencial.qrRota", { segundos: WINDOW_SECONDS })}</p>
        </>
      )}
    </div>
  );
}
