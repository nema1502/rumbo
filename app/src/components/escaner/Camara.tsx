"use client";
// La cámara del celular leyendo QR con jsQR. Dibuja cada cuadro en un lienzo escondido y lo decodifica
// unas ocho veces por segundo. Cuando hay una lectura la avisa y, mientras `activa` sea false (el
// veredicto está en pantalla), sigue filmando pero no decodifica.
import jsQR from "jsqr";
import { useEffect, useRef } from "react";

export type CameraProblem = "permiso" | "sinCamara";

interface Props {
  activa: boolean;
  etiqueta: string;
  onLectura: (texto: string) => void;
  onError: (problema: CameraProblem) => void;
}

/** Cada cuántos milisegundos se intenta leer un QR. */
const SCAN_EVERY_MS = 120;
/** El ancho máximo del cuadro que se decodifica: alcanza para un QR y no cansa al celular. */
const MAX_DECODE_WIDTH = 640;

export function Camara({ activa, etiqueta, onLectura, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activaRef = useRef(activa);
  const onLecturaRef = useRef(onLectura);
  const onErrorRef = useRef(onError);
  activaRef.current = activa;
  onLecturaRef.current = onLectura;
  onErrorRef.current = onError;

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let cancelado = false;
    let ultimo = 0;

    function tick(t: number) {
      frame = requestAnimationFrame(tick);
      if (!activaRef.current || t - ultimo < SCAN_EVERY_MS || !video || !canvas || video.readyState < 2) return;
      ultimo = t;
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return;
      const scale = Math.min(1, MAX_DECODE_WIDTH / width);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
      if (code?.data) onLecturaRef.current(code.data);
    }

    async function arrancar() {
      if (!navigator.mediaDevices?.getUserMedia) {
        onErrorRef.current("sinCamara");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        onErrorRef.current(name === "NotAllowedError" || name === "SecurityError" ? "permiso" : "sinCamara");
        return;
      }
      if (cancelado || !video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        /* autoplay bloqueado: el usuario toca y arranca */
      }
      frame = requestAnimationFrame(tick);
    }

    void arrancar();
    return () => {
      cancelado = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="esc-camara">
      <video ref={videoRef} aria-label={etiqueta} playsInline muted autoPlay />
      <canvas ref={canvasRef} hidden />
      <div className="esc-mira" aria-hidden="true" />
    </div>
  );
}
