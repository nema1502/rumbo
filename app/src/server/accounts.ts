// Las cuentas de las personas. Debajo de cada persona hay una cuenta de Stellar que nunca ve.
// AccountProvider es la interfaz; DevAccountProvider la implementación de hoy (SOLO RED DE PRUEBA);
// Pollar (Google) y passkeys quedan como esqueletos con TODO.
import { Keypair, Operation, type Transaction } from "@stellar/stellar-sdk";
import { assertTestnet, getEnv } from "./env.ts";
import { getRepo, type Repo } from "./repo.ts";
import { fundWithFriendbot, getIssuer, getTestAsset, keypairSigner, submitClassic, submitSponsored, type AuthSigner, type TxResult } from "./stellar.ts";

export type AccountProviderKind = "dev" | "pollar" | "passkey";

export interface AccountProvider {
  readonly kind: AccountProviderKind;
  /** La cuenta de Stellar de la persona (clave pública). La crea si no existe. */
  getOrCreateForPerson(personId: string): Promise<string>;
  /** La cuenta si ya existe, o null. */
  getForPerson(personId: string): Promise<string | null>;
  /** Quien firma por la persona las autorizaciones que le pide el contrato (register, buy). */
  authSigner(personId: string): Promise<AuthSigner>;
  /** Firma por la persona lo que la transacción le pide y la manda, con la comisión patrocinada. */
  signAndSubmit(personId: string, tx: Transaction): Promise<TxResult>;
}

/**
 * SOLO PARA LA RED DE PRUEBA. NUNCA EN PRODUCCIÓN.
 *
 * El servidor crea la cuenta de Stellar de cada persona, la fondea con friendbot, le agrega la línea
 * de confianza al USDC de prueba, le pide al emisor un saldo inicial y guarda la llave secreta en la
 * base local (tabla dev_accounts). Firma por la persona cuando el contrato se lo pide.
 *
 * Nada de esto vale con plata real: en producción la cuenta es de la persona (Google con Pollar, o
 * una passkey) y el servidor no tiene su llave. La interfaz lo dice: "Modo de prueba: la cuenta la
 * guarda el servidor; en producción es tuya, con Google o con una passkey".
 */
export class DevAccountProvider implements AccountProvider {
  readonly kind = "dev" as const;
  private readonly repo: Repo;

  constructor(repo: Repo) {
    assertTestnet();
    this.repo = repo;
  }

  async getForPerson(personId: string): Promise<string | null> {
    return (await this.repo.getDevAccount(personId))?.publicKey ?? null;
  }

  async getOrCreateForPerson(personId: string): Promise<string> {
    let account = await this.repo.getDevAccount(personId);
    if (!account) {
      const keypair = Keypair.random();
      // Se guarda antes de tocar la red: si algo falla a mitad de camino, el próximo intento sigue desde acá.
      account = await this.repo.saveDevAccount({ personId, publicKey: keypair.publicKey(), secretKey: keypair.secret(), funded: false });
    }
    if (!account.funded) {
      await this.setUpOnChain(Keypair.fromSecret(account.secretKey));
      await this.repo.markDevAccountFunded(personId);
    }
    return account.publicKey;
  }

  /** Friendbot, línea de confianza al USDC de prueba y saldo inicial del emisor, en una sola transacción patrocinada. */
  private async setUpOnChain(keypair: Keypair): Promise<void> {
    await fundWithFriendbot(keypair.publicKey());
    const test = getTestAsset();
    const operations = [Operation.changeTrust({ asset: test.asset, source: keypair.publicKey() })];
    const signers = [keypair];

    const issuer = getIssuer();
    const initial = getEnv("RUMBO_INITIAL_TEST_USDC", "100");
    if (issuer && issuer.publicKey() === test.issuer && Number(initial) > 0) {
      operations.push(Operation.payment({ destination: keypair.publicKey(), asset: test.asset, amount: initial, source: issuer.publicKey() }));
      signers.push(issuer);
    } else {
      console.warn(`[cuentas] La cuenta ${keypair.publicKey()} queda sin saldo inicial: no tengo la llave del emisor ${test.issuer} (STELLAR_ISSUER_SECRET).`);
    }
    await submitClassic(operations, signers);
  }

  async authSigner(personId: string): Promise<AuthSigner> {
    const account = await this.repo.getDevAccount(personId);
    if (!account) throw new Error(`La persona ${personId} todavía no tiene cuenta: llamá antes a getOrCreateForPerson`);
    return keypairSigner(Keypair.fromSecret(account.secretKey));
  }

  async signAndSubmit(personId: string, tx: Transaction): Promise<TxResult> {
    return submitSponsored(tx, [await this.authSigner(personId)]);
  }
}

/**
 * TODO: la cuenta con Google, a través de Pollar, con las comisiones patrocinadas por ellos.
 * getOrCreateForPerson pide la cuenta a Pollar con el id de la app; authSigner devuelve un firmante
 * que manda la autorización a Pollar para que la firme la persona. Ver docs/stack.md.
 */
export class PollarAccountProvider implements AccountProvider {
  readonly kind = "pollar" as const;
  private todo(): never {
    throw new Error("TODO: PollarAccountProvider todavía no está implementado. Usá RUMBO_ACCOUNTS=dev.");
  }
  getOrCreateForPerson(): Promise<string> { return this.todo(); }
  getForPerson(): Promise<string | null> { return this.todo(); }
  authSigner(): Promise<AuthSigner> { return this.todo(); }
  signAndSubmit(): Promise<TxResult> { return this.todo(); }
}

/**
 * TODO: la cuenta con passkey (passkey-kit o smart-account-kit): una cuenta inteligente cuya firma
 * es la huella o la cara de la persona. La autorización la firma el navegador con WebAuthn.
 */
export class PasskeyAccountProvider implements AccountProvider {
  readonly kind = "passkey" as const;
  private todo(): never {
    throw new Error("TODO: PasskeyAccountProvider todavía no está implementado. Usá RUMBO_ACCOUNTS=dev.");
  }
  getOrCreateForPerson(): Promise<string> { return this.todo(); }
  getForPerson(): Promise<string | null> { return this.todo(); }
  authSigner(): Promise<AuthSigner> { return this.todo(); }
  signAndSubmit(): Promise<TxResult> { return this.todo(); }
}

declare global {
  var __rumboAccounts: AccountProvider | undefined;
}

export function getAccountProvider(repo: Repo = getRepo()): AccountProvider {
  if (globalThis.__rumboAccounts) return globalThis.__rumboAccounts;
  const kind = getEnv("RUMBO_ACCOUNTS", "dev");
  const provider: AccountProvider = kind === "pollar" ? new PollarAccountProvider() : kind === "passkey" ? new PasskeyAccountProvider() : new DevAccountProvider(repo);
  globalThis.__rumboAccounts = provider;
  return provider;
}
