// La página pública que verifica un certificado de asistencia (/v/<pase>?c=<código>): si esa persona
// entró al evento, cuándo, y el enlace a su entrada en el registro público. Lo técnico va plegado.
// Las claves llevan el prefijo "verificacion." y existen en los dos idiomas en el mismo cambio.
import type { AreaDictionary } from "./types.ts";

export const verificacion = {
  es: {
    "verificacion.titulo": "Asistencia verificada",
    "verificacion.entro": "Esta persona entró a {evento} el {fecha}.",
    "verificacion.chip": "Entró",
    "verificacion.nombre": "Nombre en el certificado",
    "verificacion.nombreAyuda": "Tiene que ser el mismo nombre que dice el certificado que tenés en la mano.",
    "verificacion.hora": "Hora de entrada",
    "verificacion.evento": "Evento",
    "verificacion.organiza": "Organiza {comunidad}",
    "verificacion.ver": "Ver la entrada en el registro público",
    "verificacion.confirmando": "La entrada está registrada y su anotación pública todavía se está confirmando. Volvé a abrir este enlace en un rato.",
    "verificacion.como": "Cómo se comprueba",
    "verificacion.comoTexto":
      "La puerta del evento anotó esta entrada en Stellar, un registro público, una sola vez por persona. El enlace abre esa anotación en stellar.expert, un explorador que no depende de Rumbo ni de quien organiza. Ahí no hay nombres ni correos: el nombre está solo en el certificado y en esta página.",
    "verificacion.noHay.titulo": "No hay registro de entrada",
    "verificacion.noHay.texto": "Este enlace no corresponde a ninguna entrada registrada. Revisá que esté completo, tal como aparece en el certificado.",
    "verificacion.volver": "Ir al inicio",
  },
  en: {
    "verificacion.titulo": "Verified attendance",
    "verificacion.entro": "This person checked in to {evento} on {fecha}.",
    "verificacion.chip": "Checked in",
    "verificacion.nombre": "Name on the certificate",
    "verificacion.nombreAyuda": "It has to be the same name as on the certificate in your hands.",
    "verificacion.hora": "Check-in time",
    "verificacion.evento": "Event",
    "verificacion.organiza": "Organized by {comunidad}",
    "verificacion.ver": "View the check-in on the public record",
    "verificacion.confirmando": "The check-in is recorded and its public entry is still being confirmed. Open this link again in a while.",
    "verificacion.como": "How it is checked",
    "verificacion.comoTexto":
      "The event's gate recorded this check-in on Stellar, a public record, once per person. The link opens that entry on stellar.expert, an explorer that does not depend on Rumbo or the organizer. There are no names or emails there: the name is only on the certificate and on this page.",
    "verificacion.noHay.titulo": "No check-in on record",
    "verificacion.noHay.texto": "This link does not match any recorded check-in. Check that it is complete, exactly as it appears on the certificate.",
    "verificacion.volver": "Go home",
  },
} satisfies AreaDictionary;
