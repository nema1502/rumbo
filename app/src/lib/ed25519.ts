// Firmar y comprobar con Ed25519 en el navegador (y en Node, que trae el mismo WebCrypto). Usa WebCrypto
// si el navegador sabe Ed25519 (Chrome 137, Firefox 129, Safari 17 en adelante) y, si no, @noble/ed25519,
// una librería chica y auditada que se carga recién cuando hace falta. Sin https (la app abierta por la IP de
// la red local, al probarla desde un celular) el navegador no da crypto.subtle, y el respaldo calcula el
// SHA-512 con @noble/hashes en vez de pedírselo.
//
// Las llaves son las crudas: la pública de 32 bytes y la privada como semilla de 32 bytes.

/** Lo que va antes de la semilla para que WebCrypto la importe como llave privada (PKCS#8). */
const PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
/** Una clave pública válida cualquiera (el punto base), para probar si el navegador sabe Ed25519. */
const PROBE_KEY = Uint8Array.from([
  0x58, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66,
  0x66, 0x66, 0x66, 0x66, 0x66,
]);

type Bytes = Uint8Array<ArrayBuffer>;
const own = (bytes: Uint8Array): Bytes => new Uint8Array(bytes) as Bytes;

let webCrypto: Promise<boolean> | null = null;
let forceNoble = false;

/** Para las pruebas: obliga a usar la librería de respaldo aunque el navegador sepa Ed25519. */
export function usarRespaldo(activar: boolean): void {
  forceNoble = activar;
}

function webCryptoSabe(): Promise<boolean> {
  webCrypto ??= (async () => {
    try {
      await globalThis.crypto.subtle.importKey("raw", own(PROBE_KEY), { name: "Ed25519" }, false, ["verify"]);
      return true;
    } catch {
      return false;
    }
  })();
  return webCrypto;
}

async function conWebCrypto(): Promise<boolean> {
  return !forceNoble && (await webCryptoSabe());
}

/** La librería de respaldo, con su SHA-512 propio si el navegador no tiene crypto.subtle. */
async function respaldo(): Promise<typeof import("@noble/ed25519")> {
  const noble = await import("@noble/ed25519");
  if (!globalThis.crypto?.subtle) {
    const { sha512 } = await import("@noble/hashes/sha2.js");
    noble.hashes.sha512 = sha512;
    noble.hashes.sha512Async = async (message) => sha512(message);
  }
  return noble;
}

/** Si la firma es de esa clave pública sobre ese mensaje. Cualquier problema con las llaves da false. */
export async function ed25519Verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  try {
    if (await conWebCrypto()) {
      const key = await globalThis.crypto.subtle.importKey("raw", own(publicKey), { name: "Ed25519" }, false, ["verify"]);
      return await globalThis.crypto.subtle.verify({ name: "Ed25519" }, key, own(signature), own(message));
    }
    const noble = await respaldo();
    return await noble.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}

/** Firma un mensaje con la semilla de una llave privada. */
export async function ed25519Sign(seed: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  if (await conWebCrypto()) {
    const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + seed.length);
    pkcs8.set(PKCS8_PREFIX);
    pkcs8.set(seed, PKCS8_PREFIX.length);
    const key = await globalThis.crypto.subtle.importKey("pkcs8", pkcs8 as Bytes, { name: "Ed25519" }, false, ["sign"]);
    return new Uint8Array(await globalThis.crypto.subtle.sign({ name: "Ed25519" }, key, own(message)));
  }
  const noble = await respaldo();
  return await noble.signAsync(message, seed);
}
