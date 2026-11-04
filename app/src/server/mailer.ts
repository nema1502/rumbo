// Los correos: el enlace personal, el recordatorio, el resultado del sorteo.
// Nunca llaves ni contraseñas en un correo. Quien manda un correo recibe un resultado honesto: "sent" si de
// verdad salió, "not_configured" si en este servidor todavía no hay con qué mandarlo (y entonces el enlace se
// muestra en pantalla, o quien organiza lo baja en CSV). DevMailer escribe cada correo en data/correos/ en
// desarrollo y no manda nada en producción; ResendMailer queda como esqueleto.
import fs from "node:fs";
import path from "node:path";
import { dataDir, getEnv } from "./env.ts";
import { describeForLog } from "./log.ts";

export interface Mail {
  to: string;
  subject: string;
  /** El texto plano siempre va: es lo que se lee cuando el HTML no carga. */
  text: string;
  html?: string;
}

/** Qué pasó con el correo: salió, o este servidor no tiene con qué mandarlo (nadie lo recibió). */
export type MailOutcome = "sent" | "not_configured";

export interface MailResult {
  /** El id del envío (o del archivo, en desarrollo); null si no salió. */
  id: string | null;
  outcome: MailOutcome;
}

export interface Mailer {
  readonly kind: "dev" | "resend" | "none";
  send(mail: Mail): Promise<MailResult>;
}

const NOT_CONFIGURED: MailResult = { id: null, outcome: "not_configured" };

/** El dominio de un correo, para el registro del servidor: nunca el correo entero. */
const domainOf = (email: string): string => email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase() || "?";

/**
 * El correo de desarrollo: escribe cada uno en data/correos/<fecha>-<para>.txt. En el registro va solo el
 * dominio y dónde quedó el archivo, nunca el texto (lleva el enlace personal con su clave). En producción no
 * escribe ni dice nada y contesta "not_configured": un correo que no sale no se cuenta como enviado.
 */
export class DevMailer implements Mailer {
  readonly kind = "dev" as const;
  private readonly dir: string | null;

  constructor(dir: string | null = null) {
    this.dir = dir;
  }

  async send(mail: Mail): Promise<MailResult> {
    if (process.env.NODE_ENV === "production") return NOT_CONFIGURED;
    try {
      const dir = this.dir ?? path.join(dataDir(), "correos");
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const to = mail.to.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
      const file = path.join(dir, `${stamp}-${to}.txt`);
      const body = [`Para: ${mail.to}`, `Asunto: ${mail.subject}`, "", mail.text, ...(mail.html ? ["", "--- html ---", mail.html] : [])].join("\n");
      fs.writeFileSync(file, body, "utf8");
      console.log(`[correo] Un correo a ${domainOf(mail.to)}, "${mail.subject}": guardado en ${file}`);
      return { id: path.basename(file), outcome: "sent" };
    } catch (error) {
      console.warn(`[correo] No se pudo guardar el correo de desarrollo: ${describeForLog(error)}`);
      return NOT_CONFIGURED;
    }
  }
}

let resendWarned = false;

/**
 * TODO: mandar con Resend (dominio propio con SPF y DKIM, ver docs/stack.md).
 * Hace falta RESEND_API_KEY y RESEND_FROM en .env.local. Mientras no esté, contesta "not_configured".
 */
export class ResendMailer implements Mailer {
  readonly kind = "resend" as const;
  private readonly apiKey: string;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = from;
  }

  async send(_mail: Mail): Promise<MailResult> {
    void this.apiKey;
    void this.from;
    if (!resendWarned) {
      resendWarned = true;
      console.warn("[correo] ResendMailer todavía no está implementado: ningún correo sale. Los enlaces se muestran en pantalla y se bajan en CSV.");
    }
    return NOT_CONFIGURED;
  }
}

/** Cuando ni siquiera se pudo armar el correo de desarrollo: nada sale, y nadie recibe un 500 por eso. */
class NullMailer implements Mailer {
  readonly kind = "none" as const;
  async send(): Promise<MailResult> {
    return NOT_CONFIGURED;
  }
}

declare global {
  /** Un correo de mentira para las pruebas y las capturas. En producción se ignora. */
  var __rumboMailer: Mailer | undefined;
}

export function getMailer(): Mailer {
  if (globalThis.__rumboMailer && process.env.NODE_ENV !== "production") return globalThis.__rumboMailer;
  const kind = getEnv("RUMBO_MAILER", "dev");
  try {
    return kind === "resend" ? new ResendMailer(getEnv("RESEND_API_KEY", ""), getEnv("RESEND_FROM", "")) : new DevMailer();
  } catch (error) {
    console.warn(`[correo] No se pudo preparar el correo (${kind}): ${describeForLog(error)}`);
    return new NullMailer();
  }
}
