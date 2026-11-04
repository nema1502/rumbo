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

- **El evento:** `http://localhost:3000/e/hackaton-comunidad`. "Inscribirme" o "Comprar", nombre y correo, y la credencial tarda entre quince y cuarenta segundos (la red de prueba crea la cuenta, le da saldo y la inscribe en el contrato). El correo con el enlace personal queda en `data/correos/` y en la consola.
- **El panel:** `node scripts/panel-clave.mjs` imprime el enlace del panel con su clave (`/admin/hackaton-comunidad?k=...`) y los códigos de puesto para los voluntarios. El informe para quien auspicia está en `/admin/hackaton-comunidad/informe`.
- **El escáner:** `http://localhost:3000/scan`, con el código de un puesto. Con la cámara, o con "Escribir el código" y el texto que va debajo del QR de una credencial.

`pnpm seed -- --demo` agrega además a una persona de ejemplo con su pase y su cuenta de prueba; `node scripts/panel-pases-prueba.mjs` llena el panel con doce personas de prueba, canjes y dobles (solo el espejo, sin tocar la red).

Si los contratos del despliegue no existen (la red de prueba se reinicia cada tanto, la próxima vez el 16 de diciembre de 2026), hay que volver a desplegarlos como dice [contracts/rumbo-pass/README.md](../contracts/rumbo-pass/README.md) y correr `pnpm seed -- --refresh` para que las entradas apunten a los nuevos.

En desarrollo conviene un solo servidor por carpeta: dos `next dev` sobre la misma `app/` se pisan la salida en `.next` y aparecen errores al azar.

## Qué es el modo de prueba

Todo corre contra la red de prueba de Stellar (testnet): si `STELLAR_NETWORK` dice otra cosa, el servidor no arranca ninguna operación. En la red de prueba la plata no es plata, pero el resto es real: el contrato garantiza que cada entrada y cada canje ocurren una sola vez, el pago llega a quien organiza en la misma transacción que separa la comisión, y quien auspicia ve los canjes.

Lo que hoy es distinto de producción, y la interfaz lo dice ("Modo de prueba: la cuenta la guarda el servidor; en producción es tuya, con Google o con una passkey"):

- **La cuenta de cada persona la crea y la guarda el servidor** (`DevAccountProvider`, tabla `dev_accounts` en la base local): la fondea con friendbot, le agrega la línea de confianza al USDC de prueba, le da un saldo inicial del emisor propio (`RUMBO_INITIAL_TEST_USDC`, cien por defecto) y firma por ella cuando el contrato se lo pide. En producción la cuenta es de la persona (Google con Pollar, o una passkey) y el servidor no tiene su llave.
- **El USDC es de prueba:** lo emite una cuenta propia en la red de prueba y en pantalla se llama "USDC de prueba". No vale nada fuera de la demostración.
- **Las comisiones de red las paga el servidor** con una cuenta patrocinadora, así ninguna cuenta de persona necesita XLM. Eso sí se queda igual en producción.
- **En desarrollo la base es un archivo SQLite** (`data/rumbo.db`); en producción es Postgres en Supabase (abajo, "En producción"). **Los correos se escriben a disco** (`data/correos/`) en vez de mandarse: Resend queda como interfaz con su esqueleto, por hacer.
- **El panel se abre con una clave por evento** en vez de una cuenta de organizador.

Nada de `data/` ni de `.env.local` se versiona.

## El recorrido

| Pantalla | Qué hace |
|---|---|
| `/` | La lista de eventos |
| `/e/<evento>` | El afiche y las entradas, cada una con su único botón |
| `/e/<evento>/inscripcion?entrada=<id>` | Nombre y correo, y una sola acción: "Confirmar inscripción" o "Pagar 10 USDC de prueba" |
| `/e/<evento>/listo?pase=<id>&k=<clave>` | "Inscripción lista" o "Entrada paga", y el enlace a la credencial |
| `/p/<pase>?k=<clave>` | La credencial: el QR que se renueva solo cada 20 segundos (también sin conexión), el nombre, "Credencial N de M", el estado y lo que le toca a la persona. "Descargar en SVG" baja la versión para imprimir, con un QR fijo marcado como impresa |
| `/scan` | El escáner del voluntario: el código del puesto, la cámara, los tres veredictos, la cola local. Instalable, funciona sin red. En la puerta, además, el respaldo manual: buscar a alguien por nombre o correo, marcarle la entrada o agregarlo |
| `/admin/<evento>` | El panel de quien organiza: contadores en vivo, canjes por franja, códigos de puesto, pases, dobles, CSV y el contraste con la cadena |
| `/admin/nuevo` | Armar un evento desde una plantilla: elegirla, contar lo básico, y queda el borrador |
| `/admin/<evento>/armar` | El borrador: credenciales, canjes, puestos y topes; "Publicar el evento" |
| `/admin/<evento>/importar` | Importar la lista de Luma o de Bevy; cada persona recibe su credencial por correo |
| `/e/<evento>/equipo` | La inscripción por equipos de la hackatón |
| `/admin/<evento>/informe` | El informe para quien auspicia: números, nunca personas, con hoja de impresión |
| `/admin/<evento>/stands` | Stands y ruta: un stand por auspiciante con su código, la meta de la ruta y los números de cada uno |
| `/stand/<código>` | El panel de quien atiende un stand: sus visitas y los contactos de quienes aceptaron compartirlos, con calificación, nota y CSV |
| `/vivo/<evento>` | La pantalla en vivo para proyectar: quienes entraron, almuerzos y merch entregados, el ranking de la ruta y el espacio del sorteo |
| `/v/<pase>?c=<código>` | La verificación pública de un certificado de asistencia: si esa persona entró, cuándo, y el enlace a su entrada en el registro público |

Al terminar el evento, `pnpm informe`, `pnpm certificados` y `pnpm paquete-embajadores` arman en PDF el informe del evento (para quien organiza, quien auspicia y el programa de embajadores de Stellar), un certificado verificable por persona que entró y el paquete para el capítulo. Todo eso, con sus plantillas de XeLaTeX y sus ejemplos, está en [informes/](informes/README.md).

Cada parte tiene su guía: [la inscripción y la credencial](src/server/evento/README.md), [el escáner](src/app/scan/README.md), [el panel](src/app/admin/README.md) y [los stands y la ruta](src/app/stand/README.md). La API:

| Ruta | Qué hace |
|---|---|
| `GET /api/evento/<evento>` | Lo público del evento, sus entradas y su catálogo de beneficios |
| `POST /api/evento/<evento>/inscripcion` | Inscribe o cobra, igual que el formulario |
| `GET /api/pase/<pase>?k=<clave>` y `/svg` | La credencial como datos, y para imprimir |
| `POST /api/scan/open` y `/api/scan/sync` | El escáner: abrir el puesto con su código, y subir la cola |
| `POST /api/scan/buscar` y `/api/scan/agregar` | El respaldo de la puerta (solo con el código del puesto Puerta): buscar por nombre o correo, e inscribir gratis a quien llegó sin credencial |
| `GET /api/hora` | La hora del servidor, para que una credencial con el reloj desfasado arme el QR de la ventana que corresponde |
| `GET /api/admin/<evento>` y `/csv`, `POST .../cadena`, `.../entrar`, `.../salir` | El panel: el estado en JSON, la lista en CSV, el contraste con la cadena y la sesión |
| `GET` y `POST /api/admin/<evento>/stands` | Stands y ruta: leer, y agregar, cambiar o sacar un stand, cambiarle el código, fijar la meta y sacar a alguien de la pantalla en vivo |
| `GET` y `POST /api/pase/<pase>/ruta?k=<clave>` | La ruta de una credencial, y la respuesta de la persona a la pregunta de permiso o cómo quiere aparecer en la pantalla |
| `GET /api/stand/<código>`, `POST .../contacto`, `GET .../csv` | El panel del stand en JSON, la calificación y la nota de un contacto, y el CSV |
| `GET /api/vivo/<evento>`, `GET` y `POST .../sorteo` | La pantalla en vivo en JSON, y la lista del sorteo (JSON con huella y algoritmo, o `?formato=csv`; `POST` la congela o vuelve a la viva) |
| `POST /api/admin/<evento>/importar` y `GET .../asistencia` | Importar una lista (vista, importar y tandas de correos) y bajar la asistencia en la forma de Bevy |

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

`/admin/<evento>/armar` es el borrador: cada tipo de credencial se enciende o se apaga, se renombra y se le tilda lo que trae; cada canje tiene su nombre, su puesto y cuántos hay (el tope). "Publicar el evento" guarda y prepara el contrato de cada entrada (`src/server/kit/publicar.ts`); el evento recién entonces recibe inscripciones. Crear eventos lo controla `RUMBO_CREATE_KEY` (la "clave de la casa"): vacía, está abierto en desarrollo y cerrado en producción.

### Credenciales por tipo

Cada tipo de entrada es un tipo de credencial: asistente, oradora u orador, mentora o mentor, jurado, voluntaria o voluntario, organización y auspiciante (`src/lib/credential-kinds.ts`). Cada tipo trae sus propios canjes: el jurado y la mentoría tienen cena, quien es voluntario tiene su polera de staff. La credencial en pantalla y la que se imprime llevan el tipo en grande (la banda de arriba cambia de color si no es asistente) y el equipo si lo hay; el escáner lo muestra en cada veredicto. **Solo el asistente se inscribe desde la página pública**: las demás se entregan por invitación, importando la lista.

### Importar desde Luma y desde Bevy

`/admin/<evento>/importar` (el evento tiene que estar publicado): se sube el CSV, se revisa lo que se leyó, se eligen los estados que entran (por defecto, aprobadas o confirmadas) y qué credencial recibe cada tipo de entrada de la lista, y se importa. Cada persona recibe su enlace por correo, **de a tandas de cinco** (la pantalla las pide una tras otra con su barra de avance; si se cierra, lo pendiente se retoma). Al final: "Importadas 142, salteadas 6 duplicadas, 3 con correo inválido".

- Una persona no se duplica: el mismo correo (sin importar mayúsculas) dos veces en el archivo entra una vez, y quien ya tiene credencial en el evento no se toca (ni su entrada, ni sus canjes, ni su tipo): **volver a importar no pisa los check-ins ya hechos**.
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
- **Tope por canje.** Cada canje puede tener un total (150 poleras). El panel dice cuántas quedan y avisa cuando se acaban; el escáner de esa mesa baja el total que sabe el servidor, descuenta lo que ese escáner ya entregó sin conexión y, cuando no queda ninguna, responde "no corresponde" y no anota nada.
- **Dieta.** La inscripción (y una pregunta de la lista importada) puede traer una restricción de dieta, opcional. Se guarda en la credencial y solo viaja a los escáneres de los puestos de comida (el almuerzo, y lo que la plantilla marcó como desayuno, refrigerio o cena: `isFoodBenefit` en `src/server/kit/plantillas.ts`), donde sale en grande. La mesa del café del auspiciante o de una taza no la recibe.
- **Asistencia.** `GET /api/admin/<evento>/asistencia` baja un CSV con la forma de una lista de Bevy (`First Name`, `Last Name`, `Email`, `Ticket Type`) y la columna `Attended` (`Yes` o `No`) que piden las ligas de hackatones, más `Checked In At`, `Credential Type` y `Team`. Los GDG pueden devolverla a su plataforma.
- **Equipos.** La hackatón se inscribe en `/e/<evento>/equipo`: nombre del equipo y hasta cinco integrantes; cada uno recibe su propia credencial por correo. El equipo se ve en la credencial, en el panel y en el escáner.

Lo que el kit **no** hace todavía: cambiar el tope de un canje o los precios después de publicar, desplegar el contrato de cada entrada probado contra la red (`networkProvisioner` está escrito y revisado por tipos, pero no se corrió), importar a una entrada de pago, ni leer un `.xlsx` (hay que exportar CSV).

## Probarlo

```bash
pnpm typecheck                     # TypeScript estricto, sin errores
pnpm test                          # las pruebas sin red (tests/*.test.mjs, con node --test): cada una con su base propia y vacía
pnpm test:pg                       # las mismas, con la base en Postgres: en PGlite (Postgres en WASM, dentro del proceso) y con el driver de producción por la red
pnpm build                         # la app entera compila
pnpm e2e                           # el flujo entero contra la red de prueba, con su propio servidor (abajo)
pnpm e2e -- --motor postgres       # lo mismo, con la base en Postgres
node scripts/inscribir-prueba.mjs [--pago] [--api http://localhost:3000]   # una inscripción, con todas sus comprobaciones
node scripts/prueba-escaner.mjs --base http://localhost:3000               # el escáner en Chrome sin interfaz, con y sin red
node scripts/smoke-contrato.mjs    # los helpers del contrato, de punta a punta
node scripts/capturas.mjs --base http://localhost:3000 --salida data/capturas   # cada pantalla en tres tamaños y dos idiomas
node scripts/capturas-stands.mjs   # los stands, la ruta y la pantalla en vivo, sin la red de Stellar (hace falta pnpm build antes)
pnpm informe -- --datos informes/ejemplo.json --lang es --salida informes/ejemplo-es.pdf      # el informe de ejemplo (hace falta XeLaTeX)
node scripts/capturas-kit.mjs --salida data/capturas-kit   # las pantallas del kit en 1440x900 y 390x844, en es y en; levanta la app adentro, con una base propia y cuentas, contrato y correo de mentira: no toca la red de prueba
```

`pnpm e2e` (`scripts/e2e-testnet.mjs`) levanta un servidor de desarrollo propio sobre una base nueva en `data/e2e`, crea el evento de muestra, inscribe a una persona gratis y a otra con la entrada paga (y comprueba que la plata llegó a quien organiza y a Rumbo en la misma transacción), abre sus credenciales, las pasa por la puerta y por la mesa del almuerzo con la API del escáner, intenta el segundo canje y la segunda entrada, y comprueba con `status()`, `attendees()` e `info()` en la cadena y con el panel, el informe y el CSV que los números coinciden. Deja la transcripción con los ids de las transacciones en [demo/e2e-testnet.txt](demo/e2e-testnet.txt). Con `--base` usa un servidor ya levantado. Con `--motor postgres` la base es Postgres: levanta un Postgres local (`pnpm db:local`, PGlite servido por la red, que comparten el servidor, el seed y el script), lo migra con `pnpm db:migrate` y corre todo con `RUMBO_REPO=postgres` y el driver de producción. El contrato tiene sus propias pruebas: `cargo test --workspace` desde la raíz del repositorio.

## Cómo está armada

```
src/app/            las páginas: / , /e/[slug] (el evento), /p/[passId] (la credencial), /scan (el escáner), /admin/[slug] (el panel)
src/app/api/        las rutas de la API: evento, pase, scan, admin
src/app/globals.css los tokens de la marca (día y noche) y los componentes base
src/components/     Marca, SelectorIdioma, BotonTema, ui.tsx (Boton, BotonEnlace, Tarjeta, Chip, Campo, Pantalla, Aviso) y los de cada área: evento/, escaner/, panel/
src/i18n/           los diccionarios por área (comun, evento, escaner, panel) y el helper t(clave)
src/server/         lo que corre solo en el servidor: base/ (la base de datos, con SQLite y Postgres), repo, compartido (los turnos entre instancias), accounts, stellar, mailer, qr, qr-keys, env, evento/, escaner, puerta, panel, stands, informe, verificacion, kit/ (plantillas, borrador, publicar, importar, csv, equipos, asistencia)
src/lib/            lo que comparten servidor y navegador: la forma del QR, Ed25519 y la verificación, el QR que rota, el veredicto del escáner, la cola local, la búsqueda, los códigos de puesto, los tipos de credencial
public/             el service worker del escáner (sw.js) y su manifiesto
scripts/            setup-dev, seed, e2e-testnet, capturas, informe, certificados, paquete-embajadores, las pruebas de cada área y lib/ (env, browser, latex)
informes/           las plantillas de XeLaTeX del informe y del certificado, sus textos, las fuentes, la marca y los ejemplos
tests/              las pruebas sin red (pnpm test): el CSV, los frenos, el escáner y su cola, la firma del QR y su ventana de tiempo, el respaldo de la puerta, el envío de transacciones, los stands, el informe, los errores, los textos, y las del kit (kit-*.test.mjs, con los CSV de ejemplo en fixtures/) y las de Postgres (base-postgres.test.mjs); lib/ arma una base vacía por archivo, con el motor que diga RUMBO_TEST_ENGINE
demo/               la transcripción del flujo entero en la red de prueba
```

### El idioma

Castellano por defecto, inglés con `?lang=en`. El middleware (`src/middleware.ts`) lee `?lang=`, lo recuerda en la cookie `rumbo.lang` y se lo pasa al servidor en una cabecera.

- En un componente de servidor: `const t = await getT()` (de `@/i18n/server.ts`) y `t("inicio.titulo")`.
- En un componente de cliente: `const t = useT()` (de `@/i18n/client.tsx`).
- Los textos con huecos: `t("pago.precio", { monto: 10 })`.

Cada área tiene su diccionario en `src/i18n/`: `comun.ts` (lo general), `evento.ts`, `escaner.ts`, `panel.ts`, `stands.ts` (los stands, la ruta y el permiso), `vivo.ts` (la pantalla en vivo), `verificacion.ts` (la verificación de un certificado) y `kit.ts` (las plantillas, la importación y los equipos), con el prefijo de su área en las claves y los dos idiomas en el mismo cambio. `index.ts` los une.

### Los datos: `src/server/base/` y `src/server/repo.ts`

Todo lo que lee o escribe datos pasa por `src/server/base` (`getDb()`), con el motor que dice `RUMBO_REPO`: `sqlite` para el desarrollo y las pruebas (`data/rumbo.db`) y `postgres` para producción (Supabase, por `DATABASE_URL`); `pglite` es el mismo Postgres en WASM dentro del proceso, para probar sin servidor (`data/pglite`, o `RUMBO_PGLITE_DIR`). Las sentencias se escriben una sola vez, con `?`, `TRUE` y `FALSE` y `ON CONFLICT`; lo que cambia entre motores lo resuelve cada adaptador. `Repo` es la interfaz de los datos del evento y `getRepo()` la da (`SqlRepo`, sobre esa capa); el panel, los stands, la pantalla en vivo, las llaves de los QR y las claves de las credenciales usan la misma base. Las tablas de SQLite están en `src/server/migrations/` (`001-inicial.sql` lo general, `002-acceso-credencial.sql` las claves de acceso de las credenciales, `003-panel.sql` las del panel, `006-llaves-ed25519.sql` las llaves con las que se firman los QR, `007-kit.sql` las plantillas, los tipos de credencial, los equipos, los topes y la dieta, `008-stands.sql` los stands y la ruta, `009-consentimiento-contacto.sql` la casilla opcional de contacto de la inscripción) y se aplican solas al abrir la base. Las de Postgres están en `src/server/migrations-pg/`: las mismas nueve traducidas, con `timestamptz`, `bytea`, `boolean`, `jsonb` y las mismas restricciones, más `010-estado-compartido.sql` (los turnos y los frenos) y `011-acceso-por-fila.sql` (el acceso por fila prendido en todas las tablas). Esas se aplican con `pnpm db:migrate`.

- **Los secretos guardados.** Con Postgres, la llave privada y la raíz de credenciales de cada evento y la llave de cada cuenta de prueba van cifradas con AES-256-GCM y `RUMBO_DATA_KEY` (`src/server/base/cifrado.ts`), atadas a su fila. En SQLite de desarrollo quedan tal cual.
- **Lo que comparten las instancias.** Con Postgres, los frenos contra quien prueba a la fuerza (`src/server/limites.ts`), el turno de la cuenta patrocinadora, lo que el escáner está mandando a la cadena y la tanda de cada importación (`src/server/compartido.ts`) viven en la base (`attempt_limits` y `leases`): en Vercel cada pedido puede caer en otra instancia. Con SQLite viven en la memoria del proceso, como siempre.

- **Eventos.** Las llaves con las que se firman sus QR no están acá sino en `event_qr_keys` (`src/server/qr-keys.ts`): una llave privada por evento que no sale del servidor, y su clave pública, que es lo único que recibe el escáner.
- **Tipos de entrada**: cada uno con su precio en USDC de prueba y su contrato en la red (el precio es fijo por contrato: el evento de muestra tiene uno gratis y uno pago).
- **Beneficios**: el catálogo del evento, y qué trae cada tipo de entrada con el número con que se canjea en su contrato (`linkBenefit`, `listTicketTypeBenefits`).
- **Personas** (nombre y correo, nunca en la cadena), **pases** (id de ocho letras y números, cuenta, estado `pending`, `active` o `checked_in`, la transacción y el número de pase del contrato) y los beneficios de cada pase.
- **Check-ins y canjes**: el espejo de la cadena, con `synced` (ya llegó al contrato), `duplicate` (el contrato lo rechazó por repetido, "doble, revisar") y `clientId` (el id de la cola del escáner: reintentar no duplica).
- **Cuentas de desarrollo**: solo red de prueba, ver "modo de prueba".
- `getEventStats(eventId)`: los números para el panel y para quien auspicia.

### Las cuentas: `src/server/accounts.ts`

`AccountProvider` es la interfaz: `getOrCreateForPerson(personId)` devuelve la cuenta de Stellar de la persona (clave pública), `authSigner(personId)` da quien firma por ella lo que el contrato le pide, y `signAndSubmit(personId, tx)` firma y manda con la comisión patrocinada. `DevAccountProvider` es la de hoy y es solo para la red de prueba; `PollarAccountProvider` y `PasskeyAccountProvider` son esqueletos.

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
- **Sin conexión del lado de quien asiste.** Al abrir la credencial con red, el servidor le entrega a la página la semilla de la llave de ESA credencial (derivada con HMAC de una raíz secreta del evento y el id del pase) y su certificado (`buildLiveGrant`). Desde ahí el celular arma el QR de cada ventana solo, sin red (`QrRotante.tsx`, `src/lib/qr-live.ts`). Nadie puede armar el QR de otro pase: no tiene el certificado de ese pase, y firmarlo pide la llave privada del evento. Si el reloj del celular está desfasado más de tres segundos, se corrige con `GET /api/hora`; el escáner hace lo mismo con la hora de la foto del evento.

- Servidor: `buildPrintedPayload(passId, keys)`, `buildLiveGrant(passId, keys)`, `verifyQrPayload(payload, clavePública, ahora)`; `newPassId()` y `newEventQrKeys()`. Las llaves de un evento: `getEventQrKeys(eventId)` en `src/server/qr-keys.ts` (las crea la primera vez que hacen falta).
- Navegador (el escáner, sin red): `importEventKey(clavePública)` y `verifyQrPayloadInBrowser(payload, clave, ahora)` con WebCrypto. Si el navegador no sabe Ed25519 (antes de Chrome 137, Firefox 129 o Safari 17), `src/lib/ed25519.ts` cae a `@noble/ed25519`, que se carga recién cuando hace falta.
- `src/lib/qr-svg.ts`: `renderQrSvg(payload)` dibuja el QR como SVG, para la credencial y su exportación.
- Los QR viejos, con firma HMAC y llave compartida, dejan de valer (migración 006).

### El respaldo manual de la puerta: `src/server/puerta.ts`

Solo con el código del puesto Puerta (los demás reciben 403). `searchDoor` busca entre las personas inscriptas por nombre o correo, sin mayúsculas ni tildes, con tres letras como mínimo y hasta ocho resultados; el correo vuelve tapado (`a***@dominio`). `addAtDoor` inscribe gratis con nombre y correo, con la misma inscripción de siempre y la primera entrada sin precio del evento, y le manda la credencial al correo. La entrada marcada a mano va por la misma cola que una lectura, con el id de escáner `manual:puerta:<celular>`, así queda en el espejo como manual, con su puesto y su hora. Sin red, el escáner busca por nombre en la lista que ya bajó.

### Los correos: `src/server/mailer.ts`

`Mailer.send({ to, subject, text, html? })`. `DevMailer` escribe cada correo en `data/correos/` y lo imprime en la consola; `ResendMailer` es un esqueleto. Nunca llaves ni contraseñas en un correo.

## Las variables

Están todas en [`.env.example`](.env.example), con lo que hace cada una. Las llaves secretas viven en `.env.local` y nunca se versionan. Las cuentas son las mismas que usa el despliegue del contrato ([contracts/rumbo-pass](../contracts/rumbo-pass/README.md)): `STELLAR_SPONSOR_SECRET`, `STELLAR_GATE_SECRET`, `STELLAR_ISSUER_SECRET`, `STELLAR_ORGANIZER_SECRET` y `STELLAR_TREASURY_SECRET`. `RUMBO_DATA_DIR` cambia la carpeta de la base y los correos (los scripts de prueba la usan para no mezclar datos).

## En producción

La app corre en Vercel y la base es Postgres en Supabase, por el pooler en modo transacción. Además de las variables de siempre (`STELLAR_*`, `RUMBO_ACCOUNTS`, `RUMBO_MAILER`, `RUMBO_CREATE_KEY`, `NEXT_PUBLIC_BASE_URL`):

| Variable | Qué es |
|---|---|
| `RUMBO_REPO` | `postgres`. Sin ella la app usa SQLite, y en Vercel no arranca |
| `DATABASE_URL` | La cadena del pooler de Supabase en modo transacción, la del puerto 6543: `postgres://postgres.<proyecto>:<clave>@<región>.pooler.supabase.com:6543/postgres` |
| `RUMBO_DATA_KEY` | 32 bytes al azar en base64, con los que se cifran los secretos guardados. Se genera una vez y no se cambia: con otra llave, lo guardado no se descifra. Sin ella la app no arranca |
| `RUMBO_PG_POOL_MAX` | Opcional: cuántas conexiones abre cada instancia (cinco) |
| `RUMBO_DATA_DIR` | `/tmp/rumbo`: en Vercel el disco es de solo lectura salvo `/tmp`, y ahí deja sus correos el `DevMailer` mientras no haya Resend (se pierden; el enlace a la credencial se muestra en pantalla igual) |
| `RUMBO_DEPLOY_JSON` | `./deploy/testnet.json`: la copia de `contracts/rumbo-pass/deploy/testnet.json` que `pnpm build` arma con `scripts/copiar-despliegue.mjs`, porque con la carpeta raíz en `app/` lo de afuera no viaja. Hace falta para publicar eventos nuevos desde una plantilla |

`vercel.json` fija la región `pdx1` (Oregón), la misma de la base en Supabase (`us-west-2`), y el preset de Next.

1. **El proyecto.** Crear el proyecto en Supabase y copiar la cadena del pooler en modo transacción (Connect, Transaction pooler). Generar la llave con `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` y guardarla también en un gestor de contraseñas: si se pierde, las llaves de los QR y las cuentas guardadas no se recuperan.
2. **Migrar.** Desde `app/`: `DATABASE_URL=<la cadena> pnpm db:migrate`. Aplica lo que falte, en orden, y se puede correr las veces que haga falta. Deja el acceso por fila prendido en todas las tablas: por la API pública de Supabase no se ve nada, y la app entra como dueña de las tablas. Antes de desplegar un cambio que trae una migración nueva, se migra primero.
3. **Desplegar.** En el proyecto de Vercel de la app, con la carpeta raíz en `app`, cargar las variables para producción y desplegar. Al levantar, cada instancia comprueba `DATABASE_URL` y `RUMBO_DATA_KEY` (`src/instrumentation.ts`): si falta algo, no arranca y el registro dice qué.

Para probar el motor de producción en esta máquina, sin Supabase: `pnpm db:local` levanta un Postgres local (PGlite servido por la red) y dice su `DATABASE_URL`; después, `pnpm db:migrate` y `pnpm dev` con `RUMBO_REPO=postgres`, esa `DATABASE_URL` y una `RUMBO_DATA_KEY`.

## Cómo se escribe lo visible

Castellano con voseo e inglés en el mismo cambio. Sin tecnicismos en pantalla: se dice credencial, canje, vale, pase y cuenta. Una sola acción principal por pantalla, a la vista sin hacer scroll (el componente `Pantalla` la deja abajo, fija). Los estados siempre con palabra y color (`Chip`). Más en [docs/marca.md](../docs/marca.md).
