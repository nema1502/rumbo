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

**Rumbo pone todo el evento en un solo lugar, y hace que quien organiza cobre en segundos desde cualquier país.** Las entradas se pagan en dólares digitales (USDC sobre Stellar) y, después, en Bolivia, con el QR del banco de quien compra, a través de un socio con licencia. Cada asistente recibe una credencial con QR. Los voluntarios la escanean para hacer el check-in y para entregar lo que le toca a cada persona: el almuerzo, una polera, un premio. Cada canje ocurre una sola vez, y quien auspicia ve exactamente qué se entregó.

Rumbo está pensado para eventos de 80 a 500 personas con auspiciantes y varios beneficios: hackatones, DevFests, congresos de comunidad, bootcamps, meetups de capítulos. Se hace en Bolivia, en castellano y en inglés desde el primer día, por gente que organiza esos eventos.

## Qué hace

Esto es el producto entero. La tabla de [Dónde está](#dónde-está) dice qué está hecho hoy y qué sigue.

**Para quien organiza**

1. Armá el evento con un formulario, o contáselo en palabras al asistente que ya usás (por MCP) y aprobá el borrador que Rumbo te propone: tipos de credencial, beneficios, puestos del escáner y topes.
2. Publicá la página del evento, con inscripción gratis o paga. La lista de Luma o de Bevy se importa como CSV, a las entradas gratis: cada credencial queda lista al momento, y los enlaces personales se bajan en un CSV para mandarlos a mano hasta que exista el servicio de correo.
3. Cobrá en USDC desde cualquier país o, después, en bolivianos con el QR del banco a través de una rampa con licencia. La plata llega a quien organiza (en la red de prueba, a una cuenta de organizador de muestra) en la misma operación que separa la comisión de Rumbo. Rumbo nunca tiene la plata.
4. Después, el pago protegido opcional: la entrada va a quedar en un contrato hasta que el evento ocurra, y si se cancela el reembolso va a salir solo.
5. Descargá cada credencial en SVG para imprimir (el PDF y la impresión en tanda vienen después), o dejala en el celular de cada persona.
6. El día del evento, tus voluntarios escanean con el celular. El escáner funciona sin conexión y sincroniza después: la fila nunca espera a la red.
7. Al final, un panel en vivo y un informe para cada auspiciante: "300 cafés canjeados, 12 premios entregados".

**Para quien asiste**

- Se inscribe con Google o con su correo, sin contraseña nueva (las passkeys vienen después). Debajo se le crea una cuenta de Stellar propia sin que tenga que saberlo.
- Recibe un enlace personal a su credencial en la pantalla de confirmación; el correo con ese enlace viene después. Nunca llaves ni contraseñas.
- Tiene su credencial en el celular y ve lo que le toca: "almuerzo: pendiente", "polera M: pagada, para retirar", "premio de la ruta de stands: ganado".

**Para quien hace de voluntario**

- Escanea el QR, ve qué le toca a esa persona y marca el canje. Queda anotado una sola vez en la cadena; si dos celulares estaban sin red, el segundo queda marcado para revisar. Sin cuenta y sin entrenamiento.

**Para quien auspicia**

- Pone beneficios ("un café para cada asistente") y ve cuántos se canjearon.
- Se queda con el contacto de quienes aceptan compartirlo al escanearlos en su stand.
- Entra en la ruta de stands: quien visita la cantidad acordada de stands recibe el premio de la ruta en su credencial y lo retira en el puesto de premios.
- Recibe el informe.

## En qué se distingue Rumbo

La inscripción gratis ya está resuelta: Luma, Bevy y un formulario la hacen bien. Rumbo empieza después de la entrada.

- **Cada credencial dice qué le toca a esa persona:** el almuerzo, la polera, el premio. Quien es voluntario canjea cada cosa desde su propio celular, aunque no haya conexión; cada canje de un beneficio queda anotado una sola vez en la cadena.
- **La lista del sorteo es solo de quienes entraron.**
- **Quien auspicia recibe el informe de lo que de verdad se entregó,** sin nombres ni correos, y los contactos del stand solo con el permiso de cada persona.
- **Quien organiza cobra donde Stripe no opera** (en Latinoamérica solo está en Brasil y México), en USDC o, después, en bolivianos con el QR del banco por una rampa con licencia, con la comisión separada en la misma operación.

Las comunidades de tecnología muchas veces terminan armando su propio software, o usando manillas y tickets de papel, para manejar el almuerzo, el swag y los premios de sus eventos. Rumbo es ese kit, ya armado, de código abierto, con una API y un servidor MCP para que cada comunidad construya encima. [Stellar Passport](https://stellarpassport.xyz), que convierte la asistencia en sellos, es un complemento natural: el check-in de Rumbo podría darle un sello de Passport.

## Para capítulos de embajadores de Stellar

El [programa de embajadores de Stellar](https://stellar.gitbook.io/ambassador-program/resources/terms-and-conditions/goals-and-reporting) cuenta un evento cuando tiene al menos veinte asistentes verificados y veinte minutos de contenido de Stellar, documentados para los reportes del mes y del trimestre, y el presupuesto de un capítulo se puede reducir cuando ese reporte queda incompleto. Rumbo arma esa documentación mientras opera el evento:

- **La asistencia verificada:** cada entrada en la puerta es una transacción en Stellar, con la hora en que llegó a la cadena, así que cualquiera puede comprobar la cuenta, sin nombres en la cadena. La cuenta deja afuera a oradores, voluntarios y organización, como pide el programa.
- **La comida por persona:** con el gasto que informa quien organiza, Rumbo lo divide entre quienes entraron y lo compara con el tope por persona del programa; el canje del almuerzo dice cuántos comieron de verdad.
- **El paquete para el reporte:** al terminar, `pnpm paquete-embajadores` (en la máquina de quien organiza; necesita XeLaTeX) escribe el informe del evento en PDF, un CSV con la asistencia, los minutos y los enlaces para el reporte del mes, los contactos de quienes aceptaron que el capítulo les escriba, y un sí o un no por cada requisito. Cada asistente puede recibir además un certificado con un QR que abre una página pública de verificación.

El programa le pasa su plantilla oficial de documentación a cada capítulo; el paquete se va a ajustar a ella en cuanto un capítulo la comparta.

## Por qué Stellar

Para contar almuerzos alcanza una base de datos. Stellar suma lo que una base de datos no puede:

- **Cobrar desde cualquier país en segundos,** aunque los procesadores de tarjeta no paguen ahí. Una sola operación le paga a quien organiza y separa la comisión, sin que nadie tenga la plata en el medio.
- **Pagos protegidos** (vienen después) que se van a devolver solos si el evento se cancela.
- **Vales que se usan una sola vez,** con cada canje de un beneficio anotado en la cadena, no en una base que alguien pueda editar (el premio de la ruta de stands es la excepción: ese canje lo guarda la base de Rumbo). En testnet el vale no es plata, pero el almuerzo sí es real: una comunidad que levante su propia copia del código puede usarlo en un evento real desde hoy, sin plata en riesgo.
- **Cada asistente sale con una cuenta de Stellar** que le sirve en el próximo evento: propia cuando entra con Google o con su correo (en modo de prueba el servidor se la puede crear; las passkeys vienen después), con las comisiones de red patrocinadas para que nadie tenga que tener XLM.
- **Pagos a oradores y voluntarios** en cualquier país, más adelante.
- **Pagar en tu moneda,** después. En Bolivia, con el QR del banco por medio de una rampa con licencia; quien organiza va a recibir USDC al momento. Sin Stripe, sin pasarela local, sin papeles.
- **Una API y un servidor MCP,** gratis para tus propios eventos; los webhooks vienen después. Las plataformas y agentes que crean eventos a volumen van a pagar por uso, con x402, más adelante.

Rumbo no es una entrada NFT ni un lugar para especular con la reventa. Si quien organiza la permite (más adelante), la reventa va a ir al precio original.

## Con Tinkazo

[Tinkazo](https://tinkazo.app) hace sorteos que cualquiera puede comprobar desde su celular. Rumbo y Tinkazo son productos distintos que encajan: Tinkazo decide quién gana, Rumbo entrega lo que se ganó y opera todo lo demás del evento. El plan: el premio de un sorteo de Tinkazo entra a la credencial de quien ganó, el sorteo se hace sobre quienes de verdad hicieron el check-in, y participar en el sorteo es gratis siempre, sea el evento pago o no. Hoy Rumbo congela la lista de quienes entraron, con una huella SHA-256 que cualquiera puede recalcular y el algoritmo publicado, para hacer el sorteo sobre ella; el premio entrando a la credencial de quien ganó viene después.

## Dónde está

La primera columna de la tabla de abajo está hecha y corre en la red de prueba de Stellar: el [contrato rumbo-pass](contracts/rumbo-pass/README.md) (pase gratis o pago con el reparto en la misma operación, una entrada y un canje por beneficio, con 43 pruebas) y la [app](app/README.md) (la página del evento, la inscripción, la credencial con un QR firmado con Ed25519 que cambia cada 20 segundos, el escáner sin conexión con un respaldo manual en la puerta (buscar por nombre o correo, o inscribir gratis en el momento a quien llegó sin credencial), el panel de quien organiza con el contraste de su registro contra la cadena, los stands de quien auspicia con su ruta (su premio entra a la credencial de quien la completa) y su pantalla en vivo, la lista del sorteo congelada con una huella SHA-256 y el algoritmo publicado, el informe del evento en la web para imprimir, con el PDF y los certificados verificables generados desde la consola con XeLaTeX, y el kit: plantillas para un DevFest, un Build with AI, un Día de la Mujer, una hackatón, un meetup o un taller, e importar la lista desde Luma, o desde Bevy, cuyas columnas son una inferencia (su documentación pública no las lista) y todavía no se contrastaron con un export real). El flujo entero, corrido en la red de prueba con los ids de sus transacciones, está en [app/demo/e2e-testnet.txt](app/demo/e2e-testnet.txt), y el contrato del evento pago se puede mirar en [stellar.expert](https://stellar.expert/explorer/testnet/contract/CDKKJV3QFG4RBYLRIRTWMXFBAQVY5NP3THXBNDT7PX7ICWSCN3GCZ5UH).

El servidor MCP le da al asistente que ya usás las mismas funciones, por HTTP y por stdio: describir el evento en palabras y aprobar el borrador, importar la lista, leer los números, el informe para quien auspicia, la lista del sorteo y el resumen para el capítulo. Ese flujo entero, corrido en la red de prueba, está en [app/demo/mcp.txt](app/demo/mcp.txt).

Entrar con Google o con el correo, con una cuenta propia por medio de Pollar, está en el código y corrió en la red de prueba con una llave local; falta probarlo con una cuenta de Google real, y se prende con `RUMBO_ACCOUNTS=pollar`. Sin eso, la cuenta la crea el servidor en modo de prueba. Las passkeys vienen después.

En [un video de poco más de un minuto](site/assets/mvp-es.mp4), grabado el 3 de noviembre, se ve el MVP real andando en la red de prueba, sin maquetas (sus pantallas de inscripción todavía dicen que la credencial llega por correo; eso viene después): la inscripción gratis, la credencial con su QR que cambia, la cámara del voluntario leyendo ese QR en la puerta, el canje sin conexión que se sincroniza solo al volver la red, el panel y la transacción de la inscripción en stellar.expert (lo graba [app/scripts/grabar-recorrido.mjs](app/scripts/grabar-recorrido.mjs)).

Sin instalar nada: la [landing](https://rumbo-eventos.vercel.app) con una animación de 31 segundos del flujo entero, y una [maqueta clickeable](https://rumbo-eventos.vercel.app/#probar) (no guarda nada) donde te inscribís, recibís la credencial, la escaneás como voluntario (también sin conexión) y ves cómo sería el sorteo.

El contrato partió de un [pase de evento](https://stellar.expert/explorer/testnet/contract/CDSXJR7MBV3ZLHLQPVTWZYVVP3CNABMGO6RRPLSI2KVFSJ2UX4SUD7DP) escrito en septiembre de 2026 para Stellar Elite Bolivia: comprar el pase, entrar una sola vez, listar quiénes vinieron. Rumbo lo extiende con beneficios, canjes y, más adelante, pagos protegidos.

| Hecho, en la red de prueba | Lo que sigue | Más adelante |
|---|---|---|
| Página del evento con inscripción gratis o paga (USDC de prueba), armada desde una plantilla; entrar con Google o con el correo, con una cuenta propia (falta probarlo con una cuenta de Google real) | Passkeys, y el correo con el enlace a la credencial | Pagos con el QR del banco en bolivianos, en mainnet |
| Credencial firmada, con un QR que cambia cada 20 segundos, en el celular y para imprimir en SVG | Pago protegido con reembolso automático | Reventa al precio original |
| Escáner sin conexión para la puerta, cada comida y cada stand, con respaldo manual en la puerta | El premio de un sorteo de Tinkazo entrando a la credencial | API pagada por uso con x402 |
| Panel de quien organiza con el contraste contra la cadena, informe para quien auspicia, lista del sorteo con su huella, informe del evento para imprimir (el PDF y los certificados, desde la consola con XeLaTeX) | Webhooks y avisos por calendario y Telegram | Pagos a oradores |
| Importar de Luma y de Bevy, tipos de credencial (oradores, mentoría, jurado, voluntariado) y equipos | Credencial en Apple y Google Wallet | Licencias para redes de comunidades |
| Servidor MCP para tu asistente: describir el evento en palabras y aprobar el borrador, importar la lista, leer los números y el informe | Credencial en PDF e impresión en tanda | |

## Cómo está hecho

Un contrato en Soroban para pases y vales, una app en Next.js con Supabase debajo y un servidor MCP con las mismas funciones, cuentas propias al entrar con Google o con el correo (las passkeys, después) con las comisiones de red patrocinadas, y un escáner que funciona sin conexión y sincroniza después. Las piezas, las decisiones y el orden de obra en cuatro semanas están en [docs/stack.md](docs/stack.md). El código vive en [contracts/rumbo-pass](contracts/rumbo-pass/README.md) y en [app](app/README.md), cada uno con su guía.

## Principios

- **Sin custodia.** La plata va directo a quien organiza o, cuando llegue el pago protegido, queda en su contrato. Rumbo nunca la tiene.
- **Sin rampa propia.** Los bolivianos los convierte quien tiene la licencia.
- **Sin datos personales en la cadena.** Los nombres y los correos quedan fuera de la cadena: viven en la base de Rumbo, para la credencial, la puerta y el panel de quien organiza. Los contactos del stand se comparten solo si la persona acepta, en ese stand.
- **Los eventos gratis son gratis.** La comisión aparece cuando hay plata de por medio.
- **Sin tecnicismos en la puerta.** Nadie en la puerta tiene que saber que abajo hay una blockchain.
- **Núcleo abierto, servicio alojado.** El contrato de canjes, el escáner y la plantilla del evento son de código abierto con licencia MIT, para que cualquier comunidad los use y los adapte. El servicio alojado (el armado del evento, los correos, el panel en tiempo real, los pagos y los informes) es lo que Rumbo va a cobrar.

## Quiénes

Rumbo se hace en Santa Cruz de la Sierra, Bolivia. Lo fundan [Nicolás Emir Mejía Agreda](https://github.com/nema1502), producto y contratos, y [Guido Salazar](https://github.com/GuidoSV7), desarrollo full stack.

Preguntas e ideas: abrí un issue.

## Licencia

[MIT](LICENSE).
