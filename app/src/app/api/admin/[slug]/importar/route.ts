// /api/admin/<evento>/importar: importar la lista de Luma o de Bevy, en los pasos que pide la pantalla.
//   POST accion=vista     el archivo (campo `archivo`): qué plataforma parece, qué columnas lee y cuántas personas entrarían
//   POST accion=importar  el mismo archivo, los estados que entran (`estados`, JSON) y a qué credencial va cada entrada
//                         (`tipos`, JSON): deja una credencial pendiente por persona y devuelve el resumen
//   POST accion=tanda     `importacion`: prepara y manda por correo una tanda de credenciales pendientes; la pantalla la
//                         pide una y otra vez hasta que no queda ninguna
//   POST accion=estado    `importacion`: cuántas siguen pendientes y el resumen, para retomar una importación que se cortó
//   GET  ?importacion=<id>&formato=csv  el CSV con el enlace personal de cada credencial ya preparada (nombre, correo,
//                         enlace), para mandarlos a mano mientras este servidor no tenga un servicio de correo
// Pide la clave de organizador. Nada de esto toca la página pública: es para quien organiza.
import { NextResponse, type NextRequest } from "next/server";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";
import { langOfRequest, originOfRequest } from "@/server/pedido.ts";
import { getRepo } from "@/server/repo.ts";
import {
  BATCH_SIZE,
  GUEST_STATUSES,
  ImportFormatError,
  ImportOptionsError,
  activateBatch,
  buildImportLinksCsv,
  defaultImportDeps,
  importStatus,
  parseGuestFile,
  prepareImport,
  previewGuests,
  type GuestStatus,
} from "@/server/kit/importar.ts";

export const dynamic = "force-dynamic";
// Una tanda crea cuentas y las inscribe en el contrato, de a cinco: tarda. Con Fluid en Vercel el tope por omisión alcanza; se declara igual.
export const maxDuration = 300;

type Context = { params: Promise<{ slug: string }> };

/** El tope del archivo: una lista de unos miles de personas pesa unos cientos de KB. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const NO_STORE = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });

function jsonField<T>(form: FormData, name: string): T | null {
  const raw = form.get(name);
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  const runId = request.nextUrl.searchParams.get("importacion");
  if (!runId || request.nextUrl.searchParams.get("formato") !== "csv") return fail("bad_request", 400);
  const csv = await buildImportLinksCsv(getRepo(), auth.event, runId, langOfRequest(request), originOfRequest(request));
  if (csv === null) return fail("not_found", 404);
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-enlaces-${day}.csv"`,
      ...NO_STORE,
    },
  });
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

  if (action === "tanda" || action === "estado") {
    const runId = form.get("importacion");
    if (typeof runId !== "string" || !runId) return fail("bad_request", 400);
    const run = await repo.getImportRun(runId);
    if (!run || run.eventId !== event.id) return fail("not_found", 404);
    if (action === "estado") {
      const status = await importStatus(repo, runId);
      return NextResponse.json({ ok: true, summary: status?.summary ?? null, remaining: status?.remaining ?? 0 }, { headers: NO_STORE });
    }
    const result = await activateBatch(repo, event, runId, BATCH_SIZE, defaultImportDeps(langOfRequest(request), originOfRequest(request), repo));
    const status = await importStatus(repo, runId);
    return NextResponse.json({ ok: true, result, summary: status?.summary ?? null }, { headers: NO_STORE });
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
    return NextResponse.json({ ok: true, preview: await previewGuests(repo, event, parsed) }, { headers: NO_STORE });
  }

  const statuses = (jsonField<string[]>(form, "estados") ?? []).filter((s): s is GuestStatus => (GUEST_STATUSES as readonly string[]).includes(s));
  const mapping = jsonField<Record<string, string>>(form, "tipos") ?? {};
  const defaultTypeId = form.get("tipoPorDefecto");
  if (statuses.length === 0 || typeof defaultTypeId !== "string") return fail("bad_request", 400);
  try {
    const { run, summary } = await prepareImport(repo, event, parsed, { statuses, mapping, defaultTypeId });
    return NextResponse.json({ ok: true, runId: run.id, summary, pending: summary.created }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ImportOptionsError) return fail(error.code, error.code === "draft" ? 409 : 400);
    throw error;
  }
}
