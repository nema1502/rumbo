# El escáner del voluntario

La página `/scan`: el voluntario escribe el código de su puesto (la puerta, la mesa del almuerzo, el stand de la polera; quien organiza se lo manda desde el panel) y desde ahí lee credenciales con la cámara del celular. Cada lectura da uno de tres veredictos a pantalla entera: verde (entró, canjeado), amarillo (ya entró, ya canjeado, con la hora) y neutro (no corresponde, con el motivo). Funciona sin red una vez que el puesto se abrió con conexión, y se puede instalar en la pantalla de inicio.

## Cómo decide sin red

Al abrir el puesto, con red, el escáner baja la foto del evento (`POST /api/scan/open`): su puesto, la clave pública del evento (la privada no sale del servidor) y cada pase activo con el nombre, los beneficios que trae, si ya entró y qué ya canjeó. Con eso decide solo:

1. Verifica la firma del QR (Ed25519, con WebCrypto o, si el navegador no lo sabe, `@noble/ed25519`; `src/lib/qr-verify.ts`). Si no cierra, no corresponde: la credencial no es de este evento. El QR del celular rota cada 20 segundos: se acepta la ventana de tiempo actual, la anterior y la siguiente, con la hora corregida por la del servidor si este celular la tiene desfasada; uno más viejo (una captura de pantalla) da "este QR venció", con el nombre de quien es. La credencial impresa lleva un QR fijo, que se acepta pero se muestra con la etiqueta "Credencial impresa".
2. Mira el pase en la foto y en su propia cola (lo que este mismo escáner registró y todavía no subió).
3. En la puerta: si ya entró, amarillo; si no, verde y a la cola. Una credencial auténtica de un pase que no estaba en la foto entra igual: la firma (con el certificado del pase) prueba que es del evento y el servidor la revisa al sincronizar.
4. En una mesa de canje: si la entrada no incluye el beneficio, o la persona todavía no pasó por la puerta, no corresponde; si ya lo canjeó, amarillo; si no, verde y a la cola. Un pase que no está en la foto no se canjea sin red (no se sabe qué trae); con red, el escáner pide la foto fresca y vuelve a decidir.

La regla está en `decideVerdict`, en `src/lib/escaner-api.ts`, sin dependencias, para poder probarla sola.

## El respaldo manual de la puerta

Solo en el puesto Puerta (con el código de un puesto de mesa, el botón no aparece y el servidor contesta 403). El botón "Buscar o agregar a alguien" abre dos cosas, en `src/components/escaner/Manual.tsx`:

- **Buscar** por nombre o correo, con tres letras como mínimo (`POST /api/scan/buscar`): muestra hasta ocho personas con el correo tapado, y "Marcar la entrada" para quien todavía no entró (o "Entró a las 09:12" para quien sí). Marcar la entrada no pide red: entra a la misma cola que una lectura, sin QR y marcada como manual, y se ve en verde con la etiqueta "Marcada a mano". En el espejo queda como entrada manual (`via = 'manual'`, con el id de escáner `manual:puerta:<celular>` que pone el servidor), con su puesto y su hora. Sin red, el buscador sigue, pero solo por nombre y con la lista que ya bajó el celular.
- **Agregar en la puerta** (`POST /api/scan/agregar`): nombre y correo, e inscripción gratis en el momento, con la misma inscripción de siempre (la credencial le llega al correo), y la entrada queda marcada. Pide red y tarda unos segundos, porque crea la cuenta y la inscribe en el contrato. Quien ya estaba inscripto con ese correo vuelve igual, para marcarle la entrada.

Lo que hace el servidor está en `src/server/puerta.ts`.

## La cola y la sincronización

Cada entrada, canje o visita va a IndexedDB (`src/lib/cola.ts`) con un `clientId` propio, el código del puesto en que se registró, la hora de la lectura (el reloj del celular corregido con el del servidor) y el texto del QR que se leyó, para que el servidor vuelva a comprobar la firma antes de registrarla (sin la ventana de tiempo, que la cola puede subir tarde) y anote cómo se leyó: el QR del celular o el impreso. La entrada marcada a mano en la puerta es la única sin QR: viaja con `via: "manual"` y el servidor le pone el id de escáner `manual:puerta:<celular>`. Cuando hay red, cada cinco segundos la página manda de a cinco a `POST /api/scan/sync`, cada registro con el código de su puesto (`agruparParaSincronizar`): primero lo del puesto abierto, después lo que haya quedado de otros. Así, si el voluntario cierra la puerta con entradas pendientes y abre la mesa del almuerzo, esas entradas llegan con el código de la puerta y no se rechazan. Al cerrar un puesto con pendientes, la página intenta mandarlos antes; lo que quede se guarda en el celular y sale solo la próxima vez que haya un puesto abierto ahí. Si el código de ese otro puesto ya no existe, lo suyo queda como "sin registrar, revisar". El servidor (`src/server/escaner.ts`) lleva cada uno al contrato con la cuenta de puerta (`check_in` o `redeem`, la comisión la paga la patrocinadora) y guarda el espejo en la base con el mismo `clientId`, así reintentar no duplica. Cada registro vuelve con su estado:

| Estado | Qué pasó | Qué hace la página |
|---|---|---|
| `synced` | Llegó al contrato | Lo da por hecho |
| `duplicate` | El contrato dijo que ya estaba hecho (otro puesto lo registró sin red) | Lo cuenta como "doble, revisar"; el panel lo ve en el espejo con `duplicate = 1` |
| `retry` | Sin red, o un canje antes de que llegue la entrada de otro puesto (`NotCheckedIn`) | Lo deja pendiente y espera 10 s, 20 s, 40 s, hasta 2 minutos |
| `rejected` | No va a entrar nunca: una lectura sin su QR, con un QR que no cierra o que es de otro pase (la respuesta no distingue cuál), un pase desconocido o sin activar (tampoco distingue), un beneficio que la entrada no trae, un registro que no es de este puesto, una hora de lectura imposible, o un `clientId` que ya es de otro registro | Lo cuenta como "sin registrar, revisar" |

Una transacción que se mandó y cuya confirmación no llegó a tiempo (o cuya respuesta se cortó) no se pierde ni se vuelve un doble falso: el hash queda en el espejo apenas se manda (`tx_hash` y `tx_sent_at`, sin `synced`), y el próximo intento del mismo registro le pregunta a la red cómo terminó antes de mandar otra. Si entró, el registro queda `synced` con ese hash; si todavía puede entrar (la transacción vale 60 segundos), espera; si no entró y ya venció, manda otra. Y si el contrato contesta que ya estaba hecho, primero se mira si lo hecho era la transacción anterior de ese mismo registro: solo si no lo era, es un doble.

Si no hay nada pendiente, cada minuto pide igual la foto fresca, para enterarse de lo que registraron los otros puestos.

Todos los pedidos tienen tiempo límite (`src/lib/http.ts`), porque un wifi que el navegador cree conectado y no tiene salida (el del evento, un portal cautivo) deja un pedido colgado: la foto fresca que se pide en medio de una lectura espera cuatro segundos y, si no llega, el escáner decide con lo que sabe; abrir un puesto espera quince; una sincronización, dos minutos (un lote son varias transacciones). Si se corta, la cola sigue intacta y el próximo intento no duplica nada. Con `/scan?demo=1` aparece el interruptor "Simular sin conexión", que frena todo eso sin tocar la red: sirve para mostrar el escáner y para probarlo. Sin `demo=1` el voluntario no lo ve, así no lo activa sin querer y deja de sincronizar.

## El código del puesto

Los emite el panel de quien organiza (`src/server/panel.ts`, tabla `station_codes`): uno para la puerta y uno por cada beneficio, de doce letras y números (sesenta bits), que se muestran como `ABCD-EFGH-JKLM` y se aceptan en minúsculas y sin guiones. El código dice a qué evento y a qué puesto abre, así que el servidor solo acepta de un código de puerta entradas, y de un código de mesa canjes de su beneficio. Los códigos de ocho letras de antes se borraron (migración `005-codigos-largos.sql`) y el panel crea los nuevos al abrirse.

Contra quien prueba códigos a la fuerza (`src/server/limites.ts`): los equivocados se cuentan por la IP que pone la plataforma (en Vercel `x-real-ip`; detrás de otro proxy, el encabezado de `RUMBO_TRUSTED_IP_HEADER`), nunca por lo que diga `x-forwarded-for` en el pedido. Sin plataforma ni proxy configurado, todos los pedidos cuentan como uno solo. Ocho equivocados en diez minutos frenan esa IP diez minutos, y cada freno siguiente dura el doble, hasta un día. Cincuenta equivocados en total en diez minutos (alguien prueba desde muchas IP) encienden una alarma: mientras dura, cada IP que ya falló una vez queda frenada, y quien escribe bien su código sigue entrando. La respuesta frenada es un 429 con `Retry-After`.

Ese freno es solo para abrir el puesto. Al abrirlo, el escáner recibe con la foto una **ficha de sesión** (`session.token`, `src/server/sesion-escaner.ts`): la firma el servidor con una clave derivada de la raíz secreta del evento, dice el evento, el código, el id del celular y hasta cuándo vale (treinta y seis horas), y desde ahí sincronizar, buscar y agregar viajan con ella en vez del código, sin pasar por el freno. Así el wifi del evento, donde todos los celulares salen con la misma IP, no se frena entero porque un colega se equivocó ocho veces o un celular quedó con un código muerto. La ficha va atada al código: si quien organiza lo cambia, el servidor contesta 401 `wrong_code`; si venció, 401 `session_expired`; y ante cualquiera de los dos el escáner deja de reintentar solo, avisa ("este código ya no vale: volvé a abrir el puesto") y guarda lo pendiente en el celular, que sale la próxima vez que se abra ese puesto con su código. Una sesión guardada sin ficha (de una versión anterior) se descarta y se vuelve a pedir el código; la cola de una versión anterior, que viaja con el código, sigue entrando por el camino de antes, con el freno.

## Sin red, de verdad

`public/sw.js` es el service worker, registrado solo desde `/scan` y con ese alcance. Va a la red primero y guarda lo que pasa (el HTML, los scripts, los estilos, las fuentes); sin red sirve lo guardado. Al cargar, la página le pasa la lista de todo lo que ya usó (la lista de recursos del navegador), para que la primera visita también quede guardada. Lo de `/api` no pasa por él: de eso se encarga la cola. `public/scan/manifest.webmanifest` hace la página instalable.

## Las rutas

| Ruta | Qué recibe | Qué devuelve |
|---|---|---|
| `POST /api/scan/open` | `{ code, scannerId? }` (o `{ token }`, para la foto fresca) | La foto del evento (`ScanSnapshot`, con el puesto) y la ficha de sesión (`session.token`), o 401 si el código no es de ningún puesto |
| `POST /api/scan/sync` | `{ token, items: ScanItem[] }` (hasta 20; `code` en vez de `token`, con el freno) | `{ results: ScanItemResult[], snapshot }` |
| `POST /api/scan/buscar` | `{ token, query }`, solo con la sesión (o el código) de la Puerta | `{ matches: DoorMatch[] }` (hasta 8), o 403 |
| `POST /api/scan/agregar` | `{ token, name, email }`, solo con la sesión (o el código) de la Puerta | `{ kind: "added" \| "existing", match }`, o `{ kind: "error", error }` |

Las formas están en `src/lib/escaner-api.ts`.

## Cómo se prueba

Con el servidor levantado y el evento de muestra creado (`pnpm seed`):

```bash
node scripts/prueba-escaner.mjs --base http://localhost:3000
```

Crea cinco pases en la red de prueba (una inscripción gratis, una entrada con almuerzo, una persona que ya entró en el contrato sin pasar por la app, una que entra sin red y una que se marca a mano), abre `/scan` en Chrome sin interfaz con el código de la puerta, escribe a mano los QR (el del celular, armado en el momento con lo que recibe la credencial, y el de la credencial impresa, con su etiqueta; uno de hace un minuto, que da "venció"), corta la red (también la del service worker), vuelve a abrir la página sin red, la restablece, abre la mesa del almuerzo con su código y comprueba en la cadena con `status()` que la entrada y el canje quedaron, y en la base que el doble quedó marcado. Prueba también el respaldo de la puerta: el buscador (con tres letras, en mayúsculas, con el correo tapado, sin red), la entrada marcada a mano y la persona agregada en el momento, y que en la mesa del almuerzo el buscador no aparece. Deja capturas de las tres pantallas en 1440x900, 973x700 y 390x844.

## Lo que falta

- Un voluntario con dos puestos cierra uno y abre el otro con su código: no hay cambio rápido.
- El informe de los dobles y los rechazados es del panel: acá quedan contados en la página y marcados en el espejo.
- Una entrada marcada a mano por error no se deshace desde el escáner: el contrato no tiene cómo borrar una entrada. Queda en el espejo con su id `manual:puerta:<celular>` para que quien organiza la revise.
- La cámara necesita HTTPS (o localhost). En celular, con la página servida por Vercel, alcanza.
