"use client";
// Para compartir en LinkedIn: la insignia de la persona y la de su equipo, dibujadas en el celular (un canvas) y
// bajadas como PNG. No llevan el QR ni el enlace de la credencial, que son la entrada y su clave: se pueden publicar
// sin riesgo. El equipo se pide al servidor en el momento, así sale con el nombre y las personas de ahora.
import { useState } from "react";
import { Aviso, Boton } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";
import type { PassTeamState } from "@/server/evento/equipo.ts";

export interface InsigniaLogo {
  src: string;
  alt: string;
  width: number;
  height: number;
}

interface Props {
  passId: string;
  accessKey: string;
  evento: string;
  fecha: string;
  lugar: string;
  persona: string;
  tipo: string;
  logos: InsigniaLogo[];
  conEquipos: boolean;
}

const LADO = 1200;
const ROSA = "#ea4b71";

function cargar(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

/** Parte un texto en renglones que entran en `ancho`, como mucho `max` (el último con puntos suspensivos). */
function renglones(ctx: CanvasRenderingContext2D, texto: string, ancho: number, max: number): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let actual = "";
  for (const p of palabras) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (ctx.measureText(prueba).width <= ancho || !actual) actual = prueba;
    else {
      lineas.push(actual);
      actual = p;
    }
  }
  if (actual) lineas.push(actual);
  if (lineas.length > max) {
    const cortadas = lineas.slice(0, max);
    let ultima = cortadas[max - 1];
    while (ultima.length > 1 && ctx.measureText(`${ultima}…`).width > ancho) ultima = ultima.slice(0, -1);
    cortadas[max - 1] = `${ultima}…`;
    return cortadas;
  }
  return lineas;
}

async function dibujar(opciones: { etiqueta: string; titulo: string; subtitulo: string; lineas: string[]; fecha: string; apoyo: string; pie: string; logos: InsigniaLogo[] }): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = LADO;
  canvas.height = LADO;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  await document.fonts?.ready;
  const display = getComputedStyle(document.documentElement).getPropertyValue("--display").trim() || "system-ui, sans-serif";
  const texto = getComputedStyle(document.documentElement).getPropertyValue("--texto").trim() || "system-ui, sans-serif";

  ctx.fillStyle = "#0d0d12";
  ctx.fillRect(0, 0, LADO, LADO);
  const brillo = ctx.createRadialGradient(LADO * 0.9, 0, 0, LADO * 0.9, 0, LADO * 0.8);
  brillo.addColorStop(0, "rgba(234,75,113,0.40)");
  brillo.addColorStop(1, "rgba(234,75,113,0)");
  ctx.fillStyle = brillo;
  ctx.fillRect(0, 0, LADO, LADO);

  const x = 80;
  let y = 120;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffb3c4";
  ctx.font = `600 34px ${texto}`;
  ctx.fillText(opciones.etiqueta.toUpperCase(), x, y);

  ctx.fillStyle = "#f4f4f6";
  ctx.font = `800 118px ${display}`;
  const titulo = renglones(ctx, opciones.titulo, LADO - 2 * x, 2);
  y += 40;
  for (const l of titulo) {
    y += 122;
    ctx.fillText(l, x, y);
  }

  ctx.fillStyle = ROSA;
  ctx.font = `700 66px ${display}`;
  y += 92;
  for (const l of renglones(ctx, opciones.subtitulo, LADO - 2 * x, 1)) ctx.fillText(l, x, y);

  ctx.fillStyle = "#d9d9e3";
  ctx.font = `500 40px ${texto}`;
  y += 10;
  for (const linea of opciones.lineas) {
    for (const l of renglones(ctx, linea, LADO - 2 * x, 2)) {
      y += 56;
      ctx.fillText(l, x, y);
    }
  }
  ctx.fillStyle = "#a9a9bb";
  ctx.font = `400 34px ${texto}`;
  y += 16;
  for (const l of renglones(ctx, opciones.fecha, LADO - 2 * x, 2)) {
    y += 48;
    ctx.fillText(l, x, y);
  }

  // Los aliados sobre una tarjeta blanca, en filas que entran en el ancho.
  const imagenes = (await Promise.all(opciones.logos.map(async (l) => ({ l, img: await cargar(l.src) })))).filter((e): e is { l: InsigniaLogo; img: HTMLImageElement } => e.img !== null);
  if (imagenes.length > 0) {
    const alto = 46;
    const hueco = 34;
    const interior = LADO - 2 * x - 2 * 44;
    const filas: Array<Array<{ img: HTMLImageElement; w: number }>> = [[]];
    let ancho = 0;
    for (const { l, img } of imagenes) {
      const w = Math.round((l.width / l.height) * alto);
      if (ancho > 0 && ancho + hueco + w > interior) {
        filas.push([]);
        ancho = 0;
      }
      filas[filas.length - 1].push({ img, w });
      ancho += (ancho > 0 ? hueco : 0) + w;
    }
    const altoTarjeta = 44 * 2 + filas.length * alto + (filas.length - 1) * 26 + 46;
    const arriba = LADO - 96 - altoTarjeta;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, arriba, LADO - 2 * x, altoTarjeta, 32);
    else ctx.rect(x, arriba, LADO - 2 * x, altoTarjeta);
    ctx.fill();
    ctx.fillStyle = "#4b5563";
    ctx.font = `500 26px ${texto}`;
    ctx.fillText(opciones.apoyo, x + 44, arriba + 56);
    let fy = arriba + 44 + 42;
    for (const fila of filas) {
      let fx = x + 44;
      for (const { img, w } of fila) {
        ctx.drawImage(img, fx, fy, w, alto);
        fx += w + hueco;
      }
      fy += alto + 26;
    }
  }
  ctx.fillStyle = "#8b8ba0";
  ctx.font = `400 26px ${texto}`;
  ctx.fillText(opciones.pie, x, LADO - 48);

  return new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
}

function bajar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const archivo = (texto: string) =>
  texto
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "insignia";

export function InsigniaLinkedIn(p: Props) {
  const t = useT();
  const [haciendo, setHaciendo] = useState<"persona" | "equipo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [equipo, setEquipo] = useState<PassTeamState["team"]>(null);

  async function traerEquipo(): Promise<PassTeamState["team"]> {
    if (!p.conEquipos) return null;
    try {
      const res = await fetch(`/api/pase/${encodeURIComponent(p.passId)}/equipo?k=${encodeURIComponent(p.accessKey)}`, { cache: "no-store" });
      if (!res.ok) return null;
      const team = ((await res.json()) as { state?: PassTeamState }).state?.team ?? null;
      setEquipo(team);
      return team;
    } catch {
      return null;
    }
  }

  const base = { fecha: `${p.fecha}, ${p.lugar}`, apoyo: t("evento.aliados.titulo"), pie: t("evento.insignia.pie"), logos: p.logos };

  async function insigniaPersona() {
    setHaciendo("persona");
    setError(null);
    try {
      const team = await traerEquipo();
      const blob = await dibujar({ ...base, etiqueta: p.tipo, titulo: p.persona, subtitulo: t("evento.insignia.en", { evento: p.evento }), lineas: team ? [t("evento.insignia.equipo", { equipo: team.name })] : [] });
      if (!blob) throw new Error("sin canvas");
      bajar(blob, `${archivo(p.evento)}-${archivo(p.persona)}.png`);
    } catch {
      setError(t("evento.insignia.error"));
    } finally {
      setHaciendo(null);
    }
  }

  async function insigniaEquipo() {
    setHaciendo("equipo");
    setError(null);
    try {
      const team = await traerEquipo();
      if (!team) {
        setError(t("evento.insignia.sinEquipo"));
        return;
      }
      const blob = await dibujar({ ...base, etiqueta: t("evento.insignia.etiquetaEquipo"), titulo: team.name, subtitulo: t("evento.insignia.en", { evento: p.evento }), lineas: [team.members.map((m) => m.name).join(", ")] });
      if (!blob) throw new Error("sin canvas");
      bajar(blob, `${archivo(p.evento)}-equipo-${archivo(team.name)}.png`);
    } catch {
      setError(t("evento.insignia.error"));
    } finally {
      setHaciendo(null);
    }
  }

  const etiquetaEvento = `#${p.evento.replace(/[^\p{L}\p{N}]+/gu, "")}`;
  const textoPost = equipo
    ? t("evento.insignia.textoConEquipo", { evento: p.evento, equipo: equipo.name, hashtag: etiquetaEvento })
    : t("evento.insignia.texto", { evento: p.evento, hashtag: etiquetaEvento });

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoPost);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setError(t("evento.insignia.error"));
    }
  }

  return (
    <section className="tarjeta insignia-linkedin" aria-labelledby="insignia-titulo">
      <h2 id="insignia-titulo" className="equipo-titulo">
        {t("evento.insignia.titulo")}
      </h2>
      <p className="apagado chico">{t("evento.insignia.bajada")}</p>
      <div className="equipo-acciones">
        <Boton className="boton-chico" onClick={() => void insigniaPersona()} disabled={haciendo !== null}>
          {haciendo === "persona" ? t("evento.insignia.armando") : t("evento.insignia.mia")}
        </Boton>
        {p.conEquipos && (
          <Boton variante="secundario" className="boton-chico" onClick={() => void insigniaEquipo()} disabled={haciendo !== null}>
            {haciendo === "equipo" ? t("evento.insignia.armando") : t("evento.insignia.delEquipo")}
          </Boton>
        )}
      </div>
      <p className="chico insignia-texto">{textoPost}</p>
      <div className="equipo-acciones">
        <Boton variante="secundario" className="boton-chico" onClick={() => void copiar()}>
          {copiado ? t("evento.insignia.copiado") : t("evento.insignia.copiar")}
        </Boton>
        <a className="boton boton-secundario boton-chico" href={`https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(textoPost)}`} target="_blank" rel="noopener noreferrer">
          {t("evento.insignia.abrirLinkedin")}
        </a>
      </div>
      {error && <Aviso tono="alerta">{error}</Aviso>}
    </section>
  );
}
