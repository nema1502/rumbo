// Lo que el servidor escribe en su registro (la consola de next dev, los registros de la plataforma).
// Ahí van los detalles para quien opera Rumbo, nunca datos personales: sin correos.

const EMAIL_RE = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[^\s@<>"'(),;:]+/g;

/** El texto sin las direcciones de correo que pueda traer (un error del proveedor de correo, por ejemplo). */
export function withoutEmails(text: string): string {
  return text.replace(EMAIL_RE, "[correo]");
}

/** El mensaje de un error, sin correos, para el registro del servidor. */
export function describeForLog(error: unknown): string {
  return withoutEmails(error instanceof Error ? error.message : String(error));
}
