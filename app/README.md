# La app de Rumbo

La página pública del evento, la inscripción gratis o la entrada paga, la credencial con QR, el escáner del voluntario y el panel de quien organiza con el informe para quien auspicia. Next.js 15 con TypeScript, CSS propio con la marca ([docs/marca.md](../docs/marca.md)) y la red de prueba de Stellar debajo, con el contrato [rumbo-pass](../contracts/rumbo-pass/README.md). La arquitectura está en [docs/stack.md](../docs/stack.md).

## Levantarla desde cero

Hace falta Node 24 o más nuevo (trae `node:sqlite`) y pnpm. Rust y `stellar-cli` solo hacen falta para compilar o desplegar el contrato; la app usa los contratos ya desplegados que describe [contracts/rumbo-pass/deploy/testnet.json](../contracts/rumbo-pass/deploy/testnet.json).

```bash
cd app
pnpm install
pnpm setup:dev     # las llaves del servidor en .env.local, fondeadas con friendbot; el USDC de prueba y su contrato; las líneas de confianza
pnpm seed          # el evento de muestra, "Hackatón de la comunidad", con sus entradas y beneficios
pnpm dev           # http://localhost:3000
```

Los dos scripts se pueden correr las veces que haga falta: solo hacen lo que falta. Después:

- **El evento:** `http://localhost:3000/e/hackaton-comunidad`. "Inscribirme" o "Comprar", nombre y correo, y la credencial tarda entre quince y cuarenta segundos (la red de prueba crea la cuenta, le da saldo y la inscribe en el contrato). El correo con el enlace personal queda en `data/correos/` (la consola dice a qué dominio fue y en qué carpeta está, nunca el enlace).
- **El panel:** `node scripts/panel-clave.mjs` imprime el enlace del panel con su clave (`/admin/hackaton-comunidad?k=...`) y los códigos de puesto para los voluntarios. El informe para quien auspicia está en `/admin/hackaton-comunidad/informe`.
- **El escáner:** `http://localhost:3000/scan`, con el código de un puesto. Con la cámara, o sin ella (una laptop, un celular por http): en la credencial, "Copiar el código" (debajo del QR) copia el texto del QR vigente, y en el escáner se pega en "Escribir el código".

`pnpm seed -- --demo` agrega además a una persona de ejemplo con su pase y su cuenta de prueba; `node scripts/panel-pases-prueba.mjs` llena el panel con doce personas de prueba, canjes y dobles (solo el espejo, sin tocar la red).

`pnpm seed -- --contratos-propios` despliega en la red de prueba dos contratos solo para el evento de muestra (con el WASM del despliegue, por el mismo camino que usa el kit al publicar) y apunta las entradas a ellos, en vez de a los compartidos de `deploy/testnet.json`. Conviene en toda base que no sea la de desarrollo (la de quien evalúa, la de producción): así el "Verificar el registro del evento" del panel no trae credenciales emitidas desde otras bases contra el mismo contrato. Se despliegan una sola vez; con `--refresh --contratos-propios` se renuevan. Sin la opción, el seed sigue usando los compartidos.

Si los contratos del despliegue no existen (la red de prueba se reinicia cada tanto, la próxima vez el 16 de diciembre de 2026), hay que volver a desplegarlos como dice [contracts/rumbo-pass/README.md](../contracts/rumbo-pass/README.md) y correr `pnpm seed -- --refresh` para que las entradas apunten a los nuevos.

En desarrollo conviene un solo servidor por carpeta: dos `next dev` sobre la misma `app/` se pisan la salida en `.next` y aparecen errores al azar.

## Qué es el modo de prueba

Todo corre contra la red de prueba de Stellar (testnet): si `STELLAR_NETWORK` dice otra cosa, el servidor no arranca ninguna operación. En la red de prueba la plata no es plata, pero el resto es real: el contrato garantiza que cada entrada y cada canje ocurren una sola vez, el pago llega a quien organiza en la misma transacción que separa la comisión, y quien auspicia ve los canjes.

Lo que hoy es distinto de producción, y la interfaz lo dice ("Modo de prueba: la cuenta la guarda el servidor; con Google o con tu correo, la cuenta es tuya"):

- **La cuenta de cada persona la crea y la guarda el servidor** (`DevAccountProvider`, tabla `dev_accounts` en la base local): la fondea con friendbot, le agrega la línea de confianza al USDC de prueba, le da un saldo inicial del emisor propio (`RUMBO_INITIAL_TEST_USDC`, cien por defecto) y firma por ella cuando el contrato se lo pide. Con Pollar prendido (abajo, "Entrar con Google") la cuenta es de la persona y el servidor no tiene su llave.
- **El USDC es de prueba:** lo emite una cuenta propia en la red de prueba y en pantalla se llama "USDC de prueba". No vale nada fuera de la demostración.
- **Las comisiones de red las paga el servidor** con una cuenta patrocinadora, así ninguna cuenta de persona necesita XLM. Eso sí se queda igual en producción: también con la cuenta propia (abajo, "Entrar con Google") la patrocinadora manda y paga cada transacción.
- **En desarrollo la base es un archivo SQLite** (`data/rumbo.db`); en producción es Postgres en Supabase (abajo, "En producción"). **Los correos se escriben a disco** (`data/correos/`) en vez de mandarse: Resend queda como interfaz con su esqueleto, por hacer.
- **El panel se abre con una clave por evento**, y además con la cuenta de organizador si Pollar está prendido (abajo, "La cuenta de organizador"). En el modo de prueba, sin Pollar, queda solo la clave.

Nada de `data/` ni de `.env.local` se versiona.

## Entrar con Google (Pollar)

Con `RUMBO_ACCOUNTS=pollar` y `NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY` (la clave publicable de la app "Rumbo" en [Pollar](https://pollar.xyz), red de prueba), quien se inscribe entra con Google o con su correo (un código de un solo uso), y su credencial queda en su propia cuenta de Stellar, que crea y custodia Pollar. El servidor nunca tiene esa llave. Sin las dos variables, todo sigue en el modo de prueba de arriba, que queda como respaldo y para las pruebas. El SDK es `@pollar/core` 0.11.5, en versión exacta.

**La política de firma de Pollar.** El firmante de Pollar firma por las cuentas que custodia solo lo que la política de la app permite (en su panel: Wallets, Auth Policy): una fila por contrato, con las funciones exactas, y hay que incluir cada contrato del árbol de la llamada. Sin la fila, rechaza la entrada de autorización (`SOROBAN_AUTH_NO_POLICY`) y la inscripción termina en "Tu cuenta no autorizó la inscripción": así falló la primera prueba real, el 4-nov-2026. Como cada evento tiene su propio contrato, al publicar uno el servidor le avisa a Pollar con una fila (`register` y `buy`) usando `POLLAR_SECRET_KEY` (`src/server/pollar-politica.ts`; `pnpm seed -- --contratos-propios` hace lo mismo). Si el aviso falla, publicar sigue y queda en el registro del servidor. El USDC de prueba (`transfer`, que `buy` llama adentro) y los dos contratos del evento de muestra se cargaron a mano ese día. La fila comodín (`*`) existe, pero no se usa: abriría la firma a cualquier contrato. Dos cosas de Pollar para el sprint de diciembre: la API v1 que usa el SDK 0.11 se retira el 30-nov-2026 (hay que pasar a `0.12`, donde además cada firma pide confirmación salvo que la política diga otra cosa), y la custodia de Pollar no se ofrece en mainnet (allá van billeteras cofirmadas o passkeys).

Cómo va una inscripción:

1. **Entrar.** El formulario muestra "Entrar con Google" y "Entrar con mi correo" (`src/components/evento/FormularioConCuenta.tsx`, con un solo `PollarClient` por pestaña en `usePollar.ts`). Google abre una pestaña nueva; al terminar, esa pestaña cae en la portada de la app y la inscripción sigue en la de antes, que ya dice "Entraste como ..." y trae el nombre y el correo escritos. Pollar crea la cuenta al entrar: mientras tanto la pantalla dice "Estamos creando tu cuenta de Stellar" y espera hasta un minuto y medio.
2. **Probar que la cuenta es suya.** El servidor da un desafío de un solo uso que vence a los cinco minutos (`POST /api/cuenta/desafio`, o la acción del formulario); el navegador lo firma con `client.stellar.sep53.signMessage` y el servidor verifica la firma ed25519 sobre `SHA-256("Stellar Signed Message:\n" + mensaje)` con esa clave pública (`src/server/cuenta-propia.ts`). Recién ahí la persona queda ligada a la cuenta, con el proveedor `pollar` (tabla `wallet_links`). Una cuenta es de una sola persona y una persona tiene una sola cuenta propia: el contrato da un pase por cuenta.
3. **La cuenta en la red.** Si Pollar todavía no la creó, la crea la patrocinadora con 2 XLM (`walletChain.ensureAccount`). Para la entrada paga, la cuenta tiene que aceptar el USDC de prueba: el servidor contesta `needs_trustline` y el navegador lo pide con `client.setTrustline`; en la red de prueba el servidor le da después el saldo de prueba (`RUMBO_INITIAL_TEST_USDC`), como en el modo de prueba.
4. **Autorizar sin pagar comisión.** El servidor simula `register` o `buy` con la patrocinadora como fuente y devuelve la autorización de la persona sin firmar (con las credenciales de antes de CAP-71, las que entiende cualquier billetera), y la guarda como pedido de un solo uso (`wallet_auth_requests`). El navegador la firma con `client.signAuthEntry(entry, { validUntilLedger })` (unos cinco minutos) y la devuelve (`POST /api/evento/<slug>/inscripcion/firma`, o la acción del formulario). El servidor revisa que sea la misma que dio a firmar, de esa cuenta y con una firma que valga, y la manda con el envío de siempre, que ya trata `DUPLICATE` y `TRY_AGAIN_LATER`. Nada personal va a la cadena: el contrato, la función, la cuenta y un nonce.
5. **El final** es el de siempre: el pase activo con la cuenta de la persona, sus beneficios, su clave y el correo con el enlace.

La API sigue igual para el modo de prueba. Con la cuenta propia, `POST /api/evento/<slug>/inscripcion` lleva además `wallet: { provider: "pollar", publicKey, challengeId, signature }` y contesta 202 con `needs_signature` (`requestId`, `authEntry`, `validUntilLedger`, `fn`) o `needs_trustline` (`asset`). Con Pollar prendido, sin `wallet` contesta 401 `wallet_required`. Quien inscribe a otras personas (un equipo, la puerta, una lista importada) no puede firmar por ellas: esas siguen, solo en la red de prueba, con la cuenta de prueba que guarda el servidor. `POLLAR_APP_ID` y `POLLAR_SECRET_KEY` se quedan en el servidor y esta inscripción no los usa.

### La cuenta de organizador

Con Pollar prendido, quien organiza entra en `/admin` con la misma cuenta: "Entrar con Google" o "Entrar con mi correo" (`src/components/panel/EntrarOrganizador.tsx`, que comparte con la inscripción el ingreso de `src/components/evento/IngresoPollar.tsx`) y después "Entrar al panel": el navegador firma el mismo desafío SEP-53 de la inscripción y `POST /api/organizador/entrar` lo verifica (`src/server/organizador.ts`). Con eso:

- **Lo que se guarda, y lo que no.** La tabla `organizers` (migración `018-organizadores.sql`, en los dos dialectos) tiene la clave pública de la cuenta, quién la custodia (`pollar`) y un nombre; **ningún correo**. El nombre lo manda el navegador (el que dio Pollar), así que el servidor lo limpia (`cleanOrganizerName`): sin caracteres de control ni NUL, recortado a ochenta caracteres, y vacío si parece un correo. La sesión dura treinta días en la cookie `rumbo.organizador` (httpOnly, sameSite lax, secure por https) y en la base queda solo su huella (`organizer_sessions.id` es el SHA-256 de la ficha): quien lea la base no tiene con qué entrar. `last_seen_at` se escribe como mucho una vez por hora. "Cerrar sesión" (`POST /api/organizador/salir`) borra la sesión y la cookie de este navegador. Entrar y salir solo aceptan pedidos de la propia app (`fromOwnSite` en `src/server/pedido.ts`: el Origin tiene que ser el del pedido o el de `NEXT_PUBLIC_BASE_URL`; sin Origin, solo si `Sec-Fetch-Site` es `same-origin` o no viene) y contestan 403 a los demás: SameSite frena que otro sitio mande las cookies de Rumbo, no que el navegador guarde la sesión que trae la respuesta a un formulario ajeno.
- **Mis eventos.** `/admin` con sesión lista los eventos de esa cuenta (`events.organizer_id`), borrador o publicado, con el enlace a su panel o a seguir armándolo (secundario), y una sola acción principal: "Crear evento". Los eventos de muestra y los que crea el servidor MCP no tienen dueño y siguen con su clave.
- **Crear sin la clave de la casa.** En `/admin/nuevo` con sesión el campo de la clave no aparece y el evento queda a nombre de la cuenta, con dos topes en veinticuatro horas: `RUMBO_EVENTS_PER_DAY` por cuenta (tres) y `RUMBO_EVENTS_PER_IP_PER_DAY` por IP (diez, `eventCreateAttempts`; una IPv6 cuenta por su /64), porque una cuenta es cualquier llave que firme el desafío y se abren de a muchas: el de la cuenta frena a una cuenta, no a una persona. Y un techo para todo Rumbo, `RUMBO_EVENTS_GLOBAL_PER_DAY` (cien), que no se esquiva abriendo cuentas ni cambiando de conexión: en la red de prueba cada evento publicado despliega contratos. Contar y crear van dentro del turno `crear-evento:<cuenta>` (`src/server/compartido.ts`), así una ráfaga de pedidos a la vez no pasa el tope, y un doble clic contesta "ya estamos creando" en vez de crear dos. Con el tope alcanzado, `/admin/nuevo` no muestra el formulario: dice cuándo se libera y vuelve a Mis eventos. Si dos creaciones a la vez eligen el mismo slug, la segunda prueba con un sufijo al azar (`createEventIfSlugFree`, con `ON CONFLICT DO NOTHING`). Sin sesión y con Pollar, `/admin/nuevo` ofrece primero entrar como organizador; la clave de la casa queda como camino secundario, y el panel con la clave del evento. El MCP no cambia: la clave de la casa y la de organizador por HTTP.
- **El panel entra solo si el evento es tuyo.** `panelAccess` (páginas) y `authorizePanelRequest` (rutas) en `src/server/panel-sesion.ts` aceptan la clave del evento, como siempre, o la sesión de la cuenta que lo creó (`canManageEvent`). La clave por evento sigue existiendo para quien coorganiza y para el MCP: quien entró con la cuenta la pide en "Compartir el panel" (en el panel y al armar; `POST /api/admin/<evento>/compartir`, que la arma recién ahí) y copia el enlace, que abre ese panel sin cuenta. Con Pollar, la puerta del panel tiene como acción principal "Entrar como organizador" (`/admin?volver=/admin/<evento>`, que después de entrar vuelve ahí, solo a una ruta propia que empiece con `/admin/`: `safeReturnPath`) y la clave plegada como camino secundario; la sesión vencida lleva al mismo lugar. Con la sesión, el panel y el borrador muestran "Mis eventos" arriba, y el panel "Cerrar sesión" en vez de "Salir del panel".
- **Frenos.** Diez entradas fallidas por IP en diez minutos frenan esa IP (`organizerLoginAttempts`), y veinte entradas por IP por hora, aunque salgan bien (`organizerSessionAttempts`): cada llave nueva sería una cuenta nueva con su propio tope. Cada intento gasta además un desafío de un solo uso. Con Pollar apagado, `POST /api/organizador/entrar` contesta 503 `pollar_off` y `/admin` es la lista de paneles, que se abren con la clave de cada evento.

Las pruebas están en `tests/organizador.test.mjs` (sin red, en los tres motores): entrar por la ruta con una llave local que firma el desafío, la cookie que abre Mis eventos, crear sin la clave de la casa, el panel propio y la pantalla en vivo con la sesión y el ajeno con 401, la sesión vencida, el tope por día, el tope en una ráfaga, dos eventos con el mismo nombre a la vez, el tope por IP, el freno a las entradas, el nombre limpio, compartir el panel, a dónde vuelve `/admin`, entrar y salir desde otro sitio (403), salir, el desafío usado dos veces y Pollar apagado. Las capturas salen con `node scripts/capturas-organizador.mjs` (abajo, "Probarlo"). Lo que no se puede probar sin una persona: entrar con una cuenta de Google real.

Lo probado de la inscripción: el lado del servidor de punta a punta contra la red de prueba en `pnpm e2e`, con una llave local que hace de billetera de Pollar (firma el desafío y la autorización), y en `tests/cuenta-propia.test.mjs` sin red: el desafío, la verificación de la firma, que un desafío no sirva dos veces, que una firma de otra cuenta no valga y que una autorización cambiada o de otra llave no se mande. Lo que no se puede probar sin una persona: entrar con una cuenta de Google real, y que el firmante de Pollar acepte la autorización del contrato del evento.

### Probar Google a mano

1. En `app/.env.local`, `RUMBO_ACCOUNTS=pollar` (la clave publicable ya está). La base, la de siempre: SQLite.
2. `pnpm seed -- --refresh`, para que el evento de muestra apunte a los contratos del despliegue actual (tienen cupo de mil; si algún día se llenan con las corridas de prueba, `pnpm seed -- --contratos-nuevos` le despliega un contrato gratis y uno pago nuevos, en medio minuto).
3. `pnpm dev`, y abrir `http://localhost:3000/e/hackaton-comunidad` (con `localhost`, que es el dominio que tiene permitido la app de Pollar; `127.0.0.1:3000` también está permitido).
4. "Inscribirme" en la entrada gratis, y "Entrar con Google". Se abre una pestaña con Google: elegir la cuenta. Esa pestaña termina en la portada de la app y se puede cerrar. En la pestaña de la inscripción tiene que decir "Entraste como <tu correo>", con tu nombre y tu correo escritos. Si dice "Estamos creando tu cuenta de Stellar", esperar unos segundos.
5. "Confirmar inscripción". La pantalla dice cada paso: "Confirmando que la cuenta es tuya", "Preparando tu inscripción", "Autorizando con tu cuenta" y "Anotándote en el evento", y lleva a la confirmación con la credencial. El correo con el enlace queda en `data/correos/`.
6. La credencial quedó en la cuenta de Pollar: `node -e "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync('data/rumbo.db').prepare('SELECT w.public_key, w.provider, p.account, p.tx_hash FROM wallet_links w JOIN passes p ON p.person_id = w.person_id').all())"` muestra la cuenta ligada (la misma que el panel de Pollar le da a ese usuario), la del pase y la transacción, que se puede abrir en `https://stellar.expert/explorer/testnet/tx/<tx_hash>`.
7. La entrada paga: volver al evento y "Comprar" en "Con almuerzo", y "Pagar 10 USDC de prueba". Antes de autorizar aparece "Habilitando el USDC de prueba en tu cuenta" (Pollar agrega la línea de confianza); después el servidor le da el saldo de prueba y sigue igual que la gratis.
8. Con el correo: "Salir", "Inscribirme" otra vez con otro correo que no tenga Google, "Entrar con mi correo", el código que llega y "Entrar".
9. Recargar la página después de entrar: la sesión sigue, pero el nombre y el correo no vuelven escritos (Pollar los tiene solo en memoria).

Si algo falla, la consola del navegador dice `[pollar] ...` con lo que contestó Pollar, y la del servidor `[inscripcion] <motivo>: <detalle>`. Si dice "Tu cuenta no autorizó la inscripción", el firmante de Pollar rechazó la autorización: Pollar firma por las cuentas que custodia solo lo que permite la política de la app (contratos y funciones) y con un vencimiento acotado. Cada evento tiene su propio contrato, con `register` (gratis) o `buy` (paga, que adentro llama a `transfer` del contrato del USDC de prueba, `CAIOVRPPUFGPHOHBIEFCUJEW6773TH7NXRYSLYSHPJYC33LR4T2JHRGZ`).

## El recorrido

| Pantalla | Qué hace |
|---|---|
| `/` | La lista de eventos |
| `/e/<evento>` | El afiche y las entradas, cada una con su único botón |
| `/e/<evento>/inscripcion?entrada=<id>` | Nombre y correo, y una sola acción: "Confirmar inscripción" o "Pagar 10 USDC de prueba" |
| `/e/<evento>/listo?pase=<id>&k=<clave>` | "Inscripción lista" o "Entrada paga", y el enlace a la credencial |
| `/p/<pase>?k=<clave>` | La credencial: el QR que se renueva solo cada 20 segundos (también sin conexión), el nombre, "Credencial N de M", el estado y lo que le toca a la persona. "Descargar en SVG" baja la versión para imprimir, con un QR fijo marcado como impresa |
| `/scan` | El escáner del voluntario: el código del puesto, la cámara, los tres veredictos, la cola local. Instalable, funciona sin red. En la puerta, además, el respaldo manual: buscar a alguien por nombre o correo, marcarle la entrada o agregarlo |
| `/admin` | Entrar como organizador (con Google o con el correo, por Pollar) y Mis eventos: cada uno con su panel o su borrador, y "Crear evento". Con `?volver=/admin/<evento>`, después de entrar vuelve ahí. Con Pollar apagado, la lista de paneles, que se abren con la clave de cada evento |
| `/admin/<evento>` | El panel de quien organiza: contadores en vivo, canjes por franja, códigos de puesto, pases, dobles, CSV y el contraste con la cadena. Entra con la clave del evento o con la sesión de la cuenta que lo creó |
| `/admin/nuevo` | Armar un evento desde una plantilla: elegirla, contar lo básico, y queda el borrador |
| `/admin/<evento>/armar` | El borrador: credenciales, canjes, puestos y topes; "Publicar el evento" |
| `/admin/<evento>/importar` | Importar la lista de Luma o de Bevy; cada persona recibe su enlace (por correo cuando el servicio exista; mientras tanto, se baja en CSV) |
| `/e/<evento>/equipo` | La inscripción por equipos de la hackatón |
| `/admin/<evento>/informe` | El informe para quien auspicia: números, nunca personas, con hoja de impresión |
| `/admin/<evento>/stands` | Stands y ruta: un stand por auspiciante con su código, la meta de la ruta y los números de cada uno |
| `/stand/<código>` | El panel de quien atiende un stand: sus visitas y los contactos de quienes aceptaron compartirlos, con calificación, nota y CSV |
| `/vivo/<evento>` | La pantalla en vivo para proyectar: quienes entraron, almuerzos y merch entregados, el ranking de la ruta y el espacio del sorteo. Quien organiza la abre con su clave y copia el enlace para el proyector (`?pantalla=`), que muestra la pantalla y nada más |
| `/v/<pase>?c=<código>` | La verificación pública de un certificado de asistencia: si esa persona entró, cuándo, y el enlace a su entrada en el registro público |

Al terminar el evento, `pnpm informe`, `pnpm certificados` y `pnpm paquete-embajadores` arman en PDF el informe del evento (para quien organiza, quien auspicia y el programa de embajadores de Stellar), un certificado verificable por persona que entró y el paquete para el capítulo. Todo eso, con sus plantillas de XeLaTeX y sus ejemplos, está en [informes/](informes/README.md).

Cada parte tiene su guía: [la inscripción y la credencial](src/server/evento/README.md), [el escáner](src/app/scan/README.md), [el panel](src/app/admin/README.md) y [los stands y la ruta](src/app/stand/README.md). La API:

| Ruta | Qué hace |
|---|---|
| `GET /api/evento/<evento>` | Lo público del evento, sus entradas y su catálogo de beneficios |
| `POST /api/evento/<evento>/inscripcion` | Inscribe o cobra, igual que el formulario |
| `GET /api/pase/<pase>?k=<clave>` y `/svg` | La credencial como datos, y para imprimir |
| `POST /api/scan/open` y `/api/scan/sync` | El escáner: abrir el puesto con su código (recibe la foto del evento y una ficha de sesión de treinta y seis horas, atada al código), y subir la cola con esa ficha. Los códigos vencen un día después del evento |
| `POST /api/scan/buscar` y `/api/scan/agregar` | El respaldo de la puerta (solo con la sesión del puesto Puerta): buscar por nombre o por el correo entero, e inscribir gratis a quien llegó sin credencial |
| `GET /api/hora` | La hora del servidor, para que una credencial con el reloj desfasado arme el QR de la ventana que corresponde |
| `GET /api/admin/<evento>` y `/csv`, `POST .../cadena`, `.../entrar`, `.../salir`, `.../puestos` | El panel: el estado en JSON, la lista en CSV, el contraste con la cadena, la sesión y un código de puesto nuevo en lugar de uno que se filtró |
| `GET` y `POST /api/admin/<evento>/stands` | Stands y ruta: leer, y agregar, cambiar o sacar un stand, cambiarle el código, fijar la meta y sacar a alguien de la pantalla en vivo |
| `GET` y `POST /api/pase/<pase>/ruta?k=<clave>` | La ruta de una credencial, y la respuesta de la persona a la pregunta de permiso o cómo quiere aparecer en la pantalla |
| `GET /api/stand/<código>`, `POST .../contacto`, `GET .../csv` | El panel del stand en JSON, la calificación y la nota de un contacto, y el CSV |
| `GET` y `POST /api/vivo/<evento>`, `GET` y `POST .../sorteo` | La pantalla en vivo en JSON (con la clave del panel o con el enlace del proyector, `?pantalla=`; `POST` cambia ese enlace), y la lista del sorteo (JSON con huella y algoritmo, o `?formato=csv`; `POST` la congela o vuelve a la viva) |
| `POST /api/admin/<evento>/importar` y `GET .../asistencia` | Importar una lista (vista, importar y tandas de correos) y bajar la asistencia en la forma de Bevy |
| `POST /api/organizador/entrar` y `/salir` | La cuenta de organizador: entrar con la prueba de la cuenta propia (abre la sesión en la cookie) y cerrar la sesión. Solo desde la propia app: de otro sitio, 403 |
| `POST /api/admin/<evento>/compartir` | El enlace con la clave del evento, para quien coorganiza (la arma si no existía). Pide lo mismo que el panel, y solo desde la propia app |
| `POST /api/mcp` | El servidor MCP por HTTP, con las mismas herramientas para el asistente (abajo, "El servidor MCP") |

## El kit listo

Una comunidad arma su evento en dos minutos con una plantilla y trae su lista desde donde ya inscribe (Luma, Bevy). Todo está en `src/server/kit/` y `src/components/kit/`; los textos, en `src/i18n/kit.ts`; las tablas nuevas, en `src/server/migrations/007-kit.sql`. Los eventos son gratis por defecto: lo pago (la entrada con polera, el kit del taller) es opcional y viene apagado.

### Plantillas

`/admin/nuevo` elige entre seis plantillas y pide lo básico (nombre, día y hora, ciudad, quién organiza, cuántos lugares). Crea un **borrador**: el evento, sus tipos de credencial, sus canjes y lo que trae cada tipo. El borrador no se ve en la página pública hasta que se publica.

| Plantilla | Dura | Lugares | Qué trae |
|---|---|---|---|
| DevFest | 1 día | 300 | Almuerzo, refrigerio, café del auspiciante; cena para oradores, mentoría y organización; polera para oradores |
| Build with AI | 1 día | 150 | Almuerzo, refrigerio, café del auspiciante; cena para mentoría y organización |
| Día de la Mujer (IWD) | 1 día | 120 | Almuerzo, refrigerio, café del auspiciante; cena para oradoras, mentoras y organización |
| Hackatón | 2 días | 200 | Desayuno, almuerzo, refrigerio y cena del día 1 y del día 2, cada franja un canje distinto; mentoría y jurado; **inscripción por equipos** |
| Meetup | 3 horas | 60 | Refrigerio y café del auspiciante |
| Taller | 4 horas | 40 | Refrigerio; kit del taller opcional |

Todas traen además el premio del sorteo (no viene con la credencial: lo ganan quienes salen en el sorteo) y los puestos del escáner, que salen de los canjes: la puerta y una mesa por canje (almuerzo, refrigerio, merch, premios...). La entrada paga ("con polera", "con kit") existe en todas, apagada, a 10 USDC de prueba.

`/admin/<evento>/armar` es el borrador: cada tipo de credencial se enciende o se apaga, se renombra y se le tilda lo que trae; cada canje tiene su nombre, su puesto y cuántos hay (el tope). "Publicar el evento" guarda y prepara el contrato de cada entrada (`src/server/kit/publicar.ts`); el evento recién entonces recibe inscripciones. Crear eventos lo controla `RUMBO_CREATE_KEY` (la "clave de la casa"): vacía, está abierto en desarrollo y cerrado en producción. Con la cuenta de organizador (arriba, "La cuenta de organizador") no hace falta la clave: el tope es `RUMBO_EVENTS_PER_DAY` por cuenta y por día.

### Credenciales por tipo

Cada tipo de entrada es un tipo de credencial: asistente, oradora u orador, mentora o mentor, jurado, voluntaria o voluntario, organización y auspiciante (`src/lib/credential-kinds.ts`). Cada tipo trae sus propios canjes: el jurado y la mentoría tienen cena, quien es voluntario tiene su polera de staff. La credencial en pantalla y la que se imprime llevan el tipo en grande (la banda de arriba cambia de color si no es asistente) y el equipo si lo hay; el escáner lo muestra en cada veredicto. **Solo el asistente se inscribe desde la página pública**: las demás se entregan por invitación, importando la lista.

### Importar desde Luma y desde Bevy

`/admin/<evento>/importar` (el evento tiene que estar publicado): se sube el CSV, se revisa lo que se leyó (con las tres primeras filas tal como se leyeron, para que se note un archivo con las tildes rotas), se eligen los estados que entran (por defecto, aprobadas o confirmadas) y qué credencial recibe cada tipo de entrada de la lista, y se importa. Cada persona recibe su enlace (por correo cuando el servicio exista; mientras tanto, se baja en CSV), **de a tandas de cinco** (la pantalla las pide una tras otra con su barra de avance). Al final: "Importadas 142, salteadas 6 duplicadas, 3 con correo inválido".

- **Si se corta, se retoma.** La pantalla recuerda la importación en curso en ese navegador y, al volver, ofrece seguirla. Y si se perdió (otra computadora, otro navegador), volver a subir el mismo archivo retoma lo que quedó pendiente: la vista previa lo dice ("quedaron pendientes de una importación anterior") y esas credenciales pasan a la importación nueva, sin crear ninguna de más.
- **Sin servicio de correo, los enlaces se bajan.** Mientras el servidor no tenga con qué mandar correos (hoy, en producción: Resend está por hacer), la importación prepara igual cada credencial y cuenta aparte "con enlace, sin correo"; "Descargar enlaces (CSV)" baja nombre, correo y enlace personal para mandarlos a mano. Nunca se anuncia un correo que no salió.
- Una persona no se duplica: el mismo correo dos veces en el archivo entra una vez (sin importar mayúsculas, espacios, caracteres invisibles ni, en Gmail, los puntos o lo que sigue a un "+"), y quien ya tiene credencial en el evento no se toca (ni su entrada, ni sus canjes, ni su tipo): **volver a importar no pisa los check-ins ya hechos**. A quien ya existía como persona no se le cambia el nombre, y una credencial importada como oradora o jurado no pasa a asistente si esa persona después se inscribe por la página: queda inscripta en el contrato de su propia entrada, con sus beneficios (y si la suya es una entrada paga y eligió la gratis, se le pide que elija la suya).
- El lector se planta ante un archivo roto o armado para hacerlo trabajar de más: más de 1000 letras en una celda, más de 100 columnas o más de 5000 filas se rechazan con un aviso claro (partir el archivo), las líneas vacías no cuentan como filas y una coma final en cada fila no corre las columnas.
- La cuenta de Stellar se crea igual que en la inscripción; a la cadena no va ningún dato personal.
- Lo que la lista trae de más se ignora. Se importa solo a los tipos de entrada gratis.

Las columnas se buscan por nombre, sin importar mayúsculas, tildes ni si se separa con espacio o con guion bajo. Lo que lee de cada plataforma:

| Qué | Luma | Bevy |
|---|---|---|
| Nombre | `name`, o `first_name` y `last_name` | `First Name` y `Last Name` (o `Name`) |
| Correo | `email` | `Email` |
| Estado | `approval_status`: `approved` entra; `pending_approval` e `invited` son pendientes; `declined` rechazada | `Attendee Status` o `Registration Status`: `Registered`, `Checked In` y `Attended` entran; `Waitlisted` es lista de espera; `Cancelled` cancelada |
| Tipo de entrada | `ticket_name` | `Ticket Type` |
| Dieta (opcional) | una pregunta de la inscripción con "dieta", "alimentaria" o "alergia" en el título | igual (`diet`, `dietary`, `allergy`) |

El resto (teléfono, fechas, URL del QR, pagos, cupón, UTM, respuestas, empresa, cargo, capítulo) se ignora. La lista se reconoce como de Luma por `api_id`, `guest_id`, `qr_code_url` o `approval_status` con `checked_in_at`, y como de Bevy por `Chapter`, `Event ID`, `Event Name`, `Attendee ID`, `Registration Date` o el estado del asistente; cualquier otro archivo con una columna de correos (en castellano también: `nombre`, `correo`, `estado`) se importa igual. Una entrada que se llama como un tipo de credencial (`Speaker`, `Mentor`, `Jurado`, `Volunteer`, `Sponsor`, `Orador`...) va sugerida a ese tipo, y quien organiza lo puede cambiar antes de importar.

El lector (`src/server/kit/csv.ts`) viene del de Tinkazo (MIT): comillas, nombres con coma, punto y coma de Excel en español, BOM, UTF-16 y Windows-1252, filas más cortas o más largas que el encabezado. Sus pruebas, pasadas a `node --test`, están en `tests/kit-csv.test.mjs`. **Sin verificar con un export real:** los nombres de las columnas de Luma salen de su ayuda y del lector de Tinkazo, que ya leyó exports reales; los de Bevy son una inferencia, porque su documentación pública no los lista. Si una columna no se reconoce, la lista se importa igual mientras tenga correos.

Los CSV de ejemplo, inventados, están en `tests/fixtures/` como `luma-invitados.csv.txt` y `bevy-asistentes.csv.txt`: terminan en `.txt` porque el auditor de subida frena cualquier `.csv` (puede traer personas reales).

### Comidas por franja, topes, dieta y asistencia

- **Comidas por franja.** En un evento de varios días cada comida es un canje distinto (`Desayuno, día 1`, `Almuerzo, día 1`...). El panel muestra, en "Canjes por franja", cuántas personas canjearon cada uno, para pedir la comida justa.
- **Tope por canje.** Cada canje puede tener un total (150 poleras). El panel dice cuántas quedan y avisa cuando se acaban; el escáner de esa mesa baja el total que sabe el servidor, descuenta lo que ese escáner ya entregó sin conexión y, cuando no queda ninguna, responde "no corresponde" y no anota nada. El tope no se puede hacer cumplir desde el servidor (dos mesas sin red deciden cada una por su cuenta, y la polera ya se entregó), pero sí se detecta: el canje que se pasa queda registrado con el aviso `stock_exceeded`, el escáner lo muestra ("avisale a quien organiza") y el panel dice "pasadas por N" en vez de recortar a cero.
- **Dieta.** La inscripción (y una pregunta de la lista importada) puede traer una restricción de dieta, opcional. Se guarda en la credencial y solo viaja a los escáneres de los puestos de comida (el almuerzo, y lo que la plantilla marcó como desayuno, refrigerio o cena: `isFoodBenefit` en `src/server/kit/plantillas.ts`), donde sale en grande. La mesa del café del auspiciante o de una taza no la recibe.
- **Asistencia.** `GET /api/admin/<evento>/asistencia` baja un CSV con la forma de una lista de Bevy (`First Name`, `Last Name`, `Email`, `Ticket Type`) y la columna `Attended` (`Yes` o `No`) que piden las ligas de hackatones, más `Checked In At`, `Credential Type` y `Team`. Los GDG pueden devolverla a su plataforma.
- **Equipos.** La hackatón se inscribe en `/e/<evento>/equipo`: nombre del equipo y hasta cinco integrantes; cada uno recibe su propia credencial (el enlace por correo, cuando el servicio exista). El equipo se ve en la credencial, en el panel y en el escáner. Un equipo que ya existe se puede volver a mandar (para reintentar si la red falló para alguien, o para sumar gente), pero el pedido tiene que traer a todos los que ya están: quien conozca el correo de un solo integrante no mete gente en un equipo ajeno, y el equipo nunca pasa de cinco contando a quienes ya están.

Lo que el kit **no** hace todavía: cambiar el tope de un canje o los precios después de publicar, importar a una entrada de pago, ni leer un `.xlsx` (hay que exportar CSV). `networkProvisioner`, el que despliega el contrato de cada entrada, ya corre contra la red de prueba: `pnpm e2e -- --contratos nuevos` despliega con él los dos contratos de la corrida, y `pnpm seed -- --contratos-nuevos` los del evento de muestra; publicar un evento desde el panel con él todavía no se probó de punta a punta.

## El servidor MCP

El asistente que ya usás puede operar tu evento con las mismas funciones que usan las pantallas: armarlo desde una plantilla contándolo en palabras, cargar la lista de Luma o de Bevy y leer los números, el informe para quien auspicia y la lista del sorteo (reenviar los enlaces de las credenciales, cuando el servicio de correo exista). Es gratis para tus propios eventos, igual que la API; el pago por uso queda para las plataformas y agentes que crean eventos a volumen. Todo vive en `src/server/mcp/`: `herramientas.ts` hace cada cosa con el código del servidor (nunca una copia) y `servidor.ts` las registra con su esquema y su descripción, en inglés, que es lo que lee el modelo. Las pruebas están en `tests/mcp.test.mjs`.

Hay dos maneras de conectarlo, y las dos llegan al mismo servidor:

- **Por HTTP**, contra tu Rumbo (`pnpm dev`, o el desplegado): `POST /api/mcp`, Streamable HTTP sin sesiones (cada pedido se contesta en JSON, así en Vercel da lo mismo en qué instancia caiga). La clave de organizador va en la cabecera `Authorization: Bearer <clave>`; la clave de la casa, si hace falta para crear eventos, en `X-Rumbo-Create-Key`. Sin cabeceras sirve igual para descubrir las herramientas y para lo público.
- **Por stdio**, en tu máquina: `pnpm mcp` (`scripts/mcp.mjs`) es un puente que el asistente levanta como proceso y que habla con `/api/mcp` del Rumbo que diga `RUMBO_BASE_URL` (`http://localhost:3000` si no se dice), con `RUMBO_ORGANIZER_KEY` y, si ese servidor la pide para crear eventos, `RUMBO_CREATE_KEY`. La clave viaja solo entre tu máquina y tu servidor, y las herramientas siguen en un solo lugar.

La configuración es la misma en el asistente de escritorio, en el de la terminal y en el del editor: una entrada en `mcpServers` del archivo de servidores MCP de cada uno (el archivo de configuración de la app de escritorio; `.mcp.json` en la carpeta del proyecto, o el comando `mcp add`, en la terminal; el `mcp.json` del editor):

```json
{
  "mcpServers": {
    "rumbo": {
      "command": "node",
      "args": ["C:/ruta/a/rumbo/app/scripts/mcp.mjs"],
      "env": {
        "RUMBO_BASE_URL": "http://localhost:3000",
        "RUMBO_ORGANIZER_KEY": "LA-CLAVE-DEL-PANEL-DE-TU-EVENTO"
      }
    }
  }
}
```

Los clientes que hablan HTTP directo (el de la terminal y el del editor, entre otros) pueden saltear el puente:

```json
{
  "mcpServers": {
    "rumbo": {
      "type": "http",
      "url": "https://<tu-rumbo>/api/mcp",
      "headers": { "Authorization": "Bearer LA-CLAVE-DEL-PANEL-DE-TU-EVENTO" }
    }
  }
}
```

Las herramientas, y qué clave pide cada una (la de organizador es la del enlace del panel, `?k=`; también se puede pasar en cada llamada como `organizer_key`):

| Herramienta | Qué hace | Clave |
|---|---|---|
| `list_templates` | Las seis plantillas con lo que trae cada una: credenciales, canjes, puestos, el premio del sorteo | Ninguna |
| `create_event_draft` | Crea el borrador desde una plantilla con lo básico (nombre, día y hora, ciudad y lugar, quién organiza, cupo) y devuelve el borrador, la clave de organizador del evento nuevo y el enlace para revisarlo en `/admin/<evento>/armar` | La de la casa (`RUMBO_CREATE_KEY`), como el formulario |
| `publish_event` | Publica el borrador: un contrato por tipo de credencial en la red de prueba, y la página pública abierta | La de organizador |
| `get_event` | Lo público del evento, sus entradas, canjes y puestos; con la clave, también un borrador, las credenciales por invitación y los contratos | Ninguna; la de organizador para un borrador |
| `import_guest_list` | Recibe el CSV como texto. Sin `confirm`, la vista previa: qué plataforma parece, qué columnas leyó, cuántas personas entran por estado y qué credencial recibe cada entrada. Con `confirm: true`, crea las credenciales y prepara la primera tanda (cuenta, contrato y correo, de a cinco) | La de organizador |
| `continue_import` | La siguiente tanda de una importación, hasta que `remaining` sea 0 | La de organizador |
| `resend_links` | Reenvía el enlace a quienes todavía no entraron, de a veinte, con el freno que ya existe: uno cada diez minutos por persona. Sale cuando el servicio de correo exista; en producción hoy no manda nada | La de organizador |
| `event_status` | Los números del panel: credenciales, quiénes entraron (cuántos), canjes por beneficio y por franja con su stock, dobles por código, los códigos de puesto y el último contraste con la cadena | La de organizador |
| `sponsor_report` | El informe para quien auspicia, del evento o de un stand: solo números | La de organizador |
| `draw_list` | La lista del sorteo: los códigos de quienes entraron, ordenados, con su huella SHA-256, igual que la pantalla en vivo | La de organizador |
| `chapter_package_summary` | El sí o el no de cada requisito del programa de embajadores: asistentes verificados, minutos de Stellar (se le pasan), comida por persona (se le pasa el gasto), y cuántos contactos se compartieron | La de organizador |

El prompt `describe_your_event` guía al asistente para armar un evento desde una frase: pedir lo básico que falte, elegir la plantilla, crear el borrador, mostrar el enlace para revisarlo y publicar recién cuando la persona aprueba.

Lo que conviene saber:

- **Ninguna herramienta devuelve nombres ni correos.** La lista de personas sigue en el panel, en el navegador. Y a la cadena no va nada personal, como siempre.
- **Una llamada, una tanda.** Importar y reenviar van de a tandas, como la pantalla; cada respuesta dice cuánto falta. En la red de prueba cada credencial importada tarda unos segundos (la cuenta, la inscripción en el contrato); si el asistente corta la llamada antes, bajá `batch_size`.
- **Publicar es real:** crea un contrato por tipo de credencial en la red de prueba, y tarda. El prompt y las descripciones le piden al asistente que pregunte antes.
- **La clave del evento nuevo** la devuelve `create_event_draft`; el asistente la usa en las llamadas que siguen, y después la podés dejar en `RUMBO_ORGANIZER_KEY` para no pasarla cada vez.
- `pnpm e2e:mcp` (`scripts/prueba-mcp.mjs`) corre el flujo entero contra la red de prueba con su propio servidor: por HTTP arma y publica un Build with AI, y por el puente de stdio importa el CSV de ejemplo, reenvía los enlaces, hace entrar a dos personas por la puerta y lee el estado, la lista del sorteo, el informe y el resumen para el capítulo. Deja la transcripción con los ids reales en [demo/mcp.txt](demo/mcp.txt).

## Probarlo

```bash
pnpm typecheck                     # TypeScript estricto, sin errores
pnpm test                          # las pruebas sin red (tests/*.test.mjs, con node --test): cada una con su base propia y vacía
pnpm test:pg                       # las mismas, con la base en Postgres: en PGlite (Postgres en WASM, dentro del proceso) y con el driver de producción por la red
pnpm build                         # la app entera compila
pnpm e2e                           # el flujo entero contra la red de prueba, con su propio servidor (abajo)
pnpm e2e -- --motor postgres       # lo mismo, con la base en Postgres
pnpm e2e:mcp                       # el flujo entero por el servidor MCP (HTTP y stdio) contra la red de prueba, con su propio servidor; deja demo/mcp.txt
node scripts/inscribir-prueba.mjs [--pago] [--api http://localhost:3000]   # una inscripción, con todas sus comprobaciones
node scripts/prueba-escaner.mjs --base http://localhost:3000               # el escáner en Chrome sin interfaz, con y sin red
node scripts/smoke-contrato.mjs    # los helpers del contrato, de punta a punta
node scripts/capturas.mjs --base http://localhost:3000 --salida data/capturas   # cada pantalla en tres tamaños y dos idiomas
node scripts/capturas-stands.mjs   # los stands, la ruta y la pantalla en vivo, sin la red de Stellar (hace falta pnpm build antes)
pnpm informe -- --datos informes/ejemplo.json --lang es --salida informes/ejemplo-es.pdf      # el informe de ejemplo (hace falta XeLaTeX)
node scripts/capturas-kit.mjs --salida data/capturas-kit   # las pantallas del kit en 1440x900 y 390x844, en es y en; levanta la app adentro, con una base propia y cuentas, contrato y correo de mentira: no toca la red de prueba
node scripts/capturas-pollar.mjs --salida data/capturas-pollar   # entrar con Google o con el correo y cada paso de la inscripción con la cuenta propia, en 1440x900 y 390x844, en es y en; igual que el kit, sin la red de prueba y con un Pollar de mentira que firma con una llave local
node scripts/capturas-organizador.mjs --salida data/capturas-organizador   # la cuenta de organizador: entrar, Mis eventos vacío y con un evento, crear sin la clave de la casa y el panel con Salir, en los dos tamaños, los dos idiomas y los dos temas; con el mismo Pollar de mentira
node scripts/sanear-fechas.mjs [--borrar]   # las lecturas del espejo con una hora que no existe o de antes del 2000 (de antes de que el servidor la validara): las lista, y con --borrar las borra
```

`pnpm e2e` (`scripts/e2e-testnet.mjs`) levanta un servidor de desarrollo propio sobre una base nueva en `data/e2e`, crea el evento de muestra sobre los contratos de muestra (con `--contratos nuevos` despliega dos para la corrida, por si los de muestra se llenan), inscribe a una persona gratis y a otra con la entrada paga (y comprueba que la plata llegó a quien organiza y a Rumbo en la misma transacción), abre sus credenciales, las pasa por la puerta y por la mesa del almuerzo con la API del escáner, intenta el segundo canje y la segunda entrada, y comprueba con `status()`, `attendees()` e `info()` en la cadena y con el panel, el informe y el CSV que los números coinciden. Al final hace lo mismo con la cuenta propia: una llave local hace de billetera de Pollar, sin cuenta en la red, firma el desafío y la autorización de una inscripción gratis y de una entrada paga, y pasa por la puerta. Deja la transcripción con los ids de las transacciones en [demo/e2e-testnet.txt](demo/e2e-testnet.txt). Con `--base` usa un servidor ya levantado. Con `--motor postgres` la base es Postgres: levanta un Postgres local (`pnpm db:local`, PGlite servido por la red, que comparten el servidor, el seed y el script), lo migra con `pnpm db:migrate` y corre todo con `RUMBO_REPO=postgres` y el driver de producción. El contrato tiene sus propias pruebas: `cargo test --workspace` desde la raíz del repositorio.

## Cómo está armada

```
src/app/            las páginas: / , /e/[slug] (el evento), /p/[passId] (la credencial), /scan (el escáner), /admin/[slug] (el panel)
src/app/api/        las rutas de la API: evento, pase, scan, admin
src/app/globals.css los tokens de la marca (día y noche) y los componentes base
src/components/     Marca, SelectorIdioma, BotonTema, ui.tsx (Boton, BotonEnlace, Tarjeta, Chip, Campo, Pantalla, Aviso) y los de cada área: evento/, escaner/, panel/
src/i18n/           los diccionarios por área (comun, evento, escaner, panel) y el helper t(clave)
src/server/         lo que corre solo en el servidor: base/ (la base de datos, con SQLite y Postgres), repo, compartido (los turnos entre instancias), accounts, stellar, mailer, qr, qr-keys, env, pedido, evento/, escaner, puerta, panel, stands, informe, embajadores, verificacion, kit/ (plantillas, borrador, publicar, importar, csv, equipos, asistencia), mcp/ (las herramientas y el servidor MCP)
src/lib/            lo que comparten servidor y navegador: la forma del QR, Ed25519 y la verificación, el QR que rota, el veredicto del escáner, la cola local, la búsqueda, los códigos de puesto, los tipos de credencial
public/             el service worker del escáner (sw.js) y su manifiesto
scripts/            setup-dev, seed, e2e-testnet, mcp (el puente por stdio), prueba-mcp, capturas, informe, certificados, paquete-embajadores, las pruebas de cada área y lib/ (env, browser, latex)
informes/           las plantillas de XeLaTeX del informe y del certificado, sus textos, las fuentes, la marca y los ejemplos
tests/              las pruebas sin red (pnpm test): el CSV, los frenos, el escáner y su cola, la firma del QR y su ventana de tiempo, el respaldo de la puerta, el envío de transacciones, los stands, el informe, los errores, los textos, las del kit (kit-*.test.mjs, con los CSV de ejemplo en fixtures/), las del servidor MCP (mcp.test.mjs) y las de Postgres (base-postgres.test.mjs); lib/ arma una base vacía por archivo, con el motor que diga RUMBO_TEST_ENGINE
demo/               las transcripciones del flujo entero en la red de prueba: por la API (e2e-testnet.txt) y por el servidor MCP (mcp.txt)
```

### El idioma

Castellano por defecto, inglés con `?lang=en`. El middleware (`src/middleware.ts`) lee `?lang=`, lo recuerda en la cookie `rumbo.lang` y se lo pasa al servidor en una cabecera.

- En un componente de servidor: `const t = await getT()` (de `@/i18n/server.ts`) y `t("inicio.titulo")`.
- En un componente de cliente: `const t = useT()` (de `@/i18n/client.tsx`).
- Los textos con huecos: `t("pago.precio", { monto: 10 })`.

Cada área tiene su diccionario en `src/i18n/`: `comun.ts` (lo general), `evento.ts`, `escaner.ts`, `panel.ts`, `stands.ts` (los stands, la ruta y el permiso), `vivo.ts` (la pantalla en vivo), `verificacion.ts` (la verificación de un certificado) y `kit.ts` (las plantillas, la importación y los equipos), con el prefijo de su área en las claves y los dos idiomas en el mismo cambio. `index.ts` los une.

### Los datos: `src/server/base/` y `src/server/repo.ts`

Todo lo que lee o escribe datos pasa por `src/server/base` (`getDb()`), con el motor que dice `RUMBO_REPO`: `sqlite` para el desarrollo y las pruebas (`data/rumbo.db`) y `postgres` para producción (Supabase, por `DATABASE_URL`); `pglite` es el mismo Postgres en WASM dentro del proceso, para probar sin servidor (`data/pglite`, o `RUMBO_PGLITE_DIR`). Las sentencias se escriben una sola vez, con `?`, `TRUE` y `FALSE` y `ON CONFLICT`; lo que cambia entre motores lo resuelve cada adaptador. `Repo` es la interfaz de los datos del evento y `getRepo()` la da (`SqlRepo`, sobre esa capa); el panel, los stands, la pantalla en vivo, las llaves de los QR y las claves de las credenciales usan la misma base. Las tablas de SQLite están en `src/server/migrations/` (`001-inicial.sql` lo general, `002-acceso-credencial.sql` las claves de acceso de las credenciales, `003-panel.sql` las del panel, `006-llaves-ed25519.sql` las llaves con las que se firman los QR, `007-kit.sql` las plantillas, los tipos de credencial, los equipos, los topes y la dieta, `008-stands.sql` los stands y la ruta, `009-consentimiento-contacto.sql` la casilla opcional de contacto de la inscripción) y se aplican solas al abrir la base. Las de Postgres están en `src/server/migrations-pg/`: las mismas nueve traducidas, con `timestamptz`, `bytea`, `boolean`, `jsonb` y las mismas restricciones, más `010-estado-compartido.sql` (los turnos y los frenos), `011-acceso-por-fila.sql` (el acceso por fila prendido en todas las tablas) y `012-funciones-y-secuencias.sql` (las funciones y las secuencias, las de hoy y las que vengan, cerradas para las llaves de la API). La `013-clave-de-correo.sql` (en los dos dialectos) agrega `persons.email_key`, la clave con la que dos correos que llegan al mismo buzón cuentan como una sola persona (`emailKey` en `repo.ts`: en Gmail, sin los puntos ni lo que sigue a un "+"); la `017-lecturas-recibidas.sql` (también en los dos) agrega a `checkins`, `redemptions` y `stand_visits` la hora en que cada lectura llegó al servidor (`received_at`) y cómo se leyó la credencial (`via`); la `018-organizadores.sql` (en los dos) agrega las cuentas de organizador (`organizers`, sin correos), sus sesiones (`organizer_sessions`, guardadas como huella) y `events.organizer_id`. Esas se aplican con `pnpm db:migrate`.

- **Los secretos guardados.** Con Postgres, la llave privada y la raíz de credenciales de cada evento y la llave de cada cuenta de prueba van cifradas con AES-256-GCM y `RUMBO_DATA_KEY` (`src/server/base/cifrado.ts`), atadas a su fila. En SQLite de desarrollo quedan tal cual.
- **Lo que comparten las instancias.** Con Postgres, los frenos contra quien prueba a la fuerza (`src/server/limites.ts`), el turno de la cuenta patrocinadora, lo que el escáner está mandando a la cadena y la tanda de cada importación (`src/server/compartido.ts`) viven en la base (`attempt_limits` y `leases`): en Vercel cada pedido puede caer en otra instancia. Con SQLite viven en la memoria del proceso, como siempre.

- **Eventos.** Las llaves con las que se firman sus QR no están acá sino en `event_qr_keys` (`src/server/qr-keys.ts`): una llave privada por evento que no sale del servidor, y su clave pública, que es lo único que recibe el escáner.
- **Tipos de entrada**: cada uno con su precio en USDC de prueba y su contrato en la red (el precio es fijo por contrato: el evento de muestra tiene uno gratis y uno pago).
- **Beneficios**: el catálogo del evento, y qué trae cada tipo de entrada con el número con que se canjea en su contrato (`linkBenefit`, `listTicketTypeBenefits`).
- **Personas** (nombre y correo, nunca en la cadena), **pases** (id de ocho letras y números, cuenta, estado `pending`, `active` o `checked_in`, la transacción y el número de pase del contrato) y los beneficios de cada pase.
- **Check-ins y canjes**: el espejo de la cadena, con `synced` (ya llegó al contrato), `duplicate` (el contrato lo rechazó por repetido, "doble, revisar") y `clientId` (el id de la cola del escáner: reintentar no duplica). La hora de cada lectura (`scannedAt`) la pone el escáner y el servidor la valida dos veces: al leer el pedido (`src/lib/fecha-iso.ts`: una fecha que exista, nunca antes del 2000) y otra vez al escribir (`recordCheckIn`, `recordRedemption`, `recordVisit` rechazan con `InvalidScannedAt`), y tiene que caer entre un día antes del inicio del evento (o de hoy) y diez minutos adelante. Una fila que igual quedó con una hora ilegible (de antes de validarla) no tumba ninguna lectura: se muestra con la hora de llegada y `node scripts/sanear-fechas.mjs` la lista y la borra.
- **Cuentas de desarrollo**: solo red de prueba, ver "modo de prueba".
- `getEventStats(eventId)`: los números para el panel y para quien auspicia.

### Las cuentas: `src/server/accounts.ts`

`AccountProvider` es la interfaz: `getOrCreateForPerson(personId)` devuelve la cuenta de Stellar de la persona (clave pública), `authSigner(personId)` da quien firma por ella lo que el contrato le pide, y `signAndSubmit(personId, tx)` firma y manda con la comisión patrocinada. `DevAccountProvider` es la del modo de prueba y es solo para la red de prueba. `PollarAccountProvider` (con `RUMBO_ACCOUNTS=pollar` y la clave publicable) da la cuenta propia de quien entró con Pollar y, como el servidor no puede firmar por ella, `authSigner` falla con `SignsOnDevice`: la inscripción va en dos pasos ("Entrar con Google", arriba). Para quien no entró con Pollar (un equipo, una lista importada) sigue con la de prueba. `PasskeyAccountProvider` es un esqueleto.

### La red: `src/server/stellar.ts`

- `getRpc()`, `getHorizon()`, `getSponsor()` (paga las comisiones de todo), `getGate()` (firma check-ins y canjes), `fundWithFriendbot(publicKey)`.
- `readDeployInfo()` lee `contracts/rumbo-pass/deploy/testnet.json`: el activo de prueba, las cuentas y los contratos desplegados (`events.free`, `events.paid`). `getTestAsset()` da el USDC de prueba; `resolveContractId("free" | "paid")` el contrato de muestra.
- `rumboPass`: `register(contractId, attendee, signer)`, `buy(contractId, buyer, signer)`, `checkIn(contractId, attendee)` (lo marca la puerta, y solo la puerta), `redeem(contractId, attendee, benefit)`, `extendTtl(contractId, holders)` (mantiene vivos el evento y los pases antes de un evento que abrió con meses de anticipación), `status(contractId, who)`, `attendees(contractId)` e `info(contractId)`. Las dos primeras las firma la persona (`AuthSigner`, de `accounts.authSigner(personId)` o `keypairSigner(keypair)`), la paga el servidor; las dos siguientes las firma la puerta.
- Los errores del contrato llegan como `ContractError`, con `code` y `errorName` (`AlreadyCheckedIn`, `AlreadyRedeemed`, `NotCheckedIn`...). `isContractError(error, "AlreadyRedeemed")` y `isAlreadyDone(error)` son los que marcan "doble" en el espejo.
- `submitSponsored(tx, signers)` es la pieza de abajo: simula, firma las autorizaciones, arma la transacción con la comisión de la simulación, la firma con la patrocinadora y espera el resultado. Mandar y esperar es `sendAndWait`, que trata lo que contesta el nodo como corresponde: `DUPLICATE` es "ya está en camino" (se sigue esperando el resultado por su hash, no es un error) y `TRY_AGAIN_LATER` es "ocupado, reintentá después" (se vuelve a mandar la misma transacción con espera de 1, 2, 4, 8 y 8 segundos y, si sigue ocupado, queda como un error sin código de contrato que el escáner deja pendiente, sin esperar a una transacción que nunca entró). Todo lo que manda la patrocinadora pasa por `withSponsorLock`, de a una, porque comparten el número de secuencia; con Postgres, además, entre instancias, con el turno `sponsor` de la base. El SDK de Stellar queda fuera del bundle del servidor (`serverExternalPackages` en `next.config.ts`): adentro se duplicaban los tipos XDR y firmar una autorización fallaba.

### El QR: `src/server/qr.ts`, `src/lib/qr-codec.ts` y `src/lib/qr-verify.ts`

El QR va firmado con una llave pública (Ed25519): cada evento tiene su par de llaves en `event_qr_keys`, la privada nunca sale del servidor y el escáner recibe solo la clave pública al abrir el puesto. Un celular de voluntario perdido no sirve para fabricar credenciales. Hay dos QR, y el escáner los distingue por cuántos pedazos trae (todo en mayúsculas y números, para que salga chico):

- **La credencial impresa** (`<pase>.<firma>`, 112 letras): el pase y la firma del evento sobre su id. Es fija, vale siempre y la lleva el SVG que se descarga, con la marca "Credencial impresa". El escáner la acepta pero la muestra con esa etiqueta, porque una impresa se puede copiar.
- **La del celular** (`<pase>.<ventana>.<certificado>.<firma>`, 274 letras): rota cada 20 segundos. La ventana es el tiempo dividido en tramos de 20 segundos; el certificado es la clave pública de esa credencial más la firma del evento que la liga al pase; la firma de la ventana la hace la clave de la credencial. El escáner comprueba el certificado con la clave pública del evento y la ventana con la clave del certificado, y acepta la ventana actual, la anterior (el celular de la persona va atrasado) y la siguiente (va adelantado). Una captura de pantalla vieja da "No corresponde: este QR venció", con el nombre de quien es.
- **Sin conexión del lado de quien asiste.** Al abrir la credencial con red, el servidor le entrega a la página la semilla de la llave de ESA credencial (derivada con HMAC de una raíz secreta del evento y el id del pase) y su certificado (`buildLiveGrant`). Desde ahí el celular arma el QR de cada ventana solo, sin red (`QrRotante.tsx`, `src/lib/qr-live.ts`). Nadie puede armar el QR de otro pase: no tiene el certificado de ese pase, y firmarlo pide la llave privada del evento. Si el reloj del celular está desfasado más de tres segundos, se corrige con `GET /api/hora` (`src/lib/reloj.ts`: medido con el viaje de ida y vuelta, otra vez cada minuto y apenas se nota que el reloj saltó; una medida de cero también vale, así cuando el reloj se sincroniza solo y vuelve a estar bien la corrección de antes se va, y sin red no hay medida y queda la última); el escáner mide lo mismo con cada foto del evento. Sin una hora que valga, el QR del celular no se acepta.
- **El servidor también lo comprueba.** Cada lectura que sube la cola (una entrada, un canje, una visita a un stand) viaja con el texto del QR que se leyó, y el servidor vuelve a comprobar la firma con la clave pública del evento y que sea de ese mismo pase antes de registrar nada (sin exigir la ventana de tiempo: la cola puede subir tarde). Con un código de puesto, entonces, no se registra a quien nunca pasó. De ahí sale cómo se leyó la credencial, que queda en el espejo (`via`: `live`, `printed` o `manual`, junto con `received_at`, la hora en que llegó al servidor), el panel lo dice en los dobles y el escáner lo marca en el veredicto, también en un stand. La única lectura sin QR es la entrada marcada a mano en la puerta (`via: "manual"`), que solo vale con el código de la Puerta y cuyo id de escáner `manual:puerta:` pone el servidor.
- **Un límite conocido:** el QR de la credencial impresa es fijo y vale mientras valga el evento. Si una impresa se filtra, hoy no hay forma de revocar solo ese QR (una época por pase, firmada en el QR y comprobada por el escáner) sin cambiar las llaves de todo el evento. Queda anotado, no hecho.

- Servidor: `buildPrintedPayload(passId, keys)`, `buildLiveGrant(passId, keys)`, `verifyQrPayload(payload, clavePública, ahora)`; `newPassId()` y `newEventQrKeys()`. Las llaves de un evento: `getEventQrKeys(eventId)` en `src/server/qr-keys.ts` (las crea la primera vez que hacen falta).
- Navegador (el escáner, sin red): `importEventKey(clavePública)` y `verifyQrPayloadInBrowser(payload, clave, ahora)` con WebCrypto. Si el navegador no sabe Ed25519 (antes de Chrome 137, Firefox 129 o Safari 17), `src/lib/ed25519.ts` cae a `@noble/ed25519`, que se carga recién cuando hace falta.
- `src/lib/qr-svg.ts`: `renderQrSvg(payload)` dibuja el QR como SVG, para la credencial y su exportación.
- Los QR viejos, con firma HMAC y llave compartida, dejan de valer (migración 006).

### El respaldo manual de la puerta: `src/server/puerta.ts`

Solo con la sesión (o el código) del puesto Puerta (los demás reciben 403). `searchDoor` busca entre las personas inscriptas por nombre (sin mayúsculas ni tildes, con tres letras como mínimo) o por el correo entero, nunca por un pedazo del correo (con el dominio a la vista se reconstruía letra por letra), y da hasta ocho resultados con el correo tapado, también el dominio (`a***@e***.com`). El freno de la búsqueda (ciento veinte en diez minutos) cuenta por evento, puesto (su código, que la ficha de sesión lleva adentro) e IP, nunca por ficha (abrir el puesto da una ficha nueva sin contar nada, y con eso el cupo se renovaba en segundos), y cuenta y decide de un solo golpe (`Limiter.take`): una ráfaga no pasa entera, y quien agota su cupo no deja sin buscador a la Puerta de al lado. `addAtDoor` inscribe gratis con nombre y correo, con la misma inscripción de siempre y la primera entrada sin precio del evento, y le manda la credencial al correo. La entrada marcada a mano va por la misma cola que una lectura, marcada como manual y con el id de escáner `manual:puerta:<celular>` que pone el servidor, así queda en el espejo como manual, con su puesto y su hora. Sin red, el escáner busca por nombre en la lista que ya bajó. `addAtDoor` inscribe gratis con nombre y correo, con la misma inscripción de siempre y la primera entrada sin precio del evento, y le prepara la credencial (el correo con el enlace, cuando el servicio exista). La entrada marcada a mano va por la misma cola que una lectura, con el id de escáner `manual:puerta:<celular>`, así queda en el espejo como manual, con su puesto y su hora. Sin red, el escáner busca por nombre en la lista que ya bajó.

### Los correos: `src/server/mailer.ts`

`Mailer.send({ to, subject, text, html? })` devuelve un resultado honesto: `{ outcome: "sent" }` si de verdad salió, `{ outcome: "not_configured" }` si en este servidor no hay con qué mandarlo (y entonces el enlace se muestra en pantalla, o quien organiza lo baja en CSV desde la importación). `DevMailer` escribe cada correo en `data/correos/` en desarrollo (al registro va solo el dominio y la carpeta: nunca el enlace personal ni el correo) y en producción no manda nada y contesta `not_configured`; `ResendMailer` es un esqueleto que también contesta `not_configured`. Armar el correo nunca tira un error: si ni la carpeta se puede escribir, se degrada a "no configurado". Nunca llaves ni contraseñas en un correo.

## Las variables

Están todas en [`.env.example`](.env.example), con lo que hace cada una. Las llaves secretas viven en `.env.local` y nunca se versionan. `RUMBO_EVENTS_PER_DAY` es cuántos eventos puede crear una cuenta de organizador en veinticuatro horas (tres si no se dice; en la red de prueba cada evento publicado despliega contratos). Las cuentas son las mismas que usa el despliegue del contrato ([contracts/rumbo-pass](../contracts/rumbo-pass/README.md)): `STELLAR_SPONSOR_SECRET`, `STELLAR_GATE_SECRET`, `STELLAR_ISSUER_SECRET`, `STELLAR_ORGANIZER_SECRET` y `STELLAR_TREASURY_SECRET`. `RUMBO_DATA_DIR` cambia la carpeta de la base y los correos (los scripts de prueba la usan para no mezclar datos).

## En producción

La app corre en Vercel y la base es Postgres en Supabase, por el pooler en modo transacción. Además de las variables de siempre (`STELLAR_*`, `RUMBO_ACCOUNTS`, `RUMBO_MAILER`, `RUMBO_CREATE_KEY`, `NEXT_PUBLIC_BASE_URL`, y con Pollar `NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY`, que Next pone en el navegador al compilar y el servidor lee al pedir, y `POLLAR_SECRET_KEY`, con la que el servidor le avisa a Pollar el contrato de cada evento que se publica):

| Variable | Qué es |
|---|---|
| `RUMBO_REPO` | `postgres`. Sin ella la app usa SQLite, y en Vercel no arranca |
| `DATABASE_URL` | La cadena del pooler de Supabase en modo transacción, la del puerto 6543: `postgres://postgres.<proyecto>:<clave>@<región>.pooler.supabase.com:6543/postgres` |
| `RUMBO_DATA_KEY` | 32 bytes al azar en base64, con los que se cifran los secretos guardados. Se genera una vez y no se cambia: con otra llave, lo guardado no se descifra. Sin ella la app no arranca |
| `RUMBO_PG_CA` | **Hace falta con Supabase.** La conexión verifica el certificado del servidor, y el del pooler de Supabase lo firma su propia autoridad (`Supabase Root 2021 CA`), que no está en el sistema: bajá el `.crt` desde el panel de Supabase (Project Settings, Database, SSL, "Download certificate") y ponelo acá, como la ruta al archivo o como el PEM entero (en Vercel, el PEM entero en la variable). La raíz que presenta el pooler hoy (`Supabase Root 2021 CA`, vence en abril de 2031) está guardada en `certs/supabase-root-2021.crt`: en desarrollo, `RUMBO_PG_CA=./certs/supabase-root-2021.crt`. Sin ella la app no se conecta, y el error dice qué cargar |
| `RUMBO_PG_POOL_MAX` | Opcional: cuántas conexiones abre cada instancia (cinco) |
| `RUMBO_DATA_DIR` | `/tmp/rumbo`: en Vercel el disco es de solo lectura salvo `/tmp`. Ya no hace falta para los correos: en producción el `DevMailer` no manda nada (abajo) |
| `RUMBO_DEPLOY_JSON` | `./deploy/testnet.json`: la copia de `contracts/rumbo-pass/deploy/testnet.json` que `pnpm build` arma con `scripts/copiar-despliegue.mjs`, porque con la carpeta raíz en `app/` lo de afuera no viaja. Hace falta para publicar eventos nuevos desde una plantilla |
| `RUMBO_EVENTS_PER_DAY` | Opcional: cuántos eventos puede crear cada cuenta de organizador en veinticuatro horas (tres). Frena a una cuenta, no a una persona: el servidor solo comprueba que la llave firmó el desafío, no que la custodie Pollar, así que cualquier llave de Stellar es una cuenta |
| `RUMBO_EVENTS_PER_IP_PER_DAY` | Opcional: cuántos eventos se crean con cuenta desde una misma IP en veinticuatro horas (diez), el freno a quien abre cuentas en serie. Se lee una vez por proceso. Con Pollar prendido, cualquiera que entre puede crear eventos sin la clave de la casa: estos dos son los frenos |
| `RUMBO_EVENTS_GLOBAL_PER_DAY` | Opcional: cuántos eventos se crean con cuenta en veinticuatro horas en todo Rumbo, sumando todas las cuentas y conexiones (cien). Pasado eso, `/admin/nuevo` lo dice y no muestra el formulario |

`vercel.json` fija la región `pdx1` (Oregón), la misma de la base en Supabase (`us-west-2`), y el preset de Next.

1. **El proyecto.** Crear el proyecto en Supabase y copiar la cadena del pooler en modo transacción (Connect, Transaction pooler) y el certificado de su autoridad (`RUMBO_PG_CA`). Generar la llave con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` y guardarla también en un gestor de contraseñas: si se pierde, las llaves de los QR y las cuentas guardadas no se recuperan.
2. **Migrar.** Desde `app/`: `DATABASE_URL=<la cadena> RUMBO_PG_CA=<el .crt> pnpm db:migrate`. Aplica lo que falte, en orden, y se puede correr las veces que haga falta. Deja el acceso por fila prendido en todas las tablas y cerradas las funciones y las secuencias (las de hoy y las que vengan) para las llaves de la API: por la API pública de Supabase no se ve ni se ejecuta nada, y la app entra como dueña de las tablas. Antes de desplegar un cambio que trae una migración nueva, se migra primero.
3. **Desplegar.** En el proyecto de Vercel de la app, con la carpeta raíz en `app`, cargar las variables para producción y desplegar; o desde esta carpeta, con `pnpm dlx vercel deploy --prod` después de `pnpm build` (`.vercelignore` dice qué no viaja: la base local, los correos y `.env.local`; y deja viajar `deploy/testnet.json`). Como `package.json` fija la versión de pnpm en `packageManager`, la variable `ENABLE_EXPERIMENTAL_COREPACK=1` en Vercel hace que instale esa misma versión. Al levantar, cada instancia comprueba `DATABASE_URL` y `RUMBO_DATA_KEY` (`src/instrumentation.ts`): si falta algo, no arranca y el registro dice qué.

**El correo real queda para Resend.** Mientras no esté, en producción ningún correo sale y nada se anuncia como enviado: la inscripción muestra el enlace en pantalla, y la importación cuenta "con enlace, sin correo" y ofrece "Descargar enlaces (CSV)" para mandarlos a mano. `RUMBO_MAILER=dev` en producción no escribe archivos ni deja el enlace en el registro.

**Un límite conocido:** la clave del panel de cada evento (`organizer_keys.key`), los códigos de puesto (`station_codes.code`) y la clave de acceso de cada credencial (`pass_access.access_key`) se guardan en claro en la base (las sesiones de organizador, no: solo su huella). Quien lea la base (una copia de seguridad, la consola de Supabase) tiene con qué abrir cualquier panel, puesto o credencial. Guardarlas como huella (y comparar la huella) es un rediseño de esas tres tablas y de cómo se muestran las claves a quien organiza; queda anotado, no hecho.

Para probar el motor de producción en esta máquina, sin Supabase: `pnpm db:local` levanta un Postgres local (PGlite servido por la red) y dice su `DATABASE_URL`; después, `pnpm db:migrate` y `pnpm dev` con `RUMBO_REPO=postgres`, esa `DATABASE_URL` y una `RUMBO_DATA_KEY`.

## Lo que falta

- **Un enlace de solo lectura por auspiciante.** Hoy el informe (`/admin/<evento>/informe`) lo abre quien organiza, con su clave, y quien auspicia lo recibe impreso o en PDF. Viene un enlace propio por auspiciante, sin la clave del panel, que muestre solo su informe.
- **La cuenta de organizador no pasa un evento a otra cuenta ni tiene coorganizadores con cuenta.** Un evento es de la cuenta que lo creó; para compartirlo está "Compartir el panel", con la clave del evento. Tampoco se comprueba del lado del servidor que la cuenta sea de Pollar (la API de Pollar con `POLLAR_SECRET_KEY` lo permitiría): hoy cualquier llave que firme el desafío entra, y por eso los topes por IP. Y los eventos de antes (los de muestra, los del MCP) no tienen dueño: se abren con su clave. Pasar un evento a una cuenta queda para después.
- **Pollar 0.12 antes del 30-nov-2026.** La API v1 que usa `@pollar/core` 0.11 se retira ese día; en 0.12 cada firma pide confirmación a la persona salvo que la política de la app diga otra cosa, así que la inscripción tiene que mostrar ese pedido (`onConfirmationRequest`). Y para mainnet, donde Pollar no custodia cuentas, la inscripción con Google pasa a billeteras cofirmadas o a passkeys.

## Cómo se escribe lo visible

Castellano con voseo e inglés en el mismo cambio. Sin tecnicismos en pantalla: se dice credencial, canje, vale, pase y cuenta. Una sola acción principal por pantalla, a la vista sin hacer scroll (el componente `Pantalla` la deja abajo, fija). Los estados siempre con palabra y color (`Chip`). Más en [docs/marca.md](../docs/marca.md).
