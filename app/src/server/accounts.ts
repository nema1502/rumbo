// Las cuentas de las personas. Debajo de cada persona hay una cuenta de Stellar que nunca ve.
// AccountProvider es la interfaz; DevAccountProvider la del modo de prueba (SOLO RED DE PRUEBA: el servidor
// guarda la llave); PollarAccountProvider la de la cuenta propia, con Google o con el correo (RUMBO_ACCOUNTS=pollar
// y la clave publicable de Pollar). Las passkeys quedan como esqueleto con TODO.
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

/** La persona tiene su cuenta propia (Pollar): lo que el contrato le pide lo firma su dispositivo, no el servidor. */
export class SignsOnDevice extends Error {
  constructor(personId: string) {
    super(`La cuenta de la persona ${personId} es suya (Pollar): la autorización la firma su dispositivo, con el paso de firma de la inscripción`);
    this.name = "SignsOnDevice";
  }
}

/** Pollar está prendido: RUMBO_ACCOUNTS=pollar y la clave publicable de la app de Pollar. Sin las dos, el modo de prueba. */
export function pollarEnabled(): boolean {
  return getEnv("RUMBO_ACCOUNTS") === "pollar" && Boolean(getEnv("NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY"));
}

/** La clave publicable de Pollar, para el navegador, o null si Pollar no está prendido. */
export function pollarPublishableKey(): string | null {
  return pollarEnabled() ? (getEnv("NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY") ?? null) : null;
}

/**
 * La cuenta con Google o con el correo, a través de Pollar: la persona entra en el navegador, Pollar crea su
 * cuenta de Stellar y custodia la llave, y la persona prueba que es suya (SEP-53, src/server/cuenta-propia.ts).
 * Ahí queda ligada (wallet_links). El servidor no puede firmar por ella: register y buy van en dos pasos, el
 * servidor prepara la autorización y el navegador la firma con Pollar (src/server/evento/inscripcion.ts).
 *
 * Quien no entró con Pollar (una lista importada por quien organiza, el evento de muestra) sigue, SOLO EN LA RED
 * DE PRUEBA, con la cuenta de prueba que guarda el servidor: para esas personas este proveedor es el de prueba.
 */
export class PollarAccountProvider implements AccountProvider {
  readonly kind = "pollar" as const;
  private readonly repo: Repo;
  private readonly fallback: AccountProvider;

  constructor(repo: Repo, fallback: AccountProvider = new DevAccountProvider(repo)) {
    this.repo = repo;
    this.fallback = fallback;
  }

  async getForPerson(personId: string): Promise<string | null> {
    return (await this.repo.getWalletLink(personId))?.publicKey ?? (await this.fallback.getForPerson(personId));
  }

  async getOrCreateForPerson(personId: string): Promise<string> {
    return (await this.repo.getWalletLink(personId))?.publicKey ?? (await this.fallback.getOrCreateForPerson(personId));
  }

  async authSigner(personId: string): Promise<AuthSigner> {
    if (await this.repo.getWalletLink(personId)) throw new SignsOnDevice(personId);
    return this.fallback.authSigner(personId);
  }

  async signAndSubmit(personId: string, tx: Transaction): Promise<TxResult> {
    return submitSponsored(tx, [await this.authSigner(personId)]);
  }
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
  // Sin la clave publicable, Pollar no puede andar en el navegador: queda el modo de prueba.
  const provider: AccountProvider = pollarEnabled() ? new PollarAccountProvider(repo) : kind === "passkey" ? new PasskeyAccountProvider() : new DevAccountProvider(repo);
  globalThis.__rumboAccounts = provider;
  return provider;
}
