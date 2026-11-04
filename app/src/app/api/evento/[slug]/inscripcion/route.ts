// POST /api/evento/<slug>/inscripcion: inscribe (o cobra) a una persona, igual que el formulario.
// Cuerpo: { ticketTypeId, name, email, lang?, contactConsent?, diet?, wallet? } (contactConsent: true solo si la
// persona marcó que la comunidad que organiza le escriba). Devuelve el enlace personal solo cuando la credencial
// se acaba de crear; si el correo ya tenía la suya, se le reenvía por correo y acá no se muestra.
//
// Con la cuenta propia (Pollar), wallet es la prueba de que la cuenta es suya: { provider: "pollar", publicKey,
// challengeId, signature }, con el desafío de POST /api/cuenta/desafio firmado según SEP-53. Entonces contesta 202:
//   { status: "needs_signature", passId, requestId, authEntry, validUntilLedger, fn }: el dispositivo firma
//     authEntry (client.signAuthEntry) y lo manda a POST /api/evento/<slug>/inscripcion/firma;
//   { status: "needs_trustline", passId, asset }: la entrada paga necesita que la cuenta acepte el USDC de prueba
//     (client.setTrustline); después se vuelve a empezar, con otro desafío.
// Con Pollar prendido (RUMBO_ACCOUNTS=pollar), sin wallet contesta 401 { error: "wallet_required" }.
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANG, isLang } from "@/i18n/index.ts";
import { readWalletProof } from "@/server/cuenta-propia.ts";
import { clientKey } from "@/server/limites.ts";
import { RegistrationNotFound, hasErrors, registerForEvent, validateFields, type RegistrationResult } from "@/server/evento/inscripcion.ts";
import { registrationResponse } from "@/server/evento/inscripcion-respuesta.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

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
    result = await registerForEvent({
      slug,
      ticketTypeId,
      ...fields,
      lang,
      origin: request.nextUrl.origin,
      clientKey: clientKey(request.headers),
      contactConsent: body.contactConsent === true,
      diet: text(body.diet),
      wallet: readWalletProof(body.wallet),
      selfService: true,
    });
  } catch (error) {
    if (error instanceof RegistrationNotFound) return NextResponse.json({ error: "not_found", what: error.what }, { status: 404 });
    console.error("[inscripcion]", error);
    return NextResponse.json({ error: "network" }, { status: 502 });
  }
  return registrationResponse(result);
}
