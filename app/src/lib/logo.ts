// El logo de un stand: solo una ruta de esta misma app ("/muestra/logo-nube.svg"). Un enlace a otro servidor
// lo cargaría el navegador de cada persona que abre su credencial, y ese servidor (el del auspiciante) sabría
// la IP y la hora de gente que nunca pasó por su stand. Si hace falta un logo propio, quien organiza lo sube a
// public/ por ahora.

/** Una ruta propia: empieza con una barra (no con dos, que sería otro servidor), sin subir carpetas ni caracteres raros. */
const LOCAL_PATH_RE = /^\/(?!\/)[A-Za-z0-9._~\-/]{1,200}$/;

export function isLocalLogoPath(value: unknown): value is string {
  return typeof value === "string" && LOCAL_PATH_RE.test(value) && !/(^|\/)\.\.(\/|$)/.test(value);
}

/** La ruta si es propia, o null: lo guardado antes de esta regla (un https de afuera) no se muestra. */
export function localLogoOrNull(value: unknown): string | null {
  return isLocalLogoPath(value) ? value : null;
}
