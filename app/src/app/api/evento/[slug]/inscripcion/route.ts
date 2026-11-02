// POST /api/evento/<slug>/inscripcion: inscribe (o cobra) a una persona, igual que el formulario.
// Cuerpo: { ticketTypeId, name, email, lang? }. Devuelve el enlace personal solo cuando la credencial
// se acaba de crear; si el correo ya tenía la suya, se le reenvía por correo y acá no se muestra.
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANG, isLang } from "@/i18n/index.ts";
import { withoutEmails } from "@/server/log.ts";
import {
  RegistrationNotFound,
  hasErrors,
  registerForEvent,
  validateFields,
  type FailureReason,
  type RegistrationResult,
} from "@/server/evento/inscripcion.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

const FAILURE_STATUS: Record<FailureReason, number> = { sold_out: 409, not_paid: 402, network: 502, misconfigured: 500 };

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { slug } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const ticketTypeId = text(body.ticketTypeId);
  const fields = { name: text(body.name), email: text(body.email) };
  const lang = isLang(body.lang) ? body.lang : DEFAULT_LANG;

  const errors = validateFields(fields);
  if (!ticketTypeId || hasErrors(errors)) {
    return NextResponse.json({ error: "invalid_fields", fields: { ...errors, ...(ticketTypeId ? {} : { ticketTypeId: "obligatorio" }) } }, { status: 400 });
  }

  let result: RegistrationResult;
  try {
    result = await registerForEvent({ slug, ticketTypeId, ...fields, lang, origin: request.nextUrl.origin });
  } catch (error) {
    if (error instanceof RegistrationNotFound) return NextResponse.json({ error: "not_found", what: error.what }, { status: 404 });
    console.error("[inscripcion]", error);
    return NextResponse.json({ error: "network" }, { status: 502 });
  }

  if (result.kind === "failed") {
    console.warn(`[inscripcion] ${result.reason}: ${withoutEmails(result.detail)}`);
    return NextResponse.json({ error: result.reason }, { status: FAILURE_STATUS[result.reason] });
  }
  if (result.kind === "existing") return NextResponse.json({ status: "existing" });
  return NextResponse.json(
    { status: "created", passId: result.pass.id, url: result.url, paid: result.paid, ticketType: result.ticketType.name },
    { status: 201 },
  );
}
