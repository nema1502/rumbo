"use client";
// La pantalla de publicar: pide los pasos a /api/admin/<evento>/publicar uno tras otro (cada uno prepara una
// credencial) y dice cómo va, con palabras y una barra. Apenas el evento abre, lo dice y da el enlace para compartir;
// las credenciales del equipo se siguen preparando debajo, en una línea chica, sin frenar nada. Si un paso falla,
// reintenta solo un par de veces y después ofrece "Reintentar". Si otro paso está corriendo (otra pestaña), espera.
// Un borrador arranca solo únicamente con autoStart (se llegó desde "Publicar el evento", publicar-pedido.ts); si
// no, la pantalla pide tocar "Publicar el evento": un enlace de otro sitio no publica nada.
import { useCallback, useEffect, useRef, useState } from "react";
import { EnlaceDelEvento } from "@/components/panel/EnlaceDelEvento.tsx";
import { Aviso, Boton, BotonEnlace, Chip } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";
import type { PublishProgress } from "@/server/kit/publicar.ts";

/** Cuántas veces seguidas se reintenta solo un paso que falló antes de ofrecer "Reintentar". */
const AUTO_RETRIES = 2;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Problema = null | "fallo" | "borrador" | "tope" | "sesion";

export function Publicando({ slug, eventName, initial, autoStart }: { slug: string; eventName: string; initial: PublishProgress; autoStart: boolean }) {
  const t = useT();
  const [avance, setAvance] = useState<PublishProgress>(initial);
  const [problema, setProblema] = useState<Problema>(null);
  const [corriendo, setCorriendo] = useState(false);
  /** Si ya se pidió algún paso: sin autoStart, la pantalla espera el botón. */
  const [empezado, setEmpezado] = useState(autoStart);
  const vivo = useRef(true);
  const enCurso = useRef(false);

  const pendiente = (p: PublishProgress) => !p.published || p.done < p.total;

  const seguir = useCallback(async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    setEmpezado(true);
    setCorriendo(true);
    setProblema(null);
    let fallos = 0;
    let actual = initial;
    try {
      for (;;) {
        if (!vivo.current) return;
        let res: Response | null = null;
        try {
          res = await fetch(`/api/admin/${encodeURIComponent(slug)}/publicar`, { method: "POST", cache: "no-store" });
        } catch {
          res = null;
        }
        if (res?.ok) {
          fallos = 0;
          actual = (await res.json()) as PublishProgress;
          if (vivo.current) setAvance(actual);
          if (!pendiente(actual)) return;
          continue;
        }
        // Otro paso de este evento está corriendo (otra pestaña, o el anterior que todavía no soltó el turno): se espera.
        if (res?.status === 409) {
          await sleep(1500);
          continue;
        }
        if (res?.status === 401) return setProblema("sesion");
        if (res?.status === 422) {
          const motivo = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
          return setProblema(motivo === "too_many_contracts" ? "tope" : "borrador");
        }
        if (++fallos > AUTO_RETRIES) return setProblema("fallo");
        await sleep(2000 * fallos);
      }
    } finally {
      enCurso.current = false;
      if (vivo.current) setCorriendo(false);
    }
  }, [initial, slug]);

  // Se llega desde "Publicar el evento", al pie de un borrador largo, y la navegación conserva ese scroll: arriba,
  // donde está el título. Y cuando el evento abre, la pantalla cambia entera: arriba otra vez, con el foco en el
  // título para que el lector de pantalla diga que ya está publicado.
  const titulo = useRef<HTMLHeadingElement>(null);
  const abierto = useRef(initial.published);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    if (!avance.published || abierto.current) return;
    abierto.current = true;
    window.scrollTo(0, 0);
    titulo.current?.focus({ preventScroll: true });
  }, [avance.published]);

  useEffect(() => {
    vivo.current = true;
    if (autoStart && pendiente(initial)) void seguir();
    return () => {
      vivo.current = false;
    };
    // Una sola vez al abrir: después lo maneja "Reintentar".
  }, []);

  const equipoTotal = avance.total - avance.publicTotal;
  const equipoHechos = avance.done - avance.publicDone;
  const porcentaje = avance.total > 0 ? Math.round((avance.done / avance.total) * 100) : 0;

  const reintentar = problema === "fallo" && (
    <Boton onClick={() => void seguir()} disabled={corriendo} variante={avance.published ? "secundario" : "primario"} className={avance.published ? "boton-chico" : undefined}>
      {t("kit.publicando.reintentar")}
    </Boton>
  );

  if (!avance.published) {
    return (
      <section className="pantalla publicando">
        <header className="pantalla-cabecera">
          <p className="panel-sobre">
            <Chip estado="pendiente">{t("kit.armar.borrador")}</Chip>
            <span>{eventName}</span>
          </p>
          <h1>{empezado ? t("kit.publicando.titulo") : t("kit.publicando.confirmarTitulo")}</h1>
          <p className="bajada">{empezado ? t("kit.publicando.bajada") : t("kit.publicando.confirmar")}</p>
        </header>
        <div className="pantalla-cuerpo">
          {empezado && (
          <div className="publicando-avance" aria-live="polite">
            <p className="publicando-cifra">{t("kit.publicando.avance", { hechos: avance.done, total: avance.total })}</p>
            <div className="importar-barra" role="progressbar" aria-valuemin={0} aria-valuemax={avance.total} aria-valuenow={avance.done} aria-label={t("kit.publicando.titulo")}>
              <span style={{ width: `${Math.max(porcentaje, corriendo ? 4 : 0)}%` }} />
            </div>
            <p className="chico apagado">{t("kit.publicando.cuanto")}</p>
          </div>
          )}
          {problema === "fallo" && <Aviso tono="alerta">{t("kit.publicando.error")}</Aviso>}
          {problema === "borrador" && <Aviso tono="alerta">{t("kit.publicando.errorBorrador")}</Aviso>}
          {problema === "tope" && <Aviso tono="alerta">{t("kit.publicando.errorTope")}</Aviso>}
          {problema === "sesion" && <Aviso tono="alerta">{t("kit.publicando.errorSesion")}</Aviso>}
        </div>
        <div className="pantalla-accion">
          {!empezado && (
            <Boton onClick={() => void seguir()} grande>
              {t("kit.armar.publicar")}
            </Boton>
          )}
          {reintentar || (
            <BotonEnlace href={`/admin/${encodeURIComponent(slug)}/armar`} variante="secundario">
              {t("kit.publicando.volverBorrador")}
            </BotonEnlace>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="pantalla publicando">
      <header className="pantalla-cabecera">
        <p className="panel-sobre">
          <Chip estado="listo">{t("panel.cuenta.publicado")}</Chip>
          <span>{eventName}</span>
        </p>
        <h1 ref={titulo} tabIndex={-1} className="a-la-vista">
          {t("kit.publicando.listo")}
        </h1>
        <p className="bajada">{t("kit.publicando.listoBajada")}</p>
      </header>
      <div className="pantalla-cuerpo">
        {/* Lo que se vino a hacer: compartir. El enlace entero a la vista y Copiar como la acción principal. */}
        <EnlaceDelEvento slug={slug} principal />
        {equipoTotal > 0 && (
          <div className="publicando-equipo" aria-live="polite">
            <p className="chico apagado">
              {equipoHechos < equipoTotal ? t("kit.publicando.equipo", { hechos: equipoHechos, total: equipoTotal }) : t("kit.publicando.equipoListo")}
            </p>
            {equipoHechos < equipoTotal && (
              <div className="barra" role="progressbar" aria-valuemin={0} aria-valuemax={equipoTotal} aria-valuenow={equipoHechos} aria-label={t("kit.publicando.equipo", { hechos: equipoHechos, total: equipoTotal })}>
                <span style={{ width: `${Math.max(Math.round((equipoHechos / equipoTotal) * 100), corriendo ? 4 : 0)}%` }} />
              </div>
            )}
            {problema === "fallo" && (
              <p className="chico">
                {t("kit.publicando.errorEquipo")} {reintentar}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="pantalla-accion">
        <BotonEnlace href={`/admin/${encodeURIComponent(slug)}`} variante="secundario">
          {t("kit.publicando.irPanel")}
        </BotonEnlace>
      </div>
    </section>
  );
}
