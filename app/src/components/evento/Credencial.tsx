// La credencial en pantalla: la entrada, el número, el QR grande sobre blanco, el nombre, el estado y
// lo que le toca a la persona con su chip (siempre palabra y color).
import type { ReactNode } from "react";
import { Chip, type EstadoChip } from "@/components/ui.tsx";
import type { T } from "@/i18n/index.ts";
import type { BenefitState, CredentialView } from "@/server/evento/credencial.ts";

const CHIP: Record<BenefitState, EstadoChip> = {
  pendiente: "pendiente",
  canjeado: "listo",
  pagada: "listo",
  paraRetirar: "pendiente",
  sorteo: "neutro",
  ganado: "ganado",
  entregado: "listo",
};

function Check() {
  return (
    <svg className="check" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function Credencial({ view, t, qr }: { view: CredentialView; t: T; qr: ReactNode }) {
  const status = view.checkedIn ? t("estado.entro") : view.paid ? t("evento.credencial.paga") : t("evento.credencial.inscripta");
  return (
    <article className="tarjeta tarjeta-alzada credencial" aria-label={t("evento.credencial.titulo")}>
      <div className="credencial-cabecera">
        <span>{view.ticketType.name}</span>
        <span>{t("evento.credencial.numero", { n: view.number, total: view.total })}</span>
      </div>
      <div className="credencial-cuerpo">
        {qr}
        <div className="credencial-datos">
          <p className="credencial-nombre">{view.person.name}</p>
          <Chip estado="listo">
            {view.checkedIn && <Check />}
            {status}
          </Chip>
          <h2 className="evento-subtitulo credencial-subtitulo">{t("evento.credencial.beneficios")}</h2>
          {view.benefits.length === 0 ? (
            <p className="apagado chico">{t("evento.credencial.sinBeneficios")}</p>
          ) : (
            <ul className="credencial-beneficios">
              {view.benefits.map((benefit) => (
                <li key={benefit.id}>
                  <span>{benefit.name}</span>
                  <Chip estado={CHIP[benefit.state]}>
                    {benefit.redeemed && <Check />}
                    {t(`evento.beneficio.${benefit.state}`)}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}
