# El escáner del voluntario

La página `/scan`: el voluntario escribe el código de su puesto (la puerta, la mesa del almuerzo, el stand de la polera; quien organiza se lo manda desde el panel) y desde ahí lee credenciales con la cámara del celular. Cada lectura da uno de tres veredictos a pantalla entera: verde (entró, canjeado), amarillo (ya entró, ya canjeado, con la hora) y neutro (no corresponde, con el motivo). Funciona sin red una vez que el puesto se abrió con conexión, y se puede instalar en la pantalla de inicio.

## Cómo decide sin red

Al abrir el puesto, con red, el escáner baja la foto del evento (`POST /api/scan/open`): su puesto, la llave del evento y cada pase activo con el nombre, los beneficios que trae, si ya entró y qué ya canjeó. Con eso decide solo:

1. Verifica la firma del QR con WebCrypto (`src/lib/qr-verify.ts`). Si no cierra, no corresponde: la credencial no es de este evento.
2. Mira el pase en la foto y en su propia cola (lo que este mismo escáner registró y todavía no subió).
3. En la puerta: si ya entró, amarillo; si no, verde y a la cola. Una credencial auténtica de un pase que no estaba en la foto entra igual: la firma prueba que es del evento y el servidor la revisa al sincronizar.
4. En una mesa de canje: si la entrada no incluye el beneficio, o la persona todavía no pasó por la puerta, no corresponde; si ya lo canjeó, amarillo; si no, verde y a la cola. Un pase que no está en la foto no se canjea sin red (no se sabe qué trae); con red, el escáner pide la foto fresca y vuelve a decidir.

La regla está en `decideVerdict`, en `src/lib/escaner-api.ts`, sin dependencias, para poder probarla sola.

## La cola y la sincronización

Cada entrada o canje va a IndexedDB (`src/lib/cola.ts`) con un `clientId` propio. Cuando hay red, cada cinco segundos la página manda de a cinco a `POST /api/scan/sync`. El servidor (`src/server/escaner.ts`) lleva cada uno al contrato con la cuenta de puerta (`check_in` o `redeem`, la comisión la paga la patrocinadora) y guarda el espejo en la base con el mismo `clientId`, así reintentar no duplica. Cada registro vuelve con su estado:

| Estado | Qué pasó | Qué hace la página |
|---|---|---|
| `synced` | Llegó al contrato | Lo da por hecho |
| `duplicate` | El contrato dijo que ya estaba hecho (otro puesto lo registró sin red) | Lo cuenta como "doble, revisar"; el panel lo ve en el espejo con `duplicate = 1` |
| `retry` | Sin red, o un canje antes de que llegue la entrada de otro puesto (`NotCheckedIn`) | Lo deja pendiente y espera 10 s, 20 s, 40 s, hasta 2 minutos |
| `rejected` | No va a entrar nunca: un pase desconocido, sin activar, un beneficio que la entrada no trae, un registro que no es de este puesto o un `clientId` que ya es de otro registro | Lo cuenta como "sin registrar, revisar" |

Una transacción que se mandó y cuya confirmación no llegó a tiempo (o cuya respuesta se cortó) no se pierde ni se vuelve un doble falso: el hash queda en el espejo apenas se manda (`tx_hash` y `tx_sent_at`, sin `synced`), y el próximo intento del mismo registro le pregunta a la red cómo terminó antes de mandar otra. Si entró, el registro queda `synced` con ese hash; si todavía puede entrar (la transacción vale 60 segundos), espera; si no entró y ya venció, manda otra. Y si el contrato contesta que ya estaba hecho, primero se mira si lo hecho era la transacción anterior de ese mismo registro: solo si no lo era, es un doble.

Si no hay nada pendiente, cada minuto pide igual la foto fresca, para enterarse de lo que registraron los otros puestos. El interruptor "Simular sin conexión" frena todo eso sin tocar la red: sirve para probar.

## El código del puesto

Los emite el panel de quien organiza (`src/server/panel.ts`, tabla `station_codes`): uno para la puerta y uno por cada beneficio, de doce letras y números (sesenta bits), que se muestran como `ABCD-EFGH-JKLM` y se aceptan en minúsculas y sin guiones. El código dice a qué evento y a qué puesto abre, así que el servidor solo acepta de un código de puerta entradas, y de un código de mesa canjes de su beneficio. Los códigos de ocho letras de antes se borraron (migración `005-codigos-largos.sql`) y el panel crea los nuevos al abrirse.

Contra quien prueba códigos a la fuerza (`src/server/limites.ts`): los equivocados se cuentan por la IP que pone la plataforma (en Vercel `x-real-ip`; detrás de otro proxy, el encabezado de `RUMBO_TRUSTED_IP_HEADER`), nunca por lo que diga `x-forwarded-for` en el pedido. Sin plataforma ni proxy configurado, todos los pedidos cuentan como uno solo. Ocho equivocados en diez minutos frenan esa IP diez minutos, y cada freno siguiente dura el doble, hasta un día. Cincuenta equivocados en total en diez minutos (alguien prueba desde muchas IP) encienden una alarma: mientras dura, cada IP que ya falló una vez queda frenada, y quien escribe bien su código sigue entrando. La respuesta frenada es un 429 con `Retry-After`.

## Sin red, de verdad

`public/sw.js` es el service worker, registrado solo desde `/scan` y con ese alcance. Va a la red primero y guarda lo que pasa (el HTML, los scripts, los estilos, las fuentes); sin red sirve lo guardado. Al cargar, la página le pasa la lista de todo lo que ya usó (la lista de recursos del navegador), para que la primera visita también quede guardada. Lo de `/api` no pasa por él: de eso se encarga la cola. `public/scan/manifest.webmanifest` hace la página instalable.

## Las rutas

| Ruta | Qué recibe | Qué devuelve |
|---|---|---|
| `POST /api/scan/open` | `{ code }` | La foto del evento (`ScanSnapshot`, con el puesto), o 401 si el código no es de ningún puesto |
| `POST /api/scan/sync` | `{ code, items: ScanItem[] }` (hasta 20) | `{ results: ScanItemResult[], snapshot }` |

Las formas están en `src/lib/escaner-api.ts`.

## Cómo se prueba

Con el servidor levantado y el evento de muestra creado (`pnpm seed`):

```bash
node scripts/prueba-escaner.mjs --base http://localhost:3000
```

Crea tres pases en la red de prueba (una inscripción gratis, una entrada con almuerzo y una persona que ya entró en el contrato sin pasar por la app), abre `/scan` en Chrome sin interfaz con el código de la puerta, escribe las credenciales a mano, corta la red (también la del service worker), vuelve a abrir la página sin red, la restablece, abre la mesa del almuerzo con su código y comprueba en la cadena con `status()` que la entrada y el canje quedaron, y en la base que el doble quedó marcado. Deja capturas de las tres pantallas en 1440x900, 973x700 y 390x844.

## Lo que falta

- Un voluntario con dos puestos cierra uno y abre el otro con su código: no hay cambio rápido.
- El informe de los dobles y los rechazados es del panel: acá quedan contados en la página y marcados en el espejo.
- La cámara necesita HTTPS (o localhost). En celular, con la página servida por Vercel, alcanza.
