// Los tipos de credencial: quién es la persona en el evento. Lo comparten el servidor, la credencial y el
// escáner (que corre en el navegador del voluntario, sin red), así que no importa nada de Node.

export const CREDENTIAL_KINDS = ["attendee", "speaker", "mentor", "judge", "volunteer", "organizer", "sponsor"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export function isCredentialKind(value: unknown): value is CredentialKind {
  return typeof value === "string" && (CREDENTIAL_KINDS as readonly string[]).includes(value);
}

/** La clave del texto con que se nombra el tipo en pantalla (src/i18n/kit.ts). */
export function kindLabelKey(kind: CredentialKind): string {
  return `kit.tipo.${kind}`;
}

/** Los tipos que se ofrecen en la página pública del evento. Los demás se entregan por invitación. */
export function isPublicKind(kind: CredentialKind): boolean {
  return kind === "attendee";
}

/** Si el tipo es de quienes hacen el evento (y no de quienes vienen a él): el escáner lo marca distinto. */
export function isStaffKind(kind: CredentialKind): boolean {
  return kind !== "attendee";
}
