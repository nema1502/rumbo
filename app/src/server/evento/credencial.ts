// La credencial, armada: el pase con su persona, su evento, su número, su estado y lo que le toca.
// El estado sale del espejo de la base y, cuando la base dice que algo todavía no pasó, se confirma
// con status() en la cadena (con un tope de tiempo: si la red no contesta, vale el espejo).
import type { CredentialKind } from "../../lib/credential-kinds.ts";
import { buildLiveGrant, buildPrintedPayload, type LiveGrant } from "../qr.ts";
import { getEventQrKeys } from "../qr-keys.ts";
import { getRepo, type BenefitKind, type EventRecord, type Pass, type PassBenefit, type Person, type Repo, type TicketType } from "../repo.ts";
import { rumboPass, type PassStatusOnChain } from "../stellar.ts";
import { getRouteGoal } from "../stands.ts";
import { verifyAccessKey } from "./acceso.ts";
import { readContractCapacity, smallestCapacity } from "./cupo.ts";

/** Cómo se muestra cada beneficio en la credencial. */
export type BenefitState = "pendiente" | "canjeado" | "pagada" | "paraRetirar" | "sorteo" | "ganado" | "entregado";

export interface CredentialBenefit {
  id: string;
  name: string;
  kind: BenefitKind;
  state: BenefitState;
  redeemed: boolean;
  /** Está en el catálogo del evento pero no en este pase: un premio que todavía se sortea. */
  inDraw: boolean;
}

export interface CredentialView {
  pass: Pass;
  person: Person;
  event: EventRecord;
  ticketType: TicketType;
  /** Quién es en el evento: asistente, oradora u orador, mentoría, jurado, voluntariado, organización, auspiciante. */
  kind: CredentialKind;
  /** El equipo, si el evento se inscribe por equipos. */
  team: string | null;
  /** "Credencial 3 de 200": el lugar entre las credenciales del evento y el cupo. */
  number: number;
  total: number;
  paid: boolean;
  checkedIn: boolean;
  benefits: CredentialBenefit[];
  /** Lo que va dentro del QR de la credencial impresa: "<pase>.<firma>", fijo. */
  qrPayload: string;
  /** Lo que recibe el celular de la persona para armar el QR que rota cada 20 segundos, sin red. Es secreto de este pase. */
  live: LiveGrant;
  /** Si la cadena contestó. Si no, lo que se ve es solo el espejo. */
  chainChecked: boolean;
}

const CHAIN_TIMEOUT_MS = 4000;

async function readChainStatus(contractId: string | null, account: string | null): Promise<PassStatusOnChain | null> {
  if (!contractId || !account) return null;
  try {
    return await Promise.race([
      rumboPass.status(contractId, account),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CHAIN_TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

export function benefitState(benefit: Pick<PassBenefit, "kind" | "source">, redeemed: boolean, paid: boolean): BenefitState {
  if (benefit.source === "raffle" || benefit.kind === "prize") return redeemed ? "entregado" : "ganado";
  if (redeemed) return "canjeado";
  if (benefit.kind === "merch") return paid ? "pagada" : "paraRetirar";
  return "pendiente";
}

/**
 * El lugar del pase entre los activos del evento, por orden de activación, y el cupo: el de la base, o el del
 * contrato de la entrada si es menor (se recuerda un minuto). Sin cupo fijado, las credenciales que hay.
 */
async function passNumber(repo: Repo, pass: Pass, event: EventRecord, contractId: string | null): Promise<{ number: number; total: number }> {
  const [all, cupo] = await Promise.all([repo.listPasses(pass.eventId), readContractCapacity(contractId)]);
  const key = (p: Pass) => `${p.activatedAt ?? p.createdAt}|${p.createdAt}`;
  const activated = all.filter((p) => p.status !== "pending").sort((a, b) => key(a).localeCompare(key(b)));
  const index = activated.findIndex((p) => p.id === pass.id);
  const number = index >= 0 ? index + 1 : activated.length + 1;
  return { number, total: smallestCapacity(event.capacity, cupo) ?? Math.max(activated.length, number) };
}

/** La credencial, si la clave de acceso es la del pase. Si no, null: no se dice si el pase existe. */
export async function loadCredential(passId: string, key: unknown): Promise<CredentialView | null> {
  if (!(await verifyAccessKey(passId, key))) return null;
  return loadCredentialUnchecked(passId);
}

/** La credencial sin comprobar la clave: para el servidor, después de inscribir. */
export async function loadCredentialUnchecked(passId: string): Promise<CredentialView | null> {
  const repo = getRepo();
  const view = await repo.getPassView(passId);
  if (!view || view.pass.status === "pending") return null;

  const [checkIns, redemptions, catalog, numbering, team] = await Promise.all([
    repo.listCheckInsForPass(passId),
    repo.listRedemptionsForPass(passId),
    repo.listBenefits(view.event.id),
    passNumber(repo, view.pass, view.event, view.contractId),
    repo.getPassTeam(passId),
  ]);

  const qrKeys = await getEventQrKeys(view.event.id);
  const paid = view.ticketType.priceUsdc > 0;
  // Un canje registrado cuenta aunque el contrato lo haya marcado doble: doble quiere decir que ya estaba hecho.
  const redeemedIds = new Set(redemptions.map((r) => r.benefitId));
  let checkedIn = view.pass.status === "checked_in" || checkIns.length > 0;

  const unresolved = view.benefits.filter((b) => b.chainIndex !== null && !redeemedIds.has(b.id));
  let chain: PassStatusOnChain | null = null;
  if (!checkedIn || unresolved.length > 0) chain = await readChainStatus(view.contractId, view.pass.account);
  if (chain) {
    checkedIn = checkedIn || chain.checked_in;
    for (const benefit of unresolved) {
      if (benefit.chainIndex !== null && chain.redeemed.includes(benefit.chainIndex)) redeemedIds.add(benefit.id);
    }
  }

  const benefits: CredentialBenefit[] = view.benefits.map((b) => {
    const redeemed = redeemedIds.has(b.id);
    return { id: b.id, name: b.name, kind: b.kind, state: benefitState(b, redeemed, paid), redeemed, inDraw: false };
  });
  // Los premios del catálogo que este pase no tiene todavía: están en el sorteo. El de la ruta de stands no:
  // ese se gana visitando stands y la credencial lo cuenta aparte, en su ruta.
  const granted = new Set(view.benefits.map((b) => b.id));
  const routePrize = (await getRouteGoal(view.event.id))?.prizeBenefitId;
  for (const b of catalog) {
    if (b.kind === "prize" && b.id !== routePrize && !granted.has(b.id)) benefits.push({ id: b.id, name: b.name, kind: b.kind, state: "sorteo", redeemed: false, inDraw: true });
  }

  return {
    pass: view.pass,
    person: view.person,
    event: view.event,
    ticketType: view.ticketType,
    kind: view.ticketType.credentialKind,
    team: team?.name ?? null,
    number: numbering.number,
    total: numbering.total,
    paid,
    checkedIn,
    benefits,
    qrPayload: buildPrintedPayload(passId, qrKeys),
    live: buildLiveGrant(passId, qrKeys),
    chainChecked: chain !== null,
  };
}
