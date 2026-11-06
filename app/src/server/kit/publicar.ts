// Publicar un borrador: cada tipo de entrada necesita su propio contrato (el precio, el cupo y cuántos canjes
// tiene son fijos por contrato), y recién después el evento se ve en la página pública y recibe inscripciones.
// Quien despliega los contratos es un `ContractProvisioner`: el de verdad (networkProvisioner) los crea en la red
// de prueba desde el WASM que ya subió el despliegue de muestra; las pruebas usan uno falso, sin red.
//
// Publicar va de a un contrato por pedido (publishStep): un meetup trae ocho tipos de credencial, y desplegarlos
// todos en un solo pedido tardaba más de un minuto con la pantalla quieta (4-nov-2026). Primero van los tipos que
// se inscriben desde la página (el asistente); apenas tienen su contrato, el evento queda publicado y su página
// abre, aunque falten los del equipo (oradores, jurado, voluntarios...), que siguen en los pasos de después. La
// pantalla /admin/<evento>/publicando pide un paso tras otro y muestra el avance. Si una credencial del equipo se
// emite antes de que su tipo tenga contrato (importar una lista, una credencial importada que se inscribe por la
// página), el contrato se crea en ese momento (ensureTicketTypeContract). Si algo falla, lo que ya se creó queda
// guardado y el siguiente intento sigue desde ahí.
import { Address, Operation, TransactionBuilder, BASE_FEE, nativeToScVal } from "@stellar/stellar-sdk";
import { isPublicKind } from "../../lib/credential-kinds.ts";
import { BUSY, tryExclusive } from "../compartido.ts";
import { allowEventContractInPollar, type AllowOutcome } from "../pollar-politica.ts";
import type { EventRecord, Repo, TicketType } from "../repo.ts";
import { NETWORK_PASSPHRASE, TX_TIMEOUT_SECONDS, getRpc, getSponsor, getTestAsset, readDeployInfo, submitSponsored, toStroops, withSponsorLock } from "../stellar.ts";

/** Lo que fija el contrato de una entrada al crearse. */
export interface ContractSpec {
  /** En USDC de prueba. 0 es gratis. */
  price: number;
  capacity: number;
  /** Cuántos canjes tiene (de 0 a benefits - 1). */
  benefits: number;
  /** La cuenta de quien organiza, a donde van los pagos. Null: la del despliegue de muestra. */
  organizerAccount: string | null;
}

export interface ContractProvisioner {
  /** Crea el contrato y devuelve su id. */
  deploy(spec: ContractSpec): Promise<string>;
  /**
   * Le avisa a Pollar que el contrato existe, para que firme por las cuentas que custodia lo que la persona
   * hace en él (register y buy). Sin esto, el de verdad usa allowEventContractInPollar; las pruebas, nada.
   */
  allow?(contractId: string, label: string): Promise<AllowOutcome>;
}

export type PublishFailure = "no_attendee" | "no_free_attendee" | "no_capacity" | "deploy_failed" | "busy";

export type PublishResult =
  | { ok: true; deployed: number }
  | { ok: false; reason: PublishFailure; detail: string | null };

/** El avance de publicar: cuántos tipos de credencial ya tienen su contrato, de cuántos, y si el evento ya abrió. */
export interface PublishProgress {
  /** El evento ya se ve en la página pública: los tipos del asistente tienen su contrato. */
  published: boolean;
  /** Cuántos tipos tienen contrato, de `total`. */
  done: number;
  total: number;
  /** Los que se inscriben desde la página (el asistente): con todos listos, el evento se publica. */
  publicDone: number;
  publicTotal: number;
}

export type StepResult = ({ ok: true; deployed: number } & PublishProgress) | { ok: false; reason: PublishFailure; detail: string | null };

declare global {
  /** Un desplegador de mentira para las capturas y las pruebas con un servidor adentro, como __rumboKitChain. En producción se ignora. */
  var __rumboProvisioner: ContractProvisioner | undefined;
}

/** El desplegador de este proceso: el de la red de prueba, o el de mentira que pusieron las capturas y las pruebas. */
export function currentProvisioner(): ContractProvisioner {
  return process.env.NODE_ENV === "production" ? networkProvisioner : (globalThis.__rumboProvisioner ?? networkProvisioner);
}

const publishTurn = (eventId: string) => `publish:${eventId}`;

/**
 * Corre fn con el turno de publicar del evento, o devuelve BUSY si un paso está corriendo. Guardar el borrador lo
 * usa: un paso lee cuántos canjes trae un tipo, despliega su contrato con ese número y recién después lo guarda;
 * si el borrador cambiara en el medio, el contrato quedaría con otro número.
 */
export function withPublishTurn<T>(eventId: string, fn: () => Promise<T>): Promise<T | typeof BUSY> {
  return tryExclusive(publishTurn(eventId), fn);
}

/** Los tipos en el orden en que se despliegan: primero los que se inscriben desde la página, después el resto, cada grupo en su orden. */
export function deployOrder(types: readonly TicketType[]): TicketType[] {
  return [...types.filter((t) => isPublicKind(t.credentialKind)), ...types.filter((t) => !isPublicKind(t.credentialKind))];
}

/** Si el tipo ya tiene con qué emitir: su contrato, o el del evento (los de muestra, armados a mano). */
const hasContract = (event: EventRecord, type: TicketType): boolean => Boolean(type.contractId ?? event.contractId);

function progressOf(event: EventRecord, types: readonly TicketType[]): PublishProgress {
  const publics = types.filter((t) => isPublicKind(t.credentialKind));
  return {
    published: event.published,
    done: types.filter((t) => hasContract(event, t)).length,
    total: types.length,
    publicDone: publics.filter((t) => hasContract(event, t)).length,
    publicTotal: publics.length,
  };
}

/** Cómo va la publicación del evento, sin tocar nada: para el panel ("Terminar de preparar") y la pantalla de publicar. */
export async function publishProgress(repo: Repo, event: EventRecord): Promise<PublishProgress> {
  return progressOf(event, await repo.listTicketTypes(event.id));
}

/** Si todavía queda algo por preparar: el evento sin publicar, o algún tipo sin contrato. */
export const isPublishPending = (p: PublishProgress): boolean => !p.published || p.done < p.total;

/** Crea el contrato de un tipo, lo guarda si sigue sin uno y le avisa a Pollar. Devuelve el contrato que quedó. */
async function deployFor(repo: Repo, event: EventRecord, type: TicketType, provisioner: ContractProvisioner): Promise<{ contractId: string; created: boolean }> {
  const benefits = (await repo.listTicketTypeBenefits(type.id)).length;
  const contractId = await provisioner.deploy({ price: type.priceUsdc, capacity: event.capacity ?? 0, benefits, organizerAccount: event.organizerAccount });
  // Solo si la entrada sigue sin contrato: el que ya tiene (con inscriptos, quizás) no se pisa nunca.
  if (await repo.setTicketTypeContractIfEmpty(type.id, contractId)) {
    // Con cuentas de Pollar, su firmante tiene que conocer el contrato; si el aviso falla, publicar sigue y
    // queda en el registro: la inscripción con Google diría "no autorizó" hasta cargar la fila a mano.
    await (provisioner.allow ?? allowEventContractInPollar)(contractId, `${event.name}: ${type.name}`);
    return { contractId, created: true };
  }
  console.warn(`[publicar] La entrada ${type.id} ya tenía contrato: el recién creado (${contractId}) queda sin usar`);
  const current = await repo.getTicketType(type.id);
  return { contractId: current?.contractId ?? contractId, created: false };
}

/** Un paso, con el turno ya tomado. Se vuelve a leer todo: lo que leyó quien llamó puede ser de antes de otro paso. */
async function stepLocked(repo: Repo, eventId: string, provisioner: ContractProvisioner): Promise<StepResult> {
  let event = await repo.getEventById(eventId);
  if (!event) return { ok: false, reason: "deploy_failed", detail: "el evento ya no existe" };
  let types = await repo.listTicketTypes(event.id);
  // Lo que pide un borrador para abrir. Ya publicado, eso se revisó al abrir: los pasos que siguen solo terminan
  // las credenciales del equipo (y un evento de muestra, armado a mano, no se vuelve a juzgar).
  if (!event.published) {
    const attendees = types.filter((t) => isPublicKind(t.credentialKind));
    if (attendees.length === 0) return { ok: false, reason: "no_attendee", detail: null };
    if (!attendees.some((t) => t.priceUsdc === 0)) return { ok: false, reason: "no_free_attendee", detail: null };
    const capacity = event.capacity ?? 0;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) return { ok: false, reason: "no_capacity", detail: null };
  }

  let deployed = 0;
  const ready = (t: TicketType) => hasContract(event as EventRecord, t);
  const next = deployOrder(types).find((t) => !ready(t));
  if (next) {
    try {
      if ((await deployFor(repo, event, next, provisioner)).created) deployed++;
    } catch (error) {
      return { ok: false, reason: "deploy_failed", detail: error instanceof Error ? error.message : String(error) };
    }
    types = await repo.listTicketTypes(event.id);
  }
  // Con todos los del asistente listos, la página abre: los del equipo siguen en los pasos de después.
  if (!event.published && types.filter((t) => isPublicKind(t.credentialKind)).every(ready)) {
    event = await repo.updateEvent(event.id, { published: true });
  }
  return { ok: true, deployed, ...progressOf(event, types) };
}

/**
 * Un paso de publicar: crea el contrato de un solo tipo de credencial (primero los del asistente, después los del
 * equipo) y, apenas los del asistente tienen el suyo, marca el evento como publicado. Devuelve el avance, o el
 * motivo si no se pudo. Un solo paso por evento a la vez: dos pestañas (o un doble clic) desplegaban el doble de
 * contratos y el segundo pisaba el contrato de una entrada que ya tenía inscriptos. Mientras uno trabaja, el otro
 * recibe "busy" sin esperar.
 */
export async function publishStep(repo: Repo, event: EventRecord, provisioner: ContractProvisioner = currentProvisioner()): Promise<StepResult> {
  const outcome = await tryExclusive(publishTurn(event.id), () => stepLocked(repo, event.id, provisioner));
  return outcome === BUSY ? { ok: false, reason: "busy", detail: null } : outcome;
}

/**
 * Publica el evento entero de una vez: los pasos de publishStep uno tras otro, con el turno tomado todo el tiempo
 * (lo usan el servidor MCP y las pruebas, que no tienen una pantalla que muestre el avance). Termina cuando todos
 * los tipos tienen contrato. Ya publicado y completo, no hace nada.
 */
export async function publishEvent(repo: Repo, event: EventRecord, provisioner: ContractProvisioner = currentProvisioner()): Promise<PublishResult> {
  const outcome = await tryExclusive(publishTurn(event.id), async (): Promise<PublishResult> => {
    let deployed = 0;
    // Cada paso crea un contrato o termina: nunca más vueltas que tipos (y una para publicar).
    for (let round = 0; ; round++) {
      const step = await stepLocked(repo, event.id, provisioner);
      if (!step.ok) return step;
      deployed += step.deployed;
      if ((step.published && step.done >= step.total) || round > step.total) return { ok: true, deployed };
    }
  });
  return outcome === BUSY ? { ok: false, reason: "busy", detail: null } : outcome;
}

/** Cuánto espera ensureTicketTypeContract el turno de publicar si otro paso lo tiene: un despliegue tarda unos segundos. */
const ENSURE_WAIT_MS = 90_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** El tipo de credencial no tiene contrato y no se pudo crear ahora: quien emitía la credencial lo trata como un fallo para reintentar. */
export class ContractNotReady extends Error {
  constructor(detail: string) {
    super(`La credencial todavía no tiene su contrato: ${detail}`);
    this.name = "ContractNotReady";
  }
}

/**
 * El contrato con el que se emite una credencial de ese tipo: el suyo, el del evento, o uno nuevo creado en este
 * momento si el evento abrió antes de que le llegara el turno a ese tipo (las credenciales del equipo se terminan
 * de preparar después de publicar). Toma el mismo turno que publicar, esperándolo si otro paso lo tiene, así nunca
 * se crean dos contratos para el mismo tipo. Si no se puede, lanza ContractNotReady.
 */
export async function ensureTicketTypeContract(
  repo: Repo,
  event: EventRecord,
  type: TicketType,
  provisioner: ContractProvisioner = currentProvisioner(),
  waitMs: number = ENSURE_WAIT_MS,
): Promise<string> {
  const known = type.contractId ?? event.contractId;
  if (known) return known;
  const started = Date.now();
  for (let pause = 100; ; pause = Math.min(pause * 2, 1000)) {
    const outcome = await tryExclusive(publishTurn(event.id), async (): Promise<string> => {
      const current = await repo.getTicketType(type.id);
      if (!current || current.eventId !== event.id) throw new ContractNotReady(`el tipo ${type.id} ya no existe`);
      const fresh = (await repo.getEventById(event.id)) ?? event;
      const ready = current.contractId ?? fresh.contractId;
      if (ready) return ready;
      try {
        return (await deployFor(repo, fresh, current, provisioner)).contractId;
      } catch (error) {
        throw new ContractNotReady(error instanceof Error ? error.message : String(error));
      }
    });
    if (outcome !== BUSY) return outcome;
    if (Date.now() - started > waitMs) throw new ContractNotReady("otro paso de publicar sigue con el turno");
    await sleep(pause);
  }
}

const u32 = (n: number) => nativeToScVal(n, { type: "u32" });

/** Los argumentos del constructor de rumbo-pass, en su orden: quien organiza, Rumbo, la puerta, el activo, el precio, la comisión, el cupo y los canjes. */
export function constructorArgs(spec: ContractSpec, accounts: { organizer: string; treasury: string; gate: string; asset: string }, feeBps: number) {
  return [
    new Address(accounts.organizer).toScVal(),
    new Address(accounts.treasury).toScVal(),
    new Address(accounts.gate).toScVal(),
    new Address(accounts.asset).toScVal(),
    nativeToScVal(toStroops(spec.price), { type: "i128" }),
    u32(feeBps),
    u32(spec.capacity),
    u32(spec.benefits),
  ];
}

/**
 * Crea un contrato nuevo desde el WASM que subió el despliegue de muestra (su hash está en
 * contracts/rumbo-pass/deploy/testnet.json), con las cuentas y el activo del mismo despliegue.
 */
export const networkProvisioner: ContractProvisioner = {
  async deploy(spec) {
    const info = readDeployInfo();
    const wasmHash = typeof info?.raw.wasmHash === "string" ? info.raw.wasmHash : null;
    const organizer = spec.organizerAccount ?? info?.accounts.organizer ?? null;
    const { treasury, gate } = info?.accounts ?? {};
    if (!info || !wasmHash || !organizer || !treasury || !gate) {
      throw new Error("Falta el despliegue de muestra (contracts/rumbo-pass/deploy/testnet.json) para crear el contrato del evento.");
    }
    const feeBps = Object.values(info.events)[0]?.feeBps ?? 250;
    const args = constructorArgs(spec, { organizer, treasury, gate, asset: getTestAsset().contract }, feeBps);
    return withSponsorLock(async () => {
      const sponsor = getSponsor();
      const account = await getRpc().getAccount(sponsor.publicKey());
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(
          Operation.createCustomContract({
            address: new Address(sponsor.publicKey()),
            wasmHash: Buffer.from(wasmHash, "hex"),
            constructorArgs: args,
            salt: Buffer.from(crypto.getRandomValues(new Uint8Array(32))),
          }),
        )
        .setTimeout(TX_TIMEOUT_SECONDS)
        .build();
      const result = await submitSponsored(tx);
      if (typeof result.returnValue !== "string") throw new Error("La red no devolvió el id del contrato nuevo.");
      return result.returnValue;
    });
  },
};
