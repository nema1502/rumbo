// Los aliados de un evento en su credencial: quién presenta, en colaboración con quién, con el apoyo de quién y la
// sede, cada uno con su logo. Se configura por evento en RUMBO_EVENT_ALLIES, así los nombres de los aliados no viven
// en el código: un JSON con el final de /e/<evento> como clave.
//
//   {"<evento>": {"grupos": [{"rol": "Con el apoyo de", "logos": [{"archivo": "/eventos/<evento>/aliado-1.svg", "alt": "Nombre", "ancho": 96}]}]}}
//
// Los logos son siempre rutas de esta misma app (public/), por lo mismo que los de los stands (lib/logo.ts): un
// enlace a otro servidor le contaría a ese servidor la IP y la hora de cada persona que abre su credencial.
import { isLocalLogoPath } from "../../lib/logo.ts";
import type { EventRecord } from "../repo.ts";

export const ALLIES_ENV = "RUMBO_EVENT_ALLIES";
const LOGO_HEIGHT = 40;

export interface AllyLogo {
  src: string;
  alt: string;
  /** El ancho a 40 px de alto. */
  width: number;
  height: number;
}

export interface AllyGroup {
  role: string;
  logos: AllyLogo[];
}

const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null);

function readLogo(raw: unknown): AllyLogo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const src = r.archivo ?? r.src;
  const alt = text(r.alt, 80);
  const width = typeof r.ancho === "number" ? r.ancho : typeof r.width === "number" ? r.width : NaN;
  if (!isLocalLogoPath(src) || !alt || !Number.isInteger(width) || width < 10 || width > 400) return null;
  return { src, alt, width, height: LOGO_HEIGHT };
}

/** Los grupos de aliados del evento, o null si no tiene (o si la variable no se puede leer: la credencial sale igual). */
export function eventAllies(event: Pick<EventRecord, "slug">, raw: string | undefined = process.env[ALLIES_ENV]): AllyGroup[] | null {
  if (!raw || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[aliados] ${ALLIES_ENV} no es un JSON válido: la credencial sale sin aliados.`);
    return null;
  }
  const entry = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>)[event.slug] : undefined;
  const groups = entry && typeof entry === "object" ? (entry as Record<string, unknown>).grupos : undefined;
  if (!Array.isArray(groups)) return null;
  const out: AllyGroup[] = [];
  for (const g of groups) {
    if (!g || typeof g !== "object") continue;
    const role = text((g as Record<string, unknown>).rol, 60);
    const logos = Array.isArray((g as Record<string, unknown>).logos) ? ((g as Record<string, unknown>).logos as unknown[]).map(readLogo).filter((l): l is AllyLogo => l !== null) : [];
    if (role && logos.length > 0) out.push({ role, logos });
  }
  return out.length > 0 ? out : null;
}
