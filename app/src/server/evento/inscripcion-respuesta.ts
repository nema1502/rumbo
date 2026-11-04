// Cómo contesta la API de inscripción (POST /api/evento/<slug>/inscripcion y su paso de firma, .../firma): el
// mismo resultado de registerForEvent o de completeRegistration, como JSON con su código HTTP.
import { NextResponse } from "next/server";
import { withoutEmails } from "../log.ts";
import type { FailureReason, RegistrationResult } from "./inscripcion.ts";

export const FAILURE_STATUS: Record<FailureReason, number> = {
  sold_out: 409,
  not_paid: 402,
  network: 502,
  misconfigured: 500,
  too_many: 429,
  wallet_required: 401,
  wallet_invalid: 401,
  wallet_taken: 409,
  wallet_mismatch: 409,
  signature_invalid: 400,
  signature_expired: 410,
  ticket_mismatch: 409,
};

export function registrationResponse(result: RegistrationResult): NextResponse {
  switch (result.kind) {
    case "failed":
      console.warn(`[inscripcion] ${result.reason}: ${withoutEmails(result.detail)}`);
      return NextResponse.json({ error: result.reason }, { status: FAILURE_STATUS[result.reason] });
    case "existing":
      return NextResponse.json({ status: "existing" });
    case "needs_signature":
      // La autorización sin firmar no lleva nada personal: el contrato, la función, la cuenta y un nonce.
      return NextResponse.json({ status: "needs_signature", passId: result.pass.id, ...result.request }, { status: 202 });
    case "needs_trustline":
      return NextResponse.json({ status: "needs_trustline", passId: result.pass.id, asset: result.asset }, { status: 202 });
    case "created":
      return NextResponse.json(
        { status: "created", passId: result.pass.id, url: result.url, paid: result.paid, ticketType: result.ticketType.name },
        { status: 201 },
      );
  }
}
