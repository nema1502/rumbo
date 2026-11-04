// POST /api/organizador/entrar: entrar como organizador con la cuenta propia (Pollar). Cuerpo:
// { wallet: { provider, publicKey, challengeId, signature }, name?, lang? }, la misma prueba que lleva la inscripción
// con cuenta propia (el desafío de /api/cuenta/desafio, firmado según SEP-53). Contesta 200 con la cookie de la
// sesión, 401 { error: "wallet" } si la prueba no vale, 403 si el pedido viene de otro sitio (un formulario ajeno
// que entra con la cuenta de otro y deja esa sesión en este navegador), 429 si esa IP falló o entró demasiadas
// veces, y 503 si este servidor no tiene prendido el ingreso con Pollar (entonces el panel se abre con la clave).
import { NextResponse, type NextRequest } from "next/server";
import { pollarEnabled } from "@/server/accounts.ts";
import { readWalletProof } from "@/server/cuenta-propia.ts";
import { clientKey, organizerLoginAttempts, organizerSessionAttempts } from "@/server/limites.ts";
import { loginOrganizer, setOrganizerCookie } from "@/server/organizador.ts";
import { fromOwnSite } from "@/server/pedido.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!fromOwnSite(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!pollarEnabled()) return NextResponse.json({ error: "pollar_off" }, { status: 503 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  const attempts = organizerLoginAttempts();
  const requester = clientKey(request.headers);
  if ((await attempts.blockedFor(requester)) > 0) return NextResponse.json({ error: "too_many" }, { status: 429 });
  // Las que salen bien también cuentan: cada llave que firma es una cuenta nueva, con su propio tope de eventos.
  if ((await organizerSessionAttempts().take(requester)) > 0) return NextResponse.json({ error: "too_many" }, { status: 429 });

  const proof = readWalletProof(body.wallet);
  const name = typeof body.name === "string" ? body.name : undefined;
  const result = proof ? await loginOrganizer(getRepo(), proof, name) : null;
  if (!result || !result.ok) {
    await attempts.note(requester);
    return NextResponse.json({ error: "wallet" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true, organizer: { id: result.organizer.id, name: result.organizer.name } });
  setOrganizerCookie(response, request, result.token);
  return response;
}
