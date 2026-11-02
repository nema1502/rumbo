// El escáner del voluntario: la cámara, los tres veredictos, la cola local y la sincronización. Lo llena el frente del escáner.
// Las claves llevan el prefijo "escaner." y existen en los dos idiomas en el mismo cambio.
import type { AreaDictionary } from "./types.ts";

export const escaner = {
  es: {},
  en: {},
} satisfies AreaDictionary;
