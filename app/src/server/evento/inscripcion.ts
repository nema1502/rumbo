// La inscripción: de un nombre y un correo a un pase con su credencial. Lo usan la página del evento
// (la acción del formulario) y la API. Crea o busca a la persona, le pide su cuenta al AccountProvider,
// llama a register (gratis) o a buy (paga: la plata sale de la cuenta de la persona y el servidor paga la
// comisión de red), guarda el pase, le da los beneficios de su entrada, crea la clave de acceso y manda el
// correo con el enlace personal. Nombres y correos quedan en la base; a la cadena va solo la cuenta.
//
// Con la cuenta propia (Pollar), la persona trae la prueba de que su cuenta es suya (SEP-53) y la inscripción va
// en dos pasos, porque el servidor no tiene su llave: registerForEvent liga la cuenta, la deja lista en la red
// (que exista y, para la entrada paga, que acepte el USDC de prueba y tenga saldo), simula register o buy y
// devuelve la autorización sin firmar; el navegador la firma con Pollar y completeRegistration la manda, con la
// comisión pagada por la patrocinadora. El final (el pase activo, los beneficios, la clave y el correo) es el mismo.
import type { Lang } from "../../i18n/types.ts";
import { isPublicKind } from "../../lib/credential-kinds.ts";
import { getAccountProvider, pollarEnabled } from "../accounts.ts";
import { AUTH_REQUEST_TTL_MS, checkSignedAuthEntry, newOpaqueId, verifyWalletProof, type WalletProof } from "../cuenta-propia.ts";
import { baseUrl } from "../env.ts";
import { linkResendAttempts, registrationAttempts } from "../limites.ts";
import { describeForLog } from "../log.ts";
import { getMailer } from "../mailer.ts";
import { getRepo, normalizeEmail, type EventRecord, type Pass, type Person, type Repo, type TicketType } from "../repo.ts";
import { NETWORK_PASSPHRASE, getTestAsset, isContractError, requireContractId, rumboPass, walletChain } from "../stellar.ts";
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
  /** La casilla opcional: acepta que la comunidad que organiza le escriba. Sin marcar, no. */
  contactConsent?: boolean;
  /** Una restricción de dieta (vegetariana, alergias), opcional: se la muestra el escáner al servir la comida. */
  diet?: string | null;
  /** La prueba de que la cuenta propia (Pollar) es de quien se inscribe. Con ella, la inscripción va en dos pasos. */
  wallet?: WalletProof | null;
  /**
   * La persona se inscribe sola (el formulario, la API). Con Pollar prendido tiene que traer su cuenta propia.
   * Quien inscribe a otras (un equipo) no: esas personas siguen con la cuenta de prueba.
   */
  selfService?: boolean;
}

export const DIET_MAX = 120;

/** La dieta como se guarda: sin espacios de más y no más larga que el tope. Vacía es null. */
export function cleanDiet(raw: string | null | undefined): string | null {
  const clean = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, DIET_MAX).trim();
  return clean || null;
}

export type FailureReason =
  | "sold_out"
  | "not_paid"
  | "network"
  | "misconfigured"
  | "too_many"
  /** Con Pollar prendido, quien se inscribe sola entra con su cuenta; o la persona ya tiene la suya y se inscribe ella. */
  | "wallet_required"
  /** La prueba de la cuenta no vale: el desafío venció, ya se usó o es de otra cuenta, o la firma no es de esa cuenta. */
  | "wallet_invalid"
  /** Esa cuenta ya está ligada a otra persona (otro correo). */
  | "wallet_taken"
  /** Ese correo ya está ligado a otra cuenta. */
  | "wallet_mismatch"
  /** La autorización firmada no es la que se dio a firmar, o la firma no vale. */
  | "signature_invalid"
  /** El pedido de firma venció o ya se usó: hay que empezar de nuevo. */
  | "signature_expired";

/** Lo que el navegador tiene que firmar con la cuenta propia (client.signAuthEntry), y con qué id devolverlo. */
export interface SignatureRequest {
  requestId: string;
  /** La autorización sin firmar, en XDR base64. */
  authEntry: string;
  validUntilLedger: number;
  fn: "register" | "buy";
}

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
  /** Falta que la persona firme en su dispositivo: el navegador firma `request` y llama a completeRegistration. */
  | { kind: "needs_signature"; pass: Pass; person: Person; event: EventRecord; ticketType: TicketType; request: SignatureRequest }
  /** La entrada paga necesita que la cuenta acepte el USDC de prueba: el navegador lo pide (setTrustline) y vuelve a empezar. */
  | { kind: "needs_trustline"; pass: Pass; asset: { code: string; issuer: string } }
  | { kind: "failed"; reason: FailureReason; detail: string };

/** Sin cuenta propia (la puerta, un equipo): la inscripción sale, ya estaba o no salió, nunca espera una firma. */
export type DirectRegistrationResult = Extract<RegistrationResult, { kind: "created" | "existing" | "failed" }>;

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

const failed = (reason: FailureReason, detail: string): Extract<RegistrationResult, { kind: "failed" }> => ({ kind: "failed", reason, detail });

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
  const url = passUrl(args.pass.id, await getOrCreateAccessKey(args.pass.id), args.lang, args.origin);
  try {
    await getMailer().send(buildPassEmail({ event: args.event, person: args.person, ticketType: args.ticketType, url, lang: args.lang }));
  } catch (error) {
    // Sin correo la inscripción vale igual: el enlace se muestra en pantalla. En el registro del servidor
    // va el id de la persona, nunca su correo (ni el que pueda traer el error del proveedor).
    console.warn(`[inscripcion] No se pudo mandar el correo de la persona ${args.person.id} (pase ${args.pass.id}): ${describeForLog(error)}`);
  }
  return url;
}

/** Lo que la inscripción con la cuenta propia le pide a la red. */
export interface OwnAccountChain {
  ensureAccount(address: string): Promise<boolean>;
  hasTestTrustline(address: string): Promise<boolean>;
  topUpTestUsdc(address: string, minimum: number): Promise<void>;
  prepare: (typeof rumboPass)["prepare"];
  submitSigned: (typeof rumboPass)["submitSigned"];
  status: (typeof rumboPass)["status"];
}

declare global {
  // Las capturas levantan Next adentro del script, y el bundle no comparte módulos con él: lo reemplazan acá,
  // como __rumboAccounts y __rumboKitChain. Las pruebas cambian walletChain y rumboPass directamente.
  var __rumboOwnAccountChain: OwnAccountChain | undefined;
}

/** La red de la cuenta propia: walletChain y rumboPass, leídos en cada llamada. */
function ownChain(): OwnAccountChain {
  return (
    globalThis.__rumboOwnAccountChain ?? {
      ensureAccount: (address) => walletChain.ensureAccount(address),
      hasTestTrustline: (address) => walletChain.hasTestTrustline(address),
      topUpTestUsdc: (address, minimum) => walletChain.topUpTestUsdc(address, minimum),
      prepare: (contractId, fn, account) => rumboPass.prepare(contractId, fn, account),
      submitSigned: (contractId, fn, account, entry) => rumboPass.submitSigned(contractId, fn, account, entry),
      status: (contractId, who) => rumboPass.status(contractId, who),
    }
  );
}

/** Lo que dijo el contrato (o la red) al inscribir, como motivo de la inscripción que no salió. AlreadyHasPass se trata aparte. */
function chainFailure(error: unknown): RegistrationResult {
  if (isContractError(error, "SoldOut")) return failed("sold_out", describe(error));
  if (isContractError(error, "NotPaid")) return failed("not_paid", describe(error));
  if (isContractError(error, "NotFree") || isContractError(error, "NotConfigured")) return failed("misconfigured", describe(error));
  return failed("network", describe(error));
}

/**
 * Quien ya tiene su credencial recibe el enlace de nuevo por correo, y nada más: la pantalla no se la muestra a
 * quien escriba el correo de otra persona. El enlace se reenvía una vez cada diez minutos por correo y evento,
 * para que nadie use el formulario para llenarle el correo a otra persona.
 */
async function resendExisting(repo: Repo, args: { event: EventRecord; person: Person; pass: Pass; ticketType: TicketType; lang: Lang; origin?: string | null }): Promise<RegistrationResult> {
  const ticketType = (await repo.getTicketType(args.pass.ticketTypeId)) ?? args.ticketType;
  const resend = linkResendAttempts();
  const resendKey = `${args.event.id}:${args.person.id}`;
  if ((await resend.blockedFor(resendKey)) === 0) {
    await resend.note(resendKey);
    await sendPassEmail({ ...args, ticketType });
  }
  return { kind: "existing", pass: args.pass, person: args.person, event: args.event, ticketType };
}

/** El final de toda inscripción que salió: el pase activo con su cuenta, los beneficios, la clave y el correo. */
async function finishRegistration(
  repo: Repo,
  args: { event: EventRecord; person: Person; pass: Pass; ticketType: TicketType; account: string; txHash: string | null; chainNumber: number | null; contactConsent: boolean; lang: Lang; origin?: string | null },
): Promise<RegistrationResult> {
  // La casilla de contacto se guarda con la inscripción que termina. A quien ya tenía su credencial no se le
  // cambia (resendExisting): si no, cualquiera que escriba su correo podría marcarla por otra persona.
  const pass = await repo.updatePass(args.pass.id, { account: args.account, status: "active", txHash: args.txHash, chainNumber: args.chainNumber, contactConsent: args.contactConsent });
  await repo.grantTicketBenefits(pass.id);
  const accessKey = await getOrCreateAccessKey(pass.id);
  const url = await sendPassEmail({ event: args.event, person: args.person, pass, ticketType: args.ticketType, lang: args.lang, origin: args.origin });
  const paid = args.ticketType.priceUsdc > 0;
  return { kind: "created", pass, person: args.person, event: args.event, ticketType: args.ticketType, accessKey, url, paid, txHash: args.txHash, chainNumber: args.chainNumber };
}

/** La cuenta ya tenía su pase en el contrato (una inscripción anterior que no llegó a guardarse): el número sale de ahí. */
async function chainNumberFromStatus(contractId: string, account: string): Promise<number | RegistrationResult> {
  try {
    return (await ownChain().status(contractId, account)).number;
  } catch (statusError) {
    return failed("network", describe(statusError));
  }
}

/**
 * Liga la cuenta propia a la persona, o dice por qué no: una cuenta es de una sola persona y una persona tiene una
 * sola cuenta propia (el contrato da un pase por cuenta, y dos personas con la misma cuenta se pisarían).
 */
async function linkOwnAccount(repo: Repo, person: Person, account: string): Promise<RegistrationResult | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ofAccount = await repo.getWalletLinkByAccount(account);
    if (ofAccount && ofAccount.personId !== person.id) return failed("wallet_taken", `la cuenta ${account} ya es de otra persona`);
    const ofPerson = await repo.getWalletLink(person.id);
    if (ofPerson) return ofPerson.publicKey === account ? null : failed("wallet_mismatch", `la persona ${person.id} ya tiene otra cuenta propia`);
    // Otro pedido pudo ligar algo entre la lectura y la escritura: se mira de nuevo.
    if (await repo.linkWallet({ personId: person.id, provider: "pollar", publicKey: account })) return null;
  }
  return failed("wallet_taken", `no se pudo ligar la cuenta ${account}`);
}

export function registerForEvent(input: RegistrationInput & { wallet?: null }): Promise<DirectRegistrationResult>;
export function registerForEvent(input: RegistrationInput): Promise<RegistrationResult>;
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
  if ((await attempts.blockedFor(requester)) > 0) return failed("too_many", "demasiados pedidos seguidos");
  await attempts.note(requester);

  // La cuenta propia, primero: la prueba gasta su desafío salga bien o mal, y sin ella no se toca nada más.
  let own: string | null = null;
  if (input.wallet) {
    const proof = await verifyWalletProof(repo, input.wallet);
    if (!proof.ok) return failed("wallet_invalid", `la prueba de la cuenta no vale (${proof.why})`);
    own = proof.publicKey;
  } else if (input.selfService && pollarEnabled()) {
    return failed("wallet_required", "con Pollar prendido, quien se inscribe entra con su cuenta");
  }

  const known = await repo.getPersonByEmail(email);
  const existingPass = known ? await repo.findPass(event.id, known.id) : null;
  if (known && existingPass && existingPass.status !== "pending") {
    return resendExisting(repo, { event, person: known, pass: existingPass, ticketType, lang: input.lang, origin: input.origin });
  }

  if (own) {
    // Antes de tocar a la persona: una cuenta de otra persona no cambia ni su nombre.
    const ofAccount = await repo.getWalletLinkByAccount(own);
    if (ofAccount && ofAccount.personId !== known?.id) return failed("wallet_taken", `la cuenta ${own} ya es de otra persona`);
  }

  const person = await repo.upsertPerson({ name, email });
  if (own) {
    const problem = await linkOwnAccount(repo, person, own);
    if (problem) return problem;
  }
  let pass = existingPass ?? (await findOrCreatePass(repo, event, person, ticketType));
  if (pass.ticketTypeId !== ticketType.id) {
    // Quedó una inscripción empezada con otra entrada (la red falló a mitad de camino): sigue con la de ahora.
    pass = await repo.updatePass(pass.id, { ticketTypeId: ticketType.id });
  }
  const diet = cleanDiet(input.diet);
  if (diet && pass.diet !== diet) pass = await repo.updatePass(pass.id, { diet });
  const contactConsent = input.contactConsent === true;
  const common = { event, person, ticketType, contactConsent, lang: input.lang, origin: input.origin };

  if (own) {
    // La casilla viaja en el pase pendiente hasta que la persona firma (completeRegistration la toma de ahí).
    if (pass.contactConsent !== contactConsent) pass = await repo.updatePass(pass.id, { contactConsent });
    return startOwnAccountRegistration(repo, { ...common, pass, contractId, account: own });
  }

  // La persona ya tiene su cuenta propia: el servidor no puede firmar por ella, y otra cuenta le daría otro pase.
  if (await repo.getWalletLink(person.id)) return failed("wallet_required", `la persona ${person.id} tiene cuenta propia: se inscribe ella`);

  const accounts = getAccountProvider(repo);
  let account: string;
  try {
    account = await accounts.getOrCreateForPerson(person.id);
  } catch (error) {
    return failed("network", describe(error));
  }

  let txHash: string | null = null;
  let chainNumber: number | null = null;
  try {
    const signer = await accounts.authSigner(person.id);
    const result = paid ? await rumboPass.buy(contractId, account, signer) : await rumboPass.register(contractId, account, signer);
    txHash = result.hash;
    chainNumber = result.number;
  } catch (error) {
    if (!isContractError(error, "AlreadyHasPass")) return chainFailure(error);
    const number = await chainNumberFromStatus(contractId, account);
    if (typeof number !== "number") return number;
    chainNumber = number;
  }

  return finishRegistration(repo, { ...common, pass, account, txHash, chainNumber });
}

/**
 * El paso 1 con la cuenta propia: que la cuenta exista (Pollar la crea al entrar; si todavía no, la crea la
 * patrocinadora), que para la entrada paga acepte el USDC de prueba y tenga saldo, y lo que el contrato le va a
 * pedir firmar. Si el contrato dice que esa cuenta ya tiene su pase, se termina acá, sin firma.
 */
async function startOwnAccountRegistration(
  repo: Repo,
  args: { event: EventRecord; person: Person; pass: Pass; ticketType: TicketType; contractId: string; account: string; contactConsent: boolean; lang: Lang; origin?: string | null },
): Promise<RegistrationResult> {
  const paid = args.ticketType.priceUsdc > 0;
  const fn = paid ? "buy" : "register";
  try {
    const chain = ownChain();
    await chain.ensureAccount(args.account);
    if (paid) {
      if (!(await chain.hasTestTrustline(args.account))) {
        const test = getTestAsset();
        return { kind: "needs_trustline", pass: args.pass, asset: { code: test.code, issuer: test.issuer } };
      }
      await chain.topUpTestUsdc(args.account, args.ticketType.priceUsdc);
    }
    const prepared = await chain.prepare(args.contractId, fn, args.account);
    const request = await repo.createWalletAuthRequest({
      id: newOpaqueId(),
      passId: args.pass.id,
      publicKey: args.account,
      contractId: args.contractId,
      fn,
      entryXdr: prepared.entryXdr,
      validUntilLedger: prepared.validUntilLedger,
      expiresAt: new Date(Date.now() + AUTH_REQUEST_TTL_MS).toISOString(),
    });
    return {
      kind: "needs_signature",
      pass: args.pass,
      person: args.person,
      event: args.event,
      ticketType: args.ticketType,
      request: { requestId: request.id, authEntry: request.entryXdr, validUntilLedger: request.validUntilLedger, fn },
    };
  } catch (error) {
    if (!isContractError(error, "AlreadyHasPass")) return chainFailure(error);
    const number = await chainNumberFromStatus(args.contractId, args.account);
    if (typeof number !== "number") return number;
    return finishRegistration(repo, { ...args, txHash: null, chainNumber: number });
  }
}

export interface CompletionInput {
  /** El id que devolvió registerForEvent en `request.requestId`. */
  requestId: string;
  /** La autorización firmada por la cuenta propia, en XDR base64 (lo que devuelve client.signAuthEntry). */
  signedAuthEntry: string;
  lang: Lang;
  origin?: string | null;
  /** El evento de la ruta: un pedido de firma de otro evento no vale acá (y se gasta igual). */
  slug?: string;
}

/**
 * El paso 2 con la cuenta propia: el navegador devuelve la autorización firmada. Se usa una sola vez; se revisa
 * que sea la que se dio a firmar, de esa cuenta y con una firma que valga, y la patrocinadora arma la transacción,
 * paga la comisión y la manda. Si algo falla, se empieza de nuevo por registerForEvent (con otro desafío).
 */
export async function completeRegistration(input: CompletionInput): Promise<RegistrationResult> {
  const repo = getRepo();
  const request = await repo.useWalletAuthRequest(input.requestId);
  if (!request) return failed("signature_expired", "el pedido de firma venció o ya se usó");
  const check = checkSignedAuthEntry(input.signedAuthEntry, request, NETWORK_PASSPHRASE);
  if (!check.ok) return failed("signature_invalid", `la autorización firmada no vale (${check.problem})`);

  const view = await repo.getPassView(request.passId);
  if (!view) return failed("misconfigured", `no existe el pase ${request.passId}`);
  const { event, person, ticketType } = view;
  if (input.slug !== undefined && input.slug !== event.slug) return failed("signature_expired", "el pedido de firma es de otro evento");
  if (view.pass.status !== "pending") return resendExisting(repo, { event, person, pass: view.pass, ticketType, lang: input.lang, origin: input.origin });

  const common = { event, person, pass: view.pass, ticketType, account: request.publicKey, contactConsent: view.pass.contactConsent, lang: input.lang, origin: input.origin };
  try {
    const result = await ownChain().submitSigned(request.contractId, request.fn, request.publicKey, check.entry);
    return finishRegistration(repo, { ...common, txHash: result.hash, chainNumber: result.number });
  } catch (error) {
    if (!isContractError(error, "AlreadyHasPass")) return chainFailure(error);
    const number = await chainNumberFromStatus(request.contractId, request.publicKey);
    if (typeof number !== "number") return number;
    return finishRegistration(repo, { ...common, txHash: null, chainNumber: number });
  }
}
