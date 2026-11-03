"use server";
// La acción del formulario de inscripción: valida, inscribe (o cobra) y manda a la confirmación.
// Los textos vuelven ya traducidos al idioma del pedido.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { makeT } from "@/i18n/index.ts";
import { getLang } from "@/i18n/server.ts";
import { clientKey } from "@/server/limites.ts";
import { withoutEmails } from "@/server/log.ts";
import {
  RegistrationNotFound,
  hasErrors,
  registerForEvent,
  validateFields,
  type FailureReason,
  type FieldError,
  type RegistrationResult,
} from "@/server/evento/inscripcion.ts";

export interface FormState {
  /** Un error general, ya traducido. */
  error?: string;
  /** Los errores de cada campo, ya traducidos. */
  fields?: { name?: string; email?: string };
  /** Lo que la persona escribió (y si marcó la casilla de contacto), para no perderlo. */
  values?: { name: string; email: string; contact?: boolean };
  /** Ya tenía su credencial: se le mandó el enlace de nuevo a este correo. */
  existing?: { email: string };
}

const FIELD_KEYS: Record<FieldError, string> = {
  obligatorio: "campo.obligatorio",
  corto: "evento.form.nombreCorto",
  largo: "evento.form.nombreLargo",
  invalido: "campo.correoInvalido",
};

const FAILURE_KEYS: Record<FailureReason, string> = {
  sold_out: "evento.error.sinLugares",
  not_paid: "evento.error.sinPago",
  network: "evento.error.red",
  misconfigured: "evento.error.configuracion",
  too_many: "evento.error.demasiados",
};

/** De dónde llegó el pedido, para que el enlace del correo abra en el mismo servidor en desarrollo. */
async function requestOrigin(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const lang = await getLang();
  const t = makeT(lang);
  const field = (key: string) => String(formData.get(key) ?? "").trim();
  const slug = field("evento");
  const ticketTypeId = field("entrada");
  const fields = { name: field("nombre"), email: field("correo") };
  // La casilla opcional de contacto: solo cuenta si llegó marcada.
  const contact = formData.get("contacto") === "si";
  const values = { ...fields, contact };

  const errors = validateFields(fields);
  if (hasErrors(errors)) {
    return {
      fields: { name: errors.name && t(FIELD_KEYS[errors.name]), email: errors.email && t(FIELD_KEYS[errors.email]) },
      values,
    };
  }

  let result: RegistrationResult;
  try {
    result = await registerForEvent({
      slug,
      ticketTypeId,
      ...fields,
      lang,
      origin: await requestOrigin(),
      clientKey: clientKey(await headers()),
      contactConsent: contact,
    });
  } catch (error) {
    if (error instanceof RegistrationNotFound) return { error: t("evento.error.entrada"), values };
    console.error("[inscripcion]", error);
    return { error: t("evento.error.red"), values };
  }

  if (result.kind === "failed") {
    console.warn(`[inscripcion] ${result.reason}: ${withoutEmails(result.detail)}`);
    return { error: t(FAILURE_KEYS[result.reason]), values };
  }
  if (result.kind === "existing") return { existing: { email: result.person.email } };

  redirect(`/e/${encodeURIComponent(slug)}/listo?pase=${encodeURIComponent(result.pass.id)}&k=${encodeURIComponent(result.accessKey)}`);
}
