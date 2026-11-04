"use client";
// Lo que ve quien atiende un stand debajo de la cámara: cuántas personas pasaron, cuántas aceptaron compartir
// su contacto y cuántas todavía no contestaron. La pregunta ("¿querés compartir tu contacto con este
// stand?") le llega a la persona en su propia credencial, no acá: este resumen solo muestra qué respondió.
// Con el nombre únicamente de quien dijo que sí; del resto, apenas "Una visita" y la hora (el código de la
// credencial no se muestra: no es un nombre y a quien atiende no le sirve).
import { Chip, type EstadoChip } from "@/components/ui.tsx";
import { useLang, useT } from "@/i18n/client.tsx";
import { formatDate } from "@/i18n/index.ts";
import type { ConsentState, ScanSnapshot } from "@/lib/escaner-api.ts";
import { formatStationCode } from "@/lib/station-code.ts";

const CHIP: Record<ConsentState, EstadoChip> = { pending: "pendiente", granted: "listo", declined: "neutro" };
const RECENT = 4;

export function ResumenStand({ snapshot, code }: { snapshot: ScanSnapshot; code: string }) {
  const t = useT();
  const lang = useLang();
  const visits = snapshot.stand?.visits ?? [];
  const accepted = visits.filter((v) => v.consent === "granted").length;
  const waiting = visits.filter((v) => v.consent === "pending").length;

  return (
    <section className="esc-stand" aria-label={t("stands.escaner.ultimas")}>
      <div className="esc-stand-cifras">
        <Cifra valor={visits.length} etiqueta={t("stands.escaner.visitas")} />
        <Cifra valor={accepted} etiqueta={t("stands.escaner.aceptaron")} tono="verde" />
        <Cifra valor={waiting} etiqueta={t("stands.escaner.esperando")} tono="acento" />
      </div>

      <p className="esc-stand-regla chico">{t("stands.escaner.regla")}</p>

      <h2 className="esc-stand-titulo">{t("stands.escaner.ultimas")}</h2>
      {visits.length === 0 ? (
        <p className="apagado chico">{t("stands.escaner.sinVisitas")}</p>
      ) : (
        <ul className="esc-stand-visitas">
          {visits.slice(0, RECENT).map((visit) => (
            <li key={visit.passId}>
              <span className="esc-stand-quien">
                <strong>{visit.name || t("escaner.visitaSinNombre")}</strong>
                <span className="apagado chico" suppressHydrationWarning>
                  {formatDate(lang, visit.at, snapshot.event.timezone, { hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
              <Chip estado={CHIP[visit.consent]}>{t(`stands.escaner.estado.${visit.consent}`)}</Chip>
            </li>
          ))}
        </ul>
      )}

      <a className="boton boton-secundario" href={`/stand/${formatStationCode(code)}`}>
        {t("stands.escaner.contactos")}
      </a>
    </section>
  );
}

function Cifra({ valor, etiqueta, tono }: { valor: number; etiqueta: string; tono?: "verde" | "acento" }) {
  return (
    <div className={`esc-stand-cifra${tono ? ` esc-stand-cifra-${tono}` : ""}`} role="group" aria-label={etiqueta}>
      <span className="esc-stand-numero">{valor}</span>
      <span className="esc-stand-etiqueta">{etiqueta}</span>
    </div>
  );
}
