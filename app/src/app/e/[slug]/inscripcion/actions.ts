"use server";
// Las acciones del formulario de inscripción: valida, inscribe (o cobra) y manda a la confirmación.
// Los textos vuelven ya traducidos al idioma del pedido.
//
// registerAction es el formulario de siempre (modo de prueba: la cuenta la guarda el servidor). Con Pollar, el
// formulario llama a las otras tres desde el navegador, en orden: walletChallengeAction da el desafío que la
// cuenta firma (SEP-53), walletRegisterAction inscribe con esa prueba y devuelve lo que hay que autorizar, y
// walletSignAction manda la autorización firmada y lleva a la confirmación.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { makeT, type T } from "@/i18n/index.ts";
import { getLang } from "@/i18n/server.ts";
import { isAccountKey, issueChallenge } from "@/server/cuenta-propia.ts";
import { clientKey, walletChallengeAttempts } from "@/server/limites.ts";
import { withoutEmails } from "@/server/log.ts";
import { getRepo } from "@/server/repo.ts";
import {
  RegistrationNotFound,
  completeRegistration,
  hasErrors,
  registerForEvent,
  validateFields,
  type FailureReason,
  type FieldError,
  type RegistrationResult,
  type SignatureRequest,
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

/** Con la cuenta propia, además: lo que la cuenta tiene que autorizar, o el USDC de prueba que tiene que aceptar. */
export interface WalletFormState extends FormState {
  needsSignature?: SignatureRequest;
  needsTrustline?: { code: string; issuer: string };
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
  wallet_required: "evento.error.cuentaRequerida",
  wallet_invalid: "evento.error.cuentaPrueba",
  wallet_taken: "evento.error.cuentaOtroCorreo",
  wallet_mismatch: "evento.error.correoOtraCuenta",
  signature_invalid: "evento.error.autorizacion",
  signature_expired: "evento.error.autorizacionVencida",
};

/** De dónde llegó el pedido, para que el enlace del correo abra en el mismo servidor en desarrollo. */
async function requestOrigin(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** Lo que vuelve al formulario de un resultado que no es "created" (ese lleva a la confirmación). */
function stateFor(t: T, result: RegistrationResult, values: FormState["values"]): WalletFormState | null {
  switch (result.kind) {
    case "failed":
      console.warn(`[inscripcion] ${result.reason}: ${withoutEmails(result.detail)}`);
      return { error: t(FAILURE_KEYS[result.reason]), values };
    case "existing":
      return { existing: { email: result.person.email } };
    case "needs_signature":
      return { needsSignature: result.request, values };
    case "needs_trustline":
      return { needsTrustline: result.asset, values };
    case "created":
      return null;
  }
}

function toConfirmation(slug: string, result: Extract<RegistrationResult, { kind: "created" }>): never {
  redirect(`/e/${encodeURIComponent(slug)}/listo?pase=${encodeURIComponent(result.pass.id)}&k=${encodeURIComponent(result.accessKey)}`);
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
      diet: field("dieta"),
      selfService: true,
    });
  } catch (error) {
    if (error instanceof RegistrationNotFound) return { error: t("evento.error.entrada"), values };
    console.error("[inscripcion]", error);
    return { error: t("evento.error.red"), values };
  }

  if (result.kind === "created") toConfirmation(slug, result);
  return stateFor(t, result, values) ?? {};
}

/** El desafío para que la cuenta propia pruebe que es de quien se inscribe (SEP-53). */
export async function walletChallengeAction(publicKey: string): Promise<{ challengeId: string; message: string } | { error: string }> {
  const lang = await getLang();
  const t = makeT(lang);
  if (!isAccountKey(publicKey)) return { error: t("evento.error.cuentaPrueba") };
  const attempts = walletChallengeAttempts();
  const requester = clientKey(await headers());
  if ((await attempts.blockedFor(requester)) > 0) return { error: t("evento.error.demasiados") };
  await attempts.note(requester);
  const { challengeId, message } = await issueChallenge(getRepo(), publicKey, lang);
  return { challengeId, message };
}

export interface WalletRegistrationInput {
  slug: string;
  ticketTypeId: string;
  name: string;
  email: string;
  contact: boolean;
  diet: string;
  wallet: { publicKey: string; challengeId: string; signature: string };
}

/** La inscripción con la cuenta propia, paso 1: con la prueba de la cuenta, devuelve lo que la cuenta tiene que autorizar. */
export async function walletRegisterAction(input: WalletRegistrationInput): Promise<WalletFormState> {
  const lang = await getLang();
  const t = makeT(lang);
  const fields = { name: String(input.name ?? "").trim(), email: String(input.email ?? "").trim() };
  const values = { ...fields, contact: input.contact === true };
  const errors = validateFields(fields);
  if (hasErrors(errors)) {
    return { fields: { name: errors.name && t(FIELD_KEYS[errors.name]), email: errors.email && t(FIELD_KEYS[errors.email]) }, values };
  }
  let result: RegistrationResult;
  try {
    result = await registerForEvent({
      slug: String(input.slug),
      ticketTypeId: String(input.ticketTypeId),
      ...fields,
      lang,
      origin: await requestOrigin(),
      clientKey: clientKey(await headers()),
      contactConsent: input.contact === true,
      diet: String(input.diet ?? ""),
      wallet: { provider: "pollar", publicKey: String(input.wallet?.publicKey ?? ""), challengeId: String(input.wallet?.challengeId ?? ""), signature: String(input.wallet?.signature ?? "") },
      selfService: true,
    });
  } catch (error) {
    if (error instanceof RegistrationNotFound) return { error: t("evento.error.entrada"), values };
    console.error("[inscripcion]", error);
    return { error: t("evento.error.red"), values };
  }
  if (result.kind === "created") toConfirmation(input.slug, result);
  return stateFor(t, result, values) ?? {};
}

/** Paso 2: la autorización firmada por la cuenta. Si sale, lleva a la confirmación. */
export async function walletSignAction(input: { slug: string; requestId: string; signedAuthEntry: string }): Promise<WalletFormState> {
  const lang = await getLang();
  const t = makeT(lang);
  let result: RegistrationResult;
  try {
    result = await completeRegistration({ requestId: String(input.requestId), signedAuthEntry: String(input.signedAuthEntry), slug: String(input.slug), lang, origin: await requestOrigin() });
  } catch (error) {
    console.error("[inscripcion] firma", error);
    return { error: t("evento.error.red") };
  }
  if (result.kind === "created") toConfirmation(input.slug, result);
  return stateFor(t, result, undefined) ?? {};
}
