# Con qué se construye Rumbo

Qué piezas lleva, por qué esas y qué hace falta para levantarlo. El código está en `contracts/rumbo-pass` y en `app/`; lo que todavía no está, está marcado como por hacer.

## En una pantalla

| Capa | Qué hace | Con qué | Por qué eso |
|---|---|---|---|
| **El contrato** (Soroban, en Rust) | `buy` cobra en USDC y le paga a quien organiza en la misma operación, con la comisión separada; `check_in` una sola vez; `redeem(benefit)` una sola vez por persona y por beneficio; `attendees()` devuelve quiénes entraron. El cupo y los beneficios se fijan al crear el evento | Parte del pase de evento escrito en septiembre de 2026 para Stellar Elite Bolivia, con nueve pruebas y una corrida en la red de prueba. `soroban-sdk` 28 y `stellar-cli` 28 | Es la única pieza que garantiza "una sola vez" sin confiar en Rumbo, y ya se probó |
| **Las cuentas** | Entrar con Google o con el correo (hecho, con `RUMBO_ACCOUNTS=pollar`; falta probarlo con una cuenta de Google real); con una passkey, por hacer. Debajo hay una cuenta de Stellar propia que la persona nunca ve, con las comisiones de red patrocinadas para que nadie tenga que tener XLM; sin Pollar, la cuenta la crea el servidor en modo de prueba | Pollar (`@pollar/core`) para la cuenta con Google o con el correo, con el desafío firmado en el dispositivo (SEP-53) y la autorización del contrato firmada ahí; la cuenta patrocinadora de Rumbo manda y paga cada transacción; `passkey-kit` o `smart-account-kit` para las passkeys, por hacer | Es lo que la gente ya sabe usar, y lo que Stellar está empujando |
| **La app web** (castellano e inglés) | La página pública del evento, la inscripción gratis o paga, la credencial, el panel de quien organiza y el informe para quien auspicia | Next.js en Vercel, TypeScript, pnpm | Las páginas de evento se comparten: necesitan vista previa, buscadores y render del lado del servidor |
| **Los datos fuera de la cadena** | Eventos, personas (nombres y correos, que nunca van a la cadena), catálogo de beneficios, espejo de los canjes, informes | Supabase: Postgres, con los secretos cifrados (hoy; en desarrollo, SQLite). Realtime y Storage, por hacer | El panel consulta cada cinco segundos; Realtime lo alimentaría sin armar nada aparte |
| **El escáner** | La cámara del celular del voluntario, los tres veredictos (canjeado, ya canjeado, no corresponde), la cola local y la sincronización | Una página de la misma app, instalable (PWA): `jsqr`, IndexedDB para la cola y un Service Worker para abrir sin red | La fila no puede depender del wifi. Abajo está cómo se resuelve "una sola vez" sin conexión |
| **La credencial** | El QR en el celular, que rota cada 20 segundos, y la exportación en SVG para imprimir; el PDF, por hacer | Plantillas SVG propias y `qrcode-generator`; el PDF con `resvg` en una ruta del servidor, por hacer | Una plantilla SVG se adapta a cada evento sin diseñar de cero |
| **Los correos** | El enlace personal, el recordatorio, el resultado del sorteo. Por hacer: hoy el enlace queda en la pantalla de confirmación y, al importar una lista, se baja en CSV | Resend con dominio propio (SPF y DKIM), por hacer; la interfaz del correo ya está y dice cuando no hay con qué mandarlo | Para no caer en spam. Nunca llaves ni contraseñas en un correo |
| **Los pagos** | USDC de la red de prueba primero; mainnet y bolivianos por el QR del banco después | El contrato de USDC (SAC); una rampa con licencia para los bolivianos | Rumbo nunca custodia: `buy` reparte en la misma operación |
| **El sorteo** | Elegir entre quienes de verdad entraron, y que el premio entre a la credencial. Hoy: la lista de quienes entraron se congela con una huella SHA-256 y el algoritmo publicado; el premio en la credencial, por hacer | Tinkazo, como cualquier integrador, por hacer: recibe la lista y devuelve el comprobante | Son productos distintos: uno elige con justicia, el otro opera el evento |
| **Lo que se mide** | Credenciales, entradas y canjes, por evento y en total | Por evento, el panel y el informe, con el contraste del espejo contra la cadena. El total entre eventos, un script sobre la base y sobre los eventos del contrato, por hacer | Los números con sus transacciones, para quien auspicia y para quien evalúa |
| **El asistente** | Armar el evento desde una plantilla contándolo en palabras, cargar la lista, reenviar los enlaces y leer los números, el informe y la lista del sorteo desde el asistente que ya usa quien organiza | Un servidor MCP con las mismas funciones del servidor que usan las pantallas: por HTTP en la misma app, sin sesiones, y por stdio en la máquina de quien organiza, como puente hacia su propio Rumbo | Una sola lógica que mantener, y la clave de quien organiza viaja solo entre su máquina y su servidor |

## Las decisiones que importan

### Una sola vez, también sin conexión

El QR de la credencial va firmado con una llave pública (Ed25519). El servidor firma con la llave privada del evento, que nunca sale de la base, y el escáner recibe solo la clave pública al abrir el evento con red: con eso el celular del voluntario verifica solo que el QR es auténtico, sin red, y uno perdido no sirve para fabricar credenciales. En el celular de quien asiste el QR rota cada 20 segundos: la credencial recibe, al abrirse con conexión, una llave propia y un certificado que el evento firmó para ese pase, y arma sola el QR de cada ventana de tiempo, sin red; el escáner acepta la ventana actual, la anterior y la siguiente, así que una captura de pantalla vieja no sirve. La credencial impresa lleva un QR fijo, que el escáner acepta pero muestra como impresa. Si una credencial no se lee, la puerta tiene un respaldo manual: buscar a la persona por nombre o correo y marcarle la entrada, o inscribirla gratis en el momento. El canje se marca en la cola local y se muestra "canjeado" al instante. Cuando vuelve la red, la cola se vacía: primero al contrato (`redeem`, con la comisión patrocinada desde un relé del servidor, para no depender del celular), después al espejo en Supabase. Si dos voluntarios sin red canjearon el mismo beneficio a la misma persona, el contrato rechaza el segundo y el panel lo marca como "doble, revisar". La regla que lo evita casi siempre: cada beneficio se canjea en un solo puesto (el almuerzo en la mesa del almuerzo, la polera en el stand). El escáner lo recuerda y avisa si un voluntario intenta canjear un beneficio que no es de su puesto.

### Nada personal en la cadena

En el contrato viven direcciones, ids de beneficio y marcas de uso. Nombres, correos y lo que compró cada persona viven en Supabase, con acceso por fila. El informe para quien auspicia agrega números, nunca personas, salvo los contactos que cada persona aceptó compartir en ese stand.

### La comisión en la misma operación

`buy` recibe el precio en USDC y hace dos transferencias dentro de la misma invocación: la de quien organiza y la de Rumbo. No hay saldo de Rumbo esperando en ningún lado. El porcentaje es un parámetro del contrato de cada evento, visible para cualquiera.

### Red de prueba primero, y por qué sirve igual

En la red de prueba el vale no es plata, pero el almuerzo sí es real: el contrato garantiza "una sola vez" y quien auspicia ve los canjes. El reinicio de la red de prueba (16 de diciembre de 2026) borra el contrato y las cuentas: los eventos duran un día, así que basta con no programar eventos ese día ni el anterior, y los canjes quedan también en el espejo.

## Qué hace falta para levantarlo

- Node 24 y pnpm (la app usa la base SQLite que trae Node); Rust estable con `stellar-cli` para el contrato.
- Cuentas en Vercel, Supabase, Resend y Pollar, todas con plan gratis al principio.
- Un dominio propio para la app y para los correos.
- USDC de la red de prueba, desde el grifo de Stellar.
- Variables de entorno: la URL y la llave de Supabase, la llave de Resend, el id de la app en Pollar, el id del contrato y la red. Nunca en el repositorio.

## Lo que ya existe

- El contrato `rumbo-pass`, en la red de prueba, con 43 pruebas ([contracts/rumbo-pass](../contracts/rumbo-pass/README.md)). Partió del pase de evento de septiembre de 2026, vivo en la red de prueba: [stellar.expert](https://stellar.expert/explorer/testnet/contract/CDSXJR7MBV3ZLHLQPVTWZYVVP3CNABMGO6RRPLSI2KVFSJ2UX4SUD7DP). Cuatro pases comprados, tres entradas y el segundo intento de entrar rechazado.
- La app ([app/](../app/README.md)): la página del evento, la inscripción gratis o paga, la credencial con el QR que rota, el escáner sin conexión con su respaldo manual, el panel con el contraste contra la cadena, los stands con su ruta y la pantalla en vivo, la lista del sorteo con su huella, el informe (y el PDF y los certificados desde la consola), el kit con sus plantillas y la importación, y el servidor MCP. Las corridas del flujo entero en la red de prueba están en `app/demo/`.
- Entrar con Google o con el correo por Pollar, en el código, a falta de la prueba manual con una cuenta de Google real.
- La marca y la landing ([docs/marca.md](marca.md) y la carpeta `site/`).
- El lector de CSV, que viene del de Tinkazo.

## El orden de obra, en cuatro semanas

| Semana | Qué queda listo |
|---|---|
| 1 | El contrato con reparto, canjes, cupo y pruebas, corrido en la red de prueba. El andamiaje de la app, la base de datos y la página pública del evento |
| 2 | Las cuentas con Google y passkey con comisiones patrocinadas; la inscripción gratis y paga; el correo con el enlace; la credencial con QR y su exportación |
| 3 | El escáner con cola local y sincronización; el panel en vivo y el informe para quien auspicia; las métricas |
| 4 | El primer evento real, el kit abierto con su guía en castellano e inglés, y el segundo y el tercer evento |

## Riesgos y su cuidado

| Riesgo | Cuidado |
|---|---|
| Crear cientos de cuentas en un evento supera el límite de Pollar | Probar el límite en la red de prueba en la semana 2; plan B: `passkey-kit` con Channels |
| El `redeem` desde un celular sin XLM | Un relé del servidor paga la comisión (fee-bump) y la cuenta de la persona solo autoriza; si el relé falla, la cola espera y el canje ya quedó marcado en el celular |
| El reinicio de la red de prueba del 16 de diciembre | Ningún evento el 15 ni el 16; volver a desplegar esa noche; el espejo conserva la historia |
| Los planes gratis se quedan cortos en un evento de 500 personas | Medir en el primer evento; los planes pagos cuestan decenas de dólares al mes |
| Los correos caen en spam | Dominio propio con SPF y DKIM desde el primer día |
| Las credenciales impresas no se leen | Probar el QR impreso a 300 dpi antes de cada evento |
