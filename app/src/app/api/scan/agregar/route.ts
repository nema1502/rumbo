// POST /api/scan/agregar: "agregar en la puerta", la inscripción rápida y gratis de quien llegó sin credencial.
// Cuerpo: { code, name, email, lang? }. Devuelve a la persona (nueva, o la que ya estaba inscripta con ese
// correo) para que el voluntario le marque la entrada. Solo lo abre el código del puesto Puerta.
import { DEFAULT_LANG, isLang } from "@/i18n/index.ts";
import type { DoorAddError, DoorAddResponse } from "@/lib/escaner-api.ts";
import { authorizeScanRequest } from "@/server/escaner.ts";
import { clientKey } from "@/server/limites.ts";
import { addAtDoor, requireGate } from "@/server/puerta.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

const FAILURE: Record<string, { error: DoorAddError; status: number }> = {
  sold_out: { error: "sold_out", status: 409 },
  too_many: { error: "too_many", status: 429 },
};

export async function POST(request: Request): Promise<Response> {
  const repo = getRepo();
  const auth = await authorizeScanRequest(repo, request);
  if (!auth.ok) return auth.response;
  const denied = requireGate(auth.access);
  if (denied) return denied;

  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const lang = isLang(auth.body.lang) ? auth.body.lang : DEFAULT_LANG;
  const result = await addAtDoor(repo, auth.access.event, {
    name: text(auth.body.name),
    email: text(auth.body.email),
    lang,
    origin: new URL(request.url).origin,
    clientKey: clientKey(request.headers),
  });

  const fail = (error: DoorAddError, status: number): Response => Response.json({ kind: "error", error } satisfies DoorAddResponse, { status });
  switch (result.kind) {
    case "invalid":
      return fail(result.errors.name !== undefined ? "invalid_name" : "invalid_email", 400);
    case "no_free_ticket":
      return fail("no_free_ticket", 409);
    case "failed": {
      const known = FAILURE[result.reason];
      return known ? fail(known.error, known.status) : fail("failed", 502);
    }
    default:
      return Response.json({ kind: result.kind, match: result.match } satisfies DoorAddResponse, { status: result.kind === "added" ? 201 : 200 });
  }
}
