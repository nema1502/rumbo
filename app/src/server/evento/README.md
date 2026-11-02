# La inscripción y la credencial

Lo que pasa entre la página pública del evento y la credencial con QR. Las pantallas viven en `src/app/e/[slug]` (el afiche, el formulario y la confirmación) y `src/app/p/[passId]` (la credencial); los componentes en `src/components/evento`; los textos en `src/i18n/evento.ts`.

## El recorrido

1. `/e/<evento>` muestra el afiche (nombre, fecha, lugar, qué incluye) y una tarjeta por entrada, cada una con su único botón: "Inscribirme" si es gratis, "Comprar" si es paga (debajo, "o con el QR del banco" queda deshabilitado y marcado "pronto").
2. `/e/<evento>/inscripcion?entrada=<id>` pide el nombre y el correo. Una sola acción: "Confirmar inscripción" o "Pagar 10 USDC de prueba". Mientras la red confirma, el botón dice "Creando tu credencial".
3. La acción del formulario (`inscripcion/actions.ts`) llama a `registerForEvent` (`inscripcion.ts`), que crea o busca a la persona, le pide su cuenta al `AccountProvider`, llama a `register` (gratis) o a `buy` (paga: la plata sale de la cuenta de la persona y el servidor paga la comisión de red), guarda el pase, le da los beneficios de su entrada, crea la clave de acceso y manda el correo con el enlace personal.
4. `/e/<evento>/listo?pase=<id>&k=<clave>` dice "Inscripción lista" o "Entrada paga" y lleva a la credencial.
5. `/p/<id>?k=<clave>` es la credencial: el evento, el nombre, "Credencial N de M", el estado (inscripción lista, entrada paga o ya entró), el QR grande y lo que le toca a la persona con su chip. "Descargar en SVG" baja la versión para imprimir (100 por 150 milímetros).

## La clave de acceso

El enlace personal lleva `k=<clave>`: un secreto al azar por pase (dieciséis bytes en base64url) guardado en la tabla `pass_access` (migración `002-acceso-credencial.sql`). No es la firma del QR y no sirve para entrar ni para canjear: solo abre la página. Sin la clave correcta la credencial responde 404 sin decir si el pase existe. Quien vuelve a inscribirse con un correo que ya tiene credencial recibe el enlace de nuevo por correo, y la pantalla no se lo muestra: así nadie abre la credencial de otra persona escribiendo su correo.

## El estado en la credencial

`credencial.ts` arma la vista desde el espejo de la base (pases, check-ins, canjes). Cuando la base dice que algo todavía no pasó, lo confirma con `status()` en la cadena, con un tope de cuatro segundos: si la red no contesta, vale el espejo. Los estados de cada beneficio: pendiente, canjeado, pagada (para retirar), para retirar, en el sorteo, ganado y entregado.

## La API

| Ruta | Qué hace |
|---|---|
| `GET /api/evento/<slug>` | Lo público del evento, sus entradas con lo que incluye cada una y el catálogo de beneficios |
| `POST /api/evento/<slug>/inscripcion` | Inscribe o cobra, igual que el formulario. Cuerpo `{ ticketTypeId, name, email, lang? }`. Devuelve `201 { status: "created", passId, url, paid }` o `200 { status: "existing" }`; `400` campos, `402` sin pago, `404` evento o entrada, `409` sin lugares, `429` demasiados pedidos seguidos, `502` red |
| `GET /api/pase/<id>?k=<clave>` | La credencial como datos, con el contenido del QR |
| `GET /api/pase/<id>/svg?k=<clave>[&lang=es\|en][&ver=1]` | La credencial para imprimir. Por defecto se descarga; con `ver=1` se muestra |

## Los frenos

Cada inscripción nueva crea una cuenta, la fondea, le abre la línea de confianza, le da saldo y manda una transacción, todo pagado por el servidor; con correos inventados, además, se llenaría el cupo. Por eso (`src/server/limites.ts`):

- **Por quién pide:** sesenta pedidos por IP en diez minutos (generoso para una fila que se inscribe en la puerta con el wifi del evento), y seiscientos en total. La IP es la que pone la plataforma, no la que dice el pedido (ver `RUMBO_TRUSTED_IP_HEADER` en `.env.example`). Se cuentan todos los pedidos, con correo nuevo o conocido, y el freno responde igual para los dos: `429 { error: "too_many" }`.
- **Por correo:** a quien ya tenía su credencial el enlace se le reenvía una vez cada diez minutos por evento, se pida desde donde se pida. La respuesta es la misma, se mande o no.

## Probarlo

```bash
node scripts/inscribir-prueba.mjs           # inscripción gratis contra la red de prueba, con todas las comprobaciones
node scripts/inscribir-prueba.mjs --pago    # entrada paga: buy con el USDC de prueba de la cuenta de la persona
node scripts/inscribir-prueba.mjs --api http://localhost:3000   # lo mismo por la API de un servidor levantado
```

El script inscribe a una persona de prueba, lee `status()` en la cadena, verifica la firma del QR y la clave de acceso, arma el SVG (queda en `data/`) y comprueba que inscribirse otra vez con el mismo correo no crea otro pase.

## Lo que falta

- El SVG se descarga; la versión en PDF (con `resvg`) todavía no está.
- Las claves de acceso solo existen con `RUMBO_REPO=sqlite`.
- Un desafío contra bots en el formulario (Turnstile, hCaptcha o parecido): pide elegir el servicio.
- Que la respuesta no diga si el correo ya estaba inscripto: hoy una inscripción nueva muestra el enlace en pantalla y una conocida no (y tarda distinto, porque la nueva pasa por la red). Igualarlas pide decidir el recorrido, por ejemplo confirmar siempre por correo antes de mostrar la credencial.
