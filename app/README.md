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
- **La base es un archivo SQLite** (`data/rumbo.db`) y **los correos se escriben a disco** (`data/correos/`) en vez de mandarse. Supabase y Resend quedan como interfaces con su esqueleto, por hacer.
- **El panel se abre con una clave por evento** en vez de una cuenta de organizador.

Nada de `data/` ni de `.env.local` se versiona.

## El recorrido

| Pantalla | Qué hace |
|---|---|
| `/` | La lista de eventos |
| `/e/<evento>` | El afiche y las entradas, cada una con su único botón |
| `/e/<evento>/inscripcion?entrada=<id>` | Nombre y correo, y una sola acción: "Confirmar inscripción" o "Pagar 10 USDC de prueba" |
| `/e/<evento>/listo?pase=<id>&k=<clave>` | "Inscripción lista" o "Entrada paga", y el enlace a la credencial |
| `/p/<pase>?k=<clave>` | La credencial: el QR, el nombre, "Credencial N de M", el estado y lo que le toca a la persona. "Descargar en SVG" baja la versión para imprimir |
| `/scan` | El escáner del voluntario: el código del puesto, la cámara, los tres veredictos, la cola local. Instalable, funciona sin red |
| `/admin/<evento>` | El panel de quien organiza: contadores en vivo, códigos de puesto, pases, dobles, CSV y el contraste con la cadena |
| `/admin/<evento>/informe` | El informe para quien auspicia: números, nunca personas, con hoja de impresión |

Cada parte tiene su guía: [la inscripción y la credencial](src/server/evento/README.md), [el escáner](src/app/scan/README.md) y [el panel](src/app/admin/README.md). La API:

| Ruta | Qué hace |
|---|---|
| `GET /api/evento/<evento>` | Lo público del evento, sus entradas y su catálogo de beneficios |
| `POST /api/evento/<evento>/inscripcion` | Inscribe o cobra, igual que el formulario |
| `GET /api/pase/<pase>?k=<clave>` y `/svg` | La credencial como datos, y para imprimir |
| `POST /api/scan/open` y `/api/scan/sync` | El escáner: abrir el puesto con su código, y subir la cola |
| `GET /api/admin/<evento>` y `/csv`, `POST .../cadena`, `.../entrar`, `.../salir` | El panel: el estado en JSON, la lista en CSV, el contraste con la cadena y la sesión |

## Probarlo

```bash
pnpm typecheck                     # TypeScript estricto, sin errores
pnpm test                          # las pruebas sin red (tests/*.test.mjs, con node --test): cada una con su base propia y vacía
pnpm build                         # la app entera compila
pnpm e2e                           # el flujo entero contra la red de prueba, con su propio servidor (abajo)
node scripts/inscribir-prueba.mjs [--pago] [--api http://localhost:3000]   # una inscripción, con todas sus comprobaciones
node scripts/prueba-escaner.mjs --base http://localhost:3000               # el escáner en Chrome sin interfaz, con y sin red
node scripts/smoke-contrato.mjs    # los helpers del contrato, de punta a punta
node scripts/capturas.mjs --base http://localhost:3000 --salida data/capturas   # cada pantalla en tres tamaños y dos idiomas
```

`pnpm e2e` (`scripts/e2e-testnet.mjs`) levanta un servidor de desarrollo propio sobre una base nueva en `data/e2e`, crea el evento de muestra, inscribe a una persona gratis y a otra con la entrada paga (y comprueba que la plata llegó a quien organiza y a Rumbo en la misma transacción), abre sus credenciales, las pasa por la puerta y por la mesa del almuerzo con la API del escáner, intenta el segundo canje y la segunda entrada, y comprueba con `status()`, `attendees()` e `info()` en la cadena y con el panel, el informe y el CSV que los números coinciden. Deja la transcripción con los ids de las transacciones en [demo/e2e-testnet.txt](demo/e2e-testnet.txt). Con `--base` usa un servidor ya levantado. El contrato tiene sus propias pruebas: `cargo test --workspace` desde la raíz del repositorio.

## Cómo está armada

```
src/app/            las páginas: / , /e/[slug] (el evento), /p/[passId] (la credencial), /scan (el escáner), /admin/[slug] (el panel)
src/app/api/        las rutas de la API: evento, pase, scan, admin
src/app/globals.css los tokens de la marca (día y noche) y los componentes base
src/components/     Marca, SelectorIdioma, BotonTema, ui.tsx (Boton, BotonEnlace, Tarjeta, Chip, Campo, Pantalla, Aviso) y los de cada área: evento/, escaner/, panel/
src/i18n/           los diccionarios por área (comun, evento, escaner, panel) y el helper t(clave)
src/server/         lo que corre solo en el servidor: repo, accounts, stellar, mailer, qr, env, evento/, escaner, panel
src/lib/            lo que comparten servidor y navegador: la forma del QR y su verificación, el veredicto del escáner, la cola local, los códigos de puesto
public/             el service worker del escáner (sw.js) y su manifiesto
scripts/            setup-dev, seed, e2e-testnet, capturas, las pruebas de cada área y lib/ (env, browser)
demo/               la transcripción del flujo entero en la red de prueba
```

### El idioma

Castellano por defecto, inglés con `?lang=en`. El middleware (`src/middleware.ts`) lee `?lang=`, lo recuerda en la cookie `rumbo.lang` y se lo pasa al servidor en una cabecera.

- En un componente de servidor: `const t = await getT()` (de `@/i18n/server.ts`) y `t("inicio.titulo")`.
- En un componente de cliente: `const t = useT()` (de `@/i18n/client.tsx`).
- Los textos con huecos: `t("pago.precio", { monto: 10 })`.

Cada área tiene su diccionario en `src/i18n/`: `comun.ts` (lo general), `evento.ts`, `escaner.ts` y `panel.ts`, con el prefijo de su área en las claves y los dos idiomas en el mismo cambio. `index.ts` los une.

### Los datos: `src/server/repo.ts`

`Repo` es la interfaz; `getRepo()` da la instancia (`SqliteRepo` hoy, `SupabaseRepo` es un esqueleto). Las tablas están en `src/server/migrations/` (`001-inicial.sql` lo general, `002-acceso-credencial.sql` las claves de acceso de las credenciales, `003-panel.sql` las del panel); las migraciones se aplican solas al abrir la base.

- **Eventos**, con su llave para firmar los QR (`getEventQrKey`, nunca al navegador de quien asiste).
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
- `submitSponsored(tx, signers)` es la pieza de abajo: simula, firma las autorizaciones, arma la transacción con la comisión de la simulación, la firma con la patrocinadora y espera el resultado. Todo lo que manda la patrocinadora pasa por `withSponsorLock`, de a una, porque comparten el número de secuencia. El SDK de Stellar queda fuera del bundle del servidor (`serverExternalPackages` en `next.config.ts`): adentro se duplicaban los tipos XDR y firmar una autorización fallaba.

### El QR: `src/server/qr.ts` y `src/lib/qr-verify.ts`

El QR de la credencial lleva `<passId>.<firma>`: ocho letras y números del pase, un punto, y la firma (los primeros 10 bytes del HMAC-SHA256 del id con la llave del evento, en base32, dieciséis letras). Todo en mayúsculas para que el QR salga chico.

- Servidor: `buildQrPayload(passId, key)` y `verifyQrPayload(payload, key)`; `newPassId()` y `newEventQrKey()`.
- Navegador (el escáner, sin red): `importQrKey(key)` y `verifyQrPayloadInBrowser(payload, cryptoKey)` con WebCrypto. La llave viaja al escáner en base64url cuando abre el puesto con su código.
- `src/lib/qr-svg.ts`: `renderQrSvg(payload)` dibuja el QR como SVG, para la credencial y su exportación.

### Los correos: `src/server/mailer.ts`

`Mailer.send({ to, subject, text, html? })`. `DevMailer` escribe cada correo en `data/correos/` y lo imprime en la consola; `ResendMailer` es un esqueleto. Nunca llaves ni contraseñas en un correo.

## Las variables

Están todas en [`.env.example`](.env.example), con lo que hace cada una. Las llaves secretas viven en `.env.local` y nunca se versionan. Las cuentas son las mismas que usa el despliegue del contrato ([contracts/rumbo-pass](../contracts/rumbo-pass/README.md)): `STELLAR_SPONSOR_SECRET`, `STELLAR_GATE_SECRET`, `STELLAR_ISSUER_SECRET`, `STELLAR_ORGANIZER_SECRET` y `STELLAR_TREASURY_SECRET`. `RUMBO_DATA_DIR` cambia la carpeta de la base y los correos (los scripts de prueba la usan para no mezclar datos).

## Cómo se escribe lo visible

Castellano con voseo e inglés en el mismo cambio. Sin tecnicismos en pantalla: se dice credencial, canje, vale, pase y cuenta. Una sola acción principal por pantalla, a la vista sin hacer scroll (el componente `Pantalla` la deja abajo, fija). Los estados siempre con palabra y color (`Chip`). Más en [docs/marca.md](../docs/marca.md).
