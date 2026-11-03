"use client";
// Importar la lista de Luma o de Bevy, en cuatro momentos y una sola acción principal por vez:
// elegir el archivo, revisar lo que se leyó y a quiénes entran, mandar las credenciales de a poco (con su
// barra) y el resumen final. El archivo se lee en el servidor; acá solo se elige y se muestra.
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { Aviso, Boton, BotonEnlace, Campo, Tarjeta } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";
import type { CredentialKind } from "@/lib/credential-kinds.ts";
import type { GuestPreview, GuestStatus, ImportSummary, StatusBucket } from "@/server/kit/importar.ts";

type Fase =
  | { fase: "elegir" }
  | { fase: "leyendo" }
  | { fase: "vista"; preview: GuestPreview }
  | { fase: "enviando"; runId: string; summary: ImportSummary; hechas: number; total: number }
  | { fase: "listo"; runId: string; summary: ImportSummary; faltan: number };

interface Tanda {
  processed: number;
  activated: number;
  remaining: number;
  busy: boolean;
}

const ORDEN_ESTADOS: GuestStatus[] = ["approved", "pending", "waitlist", "declined", "cancelled", "unknown"];
const ERRORES: Record<string, string> = {
  empty: "kit.importar.error.vacio",
  no_text: "kit.importar.error.noTexto",
  no_email: "kit.importar.error.sinCorreo",
  too_big: "kit.importar.error.grande",
  draft: "kit.importar.error.borrador",
};

const dormir = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pedir(slug: string, form: FormData): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/admin/${slug}/importar`, { method: "POST", body: form });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* sin cuerpo */
  }
  if (!res.ok || body.ok !== true) throw new Error(typeof body.error === "string" ? body.error : "servidor");
  return body;
}

/** Lo que dejan las columnas que se leyeron, en palabras: "nombre, correo, estado y tipo de entrada". */
function columnasLeidas(t: ReturnType<typeof useT>, preview: GuestPreview): string {
  const partes = [preview.columns.name && t("kit.importar.col.nombre"), t("kit.importar.col.correo"), preview.columns.status && t("kit.importar.col.estado"), preview.columns.ticket && t("kit.importar.col.entrada"), preview.columns.diet && t("kit.importar.col.dieta")].filter(Boolean) as string[];
  return partes.join(", ");
}

export function Importador({ slug, volverA }: { slug: string; volverA: string }) {
  const t = useT();
  const [estado, setEstado] = useState<Fase>({ fase: "elegir" });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegidos, setElegidos] = useState<Set<GuestStatus>>(new Set());
  const [tipos, setTipos] = useState<Record<string, string>>({});
  const enCurso = useRef(false);

  const mensajeDe = useCallback((e: unknown) => t(ERRORES[e instanceof Error ? e.message : ""] ?? "kit.importar.error.servidor"), [t]);

  async function revisar() {
    if (!archivo) return;
    setError(null);
    setEstado({ fase: "leyendo" });
    try {
      const form = new FormData();
      form.set("accion", "vista");
      form.set("archivo", archivo);
      const preview = (await pedir(slug, form)).preview as GuestPreview;
      // Por defecto entran las aprobadas o confirmadas; si la lista no trae ninguna, todas las que se leyeron.
      const presentes = ORDEN_ESTADOS.filter((s) => preview.buckets[s]);
      setElegidos(new Set(presentes.includes("approved") ? ["approved"] : presentes));
      setTipos(Object.fromEntries(preview.tickets.map((e) => [e.key, e.suggestedTypeId ?? preview.defaultTypeId ?? ""])));
      setEstado({ fase: "vista", preview });
    } catch (e) {
      setError(mensajeDe(e));
      setEstado({ fase: "elegir" });
    }
  }

  /** Pide tandas hasta que no queda ninguna pendiente. Si dos seguidas no activan a nadie, se detiene y lo dice. */
  async function mandar(runId: string, summary: ImportSummary, total: number, pendientes: number) {
    if (enCurso.current) return;
    enCurso.current = true;
    let sinAvance = 0;
    let faltan = pendientes;
    let ultimo = summary;
    try {
      setEstado({ fase: "enviando", runId, summary, hechas: total - faltan, total });
      while (faltan > 0) {
        const form = new FormData();
        form.set("accion", "tanda");
        form.set("importacion", runId);
        const cuerpo = await pedir(slug, form);
        const tanda = cuerpo.result as Tanda;
        if (cuerpo.summary) ultimo = cuerpo.summary as ImportSummary;
        faltan = tanda.remaining;
        setEstado({ fase: "enviando", runId, summary: ultimo, hechas: total - faltan, total });
        if (tanda.busy) {
          await dormir(1000);
          continue;
        }
        sinAvance = tanda.activated === 0 ? sinAvance + 1 : 0;
        if (sinAvance >= 2) break;
        // De a poco: una pausa corta entre tandas, para no apurar al servicio de correo.
        await dormir(300);
      }
      setEstado({ fase: "listo", runId, summary: ultimo, faltan });
    } catch (e) {
      setError(mensajeDe(e));
      setEstado({ fase: "listo", runId, summary: ultimo, faltan });
    } finally {
      enCurso.current = false;
    }
  }

  async function importar(preview: GuestPreview) {
    if (!archivo) return;
    setError(null);
    try {
      const form = new FormData();
      form.set("accion", "importar");
      form.set("archivo", archivo);
      form.set("estados", JSON.stringify([...elegidos]));
      form.set("tipos", JSON.stringify(tipos));
      form.set("tipoPorDefecto", preview.defaultTypeId ?? "");
      const cuerpo = await pedir(slug, form);
      const summary = cuerpo.summary as ImportSummary;
      await mandar(cuerpo.runId as string, summary, summary.created, summary.created);
    } catch (e) {
      setError(mensajeDe(e));
    }
  }

  if (estado.fase === "elegir" || estado.fase === "leyendo") {
    const leyendo = estado.fase === "leyendo";
    return (
      <section className="pantalla importar">
        <header className="pantalla-cabecera">
          <h1>{t("kit.importar.titulo")}</h1>
          <p className="bajada">{t("kit.importar.bajada")}</p>
        </header>
        <div className="pantalla-cuerpo">
          {error && <Aviso tono="alerta">{error}</Aviso>}
          <Campo
            id="archivo"
            className="importar-archivo"
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            etiqueta={t("kit.importar.archivo")}
            ayuda={t("kit.importar.archivoAyuda")}
            disabled={leyendo}
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="pantalla-accion">
          <Boton grande disabled={!archivo || leyendo} aria-busy={leyendo || undefined} onClick={() => void revisar()}>
            {leyendo ? t("kit.importar.leyendo") : t("kit.importar.revisar")}
          </Boton>
          <p className="nota">
            <Link className="enlace" href={volverA}>
              {t("kit.importar.volver")}
            </Link>
          </p>
        </div>
      </section>
    );
  }

  if (estado.fase === "vista") {
    return (
      <Vista
        preview={estado.preview}
        elegidos={elegidos}
        setElegidos={setElegidos}
        tipos={tipos}
        setTipos={setTipos}
        error={error}
        onImportar={() => void importar(estado.preview)}
        onOtro={() => {
          setError(null);
          setEstado({ fase: "elegir" });
        }}
      />
    );
  }

  if (estado.fase === "enviando") {
    const porcentaje = estado.total === 0 ? 100 : Math.round((estado.hechas / estado.total) * 100);
    return (
      <section className="pantalla importar">
        <header className="pantalla-cabecera">
          <h1>{t("kit.importar.enviando", { hechas: estado.hechas, total: estado.total })}</h1>
          <p className="bajada">{t("kit.importar.enviandoNota")}</p>
        </header>
        <div className="pantalla-cuerpo">
          <div className="importar-barra" role="progressbar" aria-valuemin={0} aria-valuemax={estado.total} aria-valuenow={estado.hechas}>
            <span style={{ width: `${porcentaje}%` }} />
          </div>
        </div>
        <div className="pantalla-accion">
          <Boton grande disabled aria-busy>
            {t("kit.importar.enviando", { hechas: estado.hechas, total: estado.total })}
          </Boton>
        </div>
      </section>
    );
  }

  const { summary, faltan } = estado;
  return (
    <section className="pantalla importar">
      <header className="pantalla-cabecera">
        <h1>{t("kit.importar.listo")}</h1>
        <p className="importar-resumen">
          {t("kit.importar.resumen", { importadas: summary.created, repetidas: summary.duplicates, invalidas: summary.invalidEmail })}
        </p>
      </header>
      <div className="pantalla-cuerpo">
        {error && <Aviso tono="alerta">{error}</Aviso>}
        {summary.notSelected > 0 && <Aviso>{t("kit.importar.sinImportar", { n: summary.notSelected })}</Aviso>}
        <Aviso tono="listo">{t("kit.importar.correos", { n: summary.emailsSent })}</Aviso>
        {summary.emailsFailed > 0 && <Aviso>{t("kit.importar.correosFallaron", { n: summary.emailsFailed })}</Aviso>}
        {faltan > 0 && <Aviso tono="alerta">{t("kit.importar.faltan", { n: faltan })}</Aviso>}
      </div>
      <div className="pantalla-accion">
        {faltan > 0 ? (
          <>
            <Boton grande onClick={() => void mandar(estado.runId, summary, summary.created, faltan)}>
              {t("kit.importar.reintentar", { n: faltan })}
            </Boton>
            <p className="nota">
              <Link className="enlace" href={volverA}>
                {t("kit.importar.volver")}
              </Link>
            </p>
          </>
        ) : (
          <BotonEnlace href={volverA} grande>
            {t("kit.importar.volver")}
          </BotonEnlace>
        )}
      </div>
    </section>
  );
}

function Vista({
  preview,
  elegidos,
  setElegidos,
  tipos,
  setTipos,
  error,
  onImportar,
  onOtro,
}: {
  preview: GuestPreview;
  elegidos: Set<GuestStatus>;
  setElegidos: (s: Set<GuestStatus>) => void;
  tipos: Record<string, string>;
  setTipos: (m: Record<string, string>) => void;
  error: string | null;
  onImportar: () => void;
  onOtro: () => void;
}) {
  const t = useT();
  const presentes = ORDEN_ESTADOS.filter((s) => preview.buckets[s]);
  const suma = (campo: keyof StatusBucket) => presentes.filter((s) => elegidos.has(s)).reduce((n, s) => n + (preview.buckets[s]?.[campo] ?? 0), 0);
  const entran = suma("valid");
  const invalidos = suma("invalidEmail");
  const repetidasArchivo = suma("duplicatesInFile");
  const yaTienen = suma("alreadyHere");
  const conEntradas = useMemo(() => preview.tickets.some((e) => e.label), [preview.tickets]);

  const alternar = (estado: GuestStatus) => {
    const proximo = new Set(elegidos);
    if (proximo.has(estado)) proximo.delete(estado);
    else proximo.add(estado);
    setElegidos(proximo);
  };

  return (
    <section className="pantalla importar">
      <header className="pantalla-cabecera">
        <h1>{t("kit.importar.titulo")}</h1>
        <p className="bajada">{t("kit.importar.leida", { origen: t(`kit.importar.origen.${preview.source === "other" ? "otra" : preview.source}`), n: preview.total })}</p>
        <p className="apagado chico">
          {t("kit.importar.columnas", { lista: columnasLeidas(t, preview) })} {preview.ignored > 0 && t("kit.importar.ignoradas", { n: preview.ignored })}
        </p>
      </header>
      <div className="pantalla-cuerpo">
        {error && <Aviso tono="alerta">{error}</Aviso>}
        <Tarjeta className="importar-bloque">
          <h2>{t("kit.importar.quienes")}</h2>
          <ul className="importar-estados">
            {presentes.map((estado) => (
              <li key={estado}>
                <label>
                  <input type="checkbox" checked={elegidos.has(estado)} onChange={() => alternar(estado)} />
                  <span>{t(`kit.importar.estado.${estado}`)}</span>
                </label>
                <span className="cuantas">{preview.buckets[estado]?.valid ?? 0}</span>
              </li>
            ))}
          </ul>
        </Tarjeta>

        {conEntradas && (
          <Tarjeta className="importar-bloque">
            <h2>{t("kit.importar.tipos")}</h2>
            <ul className="importar-tipos">
              {preview.tickets.map((entrada) => (
                <li key={entrada.key}>
                  <span className="etiqueta">
                    {entrada.label || t("kit.importar.sinEntrada")}{" "}
                    <span className="apagado chico">{t("kit.importar.personas", { n: entrada.count })}</span>
                  </span>
                  <Campo id={`tipo-${entrada.key || "ninguna"}`} etiqueta={entrada.label || t("kit.importar.sinEntrada")} className="campo-sin-etiqueta">
                    <select
                      id={`tipo-${entrada.key || "ninguna"}`}
                      value={tipos[entrada.key] ?? ""}
                      onChange={(e) => setTipos({ ...tipos, [entrada.key]: e.target.value })}
                    >
                      {preview.types.map((tipo) => (
                        <option key={tipo.id} value={tipo.id}>
                          {tipo.name}
                        </option>
                      ))}
                    </select>
                  </Campo>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}

        {invalidos > 0 && <Aviso>{t("kit.importar.avisoInvalidos", { n: invalidos })}</Aviso>}
        {repetidasArchivo > 0 && <Aviso>{t("kit.importar.avisoRepetidasArchivo", { n: repetidasArchivo })}</Aviso>}
        {yaTienen > 0 && <Aviso>{t("kit.importar.avisoYaTienen", { n: yaTienen })}</Aviso>}
      </div>
      <div className="pantalla-accion">
        <Boton grande disabled={entran === 0 || !preview.defaultTypeId} onClick={onImportar}>
          {entran === 0 ? t("kit.importar.ninguna") : entran === 1 ? t("kit.importar.importarUna") : t("kit.importar.importar", { n: entran })}
        </Boton>
        <p className="nota">
          <button type="button" className="enlace" onClick={onOtro}>
            {t("kit.importar.otro")}
          </button>
        </p>
      </div>
    </section>
  );
}
