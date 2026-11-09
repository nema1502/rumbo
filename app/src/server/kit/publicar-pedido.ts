// Quién puede hacer que /admin/<evento>/publicando arranque sola. La página es un GET: cualquier sitio la puede abrir
// con un enlace, y la cookie de la sesión (SameSite=Lax) viaja en esa navegación. Si arrancara siempre, un enlace de
// otro sitio publicaría el borrador de quien lo sigue con la sesión abierta, y publicar no se deshace. Arranca sola
// solo si el evento ya está publicado (terminar las credenciales del equipo no cambia nada que se vea) o si quien
// llega tocó "Publicar el evento" en el borrador hace un momento: esa acción deja esta cookie, SameSite=Strict
// (ningún pedido que empiece en otro sitio la lleva), con el id del evento y dos minutos de vida, y el primer paso la
// borra. Si no, la pantalla muestra el botón "Publicar el evento".

/** La cookie que deja "Publicar el evento" en el borrador. */
export const PUBLISH_INTENT_COOKIE = "rumbo.publicar";

/** Si /publicando arranca sola: el evento ya publicado, o la cookie de "Publicar el evento" con el id de este evento. */
export function shouldAutoStart(event: { id: string; published: boolean }, intent: string | null | undefined): boolean {
  return event.published || (typeof intent === "string" && intent !== "" && intent === event.id);
}
