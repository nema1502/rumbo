// La verificación pública de la asistencia: lo que muestra /v/<pase>?c=<código> y lo que lleva el QR
// del certificado (scripts/certificados.mjs). Dice si esa persona entró al evento, cuándo, y con qué
// transacción quedó en Stellar. El código es una firma del pase con la llave del evento, separada de la
// firma del QR de la credencial: con el enlace del certificado no se puede armar una credencial, y sin
// el código no se puede recorrer los ids de pase para sacar nombres (un id solo tiene cuarenta bits).
import { createHmac } from "node:crypto";
import { QR_SIG_BYTES, base32Encode, constantTimeEqual, isValidPassId } from "../lib/qr-codec.ts";
import { baseUrl } from "./env.ts";
import { explorerUrl, reportNetwork, type ReportNetwork } from "./explorador.ts";
import { getRepo, type EventRecord, type Repo } from "./repo.ts";

/** Lo que separa la firma del certificado de la firma del QR de la credencial. */
const CERTIFICATE_DOMAIN = "rumbo:certificado:";
const CODE_RE = /^[A-Z2-7]{16}$/;

/** El código de verificación de un certificado: dieciséis letras y números. */
export function certificateCode(passId: string, key: Uint8Array): string {
  const mac = createHmac("sha256", key).update(`${CERTIFICATE_DOMAIN}${passId}`, "utf8").digest();
  return base32Encode(new Uint8Array(mac.subarray(0, QR_SIG_BYTES)));
}

/** La dirección pública de verificación de un certificado. */
export function verificationUrl(passId: string, code: string, base: string = baseUrl()): string {
  return `${base.replace(/\/+$/, "")}/v/${encodeURIComponent(passId)}?c=${encodeURIComponent(code)}`;
}

export type AttendanceVerification =
  | { found: false }
  | {
      found: true;
      event: Pick<EventRecord, "name" | "startsAt" | "endsAt" | "timezone" | "place" | "venue" | "organizerName">;
      /** El nombre que va en el certificado. */
      name: string;
      checkedIn: boolean;
      checkedInAt: string | null;
      /** El enlace a la transacción de entrada en stellar.expert, si ya llegó al contrato. */
      txUrl: string | null;
      network: ReportNetwork;
    };

interface FirstEntry {
  at: string | null;
  txHash: string | null;
}

/** La primera entrada válida de un pase (las dobles no cuentan) y su transacción, si llegó al contrato. */
async function firstEntry(passId: string, fallbackAt: string | null, repo: Repo): Promise<FirstEntry> {
  const checkIns = (await repo.listCheckInsForPass(passId)).filter((c) => !c.duplicate).sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
  const first = checkIns[0];
  const synced = checkIns.find((c) => c.synced && c.txHash);
  return { at: first?.scannedAt ?? fallbackAt, txHash: synced?.txHash ?? null };
}

/**
 * Lo que la página de verificación puede decir de un pase. Sin el código correcto responde igual que
 * si el pase no existiera: la página no cuenta qué ids existen.
 */
export async function verifyAttendance(passId: string, code: string | null | undefined, repo: Repo = getRepo()): Promise<AttendanceVerification> {
  const id = passId.trim().toUpperCase();
  const given = (code ?? "").trim().toUpperCase();
  if (!isValidPassId(id) || !CODE_RE.test(given)) return { found: false };
  const view = await repo.getPassView(id);
  if (!view) return { found: false };
  const expected = certificateCode(id, await repo.getEventQrKey(view.event.id));
  if (!constantTimeEqual(expected, given)) return { found: false };

  const network = reportNetwork();
  const checkedIn = view.pass.status === "checked_in";
  const entry = checkedIn ? await firstEntry(id, view.pass.checkedInAt, repo) : { at: null, txHash: null };
  const { name, startsAt, endsAt, timezone, place, venue, organizerName } = view.event;
  return {
    found: true,
    event: { name, startsAt, endsAt, timezone, place, venue, organizerName },
    name: view.person.name,
    checkedIn,
    checkedInAt: entry.at,
    txUrl: entry.txHash ? explorerUrl(network, "tx", entry.txHash) : null,
    network,
  };
}

/** Una persona que entró, para su certificado: el nombre va en el PDF y en la página de verificación, nunca en la cadena. */
export interface CertificateAttendee {
  passId: string;
  code: string;
  name: string;
  checkedInAt: string | null;
  /** El tipo de participación, si el dato existe. Hoy la inscripción no lo pide: queda null. */
  role: "attendee" | "speaker" | "mentor" | "volunteer" | null;
}

/** Quienes entraron al evento, con el código de verificación de cada certificado. */
export async function listCertificateAttendees(event: EventRecord, repo: Repo = getRepo()): Promise<CertificateAttendee[]> {
  const key = await repo.getEventQrKey(event.id);
  const passes = (await repo.listPasses(event.id)).filter((p) => p.status === "checked_in");
  const out: CertificateAttendee[] = [];
  for (const pass of passes) {
    const person = await repo.getPersonById(pass.personId);
    if (!person) continue;
    const entry = await firstEntry(pass.id, pass.checkedInAt, repo);
    out.push({ passId: pass.id, code: certificateCode(pass.id, key), name: person.name, checkedInAt: entry.at, role: null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "es"));
}
