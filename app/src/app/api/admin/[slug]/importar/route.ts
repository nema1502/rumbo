// POST /api/admin/<evento>/importar: importar la lista de Luma o de Bevy, en tres pasos que pide la pantalla.
//   accion=vista     el archivo (campo `archivo`): qué plataforma parece, qué columnas lee y cuántas personas entrarían
//   accion=importar  el mismo archivo, los estados que entran (`estados`, JSON) y a qué credencial va cada entrada
//                    (`tipos`, JSON): deja una credencial pendiente por persona y devuelve el resumen
//   accion=tanda     `importacion`: prepara y manda por correo una tanda de credenciales pendientes; la pantalla la
//                    pide una y otra vez hasta que no queda ninguna
// Pide la clave de organizador. Nada de esto toca la página pública: es para quien organiza.
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANG, LANG_COOKIE, LANG_QUERY, isLang, type Lang } from "@/i18n/index.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";
import { getRepo } from "@/server/repo.ts";
import {
  BATCH_SIZE,
  GUEST_STATUSES,
  ImportFormatError,
  ImportOptionsError,
  activateBatch,
  defaultImportDeps,
  importStatus,
  parseGuestFile,
  prepareImport,
  previewGuests,
  type GuestStatus,
} from "@/server/kit/importar.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

/** El tope del archivo: una lista de unos miles de personas pesa unos cientos de KB. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function langOf(request: NextRequest): Lang {
  const fromQuery = request.nextUrl.searchParams.get(LANG_QUERY);
  const fromCookie = request.cookies.get(LANG_COOKIE)?.value;
  return isLang(fromQuery) ? fromQuery : isLang(fromCookie) ? fromCookie : DEFAULT_LANG;
}

/** De dónde se pidió, para que en desarrollo el enlace del correo abra en el mismo servidor. */
function originOf(request: NextRequest): string | null {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return null;
  const proto = request.headers.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });

function jsonField<T>(form: FormData, name: string): T | null {
  const raw = form.get(name);
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  const event = auth.event;
  if (!event.published) return fail("draft", 409);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("bad_request", 400);
  }
  const action = form.get("accion");
  const repo = getRepo();

  if (action === "tanda") {
    const runId = form.get("importacion");
    if (typeof runId !== "string" || !runId) return fail("bad_request", 400);
    const run = await repo.getImportRun(runId);
    if (!run || run.eventId !== event.id) return fail("not_found", 404);
    const result = await activateBatch(repo, event, runId, BATCH_SIZE, defaultImportDeps(langOf(request), originOf(request), repo));
    const status = await importStatus(repo, runId);
    return NextResponse.json({ ok: true, result, summary: status?.summary ?? null }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action !== "vista" && action !== "importar") return fail("bad_request", 400);
  const file = form.get("archivo");
  if (!(file instanceof File)) return fail("bad_request", 400);
  if (file.size > MAX_FILE_BYTES) return fail("too_big", 413);

  let parsed;
  try {
    parsed = parseGuestFile(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof ImportFormatError) return fail(error.code, 422);
    throw error;
  }

  if (action === "vista") {
    return NextResponse.json({ ok: true, preview: await previewGuests(repo, event, parsed) }, { headers: { "Cache-Control": "no-store" } });
  }

  const statuses = (jsonField<string[]>(form, "estados") ?? []).filter((s): s is GuestStatus => (GUEST_STATUSES as readonly string[]).includes(s));
  const mapping = jsonField<Record<string, string>>(form, "tipos") ?? {};
  const defaultTypeId = form.get("tipoPorDefecto");
  if (statuses.length === 0 || typeof defaultTypeId !== "string") return fail("bad_request", 400);
  try {
    const { run, summary } = await prepareImport(repo, event, parsed, { statuses, mapping, defaultTypeId });
    return NextResponse.json({ ok: true, runId: run.id, summary, pending: summary.created }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ImportOptionsError) return fail(error.code, error.code === "draft" ? 409 : 400);
    throw error;
  }
}
