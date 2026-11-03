"use client";
// El veredicto de una lectura, a pantalla entera: verde (entró, canjeado), amarillo (ya entró, ya
// canjeado, con la hora) o neutro (no corresponde, con el motivo). Siempre palabra y color. Se cierra
// solo a los pocos segundos, o al tocar.
import { useEffect } from "react";
import { useLang, useT } from "@/i18n/client.tsx";
import { formatDate } from "@/i18n/index.ts";
import type { ScanStation, Verdict } from "@/lib/escaner-api.ts";

interface Props {
  veredicto: Verdict;
  puesto: ScanStation;
  timezone: string;
  onCerrar: () => void;
}

/** Cuánto queda en pantalla: lo que no corresponde, un poco más, para leer el motivo. */
const DISMISS_MS: Record<Verdict["kind"], number> = { ok: 3500, already: 4500, no: 6500 };

function Icono({ kind }: { kind: Verdict["kind"] }) {
  const common = { className: "esc-veredicto-icono", viewBox: "0 0 64 64", fill: "none", stroke: "currentColor", strokeWidth: 5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "ok") {
    return (
      <svg {...common}>
        <circle cx="32" cy="32" r="27" />
        <path d="M19 33l9 9 17-19" />
      </svg>
    );
  }
  if (kind === "already") {
    return (
      <svg {...common}>
        <circle cx="32" cy="32" r="27" />
        <path d="M32 17v16l10 6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="32" cy="32" r="27" />
      <path d="M13 13l38 38" />
    </svg>
  );
}

export function Veredicto({ veredicto, puesto, timezone, onCerrar }: Props) {
  const t = useT();
  const lang = useLang();

  useEffect(() => {
    const id = setTimeout(onCerrar, DISMISS_MS[veredicto.kind]);
    return () => clearTimeout(id);
  }, [veredicto, onCerrar]);

  const titulo =
    veredicto.kind === "ok"
      ? t(veredicto.action === "checkin" ? "escaner.entro" : veredicto.action === "visit" ? "stands.escaner.visita" : "escaner.canjeado")
      : veredicto.kind === "already"
        ? t(veredicto.action === "checkin" ? "escaner.yaEntro" : veredicto.action === "visit" ? "stands.escaner.yaVisito" : "escaner.yaCanjeado")
        : t("escaner.noCorresponde");

  // En un stand, una visita nueva dice lo que pasa con el contacto: la persona decide desde su celular.
  const detalle =
    veredicto.kind === "already"
      ? t("escaner.aLas", { hora: formatDate(lang, veredicto.at, timezone, { hour: "2-digit", minute: "2-digit" }) })
      : veredicto.kind === "no"
        ? t(`escaner.motivo.${veredicto.reason}`, { beneficio: puesto.name })
        : puesto.kind === "stand"
          ? t("stands.escaner.pregunta")
          : puesto.kind === "benefit"
            ? puesto.name
            : null;

  const nombre = veredicto.name || (veredicto.passId ? t("escaner.sinNombre", { id: veredicto.passId }) : null);

  return (
    <div className={`esc-veredicto esc-veredicto-${veredicto.kind}`} role="dialog" aria-modal="true" aria-live="assertive" onClick={onCerrar}>
      <div className="esc-veredicto-panel">
        <Icono kind={veredicto.kind} />
        <h2 className="esc-veredicto-titulo">{titulo}</h2>
        {nombre && <p className="esc-veredicto-nombre">{nombre}</p>}
        {detalle && <p className="esc-veredicto-detalle">{detalle}</p>}
      </div>
      <button type="button" className="esc-veredicto-boton" onClick={onCerrar}>
        {t("escaner.siguiente")}
      </button>
    </div>
  );
}
