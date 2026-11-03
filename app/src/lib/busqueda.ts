// La búsqueda de la puerta: sin mayúsculas ni tildes. La usan el servidor (por nombre o correo, con red,
// src/server/puerta.ts) y el escáner (solo por nombre, en la lista que ya bajó, sin red).
import type { DoorMatch, ScanPassInfo } from "./escaner-api.ts";

export const SEARCH_MIN_LENGTH = 3;
export const SEARCH_MAX_RESULTS = 8;

/** Minúsculas y sin tildes, para que "jose" encuentre a "José". */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Si lo escrito alcanza para buscar. */
export function isSearchable(query: string): boolean {
  return normalizeSearch(query).length >= SEARCH_MIN_LENGTH;
}

/**
 * Sin red: busca por nombre en la lista que el escáner ya tiene (no trae correos). `checkedIn` es lo que
 * este mismo celular ya marcó y todavía no llegó al servidor.
 */
export function searchSnapshotByName(passes: ScanPassInfo[], query: string, checkedIn: (passId: string) => string | null = () => null): DoorMatch[] {
  const needle = normalizeSearch(query);
  if (needle.length < SEARCH_MIN_LENGTH) return [];
  return passes
    .filter((pass) => normalizeSearch(pass.name).includes(needle))
    .map((pass) => ({ passId: pass.id, name: pass.name, emailHint: "", checkedInAt: pass.checkedInAt ?? checkedIn(pass.id), ticket: "" }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, SEARCH_MAX_RESULTS);
}
