// El correo con el enlace personal de una credencial que salió de una lista importada (Luma, Bevy). La persona ya
// se había inscripto en otra parte, así que el correo no dice "te inscribiste": dice que su credencial está lista
// y, si no es asistente, como qué. Lleva el enlace y nada más que haga falta guardar: nunca llaves ni contraseñas.
import { makeT } from "../../i18n/index.ts";
import type { Lang } from "../../i18n/types.ts";
import { kindLabelKey } from "../../lib/credential-kinds.ts";
import { firstName } from "../evento/correo.ts";
import { formatEventWhen, formatEventWhere } from "../evento/fecha.ts";
import type { Mail } from "../mailer.ts";
import type { EventRecord, Person, TicketType } from "../repo.ts";

export interface ImportedEmailInput {
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

export function buildImportedEmail({ event, person, ticketType, url, lang }: ImportedEmailInput): Mail {
  const t = makeT(lang);
  const when = formatEventWhen(lang, event);
  const intro =
    ticketType.credentialKind === "attendee"
      ? t("kit.correo.intro", { evento: event.name })
      : t("kit.correo.introTipo", { evento: event.name, tipo: t(kindLabelKey(ticketType.credentialKind)).toLowerCase() });
  const where = t("evento.correo.cuando", { fecha: `${when.date}, ${when.time}`, lugar: formatEventWhere(event) });
  const hello = t("evento.correo.hola", { nombre: firstName(person.name) });

  const text = [hello, "", intro, where, "", t("evento.correo.enlace"), url, "", t("evento.correo.mostra"), "", t("evento.correo.noFuiste"), "", t("evento.correo.firma")].join("\n");

  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="${lang}"><body style="margin:0;background:#f7f2e8;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f1c2e;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <p style="margin:0 0 20px;font-size:22px;font-weight:800;letter-spacing:-0.02em;">Rumbo</p>
    <div style="background:#fff;border:1px solid rgba(15,28,46,0.12);border-radius:20px;padding:28px;">
      <p style="margin:0 0 14px;font-size:17px;">${e(hello)}</p>
      <p style="margin:0 0 6px;font-size:17px;">${e(intro)}</p>
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

  return { to: person.email, subject: t("kit.correo.asunto", { evento: event.name }), text, html };
}
