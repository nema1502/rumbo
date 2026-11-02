// El correo con el enlace personal a la credencial. Lleva el enlace y nada más que haga falta
// guardar: nunca llaves ni contraseñas. En texto plano siempre, y en HTML para quien lo muestra.
import { formatAmount, makeT } from "../../i18n/index.ts";
import type { Lang } from "../../i18n/types.ts";
import type { Mail } from "../mailer.ts";
import type { EventRecord, Person, TicketType } from "../repo.ts";
import { formatEventWhen, formatEventWhere } from "./fecha.ts";

export interface PassEmailInput {
  event: EventRecord;
  person: Person;
  ticketType: TicketType;
  /** El enlace personal, completo: https://.../p/<pase>?k=<clave>&lang=es */
  url: string;
  lang: Lang;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** "Ana Quiroga" se saluda como "Ana". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function buildPassEmail({ event, person, ticketType, url, lang }: PassEmailInput): Mail {
  const t = makeT(lang);
  const paid = ticketType.priceUsdc > 0;
  const when = formatEventWhen(lang, event);
  const what = paid
    ? t("evento.correo.pago", { evento: event.name, monto: formatAmount(lang, ticketType.priceUsdc) })
    : t("evento.correo.gratis", { evento: event.name });
  const where = t("evento.correo.cuando", { fecha: `${when.date}, ${when.time}`, lugar: formatEventWhere(event) });

  const text = [
    t("evento.correo.hola", { nombre: firstName(person.name) }),
    "",
    what,
    where,
    "",
    t("evento.correo.enlace"),
    url,
    "",
    t("evento.correo.mostra"),
    "",
    t("evento.correo.noFuiste"),
    "",
    t("evento.correo.firma"),
  ].join("\n");

  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="${lang}"><body style="margin:0;background:#f7f2e8;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f1c2e;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <p style="margin:0 0 20px;font-size:22px;font-weight:800;letter-spacing:-0.02em;">Rumbo</p>
    <div style="background:#fff;border:1px solid rgba(15,28,46,0.12);border-radius:20px;padding:28px;">
      <p style="margin:0 0 14px;font-size:17px;">${e(t("evento.correo.hola", { nombre: firstName(person.name) }))}</p>
      <p style="margin:0 0 6px;font-size:17px;">${e(what)}</p>
      <p style="margin:0 0 22px;color:#3d4b5f;">${e(where)}</p>
      <p style="margin:0 0 22px;">
        <a href="${e(url)}" style="display:inline-block;background:#e8541e;color:#0f1c2e;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:999px;">${e(t("evento.correo.abrir"))}</a>
      </p>
      <p style="margin:0 0 6px;color:#3d4b5f;font-size:14px;">${e(t("evento.correo.enlace"))}</p>
      <p style="margin:0 0 22px;font-size:14px;word-break:break-all;"><a href="${e(url)}" style="color:#c2410c;">${e(url)}</a></p>
      <p style="margin:0;color:#3d4b5f;font-size:15px;">${e(t("evento.correo.mostra"))}</p>
    </div>
    <p style="margin:20px 0 0;color:#5b6675;font-size:13px;">${e(t("evento.correo.noFuiste"))}</p>
  </div>
</body></html>`;

  return { to: person.email, subject: t("evento.correo.asunto", { evento: event.name }), text, html };
}
