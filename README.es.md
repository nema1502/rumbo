<div align="center">

# Rumbo

### Eventos de comunidad sobre Stellar. Inscribí gratis o cobrá entradas desde cualquier país, y operá todo tu evento desde un QR.

[![Hecho sobre Stellar](https://img.shields.io/badge/hecho%20sobre-Stellar-7b61ff?style=flat-square)](https://stellar.org)
[![Estado: MVP en testnet](https://img.shields.io/badge/estado-MVP%20en%20testnet-ffc629?style=flat-square)](#dónde-está)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-14b8a6?style=flat-square)](LICENSE)

**[rumbo-eventos.vercel.app](https://rumbo-eventos.vercel.app)** | [English](README.md) | [Qué hace](#qué-hace) | [Por qué Stellar](#por-qué-stellar) | [Dónde está](#dónde-está) | [En qué se distingue](#en-qué-se-distingue-rumbo) | [Para capítulos de Stellar](#para-capítulos-de-embajadores-de-stellar) | [Principios](#principios) | [Quiénes](#quiénes)

<img src="site/assets/og.png" alt="Rumbo: tu evento entero en un QR. Una credencial de muestra con su QR y sus beneficios." width="820">

</div>

---

Un evento de comunidad hoy son seis herramientas y una planilla. Las inscripciones viven en Luma. Las credenciales se hacen en Canva. Los vales del almuerzo son tickets de papel o una columna que alguien marca a mano. El merch se vende por mensajes de Instagram. Los premios son una foto. Y cuando el evento termina, el informe para quien auspicia se arma de memoria.

Encima, en buena parte del mundo quien organiza no puede cobrar entradas: las plataformas que ya usa piden una cuenta de Stripe, y Stripe no paga en su país. Bolivia es uno de esos países.

**Rumbo pone todo el evento en un solo lugar, y hace que quien organiza cobre en segundos desde cualquier país.** Las entradas se pagan en dólares digitales (USDC sobre Stellar) o, en Bolivia, con el QR del banco de quien compra, a través de un socio con licencia. Cada asistente recibe una credencial con QR. Los voluntarios la escanean para hacer el check-in y para entregar lo que le toca a cada persona: el almuerzo, una polera, un premio. Cada canje ocurre una sola vez, y quien auspicia ve exactamente qué se entregó.

Rumbo está pensado para eventos de 80 a 500 personas con auspiciantes y varios beneficios: hackatones, DevFests, congresos de comunidad, bootcamps, meetups de capítulos. Se hace en Bolivia, en castellano y en inglés desde el primer día, por gente que organiza esos eventos.

## Qué hace

**Para quien organiza**

1. Armá el evento con un formulario, o describilo en una frase y aprobá lo que Rumbo te propone: tipos de entrada, beneficios, el diseño de la credencial, el correo de bienvenida.
2. Publicá la página del evento, con inscripción gratis o paga. La lista de Luma se importa como CSV.
3. Cobrá en USDC desde cualquier país, o en bolivianos con el QR del banco a través de una rampa con licencia. La plata llega a quien organiza en la misma operación que separa la comisión de Rumbo. Rumbo nunca tiene la plata.
4. Si querés, pago protegido: la entrada queda en un contrato hasta que el evento ocurre, y si se cancela el reembolso sale solo.
5. Exportá las credenciales en SVG o PDF para imprimir, o dejalas en el celular de cada persona.
6. El día del evento, tus voluntarios escanean con el celular. El escáner funciona sin conexión y sincroniza después: la fila nunca espera a la red.
7. Al final, un panel en vivo y un informe para cada auspiciante: "300 cafés canjeados, 12 premios entregados con prueba".

**Para quien asiste**

- Se inscribe con Google o con una passkey. Debajo se le crea una cuenta de Stellar sin que tenga que saberlo.
- Recibe un correo con un enlace personal. Nunca llaves ni contraseñas.
- Tiene su credencial en el celular y ve lo que le toca: "almuerzo del sábado: pendiente", "polera M: pagada, para retirar", "premio del sorteo: unos auriculares".

**Para quien hace de voluntario**

- Escanea el QR, ve qué le toca a esa persona y marca el canje. No se puede repetir. Sin cuenta y sin entrenamiento.

**Para quien auspicia**

- Pone beneficios ("un café para cada asistente") y ve cuántos se canjearon.
- Se queda con el contacto de quienes aceptan compartirlo al escanearlos en su stand.
- Recibe el informe.

## En qué se distingue Rumbo

La inscripción gratis ya está resuelta: Luma, Bevy y un formulario la hacen bien. Rumbo empieza después de la entrada.

- **Cada credencial dice qué le toca a esa persona:** el almuerzo, la polera, el premio. Quien es voluntario canjea cada cosa una sola vez desde su propio celular, aunque no haya conexión.
- **El sorteo es solo entre quienes entraron.**
- **Quien auspicia recibe el informe de lo que de verdad se entregó,** sin nombres ni correos, y los contactos del stand solo con el permiso de cada persona.
- **Quien organiza cobra donde Stripe no opera** (en Latinoamérica solo está en Brasil y México), en USDC o, en Bolivia, en bolivianos con el QR del banco por una rampa con licencia, con la comisión separada en la misma operación.

Las comunidades de tecnología muchas veces terminan armando su propio software, o usando manillas y tickets de papel, para manejar el almuerzo, el swag y los premios de sus eventos. Rumbo es ese kit, ya hecho, de código abierto, con una API y un servidor MCP para que cada comunidad construya encima. [Stellar Passport](https://stellarpassport.xyz), que convierte la asistencia en sellos, es un complemento natural: el check-in de Rumbo podría darle un sello de Passport.

## Para capítulos de embajadores de Stellar

El [programa de embajadores de Stellar](https://stellar.gitbook.io/ambassador-program/resources/terms-and-conditions/goals-and-reporting) cuenta un evento cuando tiene al menos veinte asistentes verificados y veinte minutos de contenido de Stellar, documentados para los reportes del mes y del trimestre, y el presupuesto de un capítulo se puede reducir cuando ese reporte queda incompleto. Rumbo arma esa documentación mientras opera el evento:

- **La asistencia verificada:** cada entrada en la puerta es una transacción en Stellar con su hora, así que cualquiera puede comprobar la cuenta, sin nombres en la cadena.
- **La comida por persona:** el canje del almuerzo dice cuántos comieron, frente al tope por persona del programa.
- **El paquete para el reporte:** al terminar, `pnpm paquete-embajadores` escribe el informe del evento en PDF, un CSV con los números que pide el reporte del mes, los contactos de quienes aceptaron que el capítulo les escriba, y un sí o un no por cada requisito. Cada asistente puede recibir además un certificado con un QR que abre una página pública de verificación.

El programa le pasa su plantilla oficial de documentación a cada capítulo; el paquete se va a ajustar a ella en cuanto un capítulo la comparta.

## Por qué Stellar

Para contar almuerzos alcanza una base de datos. Stellar suma lo que una base de datos no puede:

- **Cobrar desde cualquier país en segundos,** aunque los procesadores de tarjeta no paguen ahí. Una sola operación le paga a quien organiza y separa la comisión, sin que nadie tenga la plata en el medio.
- **Pagos protegidos** que se devuelven solos si el evento se cancela.
- **Vales que se usan una sola vez,** y premios entregados con una prueba que no depende de Rumbo. En testnet el vale no es plata, pero el almuerzo sí es real: una comunidad puede operar eventos reales en Rumbo desde hoy, sin plata en riesgo.
- **Cada asistente sale con una cuenta de Stellar** que le sirve en el próximo evento, creada con Google o con una passkey, con las comisiones de red patrocinadas para que nadie tenga que tener XLM.
- **Pagos a oradores y voluntarios** en cualquier país.
- **Pagar en tu moneda.** En Bolivia, con el QR del banco por medio de una rampa con licencia; quien organiza recibe USDC al momento. Sin Stripe, sin pasarela local, sin papeles.
- **Una API, webhooks y un servidor MCP,** gratis para tus propios eventos. Las plataformas y agentes que crean eventos a volumen pagan por uso, con x402.

Rumbo no es una entrada NFT ni un lugar para especular con la reventa. Si quien organiza la permite, la reventa va al precio original.

## Con Tinkazo

[Tinkazo](https://tinkazo.app) hace sorteos que cualquiera puede comprobar desde su celular. Rumbo y Tinkazo son productos distintos que encajan: Tinkazo decide quién gana, Rumbo entrega lo que se ganó y opera todo lo demás del evento. El premio de un sorteo de Tinkazo entra a la credencial de quien ganó, el sorteo se hace sobre quienes de verdad hicieron el check-in, y participar en el sorteo es gratis siempre, sea el evento pago o no.

## Dónde está

La primera columna de la tabla de abajo está hecha y corre en la red de prueba de Stellar: el [contrato rumbo-pass](contracts/rumbo-pass/README.md) (pase gratis o pago con el reparto en la misma operación, una entrada y un canje por beneficio, con 43 pruebas) y la [app](app/README.md) (la página del evento, la inscripción, la credencial con un QR firmado con Ed25519 que cambia cada 20 segundos, el escáner sin conexión con un respaldo manual en la puerta, el panel de quien organiza, los stands de quien auspicia con su ruta y su pantalla en vivo, el informe del evento en PDF con certificados verificables, y el kit: plantillas para un DevFest, un Build with AI, un Día de la Mujer, una hackatón, un meetup o un taller, e importar la lista desde Luma o Bevy). Las cuentas las crea el servidor en modo de prueba; entrar con Google o con una passkey viene después. El flujo entero, corrido en la red de prueba con los ids de sus transacciones, está en [app/demo/e2e-testnet.txt](app/demo/e2e-testnet.txt), y el contrato del evento pago se puede mirar en [stellar.expert](https://stellar.expert/explorer/testnet/contract/CBDYAZRXJCCDTKMJ5D3IG6M2YD6PFR2KOL5ETZOIU2CY4DJDDVARZWKA).

En [un video de un minuto](site/assets/mvp-es.mp4) se ve el MVP real andando en la red de prueba, sin maquetas: la inscripción gratis, la credencial con su QR que cambia, la cámara del voluntario leyendo ese QR en la puerta, el canje sin conexión que se sincroniza solo al volver la red, el panel y la transacción de la inscripción en stellar.expert (lo graba [app/scripts/grabar-recorrido.mjs](app/scripts/grabar-recorrido.mjs)).

Sin instalar nada: la [landing](https://rumbo-eventos.vercel.app) con una animación de 31 segundos del flujo entero, y una [demo clickeable](https://rumbo-eventos.vercel.app/#probar) donde te inscribís, recibís la credencial, la escaneás como voluntario (también sin conexión) y hacés el sorteo como organizador.

El contrato partió de un [pase de evento](https://stellar.expert/explorer/testnet/contract/CDSXJR7MBV3ZLHLQPVTWZYVVP3CNABMGO6RRPLSI2KVFSJ2UX4SUD7DP) escrito en septiembre de 2026 para Stellar Elite Bolivia: comprar el pase, entrar una sola vez, listar quiénes vinieron. Rumbo lo extiende con beneficios, canjes y, más adelante, pagos protegidos.

| Hecho, en la red de prueba | Lo que sigue | Más adelante |
|---|---|---|
| Página del evento con inscripción gratis o paga (USDC de prueba), armada desde una plantilla | Cuenta con Google o passkey, con comisiones patrocinadas | Pagos con el QR del banco en bolivianos, en mainnet |
| Credencial firmada, con un QR que cambia cada 20 segundos, en el celular y para imprimir | Pago protegido con reembolso automático | Reventa al precio original |
| Escáner sin conexión para la puerta, cada comida y cada stand, con respaldo manual en la puerta | El premio de un sorteo de Tinkazo entrando a la credencial | API pagada por uso con x402 |
| Panel de quien organiza, informe para quien auspicia, informe del evento en PDF y certificados verificables | Describir el evento en una frase y aprobar la propuesta | Pagos a oradores |
| Importar de Luma y de Bevy, tipos de credencial (oradores, mentoría, jurado, voluntariado) y equipos | Credencial en Apple y Google Wallet | Licencias para redes de comunidades |

## Cómo está hecho

Un contrato en Soroban para pases y vales, una app en Next.js con Supabase debajo, cuentas creadas con Google o con una passkey con las comisiones de red patrocinadas, y un escáner que funciona sin conexión y sincroniza después. Las piezas, las decisiones y el orden de obra en cuatro semanas están en [docs/stack.md](docs/stack.md). El código vive en [contracts/rumbo-pass](contracts/rumbo-pass/README.md) y en [app](app/README.md), cada uno con su guía.

## Principios

- **Sin custodia.** La plata va directo a quien organiza o queda en el contrato de un pago protegido. Rumbo nunca la tiene.
- **Sin rampa propia.** Los bolivianos los convierte quien tiene la licencia.
- **Sin datos personales en la cadena.** Los nombres y los correos quedan fuera del ledger y se usan solo para avisar. Los contactos del stand se comparten solo si la persona acepta, en ese stand.
- **Los eventos gratis son gratis.** La comisión aparece cuando hay plata de por medio.
- **Sin tecnicismos en la pantalla.** Nadie en la puerta tiene que saber que abajo hay una blockchain.
- **Núcleo abierto, servicio alojado.** El contrato de canjes, el escáner y la plantilla del evento son de código abierto con licencia MIT, para que cualquier comunidad los use y los adapte. El servicio alojado (el armado del evento, los correos, el panel en tiempo real, los pagos y los informes) es lo que Rumbo cobra.

## Quiénes

Rumbo se hace en Santa Cruz de la Sierra, Bolivia. Lo fundan [Nicolás Emir Mejía Agreda](https://github.com/nema1502), producto y contratos, y [Guido Salazar](https://github.com/GuidoSV7), desarrollo full stack.

Preguntas e ideas: abrí un issue.

## Licencia

[MIT](LICENSE).
