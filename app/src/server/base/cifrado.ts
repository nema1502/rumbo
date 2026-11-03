// Los secretos que se guardan en la base: la llave privada y la raíz de credenciales de cada evento
// (event_qr_keys) y la llave de cada cuenta de prueba (dev_accounts). Con Postgres van cifrados con AES-256-GCM
// y la llave RUMBO_DATA_KEY, que vive en las variables del servidor y nunca en la base: quien se lleve una copia
// de la base no tiene con qué firmar credenciales ni mover cuentas. En SQLite de desarrollo quedan tal cual.
//
// Cada valor cifrado es: la versión (1 byte), el nonce (12), la etiqueta de GCM (16) y el texto cifrado. El
// contexto (tabla, columna y fila) va como dato asociado: un valor copiado a otra fila no se descifra.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "../env.ts";

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class DataKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataKeyError";
  }
}

const HOW_TO = 'Son 32 bytes al azar en base64: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"';

/** La llave de RUMBO_DATA_KEY. Lanza DataKeyError si falta o no tiene la forma: así la app no arranca a medias. */
export function loadDataKey(): Buffer {
  const raw = getEnv("RUMBO_DATA_KEY")?.trim();
  if (!raw) throw new DataKeyError(`Falta RUMBO_DATA_KEY: con la base Postgres, las llaves de los QR y las cuentas de prueba se guardan cifradas con ella. ${HOW_TO}`);
  const key = /^[A-Za-z0-9+/_-]+={0,2}$/.test(raw) ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (key.length !== KEY_BYTES) throw new DataKeyError(`RUMBO_DATA_KEY no es una llave de 32 bytes en base64. ${HOW_TO}`);
  return key;
}

/** Cómo guarda la base un secreto y cómo lo recupera. `context` dice de qué fila y columna es. */
export interface SecretCodec {
  readonly encrypted: boolean;
  sealBytes(plain: Uint8Array, context: string): Uint8Array;
  openBytes(stored: unknown, context: string): Uint8Array;
  /** Un texto secreto (la llave de una cuenta de prueba): en SQLite queda como texto, en Postgres cifrado. */
  sealText(plain: string, context: string): string | Uint8Array;
  openText(stored: unknown, context: string): string;
}

const asBytes = (value: unknown): Uint8Array => {
  if (value instanceof Uint8Array) return value;
  throw new Error("El secreto guardado no tiene la forma esperada");
};

/** SQLite de desarrollo: tal cual, como hasta ahora. */
export const plainSecrets: SecretCodec = {
  encrypted: false,
  sealBytes: (plain) => plain,
  openBytes: (stored) => new Uint8Array(asBytes(stored)),
  sealText: (plain) => plain,
  openText: (stored) => String(stored),
};

export function aesSecrets(key: Buffer): SecretCodec {
  if (key.length !== KEY_BYTES) throw new DataKeyError("La llave de la base tiene que tener 32 bytes");
  const seal = (plain: Uint8Array, context: string): Uint8Array => {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, "utf8"));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return new Uint8Array(Buffer.concat([Buffer.from([VERSION]), nonce, cipher.getAuthTag(), body]));
  };
  const open = (stored: unknown, context: string): Uint8Array => {
    const bytes = Buffer.from(asBytes(stored));
    if (bytes.length < 1 + NONCE_BYTES + TAG_BYTES || bytes[0] !== VERSION) throw new Error(`El secreto guardado (${context}) no está cifrado con esta versión`);
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(1, 1 + NONCE_BYTES), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(bytes.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES));
    try {
      return new Uint8Array(Buffer.concat([decipher.update(bytes.subarray(1 + NONCE_BYTES + TAG_BYTES)), decipher.final()]));
    } catch {
      // Sin el detalle de la llave: solo de qué fila es, para encontrar el problema.
      throw new Error(`No se pudo descifrar el secreto guardado (${context}): ¿cambió RUMBO_DATA_KEY?`);
    }
  };
  return {
    encrypted: true,
    sealBytes: seal,
    openBytes: open,
    sealText: (plain, context) => seal(Buffer.from(plain, "utf8"), context),
    openText: (stored, context) => Buffer.from(open(stored, context)).toString("utf8"),
  };
}
