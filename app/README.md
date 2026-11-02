# La app de Rumbo

La página pública del evento, la inscripción gratis o la entrada paga, la credencial con QR, el escáner del voluntario y el panel de quien organiza. Next.js 15 con TypeScript, CSS propio con la marca ([docs/marca.md](../docs/marca.md)) y la red de prueba de Stellar debajo. La arquitectura está en [docs/stack.md](../docs/stack.md).

## Levantarla

Hace falta Node 24 o más nuevo (trae `node:sqlite`), pnpm y, para desplegar el activo de prueba si no está, `stellar-cli`.

```bash
cd app
pnpm install
pnpm setup:dev     # las llaves del servidor en .env.local, fondeadas con friendbot; el USDC de prueba y su contrato
pnpm seed          # el evento de muestra, "Hackatón de la comunidad", con sus entradas y beneficios
pnpm dev           # http://localhost:3000
```

Los dos scripts se pueden correr las veces que haga falta: solo hacen lo que falta. `pnpm seed -- --demo` agrega además a una persona de ejemplo con su pase, su cuenta de prueba y su inscripción en el contrato (toca la red: tarda unos segundos). `node scripts/smoke-contrato.mjs` prueba los helpers del contrato de punta a punta en la red de prueba.

Todo corre contra la red de prueba de Stellar y contra una base SQLite local (`app/data/rumbo.db`, fuera de git). Si `STELLAR_NETWORK` dice otra cosa, el servidor no arranca ninguna operación.

## Cómo está armada

```
src/app/            las páginas: / (eventos), /e/[slug] (el evento), /scan (el escáner), /admin/[slug] (el panel)
src/app/globals.css los tokens de la marca (día y noche) y los componentes base
src/components/     Marca, SelectorIdioma, BotonTema y ui.tsx (Boton, BotonEnlace, Tarjeta, Chip, Campo, Pantalla, Aviso)
src/i18n/           los diccionarios por área y el helper t(clave)
src/server/         lo que corre solo en el servidor: repo, accounts, stellar, mailer, qr, env
src/lib/            lo que comparten servidor y navegador: la forma del QR y su verificación con WebCrypto
scripts/            setup-dev, seed, smoke-contrato y lib/ (env, browser)
```

### El idioma

Castellano por defecto, inglés con `?lang=en`. El middleware (`src/middleware.ts`) lee `?lang=`, lo recuerda en la cookie `rumbo.lang` y se lo pasa al servidor en una cabecera.

- En un componente de servidor: `const t = await getT()` (de `@/i18n/server.ts`) y `t("inicio.titulo")`.
- En un componente de cliente: `const t = useT()` (de `@/i18n/client.tsx`).
- Los textos con huecos: `t("pago.precio", { monto: 10 })`.

Cada área tiene su diccionario en `src/i18n/`: `comun.ts` (lo general), `evento.ts`, `escaner.ts` y `panel.ts`. Cada frente llena solo el suyo, con el prefijo de su área en las claves y los dos idiomas en el mismo cambio. `index.ts` los une.

### Los datos: `src/server/repo.ts`

`Repo` es la interfaz; `getRepo()` da la instancia (`SqliteRepo` hoy, `SupabaseRepo` es un esqueleto con TODO). Las tablas están en `src/server/migrations/001-inicial.sql`; las migraciones se aplican solas al abrir la base.

- **Eventos**, con su llave para firmar los QR (`getEventQrKey`, nunca al navegador de quien asiste).
- **Tipos de entrada**: cada uno con su precio en USDC de prueba y su contrato en la red (el precio es fijo por contrato: el evento de muestra tiene uno gratis y uno pago).
- **Beneficios**: el catálogo del evento, y qué trae cada tipo de entrada con el número con que se canjea en su contrato (`linkBenefit`, `listTicketTypeBenefits`).
- **Personas** (nombre y correo, nunca en la cadena), **pases** (id de ocho letras y números, cuenta, estado `pending`, `active` o `checked_in`, la transacción y el número de pase del contrato) y los beneficios de cada pase.
- **Check-ins y canjes**: el espejo de la cadena, con `synced` (ya llegó al contrato), `duplicate` (el contrato lo rechazó por repetido, "doble, revisar") y `clientId` (el id de la cola del escáner: reintentar no duplica).
- **Cuentas de desarrollo**: solo red de prueba, ver abajo.
- `getEventStats(eventId)`: los números para el panel y para quien auspicia.

### Las cuentas: `src/server/accounts.ts`

`AccountProvider` es la interfaz: `getOrCreateForPerson(personId)` devuelve la cuenta de Stellar de la persona (clave pública), `authSigner(personId)` da quien firma por ella lo que el contrato le pide, y `signAndSubmit(personId, tx)` firma y manda con la comisión patrocinada.

`DevAccountProvider` es la de hoy y es **solo para la red de prueba**: el servidor crea la cuenta, la fondea con friendbot, le agrega la línea de confianza al USDC de prueba, le pide al emisor un saldo inicial (`RUMBO_INITIAL_TEST_USDC`) y guarda la llave secreta en la base local. La interfaz lo dice: "Modo de prueba: la cuenta la guarda el servidor; en producción es tuya, con Google o con una passkey" (`t("cuenta.modoPrueba")`). `PollarAccountProvider` y `PasskeyAccountProvider` son esqueletos con TODO.

### La red: `src/server/stellar.ts`

- `getRpc()`, `getHorizon()`, `getSponsor()` (paga las comisiones de todo), `getGate()` (firma check-ins y canjes), `fundWithFriendbot(publicKey)`.
- `readDeployInfo()` lee `contracts/rumbo-pass/deploy/testnet.json`: el activo de prueba, las cuentas y los contratos desplegados (`events.free`, `events.paid`). `getTestAsset()` da el USDC de prueba; `resolveContractId("free" | "paid")` el contrato de muestra.
- `rumboPass`: `register(contractId, attendee, signer)`, `buy(contractId, buyer, signer)`, `checkIn(contractId, attendee)` (lo marca la puerta), `redeem(contractId, attendee, benefit)`, `status(contractId, who)`, `attendees(contractId)` e `info(contractId)`. Las dos primeras las firma la persona (`AuthSigner`, de `accounts.authSigner(personId)` o `keypairSigner(keypair)`), la paga el servidor; las dos siguientes las firma la puerta.
- Los errores del contrato llegan como `ContractError`, con `code` y `errorName` (`AlreadyCheckedIn`, `AlreadyRedeemed`, `NotCheckedIn`...). `isContractError(error, "AlreadyRedeemed")` y `isAlreadyDone(error)` son los que marcan "doble" en el espejo.
- `submitSponsored(tx, signers)` es la pieza de abajo: simula, firma las autorizaciones, arma la transacción con la comisión de la simulación, la firma con la patrocinadora y espera el resultado. Todo lo que manda la patrocinadora pasa por `withSponsorLock`, de a una, porque comparten el número de secuencia.

### El QR: `src/server/qr.ts` y `src/lib/qr-verify.ts`

El QR de la credencial lleva `<passId>.<firma>`: ocho letras y números del pase, un punto, y la firma (los primeros 10 bytes del HMAC-SHA256 del id con la llave del evento, en base32, dieciséis letras). Todo en mayúsculas para que el QR salga chico.

- Servidor: `buildQrPayload(passId, key)` y `verifyQrPayload(payload, key)`; `newPassId()` y `newEventQrKey()`.
- Navegador (el escáner, sin red): `importQrKey(key)` y `verifyQrPayloadInBrowser(payload, cryptoKey)` con WebCrypto. La llave viaja al escáner en base64url (`bytesToBase64url`).
- `src/lib/qr-svg.ts`: `renderQrSvg(payload)` dibuja el QR como SVG, para la credencial y su exportación.

### Los correos: `src/server/mailer.ts`

`Mailer.send({ to, subject, text, html? })`. `DevMailer` escribe cada correo en `app/data/correos/` y lo imprime en la consola; `ResendMailer` es un esqueleto con TODO. Nunca llaves ni contraseñas en un correo.

## Las variables

Están todas en [`.env.example`](.env.example), con lo que hace cada una. Las llaves secretas viven en `.env.local` y nunca se versionan. Las cuentas son las mismas que usa el despliegue del contrato ([contracts/rumbo-pass](../contracts/rumbo-pass)): `STELLAR_SPONSOR_SECRET`, `STELLAR_GATE_SECRET`, `STELLAR_ISSUER_SECRET`, `STELLAR_ORGANIZER_SECRET` y `STELLAR_TREASURY_SECRET`.

## Cómo se escribe lo visible

Castellano con voseo e inglés en el mismo cambio. Sin tecnicismos en pantalla: se dice credencial, canje, vale, pase y cuenta. Una sola acción principal por pantalla, a la vista sin hacer scroll (el componente `Pantalla` la deja abajo, fija). Los estados siempre con palabra y color (`Chip`). Más en [docs/marca.md](../docs/marca.md).
