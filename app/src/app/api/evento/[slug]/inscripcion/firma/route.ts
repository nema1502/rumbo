// POST /api/evento/<slug>/inscripcion/firma: el paso 2 de la inscripción con la cuenta propia (Pollar).
// Cuerpo: { requestId, signedAuthEntry, lang? }: el id que devolvió la inscripción y la autorización que firmó el
// dispositivo (client.signAuthEntry). El servidor revisa que sea la misma que dio a firmar, de esa cuenta y con
// una firma que valga, y la manda pagando la comisión. Contesta como la inscripción: 201 con la credencial creada,
// o el error (410 signature_expired si el pedido venció o ya se usó: hay que empezar de nuevo).
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANG, isLang } from "@/i18n/index.ts";
import { completeRegistration, type RegistrationResult } from "@/server/evento/inscripcion.ts";
import { registrationResponse } from "@/server/evento/inscripcion-respuesta.ts";

export const dynamic = "force-dynamic";
// Mandar la transacción y esperar su confirmación tarda. Con Fluid en Vercel el tope por omisión alcanza; se declara igual.
export const maxDuration = 300;

type Params = Promise<{ slug: string }>;

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { slug } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  // Un cuerpo que es JSON pero no es un objeto ("null", una lista) tampoco sirve.
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const requestId = text(body.requestId);
  const signedAuthEntry = text(body.signedAuthEntry);
  if (!requestId || !signedAuthEntry) return NextResponse.json({ error: "invalid_fields" }, { status: 400 });

  let result: RegistrationResult;
  try {
    result = await completeRegistration({ requestId, signedAuthEntry, slug, lang: isLang(body.lang) ? body.lang : DEFAULT_LANG, origin: request.nextUrl.origin });
  } catch (error) {
    console.error("[inscripcion] firma", error);
    return NextResponse.json({ error: "network" }, { status: 502 });
  }
  return registrationResponse(result);
}
