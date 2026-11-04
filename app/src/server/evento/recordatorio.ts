// Reenviar el enlace de la credencial a quienes todavía no entraron: el recordatorio de los días previos. Cada
// persona recibe el mismo correo que ya recibió (el de la inscripción, o el de la lista importada), con el mismo
// freno que tiene el formulario cuando alguien vuelve a escribir su correo: un reenvío cada diez minutos por
// persona y evento (src/server/limites.ts, linkResendAttempts). Va de a tandas, para no apurar al servicio de
// correo ni pasarse del tiempo de un pedido; lo que no entró en la tanda queda para la siguiente llamada. Si el
// servidor no tiene servicio de correo, no cuenta nada como enviado: lo dice (notConfigured) y no frena a nadie.
// Lo usa el servidor MCP (resend_links); un botón del panel podría usarlo igual.
import type { Lang } from "../../i18n/types.ts";
import { buildImportedEmail } from "../kit/correo.ts";
import { linkResendAttempts } from "../limites.ts";
import { describeForLog } from "../log.ts";
import { getMailer, type Mailer } from "../mailer.ts";
import { getRepo, type EventRecord, type Repo } from "../repo.ts";
import { getOrCreateAccessKey } from "./acceso.ts";
import { buildPassEmail } from "./correo.ts";
import { passUrl } from "./inscripcion.ts";

export interface ResendDeps {
  mailer: Pick<Mailer, "send">;
  lang: Lang;
  /** De dónde se pidió, para que en desarrollo el enlace abra en el mismo servidor. */
  origin?: string | null;
}

export interface ResendResult {
  /** Credenciales emitidas cuya persona todavía no entró. */
  eligible: number;
  sent: number;
  /** Recibieron el enlace hace menos de diez minutos: no se les manda otro. */
  skipped: number;
  /** El servicio de correo falló; se vuelve a intentar en otra tanda. */
  failed: number;
  /** Este servidor no tiene servicio de correo: tienen credencial y enlace, pero ningún correo salió. */
  notConfigured: number;
  /** Las que no entraron en esta tanda. */
  remaining: number;
}

export const RESEND_BATCH_SIZE = 20;
export const RESEND_MAX_BATCH_SIZE = 100;

/**
 * Manda una tanda de recordatorios: a lo sumo `size` correos, a quienes tienen su credencial, no entraron y no
 * recibieron el enlace en los últimos diez minutos. Devuelve cuántos faltan para la próxima tanda.
 */
export async function resendCredentialLinks(event: EventRecord, size: number = RESEND_BATCH_SIZE, deps: ResendDeps = { mailer: getMailer(), lang: "es" }, repo: Repo = getRepo()): Promise<ResendResult> {
  const limit = Math.max(1, Math.min(size, RESEND_MAX_BATCH_SIZE));
  const resend = linkResendAttempts();
  const result: ResendResult = { eligible: 0, sent: 0, skipped: 0, failed: 0, notConfigured: 0, remaining: 0 };
  // Sin servicio de correo nada sale: al primer "not_configured" el resto cuenta como no mandado, sin más vueltas.
  let sinServicio = false;
  for (const pass of await repo.listPasses(event.id)) {
    if (pass.status !== "active") continue;
    result.eligible++;
    const key = `${event.id}:${pass.personId}`;
    if ((await resend.blockedFor(key)) > 0) {
      result.skipped++;
      continue;
    }
    if (sinServicio) {
      result.notConfigured++;
      continue;
    }
    if (result.sent + result.failed >= limit) {
      result.remaining++;
      continue;
    }
    const [person, ticketType] = await Promise.all([repo.getPersonById(pass.personId), repo.getTicketType(pass.ticketTypeId)]);
    if (!person || !ticketType) continue;
    const url = passUrl(pass.id, await getOrCreateAccessKey(pass.id), deps.lang, deps.origin);
    const mail = pass.importRunId
      ? buildImportedEmail({ event, person, ticketType, url, lang: deps.lang })
      : buildPassEmail({ event, person, ticketType, url, lang: deps.lang });
    try {
      const sent = await deps.mailer.send(mail);
      if (sent?.outcome === "not_configured") {
        // Nadie recibió nada, así que a nadie se lo frena: el enlace sigue en la página del evento y en el CSV.
        sinServicio = true;
        result.notConfigured++;
        continue;
      }
      await resend.note(key);
      result.sent++;
    } catch (error) {
      // En el registro va el id de la persona, nunca su correo.
      console.warn(`[recordatorio] No se pudo reenviar el enlace de la persona ${person.id} (pase ${pass.id}): ${describeForLog(error)}`);
      result.failed++;
    }
  }
  return result;
}
