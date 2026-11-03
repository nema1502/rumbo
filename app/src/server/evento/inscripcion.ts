// La inscripción: de un nombre y un correo a un pase con su credencial. Lo usan la página del evento
// (la acción del formulario) y la API. Crea o busca a la persona, le pide su cuenta al AccountProvider,
// llama a register (gratis) o a buy (paga: la plata sale de la cuenta de la persona y el servidor paga la
// comisión de red), guarda el pase, le da los beneficios de su entrada, crea la clave de acceso y manda el
// correo con el enlace personal. Nombres y correos quedan en la base; a la cadena va solo la cuenta.
import type { Lang } from "../../i18n/types.ts";
import { isPublicKind } from "../../lib/credential-kinds.ts";
import { getAccountProvider } from "../accounts.ts";
import { baseUrl } from "../env.ts";
import { linkResendAttempts, registrationAttempts } from "../limites.ts";
import { describeForLog } from "../log.ts";
import { getMailer } from "../mailer.ts";
import { getRepo, normalizeEmail, type EventRecord, type Pass, type Person, type Repo, type TicketType } from "../repo.ts";
import { isContractError, requireContractId, rumboPass } from "../stellar.ts";
import { getOrCreateAccessKey } from "./acceso.ts";
import { buildPassEmail } from "./correo.ts";

export interface RegistrationFields {
  name: string;
  email: string;
}

export type FieldError = "obligatorio" | "corto" | "largo" | "invalido";
export interface FieldErrors {
  name?: FieldError;
  email?: FieldError;
}

export const NAME_MAX = 80;
export const EMAIL_MAX = 120;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateFields(fields: RegistrationFields): FieldErrors {
  const errors: FieldErrors = {};
  const name = fields.name.trim();
  const email = fields.email.trim();
  if (!name) errors.name = "obligatorio";
  else if (name.length < 2) errors.name = "corto";
  else if (name.length > NAME_MAX) errors.name = "largo";
  if (!email) errors.email = "obligatorio";
  else if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) errors.email = "invalido";
  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return errors.name !== undefined || errors.email !== undefined;
}

export interface RegistrationInput extends RegistrationFields {
  slug: string;
  ticketTypeId: string;
  lang: Lang;
  /** De dónde se pidió (http://localhost:3000): en desarrollo el enlace del correo sale de ahí. */
  origin?: string | null;
  /** Quién pide, para el freno de pedidos (clientKey de limites.ts, con la IP que pone la plataforma). */
  clientKey?: string | null;
  /** Una restricción de dieta (vegetariana, alergias), opcional: se la muestra el escáner al servir la comida. */
  diet?: string | null;
}

export const DIET_MAX = 120;

/** La dieta como se guarda: sin espacios de más y no más larga que el tope. Vacía es null. */
export function cleanDiet(raw: string | null | undefined): string | null {
  const clean = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, DIET_MAX).trim();
  return clean || null;
}

export type FailureReason = "sold_out" | "not_paid" | "network" | "misconfigured" | "too_many";

export type RegistrationResult =
  | {
      kind: "created";
      pass: Pass;
      person: Person;
      event: EventRecord;
      ticketType: TicketType;
      accessKey: string;
      url: string;
      paid: boolean;
      txHash: string | null;
      chainNumber: number | null;
    }
  | { kind: "existing"; pass: Pass; person: Person; event: EventRecord; ticketType: TicketType }
  | { kind: "failed"; reason: FailureReason; detail: string };

/** El evento o la entrada no existen (o la entrada es de otro evento). */
export class RegistrationNotFound extends Error {
  readonly what: "event" | "ticket";
  constructor(what: "event" | "ticket") {
    super(what === "event" ? "No existe ese evento" : "No existe esa entrada");
    this.name = "RegistrationNotFound";
    this.what = what;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLocalOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}

/**
 * El enlace personal. Con la app en producción manda NEXT_PUBLIC_BASE_URL; en desarrollo, el puerto desde
 * el que se pidió, para que el correo abra en el mismo servidor.
 */
export function passUrl(passId: string, accessKey: string, lang: Lang, origin?: string | null): string {
  const base = origin && isLocalOrigin(origin) ? origin : baseUrl();
  return `${base.replace(/\/+$/, "")}/p/${passId}?k=${encodeURIComponent(accessKey)}&lang=${lang}`;
}

async function findOrCreatePass(repo: Repo, event: EventRecord, person: Person, ticketType: TicketType): Promise<Pass> {
  const found = await repo.findPass(event.id, person.id);
  if (found) return found;
  try {
    return await repo.createPass({ eventId: event.id, personId: person.id, ticketTypeId: ticketType.id, status: "pending" });
  } catch (error) {
    // Dos pedidos a la vez con el mismo correo: el segundo toma el pase que creó el primero.
    const again = await repo.findPass(event.id, person.id);
    if (again) return again;
    throw error;
  }
}

async function sendPassEmail(args: { event: EventRecord; person: Person; pass: Pass; ticketType: TicketType; lang: Lang; origin?: string | null }): Promise<string> {
  const url = passUrl(args.pass.id, getOrCreateAccessKey(args.pass.id), args.lang, args.origin);
  try {
    await getMailer().send(buildPassEmail({ event: args.event, person: args.person, ticketType: args.ticketType, url, lang: args.lang }));
  } catch (error) {
    // Sin correo la inscripción vale igual: el enlace se muestra en pantalla. En el registro del servidor
    // va el id de la persona, nunca su correo (ni el que pueda traer el error del proveedor).
    console.warn(`[inscripcion] No se pudo mandar el correo de la persona ${args.person.id} (pase ${args.pass.id}): ${describeForLog(error)}`);
  }
  return url;
}

export async function registerForEvent(input: RegistrationInput): Promise<RegistrationResult> {
  const repo = getRepo();
  const event = await repo.getEventBySlug(input.slug);
  // Un borrador todavía no recibe inscripciones.
  if (!event || !event.published) throw new RegistrationNotFound("event");
  const ticketType = await repo.getTicketType(input.ticketTypeId);
  // Las credenciales de oradores, jurado, voluntarios y demás se entregan por invitación: no se piden desde la página.
  if (!ticketType || ticketType.eventId !== event.id || !isPublicKind(ticketType.credentialKind)) throw new RegistrationNotFound("ticket");
  const contractId = requireContractId(ticketType.contractId ?? event.contractId);
  const paid = ticketType.priceUsdc > 0;
  const email = normalizeEmail(input.email);
  const name = input.name.trim();

  // El freno: cada inscripción nueva crea una cuenta, la fondea y manda una transacción que paga el
  // servidor, y con correos inventados se llenaría el cupo. Cuenta todos los pedidos de quien pide, con
  // correo nuevo o conocido (así el freno tampoco dice cuál es cuál).
  const attempts = registrationAttempts();
  const requester = input.clientKey ?? "local";
  if (attempts.blockedFor(requester) > 0) return { kind: "failed", reason: "too_many", detail: "demasiados pedidos seguidos" };
  attempts.note(requester);

  // Quien ya tiene su credencial recibe el enlace de nuevo por correo, y nada más: la pantalla no se la
  // muestra a quien escriba el correo de otra persona. El enlace se reenvía una vez cada diez minutos por
  // correo y evento, para que nadie use el formulario para llenarle el correo a otra persona.
  const known = await repo.getPersonByEmail(email);
  const existingPass = known ? await repo.findPass(event.id, known.id) : null;
  if (known && existingPass && existingPass.status !== "pending") {
    const existingTicket = (await repo.getTicketType(existingPass.ticketTypeId)) ?? ticketType;
    const resend = linkResendAttempts();
    const resendKey = `${event.id}:${known.id}`;
    if (resend.blockedFor(resendKey) === 0) {
      resend.note(resendKey);
      await sendPassEmail({ event, person: known, pass: existingPass, ticketType: existingTicket, lang: input.lang, origin: input.origin });
    }
    return { kind: "existing", pass: existingPass, person: known, event, ticketType: existingTicket };
  }

  const person = await repo.upsertPerson({ name, email });
  let pass = existingPass ?? (await findOrCreatePass(repo, event, person, ticketType));
  if (pass.ticketTypeId !== ticketType.id) {
    // Quedó una inscripción empezada con otra entrada (la red falló a mitad de camino): sigue con la de ahora.
    pass = await repo.updatePass(pass.id, { ticketTypeId: ticketType.id });
  }
  const diet = cleanDiet(input.diet);
  if (diet && pass.diet !== diet) pass = await repo.updatePass(pass.id, { diet });

  const accounts = getAccountProvider(repo);
  let account: string;
  try {
    account = await accounts.getOrCreateForPerson(person.id);
  } catch (error) {
    return { kind: "failed", reason: "network", detail: describe(error) };
  }

  let txHash: string | null = null;
  let chainNumber: number | null = null;
  try {
    const signer = await accounts.authSigner(person.id);
    const result = paid ? await rumboPass.buy(contractId, account, signer) : await rumboPass.register(contractId, account, signer);
    txHash = result.hash;
    chainNumber = result.number;
  } catch (error) {
    if (isContractError(error, "AlreadyHasPass")) {
      // La cuenta ya tenía su pase en el contrato (una inscripción anterior que no llegó a guardarse): se toma de ahí.
      try {
        chainNumber = (await rumboPass.status(contractId, account)).number;
      } catch (statusError) {
        return { kind: "failed", reason: "network", detail: describe(statusError) };
      }
    } else if (isContractError(error, "SoldOut")) {
      return { kind: "failed", reason: "sold_out", detail: describe(error) };
    } else if (isContractError(error, "NotPaid")) {
      return { kind: "failed", reason: "not_paid", detail: describe(error) };
    } else if (isContractError(error, "NotFree") || isContractError(error, "NotConfigured")) {
      return { kind: "failed", reason: "misconfigured", detail: describe(error) };
    } else {
      return { kind: "failed", reason: "network", detail: describe(error) };
    }
  }

  pass = await repo.updatePass(pass.id, { account, status: "active", txHash, chainNumber });
  await repo.grantTicketBenefits(pass.id);
  const accessKey = getOrCreateAccessKey(pass.id);
  const url = await sendPassEmail({ event, person, pass, ticketType, lang: input.lang, origin: input.origin });
  return { kind: "created", pass, person, event, ticketType, accessKey, url, paid, txHash, chainNumber };
}
