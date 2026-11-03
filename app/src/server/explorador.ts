// Los enlaces a stellar.expert, el explorador público donde cualquiera puede abrir un contrato o una
// transacción. Los usan el informe del evento y la página de verificación de los certificados.
import { getEnv } from "./env.ts";

/** La red de Stellar, como la nombra stellar.expert: "testnet" o "public". */
export type ReportNetwork = "testnet" | "public";

/** La red del servidor como la nombra stellar.expert. */
export function reportNetwork(): ReportNetwork {
  const network = getEnv("STELLAR_NETWORK", "testnet").toLowerCase();
  return network === "testnet" ? "testnet" : "public";
}

/** El enlace de stellar.expert a un contrato o a una transacción. */
export function explorerUrl(network: ReportNetwork, kind: "contract" | "tx", id: string): string {
  return `https://stellar.expert/explorer/${network}/${kind}/${encodeURIComponent(id)}`;
}
