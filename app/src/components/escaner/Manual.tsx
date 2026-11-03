"use client";
// El respaldo manual de la puerta (solo en el puesto Puerta): buscar a una persona por nombre o correo y
// marcarle la entrada a mano, o agregarla en el momento con una inscripción gratis. Buscar usa la red; sin
// red se busca por nombre en la lista que el celular ya bajó. Marcar la entrada no necesita red: entra a la
// misma cola que una lectura y se sincroniza cuando vuelve (lo hace Escaner.tsx con onMarcar).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Aviso, Boton, Campo, Chip } from "@/components/ui.tsx";
import { useLang, useT } from "@/i18n/client.tsx";
import { formatDate } from "@/i18n/index.ts";
import { isSearchable, searchSnapshotByName } from "@/lib/busqueda.ts";
import type { DoorAddError, DoorAddResponse, DoorMatch, DoorSearchResponse, LocalUsage, ScanSnapshot } from "@/lib/escaner-api.ts";
import { OPEN_TIMEOUT_MS, SYNC_TIMEOUT_MS, postJson } from "@/lib/http.ts";

interface Props {
  code: string;
  enLinea: boolean;
  snapshot: ScanSnapshot;
  /** Lo que este celular ya registró y todavía no llegó al servidor. */
  local: Map<string, LocalUsage>;
  onMarcar: (match: DoorMatch) => void;
  onVolver: () => void;
}

const DEBOUNCE_MS = 300;

export function Manual({ code, enLinea, snapshot, local, onMarcar, onVolver }: Props) {
  const t = useT();
  const lang = useLang();
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<DoorMatch[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const secuencia = useRef(0);
  // Lo que cambia solo (la foto del evento cada vez que sincroniza, el idioma) no tiene que repetir la búsqueda.
  const tRef = useRef(t);
  const snapshotRef = useRef(snapshot);
  const localRef = useRef(local);
  tRef.current = t;
  snapshotRef.current = snapshot;
  localRef.current = local;

  const [agregando, setAgregando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorAgregar, setErrorAgregar] = useState<string | null>(null);

  const entroEn = (passId: string, hasta: string | null): string | null => hasta ?? local.get(passId)?.checkedInAt ?? null;

  // La búsqueda se pide un momento después de que se deja de escribir; las respuestas viejas se descartan.
  useEffect(() => {
    if (!isSearchable(consulta)) {
      setResultados(null);
      setErrorBusqueda(null);
      setBuscando(false);
      return;
    }
    const mia = ++secuencia.current;
    const buscarAca = () => searchSnapshotByName(snapshotRef.current.passes, consulta, (passId) => localRef.current.get(passId)?.checkedInAt ?? null);
    const id = setTimeout(async () => {
      if (!enLinea) {
        setResultados(buscarAca());
        setErrorBusqueda(null);
        return;
      }
      setBuscando(true);
      try {
        const { status, data } = await postJson<DoorSearchResponse>("/api/scan/buscar", { code, query: consulta }, OPEN_TIMEOUT_MS);
        if (mia !== secuencia.current) return;
        if (status === 429) setErrorBusqueda(tRef.current("escaner.buscar.demasiadas"));
        else if (status !== 200 || !data) setErrorBusqueda(tRef.current("escaner.buscar.error"));
        else {
          setResultados(data.matches);
          setErrorBusqueda(null);
        }
      } catch {
        // Si la red no contestó, se busca por nombre con lo que ya hay: la puerta no se queda sin respaldo.
        if (mia !== secuencia.current) return;
        setResultados(buscarAca());
        setErrorBusqueda(null);
      } finally {
        if (mia === secuencia.current) setBuscando(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [consulta, enLinea, code]);

  async function agregar(event: FormEvent) {
    event.preventDefault();
    if (enviando || !enLinea) return;
    setEnviando(true);
    setErrorAgregar(null);
    try {
      const { data } = await postJson<DoorAddResponse>("/api/scan/agregar", { code, name: nombre, email: correo, lang }, SYNC_TIMEOUT_MS);
      if (data && data.kind !== "error") {
        // Quien ya estaba inscripta vuelve igual, para marcarle la entrada.
        onMarcar(data.match);
        return;
      }
      const error: DoorAddError = data && data.kind === "error" ? data.error : "failed";
      setErrorAgregar(t(`escaner.agregar.error.${error}`));
    } catch {
      setErrorAgregar(t("escaner.agregar.error.failed"));
    } finally {
      setEnviando(false);
    }
  }

  const hora = (iso: string) => formatDate(lang, iso, snapshot.event.timezone, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="esc-manual">
      <div className="esc-manual-buscar">
        <h2 className="esc-manual-titulo">{t("escaner.buscar.titulo")}</h2>
        <Campo
          id="esc-buscar"
          etiqueta={t("escaner.buscar.campo")}
          ayuda={!isSearchable(consulta) ? t("escaner.buscar.ayuda") : undefined}
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          maxLength={80}
        />
        {!enLinea && <Aviso>{t("escaner.buscar.sinConexion")}</Aviso>}
        {errorBusqueda && <Aviso tono="alerta">{errorBusqueda}</Aviso>}
        {buscando && <p className="apagado chico">{t("escaner.buscar.buscando")}</p>}
        {resultados && resultados.length === 0 && !buscando && <p className="apagado">{t("escaner.buscar.ninguno")}</p>}
        {resultados && resultados.length > 0 && (
          <ul className="esc-manual-lista">
            {resultados.map((match) => {
              const entro = entroEn(match.passId, match.checkedInAt);
              return (
                <li key={match.passId} className="esc-manual-fila">
                  <div className="esc-manual-quien">
                    <strong>{match.name}</strong>
                    <span className="apagado chico">{[match.emailHint, match.ticket].filter(Boolean).join(", ")}</span>
                  </div>
                  {entro ? (
                    <Chip estado="ganado">{t("escaner.buscar.entroA", { hora: hora(entro) })}</Chip>
                  ) : (
                    <Boton onClick={() => onMarcar(match)}>{t("escaner.buscar.marcar")}</Boton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="esc-manual-agregar">
        {agregando ? (
          <form onSubmit={agregar} className="esc-manual-form">
            <h2 className="esc-manual-titulo">{t("escaner.agregar.titulo")}</h2>
            <p className="apagado chico">{t("escaner.agregar.ayuda")}</p>
            {!enLinea && <Aviso tono="alerta">{t("escaner.agregar.sinConexion")}</Aviso>}
            <Campo
              id="esc-agregar-nombre"
              etiqueta={t("escaner.agregar.nombre")}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoComplete="off"
              maxLength={80}
              required
            />
            <Campo
              id="esc-agregar-correo"
              etiqueta={t("escaner.agregar.correo")}
              type="email"
              inputMode="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={120}
              required
            />
            {errorAgregar && <Aviso tono="alerta">{errorAgregar}</Aviso>}
            {enviando && <p className="apagado chico">{t("escaner.agregar.espera")}</p>}
            <Boton type="submit" grande disabled={enviando || !enLinea || !nombre.trim() || !correo.trim()}>
              {enviando ? t("escaner.agregar.agregando") : t("escaner.agregar.boton")}
            </Boton>
          </form>
        ) : (
          <Boton variante="secundario" onClick={() => setAgregando(true)}>
            {t("escaner.agregar.titulo")}
          </Boton>
        )}
      </div>

      <div className="fila esc-pie">
        <button type="button" className="enlace" onClick={onVolver}>
          {t("escaner.puerta.volver")}
        </button>
      </div>
    </div>
  );
}
