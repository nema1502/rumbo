// Los correos: el enlace personal, el recordatorio, el resultado del sorteo.
// Nunca llaves ni contraseñas en un correo. DevMailer los escribe en data/correos/ y los muestra
// en la consola; ResendMailer queda como esqueleto para producción.
import fs from "node:fs";
import path from "node:path";
import { dataDir, getEnv } from "./env.ts";

export interface Mail {
  to: string;
  subject: string;
  /** El texto plano siempre va: es lo que se lee cuando el HTML no carga. */
  text: string;
  html?: string;
}

export interface Mailer {
  readonly kind: "dev" | "resend";
  send(mail: Mail): Promise<{ id: string }>;
}

/** Escribe cada correo en data/correos/<fecha>-<para>.txt y lo imprime en la consola. */
export class DevMailer implements Mailer {
  readonly kind = "dev" as const;
  private readonly dir: string;

  constructor(dir: string = path.join(dataDir(), "correos")) {
    this.dir = dir;
  }

  async send(mail: Mail): Promise<{ id: string }> {
    fs.mkdirSync(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const to = mail.to.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
    const file = path.join(this.dir, `${stamp}-${to}.txt`);
    const body = [`Para: ${mail.to}`, `Asunto: ${mail.subject}`, "", mail.text, ...(mail.html ? ["", "--- html ---", mail.html] : [])].join("\n");
    fs.writeFileSync(file, body, "utf8");
    console.log(`\n[correo] Para: ${mail.to}\n[correo] Asunto: ${mail.subject}\n${mail.text}\n[correo] Guardado en ${file}\n`);
    return { id: path.basename(file) };
  }
}

/**
 * TODO: mandar con Resend (dominio propio con SPF y DKIM, ver docs/stack.md).
 * Hace falta RESEND_API_KEY y RESEND_FROM en .env.local.
 */
export class ResendMailer implements Mailer {
  readonly kind = "resend" as const;
  private readonly apiKey: string;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = from;
  }

  async send(_mail: Mail): Promise<{ id: string }> {
    void this.apiKey;
    void this.from;
    throw new Error("TODO: ResendMailer todavía no está implementado. Usá RUMBO_MAILER=dev.");
  }
}

declare global {
  var __rumboMailer: Mailer | undefined;
}

export function getMailer(): Mailer {
  if (globalThis.__rumboMailer) return globalThis.__rumboMailer;
  const kind = getEnv("RUMBO_MAILER", "dev");
  const mailer: Mailer = kind === "resend" ? new ResendMailer(getEnv("RESEND_API_KEY", ""), getEnv("RESEND_FROM", "")) : new DevMailer();
  globalThis.__rumboMailer = mailer;
  return mailer;
}
