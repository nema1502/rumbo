// Una entrada del evento: el nombre, el precio, qué incluye y su único botón. Si es paga, debajo va
// "o con el QR del banco", todavía deshabilitado y marcado "pronto".
import { BotonEnlace, Chip, Tarjeta } from "@/components/ui.tsx";
import { formatAmount, type T } from "@/i18n/index.ts";
import type { Lang } from "@/i18n/types.ts";
import { joinList } from "@/server/evento/fecha.ts";
import type { TicketType, TicketTypeBenefit } from "@/server/repo.ts";

interface Props {
  ticket: TicketType;
  benefits: TicketTypeBenefit[];
  href: string;
  lang: Lang;
  t: T;
}

/** Hasta tres cosas, y "y 6 más" si hay más: un evento de varios días trae una comida por franja y la lista no entra en la tarjeta. */
function listaCorta(lang: Lang, names: string[], t: T): string {
  if (names.length <= 3) return joinList(lang, names);
  return `${names.slice(0, 3).join(", ")} ${t("kit.evento.yMas", { n: names.length - 3 })}`;
}

export function FilaEntrada({ ticket, benefits, href, lang, t }: Props) {
  const free = ticket.priceUsdc === 0;
  return (
    <Tarjeta className="entrada" alzada>
      <div className="entrada-cabecera">
        <h3 className="entrada-nombre">{ticket.name}</h3>
        <span className={free ? "entrada-precio entrada-precio-gratis" : "entrada-precio"}>
          {free ? t("pago.gratis") : t("pago.precio", { monto: formatAmount(lang, ticket.priceUsdc) })}
        </span>
      </div>
      {benefits.length > 0 && <p className="entrada-incluye">{t("evento.entrada.incluye", { lista: listaCorta(lang, benefits.map((b) => b.name), t) })}</p>}
      <BotonEnlace href={href} grande>
        {free ? t("evento.entrada.inscribirme") : t("evento.entrada.comprar")}
      </BotonEnlace>
      {!free && (
        <p className="entrada-banco">
          <button type="button" disabled>
            {t("evento.entrada.banco")}
          </button>
          <Chip estado="neutro">{t("evento.entrada.pronto")}</Chip>
        </p>
      )}
    </Tarjeta>
  );
}
