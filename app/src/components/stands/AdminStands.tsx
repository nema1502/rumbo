"use client";
// "Stands y ruta", para quien organiza: un stand por auspiciante (nombre, logo y lo que regala), la meta de la
// ruta ("visitá 4 de 6 stands") y, por cada auspiciante, sus números y el código con el que su gente abre el
// escáner y su panel. Los números se vuelven a pedir cada cinco segundos.
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BotonCopiar } from "@/components/panel/BotonCopiar.tsx";
import { Aviso, Boton, BotonEnlace, Campo, Chip, Tarjeta } from "@/components/ui.tsx";
import { useT } from "@/i18n/client.tsx";
import { formatStationCode } from "@/lib/station-code.ts";
import type { AdminStandRow, AdminStandsState } from "@/server/stands.ts";
import { Logo } from "./RutaCredencial.tsx";

const POLL_MS = 5000;

export function AdminStands({ slug, initial }: { slug: string; initial: AdminStandsState }) {
  const t = useT();
  const [state, setState] = useState<AdminStandsState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [vencida, setVencida] = useState(false);
  const [origin, setOrigin] = useState("");
  const [meta, setMeta] = useState(String(initial.goal?.target ?? Math.min(4, Math.max(1, initial.stands.length))));
  const [premio, setPremio] = useState(initial.goal?.prizeName ?? "");
  const [metaGuardada, setMetaGuardada] = useState(false);

  const api = `/api/admin/${slug}/stands`;

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const traer = useCallback(async () => {
    try {
      const res = await fetch(api, { cache: "no-store" });
      if (res.status === 401) return setVencida(true);
      if (res.ok) setState((await res.json()) as AdminStandsState);
    } catch {
      /* se reintenta en el próximo ciclo */
    }
  }, [api]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void traer();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [traer]);

  /** Manda una acción; si sale bien, el estado nuevo reemplaza al anterior. Devuelve si salió bien. */
  async function accion(cuerpo: Record<string, unknown>): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
      if (res.status === 401) {
        setVencida(true);
        return false;
      }
      const data = (await res.json()) as AdminStandsState & { error?: string };
      if (!res.ok) {
        const clave = `stands.admin.error.${data.error}`;
        const texto = t(clave);
        setError(texto === clave ? t("stands.admin.error") : texto);
        return false;
      }
      setState(data);
      return true;
    } catch {
      setError(t("stands.admin.error"));
      return false;
    }
  }

  async function guardarMeta(event: FormEvent) {
    event.preventDefault();
    setMetaGuardada(false);
    if (await accion({ action: "goal", target: Number(meta), prizeName: premio })) {
      setMetaGuardada(true);
      setTimeout(() => setMetaGuardada(false), 2500);
    }
  }

  const { stands, route, goal, screen } = state;

  return (
    <section className="panel">
      <header className="panel-cabecera">
        <p className="panel-sobre">
          <span>{t("stands.admin.titulo")}</span>
        </p>
        <h1>{state.event.name}</h1>
        <p className="bajada">{t("stands.admin.bajada")}</p>
        <div className="fila">
          <BotonEnlace variante="secundario" className="boton-chico" href={`/admin/${slug}`}>
            {t("stands.admin.volver")}
          </BotonEnlace>
          <BotonEnlace variante="secundario" className="boton-chico" href={`/vivo/${slug}`}>
            {t("stands.admin.pantalla")}
          </BotonEnlace>
        </div>
      </header>

      {vencida && (
        <Aviso tono="alerta">
          {t("stands.admin.sesionVencida")}{" "}
          <Link className="enlace" href={`/admin/${slug}`}>
            {t("panel.volverAEntrar")}
          </Link>
        </Aviso>
      )}
      {error && <Aviso tono="alerta">{error}</Aviso>}

      <div className="panel-columnas">
        <Tarjeta>
          <h2>{t("stands.admin.meta.titulo")}</h2>
          <p className="chico">{t("stands.admin.meta.ayuda")}</p>
          {stands.length === 0 ? (
            <Aviso>{t("stands.admin.meta.sinStands")}</Aviso>
          ) : (
            <form className="admin-meta" onSubmit={guardarMeta}>
              <Campo id="meta-cuantos" etiqueta={t("stands.admin.meta.cuantos")} type="number" min={1} max={stands.length} value={meta} onChange={(e) => setMeta(e.target.value)} required />
              <Campo id="meta-premio" etiqueta={t("stands.admin.meta.premio")} value={premio} maxLength={60} onChange={(e) => setPremio(e.target.value)} />
              <div className="fila">
                <Boton type="submit" variante="secundario">
                  {t("stands.admin.meta.guardar")}
                </Boton>
                {metaGuardada && <Chip estado="listo">{t("stands.admin.guardado")}</Chip>}
              </div>
            </form>
          )}
          <p className="chico secundario admin-meta-estado">
            {goal ? t("stands.admin.meta.estado", { meta: route.target ?? goal.target, total: stands.length }) : t("stands.admin.meta.sinMeta")}
          </p>
          {stands.length > 0 && <p className="chico secundario">{t("stands.admin.ruta", { participan: route.participants, completaron: route.completed })}</p>}
        </Tarjeta>

        <Tarjeta>
          <h2>{t("stands.admin.agregar")}</h2>
          <FormularioStand
            key={stands.length}
            beneficios={state.benefits}
            enviar={(valores) => accion({ action: "create", ...valores })}
            etiqueta={t("stands.admin.crear")}
            idBase="nuevo"
          />
        </Tarjeta>
      </div>

      {stands.length === 0 ? (
        <Aviso>{t("stands.admin.vacio")}</Aviso>
      ) : (
        <ul className="admin-stands">
          {stands.map((stand) => (
            <TarjetaStand
              key={stand.id}
              stand={stand}
              eventName={state.event.name}
              origin={origin}
              beneficios={state.benefits}
              onSacar={() => {
                if (window.confirm(t("stands.admin.confirmarSacar", { nombre: stand.name }))) void accion({ action: "delete", standId: stand.id });
              }}
              onRegenerar={() => {
                if (window.confirm(t("stands.admin.confirmarRegenerar", { nombre: stand.name }))) void accion({ action: "regenerate", standId: stand.id });
              }}
              onEditar={(valores) => accion({ action: "update", standId: stand.id, ...valores })}
            />
          ))}
        </ul>
      )}

      {stands.length > 0 && (
        <Tarjeta>
          <h2>{t("stands.admin.pantalla.titulo")}</h2>
          <p className="chico">{t("stands.admin.pantalla.ayuda")}</p>
          {screen.length === 0 ? (
            <p className="chico apagado">{t("stands.admin.pantalla.vacia")}</p>
          ) : (
            <ol className="admin-pantalla">
              {screen.map((row) => (
                <li key={row.passId}>
                  <span className="admin-pantalla-puesto">{row.rank}</span>
                  <span className="admin-pantalla-nombre">{row.label ?? t("vivo.anonimo")}</span>
                  <span className="chico apagado">{t("stands.admin.pantalla.avance", { n: row.visited })}</span>
                  {row.hidden ? (
                    <Chip estado="neutro">{t("stands.admin.pantalla.oculto")}</Chip>
                  ) : (
                    <Boton variante="secundario" className="boton-chico" onClick={() => void accion({ action: "hide", passId: row.passId })}>
                      {t("stands.admin.pantalla.ocultar")}
                    </Boton>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Tarjeta>
      )}
    </section>
  );
}

interface Valores {
  name: string;
  logoUrl: string;
  benefitId: string;
}

function FormularioStand({
  beneficios,
  enviar,
  etiqueta,
  idBase,
  inicial,
}: {
  beneficios: Array<{ id: string; name: string }>;
  enviar: (valores: Valores) => Promise<boolean>;
  etiqueta: string;
  idBase: string;
  inicial?: Valores;
}) {
  const t = useT();
  const [valores, setValores] = useState<Valores>(inicial ?? { name: "", logoUrl: "", benefitId: "" });
  const [enviando, setEnviando] = useState(false);

  async function alEnviar(event: FormEvent) {
    event.preventDefault();
    setEnviando(true);
    const bien = await enviar(valores);
    setEnviando(false);
    if (bien && !inicial) setValores({ name: "", logoUrl: "", benefitId: "" });
  }

  return (
    <form className="admin-form-stand" onSubmit={alEnviar}>
      <Campo id={`${idBase}-nombre`} etiqueta={t("stands.admin.nombre")} value={valores.name} maxLength={60} onChange={(e) => setValores({ ...valores, name: e.target.value })} required />
      <Campo id={`${idBase}-logo`} etiqueta={t("stands.admin.logo")} value={valores.logoUrl} placeholder="/muestra/logo.svg" autoComplete="off" onChange={(e) => setValores({ ...valores, logoUrl: e.target.value })} />
      {beneficios.length > 0 && (
        <Campo id={`${idBase}-beneficio`} etiqueta={t("stands.admin.beneficio")}>
          <select id={`${idBase}-beneficio`} value={valores.benefitId} onChange={(e) => setValores({ ...valores, benefitId: e.target.value })}>
            <option value="">{t("stands.admin.ninguno")}</option>
            {beneficios.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Campo>
      )}
      <Boton type="submit" variante="secundario" disabled={enviando || !valores.name.trim()}>
        {etiqueta}
      </Boton>
    </form>
  );
}

function TarjetaStand({
  stand,
  eventName,
  origin,
  beneficios,
  onSacar,
  onRegenerar,
  onEditar,
}: {
  stand: AdminStandRow;
  eventName: string;
  origin: string;
  beneficios: Array<{ id: string; name: string }>;
  onSacar: () => void;
  onRegenerar: () => void;
  onEditar: (valores: Valores) => Promise<boolean>;
}) {
  const t = useT();
  const codigo = stand.code ? formatStationCode(stand.code) : "";
  const { report } = stand;
  return (
    <li className="tarjeta admin-stand">
      <div className="admin-stand-cabecera">
        <Logo stand={stand} />
        <h3>{stand.name}</h3>
        <button type="button" className="enlace admin-stand-sacar" onClick={onSacar}>
          {t("stands.admin.sacar")}
        </button>
      </div>

      <dl className="admin-stand-cifras">
        <div>
          <dt>{t("stands.admin.cifra.visitas")}</dt>
          <dd>{report.visits}</dd>
        </div>
        <div>
          <dt>{t("stands.admin.cifra.aceptaron")}</dt>
          <dd>{report.contactsAccepted}</dd>
        </div>
        {report.benefit && (
          <div>
            <dt>{t("stands.admin.cifra.canjes", { beneficio: report.benefit.name })}</dt>
            <dd>{report.benefit.redeemed}</dd>
          </div>
        )}
        <div>
          <dt>{t("stands.admin.cifra.ruta")}</dt>
          <dd>{report.routeCompleted}</dd>
        </div>
      </dl>

      {stand.code && (
        <div className="admin-stand-codigo">
          <span className="chico apagado">{t("stands.admin.codigo")}</span>
          <span className="codigo">{codigo}</span>
          <BotonCopiar
            texto={t("stands.admin.mensaje", { auspiciante: stand.name, evento: eventName, url: `${origin}/scan`, codigo })}
            etiqueta={t("stands.admin.copiar")}
            listo={t("stands.admin.copiado")}
            aria-label={t("stands.admin.copiarAria", { auspiciante: stand.name })}
          />
          <BotonEnlace variante="secundario" className="boton-chico" href={`/stand/${codigo}`}>
            {t("stands.admin.abrirPanel")}
          </BotonEnlace>
          <button type="button" className="enlace" onClick={onRegenerar}>
            {t("stands.admin.regenerar")}
          </button>
        </div>
      )}
      {stand.code && <p className="chico apagado admin-stand-codigo-ayuda">{t("stands.admin.codigoAyuda")}</p>}

      <details className="admin-stand-editar">
        <summary>{t("stands.admin.editar")}</summary>
        <FormularioStand
          idBase={`editar-${stand.id}`}
          beneficios={beneficios}
          etiqueta={t("accion.guardar")}
          inicial={{ name: stand.name, logoUrl: stand.logoUrl ?? "", benefitId: stand.benefitId ?? "" }}
          enviar={onEditar}
        />
      </details>
    </li>
  );
}
