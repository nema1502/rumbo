// El enlace del proyector: la pantalla en vivo en modo solo lectura. Lo que comparten el servidor
// (src/server/vivo.ts, src/app/vivo/[slug]/page.tsx) y la pantalla en el navegador (components/vivo/PantallaVivo.tsx).

/** El parámetro con el que el enlace del proyector trae su clave: /vivo/<evento>?pantalla=... */
export const SCREEN_KEY_QUERY = "pantalla";

/**
 * Quién abrió la pantalla en vivo: quien organiza, con su clave del panel (ve el enlace del proyector y maneja el
 * sorteo), o el proyector, con su propio enlace (solo mira: sin el panel ni los botones del sorteo).
 */
export type ScreenAccess = { kind: "organizer"; screenKey: string } | { kind: "screen"; key: string };
