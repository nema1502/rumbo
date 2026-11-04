// Publicar un borrador: cada tipo de entrada necesita su propio contrato (el precio, el cupo y cuántos canjes
// tiene son fijos por contrato), y recién después el evento se ve en la página pública y recibe inscripciones.
// Quien despliega los contratos es un `ContractProvisioner`: el de verdad (networkProvisioner) los crea en la red
// de prueba desde el WASM que ya subió el despliegue de muestra; las pruebas usan uno falso, sin red.
// networkProvisioner corrió contra la red de prueba el 4-nov-2026, por el servidor MCP (pnpm e2e:mcp): seis
// contratos en treinta segundos, con sus ids en demo/mcp.txt. Si algo falla, publicar devuelve el error y el
// borrador queda como estaba.
import { Address, Operation, TransactionBuilder, BASE_FEE, nativeToScVal } from "@stellar/stellar-sdk";
import { isPublicKind } from "../../lib/credential-kinds.ts";
import { BUSY, tryExclusive } from "../compartido.ts";
import type { EventRecord, Repo } from "../repo.ts";
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
}

export type PublishFailure = "no_attendee" | "no_free_attendee" | "no_capacity" | "deploy_failed" | "busy";

export type PublishResult =
  | { ok: true; deployed: number }
  | { ok: false; reason: PublishFailure; detail: string | null };

/**
 * Publica el evento: crea el contrato de cada tipo de entrada que todavía no lo tiene y marca el evento como
 * publicado. Si un contrato falla, los que ya se crearon quedan guardados y el siguiente intento sigue desde ahí.
 * Un solo "Publicar" por evento a la vez: dos pestañas (o un doble clic) desplegaban el doble de contratos y el
 * segundo pisaba el contrato de una entrada que ya tenía inscriptos. Mientras uno publica, el otro recibe "busy".
 */
export async function publishEvent(repo: Repo, event: EventRecord, provisioner: ContractProvisioner = networkProvisioner): Promise<PublishResult> {
  if (event.published) return { ok: true, deployed: 0 };
  const outcome = await tryExclusive(`publish:${event.id}`, () => publishOnce(repo, event.id, provisioner));
  return outcome === BUSY ? { ok: false, reason: "busy", detail: null } : outcome;
}

async function publishOnce(repo: Repo, eventId: string, provisioner: ContractProvisioner): Promise<PublishResult> {
  // Se vuelve a leer con el turno tomado: lo que quien llama leyó puede ser de antes de que otro publicara.
  const event = await repo.getEventById(eventId);
  if (!event) return { ok: false, reason: "deploy_failed", detail: "el evento ya no existe" };
  if (event.published) return { ok: true, deployed: 0 };
  const types = await repo.listTicketTypes(event.id);
  const attendees = types.filter((t) => isPublicKind(t.credentialKind));
  if (attendees.length === 0) return { ok: false, reason: "no_attendee", detail: null };
  if (!attendees.some((t) => t.priceUsdc === 0)) return { ok: false, reason: "no_free_attendee", detail: null };
  const capacity = event.capacity ?? 0;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) return { ok: false, reason: "no_capacity", detail: null };

  let deployed = 0;
  for (const type of types) {
    if (type.contractId) continue;
    const benefits = (await repo.listTicketTypeBenefits(type.id)).length;
    try {
      const contractId = await provisioner.deploy({ price: type.priceUsdc, capacity, benefits, organizerAccount: event.organizerAccount });
      // Solo si la entrada sigue sin contrato: el que ya tiene (con inscriptos, quizás) no se pisa nunca.
      if (await repo.setTicketTypeContractIfEmpty(type.id, contractId)) deployed++;
      else console.warn(`[publicar] La entrada ${type.id} ya tenía contrato: el recién creado (${contractId}) queda sin usar`);
    } catch (error) {
      return { ok: false, reason: "deploy_failed", detail: error instanceof Error ? error.message : String(error) };
    }
  }
  await repo.updateEvent(event.id, { published: true });
  return { ok: true, deployed };
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
