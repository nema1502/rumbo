// POST /api/cuenta/desafio: un desafío de un solo uso para probar que una cuenta de Stellar es de quien la trae.
// Cuerpo: { publicKey, lang? }. Contesta 201 { challengeId, message, expiresAt }: el dispositivo firma `message`
// según SEP-53 (con Pollar, client.stellar.sep53.signMessage) y la firma va en la inscripción, en wallet. Vence a
// los cinco minutos y sirve una sola vez.
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANG, isLang } from "@/i18n/index.ts";
import { isAccountKey, issueChallenge } from "@/server/cuenta-propia.ts";
import { clientKey, walletChallengeAttempts } from "@/server/limites.ts";
import { getRepo } from "@/server/repo.ts";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const publicKey = typeof body.publicKey === "string" ? body.publicKey.trim() : "";
  if (!isAccountKey(publicKey)) return NextResponse.json({ error: "invalid_account" }, { status: 400 });

  const attempts = walletChallengeAttempts();
  const requester = clientKey(request.headers);
  if ((await attempts.blockedFor(requester)) > 0) return NextResponse.json({ error: "too_many" }, { status: 429 });
  await attempts.note(requester);

  const challenge = await issueChallenge(getRepo(), publicKey, isLang(body.lang) ? body.lang : DEFAULT_LANG);
  return NextResponse.json(challenge, { status: 201 });
}
