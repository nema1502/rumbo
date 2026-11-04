# Los documentos que se imprimen: el informe, los certificados y el paquete para embajadores

Tres piezas que Rumbo arma al terminar un evento, con la marca ([docs/marca.md](../../docs/marca.md)) y con los datos que respalda el contrato `rumbo-pass` en Stellar:

| Pieza | Para quién | Script |
|---|---|---|
| **El informe del evento** (PDF, A4) | Quien organiza, quien auspicia y el programa de embajadores de Stellar | `pnpm informe` ([scripts/informe.mjs](../scripts/informe.mjs)) |
| **Los certificados de asistencia** (un PDF por persona que entró, A4 apaisado) | Quien asistió, y la universidad o el trabajo que pide el certificado | `pnpm certificados` ([scripts/certificados.mjs](../scripts/certificados.mjs)) |
| **El paquete para el programa de embajadores** (una carpeta) | El capítulo, para documentar el evento ante el programa | `pnpm paquete-embajadores` ([scripts/paquete-embajadores.mjs](../scripts/paquete-embajadores.mjs)) |

Los tres se compilan con XeLaTeX desde las plantillas de esta carpeta.

## Por qué existe el informe

El programa de embajadores de Stellar cuenta un evento si tiene "a minimum of twenty (20) verified attendees", al menos 20 minutos de contenido de Stellar y su "Event Documentation Package"; los eventos sin la documentación de asistencia suficiente para verificar ese mínimo no cuentan, y la SDF puede reducir, demorar o recuperar los fondos del capítulo si el informe está incompleto. La comida tiene un tope de US$ 25 por persona. Fuentes: [Goals and reporting](https://stellar.gitbook.io/ambassador-program/resources/terms-and-conditions/goals-and-reporting) y [Budget setting and review](https://stellar.gitbook.io/ambassador-program/resources/terms-and-conditions/budget-setting-and-review).

Quien auspicia, por su lado, quiere saber cuánta gente llegó, cuántos canjearon su beneficio y cuántos aceptaron que les escriba. El informe responde las dos cosas con números que cualquiera puede contrastar en stellar.expert.

## El informe del evento

```bash
cd app
pnpm informe -- --evento hackaton-comunidad --lang es \
  --gasto-comida 2400 --minutos-stellar 45 \
  --auspiciante "Cafetería La Brújula" --beneficio-auspiciante "Café" --contactos-auspiciante 37 \
  --comprobante-sorteo https://... \
  --salida data/informes/hackaton-es.pdf
```

Todo lo que va después de `--evento` es opcional. Sin `--salida`, el PDF queda en `data/informes/<evento>-<idioma>.pdf`. Con `--json <archivo>` deja además los números agregados (el mismo JSON que acepta `--datos`), y con `--conservar` no borra la carpeta de trabajo de XeLaTeX, para mirar el `.log`.

Las secciones, en orden, y cada una se omite sola si no hay datos para ella:

1. **La portada:** el nombre del evento, la fecha, el lugar, quien organiza y tres cifras (credenciales, entraron, tasa de asistencia).
2. **Resumen en números:** credenciales emitidas, entraron, tasa de asistencia, canjes, premios entregados y dobles revisados; las barras de la inscripción a la mesa y la llegada hora por hora.
3. **Asistencia verificada:** los asistentes verificados frente al mínimo de 20, los minutos de contenido de Stellar (con `--minutos-stellar`; sin él, queda un recuadro para escribirlo a mano), cómo se verifica, el contrato con su enlace a stellar.expert y una muestra de diez transacciones de entrada con sus enlaces.
4. **La comida y lo que se entregó:** cada beneficio contra inscritos y contra quienes entraron; con `--gasto-comida`, el gasto por persona que entró frente al tope de US$ 25.
5. **Los stands y la ruta** (si el evento tiene stands): la meta, cuántas personas participaron y, por auspiciante, las visitas verificadas, los contactos que aceptaron, cuántos completaron la ruta y los canjes de su regalo. Solo números.
6. **Para quien auspicia** (con `--auspiciante`): si el nombre es el de un stand del evento, las visitas a su stand, los canjes de su regalo y cuántos contactos aceptaron compartirse salen de ahí solos; `--beneficio-auspiciante` (el nombre de uno del catálogo) y `--contactos-auspiciante` los fuerzan si hace falta. Y el alcance del evento.
7. **El sorteo** (si hubo premios ganados): entre cuántas personas, los premios y, con `--comprobante-sorteo`, cómo se comprueba.
8. **Cómo verificar este informe.**

### De dónde salen los números

Del mismo código que usa el panel y el informe web: [src/server/informe.ts](../src/server/informe.ts) llama a `getPanelState` de [src/server/panel.ts](../src/server/panel.ts), a `getEventStandsReport` de [src/server/stands.ts](../src/server/stands.ts) para los stands y la ruta, y al `Repo` para lo que el panel no trae (las transacciones de entrada y los contratos de cada entrada). Nada de consultas aparte.

- **Inscritos** son las credenciales emitidas (inscripciones gratis y entradas pagas); las inscripciones que no terminaron no cuentan.
- **Entraron (verificados)** son los pases en estado "entró": el espejo solo lo marca cuando el contrato aceptó la entrada que firmó la cuenta de puerta. Si un escáner tiene entradas sin mandar, el informe lo avisa.
- **La muestra de transacciones** son las diez entradas en orden de llegada cuyo hash guardó el espejo (`checkins.tx_hash`).
- **El contraste**: si el panel ya comparó con la cadena ("Verificar el registro del evento") y pudo leer todos los contratos, el informe dice cuántas entradas contó el contrato.
- **El gasto en comida, los minutos de Stellar, quien auspicia y el comprobante del sorteo** los informa quien organiza: la base no los tiene.

### Desde un JSON

`--datos <archivo.json>` genera desde un JSON con la forma de `EventReportData` (está en [src/server/informe.ts](../src/server/informe.ts)) en vez de la base. Así se hacen los ejemplos, y así se puede generar en otra máquina sin la base.

## Los certificados de asistencia

```bash
pnpm certificados -- --evento hackaton-comunidad --lang es --base https://rum.bo
```

Uno por persona que entró, con su nombre, el evento, la fecha, el lugar, la duración (si el evento termina el mismo día), la hora en que entró y el tipo de participación si el dato existe (asistente, charla, mentoría, voluntariado; hoy la inscripción no lo pide, así que dice "asistió a"). Sin `--salida`, quedan en `data/certificados/<evento>/` con un `indice-<idioma>.csv` (pase, nombre, archivo) para mandarlos. `--solo <pase>` hace uno solo.

El QR lleva a `/v/<pase>?c=<código>`, una página pública de solo lectura ([src/app/v/](../src/app/v/), con [src/server/verificacion.ts](../src/server/verificacion.ts)) que dice "Esta persona entró a <evento> el <fecha>", muestra el nombre que figura en el certificado para compararlo y enlaza la transacción de entrada en stellar.expert. El código es una firma del pase con la llave del evento, separada de la firma del QR de la credencial: con el enlace del certificado no se puede armar una credencial, y sin el código la página dice lo mismo que si el pase no existiera, así nadie puede recorrer los ids de pase (de cuarenta bits) para sacar nombres. Si la persona no entró, la página dice que no hay registro. La página no se indexa.

`--base` es la dirección pública de la app; por defecto `NEXT_PUBLIC_BASE_URL`. Si apunta a `localhost`, el script avisa: esos QR no abren fuera de la computadora.

Bricolage Grotesque, la fuente del nombre, es solo latina. Antes de compilar, el script lee qué letras cubre ([scripts/lib/fuentes.mjs](../scripts/lib/fuentes.mjs), la tabla `cmap` de la fuente) y, si un nombre lleva otras (cirílico, griego, árabe, chino), lo escribe con una fuente de respaldo del sistema: Segoe UI o Arial en Windows; Noto Sans, DejaVu Sans, Liberation Sans o Arial donde haya fontconfig. `--fuente-respaldo <nombre>` elige otra (y `--fuente-respaldo-archivo <ruta.ttf>` le dice el archivo, para saber qué cubre). Si ninguna fuente tiene esas letras, el script lo dice con el pase y el nombre de cada persona afectada y termina con código 2.

El nombre va en el certificado y en la página de verificación; nunca en la cadena. Los PDF llevan nombres: por eso quedan en `data/`, fuera del repositorio.

## El paquete para el programa de embajadores

```bash
pnpm paquete-embajadores -- --evento hackaton-comunidad --minutos-stellar 45 --gasto-comida 2400
```

Deja en `data/paquetes/<evento>/` (o en `--salida`):

| Archivo | Qué tiene |
|---|---|
| `informe-<evento>-<idioma>.pdf` | El informe del evento, en inglés por defecto (`--lang es` para castellano) |
| `airtable.csv` | La fila para el Airtable del capítulo: nombre del evento, fecha, ciudad, asistentes verificados, minutos de contenido de Stellar, enlace del contrato y enlace del informe (`--enlace-informe <url>` cuando el PDF ya está subido; si no, el nombre del archivo). Los encabezados van en inglés |
| `contactos-capitulo.csv` | Nombre y correo, **solo de quienes marcaron en la inscripción que la comunidad les escriba**. No se reenvía a terceros |
| `resumen.txt` | Si el evento cumple: 20 asistentes verificados como mínimo (sí o no), 20 minutos de Stellar (sí o no) y la comida por persona frente al tope de US$ 25 |

Acepta también las opciones del informe (`--auspiciante` y las demás).

**El paquete oficial de la SDF no es público:** los campos de `airtable.csv` y del resumen se ajustan cuando el programa le pase al capítulo la plantilla oficial.

### El consentimiento de contacto

La inscripción tiene una casilla opcional y desmarcada: "Quiero que <comunidad> me escriba sobre sus próximos eventos." Se guarda por pase (por evento, no por persona) en `passes.contact_consent` y `contact_consent_at` ([la migración 009](../src/server/migrations/009-consentimiento-contacto.sql)). La API la recibe como `contactConsent: true`. A quien ya tenía su credencial no se le cambia: si no, cualquiera que escriba un correo ajeno podría marcarla por otra persona.

## Qué no incluye

- **El informe no tiene datos personales:** ni nombres ni correos, solo números agregados y los identificadores públicos del contrato y de las transacciones. Lo comprueba una prueba ([tests/informe.test.mjs](../tests/informe.test.mjs)).
- **En el informe, quien auspicia recibe solo el número** de contactos que aceptaron compartirse. La lista de esas personas (nombre y correo, de quienes dijeron que sí desde su credencial) la ve en su propio panel, `/stand/<código>`, y la exporta desde ahí; el informe no la lleva.
- **Los certificados llevan el nombre de una sola persona**, y el CSV de contactos del capítulo lleva correos: los dos quedan en `data/`, que no se versiona.

## Los ejemplos

`ejemplo.json` es un DevFest de comunidad inventado (180 inscritos, 142 entraron, 131 almuerzos, 88 poleras, 3 premios, 2 dobles, US$ 2.400 en comida, 45 minutos de Stellar y un auspiciante con 120 canjes de su café y 37 contactos). `ejemplo-certificados.json` es una persona inventada. Los PDF dicen en cada página "Ejemplo con datos ficticios", y en vez de transacciones dicen que en un informe real ahí van los enlaces.

```bash
pnpm informe -- --datos informes/ejemplo.json --lang es --salida informes/ejemplo-es.pdf
pnpm informe -- --datos informes/ejemplo.json --lang en --salida informes/ejemplo-en.pdf
pnpm certificados -- --datos informes/ejemplo-certificados.json --lang es --salida <carpeta>   # y se copia como ejemplo-certificado-es.pdf
```

## Con datos reales

En la red de prueba, con las llaves del servidor en `.env.local`:

```bash
pnpm setup:dev && pnpm seed            # el evento de muestra
pnpm e2e                               # el flujo entero: inscripciones, entradas y canjes en el contrato, con sus transacciones
RUMBO_DATA_DIR=data/e2e pnpm informe -- --evento hackaton-comunidad --minutos-stellar 30
```

Sin llaves, `pnpm seed` y `node scripts/panel-pases-prueba.mjs` llenan el espejo con doce personas de prueba (sin tocar la red): el informe, los certificados y el paquete salen igual, pero sin transacciones que enlazar.

## Qué hace falta para compilar

XeLaTeX (TeX Live o TinyTeX) con `fontspec`, `babel` en castellano e inglés, `tikz`, `tcolorbox`, `tabularx`, `booktabs`, `needspace`, `hyperref`, `lastpage`, `microtype` y `fix-cm`. Si `xelatex` no está en el `PATH`, la variable `XELATEX` dice dónde está. Las fuentes vienen en `fuentes/` (Bricolage Grotesque e Inter, con sus licencias OFL al lado) y la marca en `marca/logo-tinta.pdf`: la brújula de `site/assets/logo.svg`, la que va junto al nombre, con `currentColor` en tinta, impresa a PDF con Chrome sin interfaz (una página de 64 por 64 px con `@page { margin: 0 }`). La brújula grande de la portada y del certificado está dibujada con TikZ en la clase, con las mismas medidas. Un informe tarda unos cinco segundos; los certificados se hacen de a cuatro a la vez.

**En producción, TeX Live no corre en Vercel:** el informe y los certificados se generan en un proceso aparte (un trabajo en una máquina con TeX Live, o un contenedor), o más adelante se pasa la plantilla a Typst, que es un solo binario chico. Por ahora es una nota: no está hecho.

## Los archivos

| Archivo | Qué es |
|---|---|
| `rumbo-informe.cls` | La clase: los colores, las fuentes, la cabecera y el pie, las tarjetas, las cifras, las tablas, los gráficos y la brújula dibujada |
| `informe.tex` | La plantilla del informe: la portada y las secciones en orden |
| `certificado.tex` | La plantilla del certificado |
| `textos.json` | Los textos en castellano (con voseo) y en inglés |
| `ejemplo.json`, `ejemplo-certificados.json` | Los datos ficticios de los ejemplos |
| `ejemplo-es.pdf`, `ejemplo-en.pdf`, `ejemplo-certificado-es.pdf`, `ejemplo-certificado-en.pdf` | Los ejemplos ya generados |
| `fuentes/`, `marca/` | Las fuentes con sus licencias y el logo en PDF |

El generador escribe `datos.tex` con `\rumboset{clave}{valor}` (todo texto pasa por el escape de [scripts/lib/latex.mjs](../scripts/lib/latex.mjs), que aguanta `& % $ # _ { } ~ ^ \`) y `\rumbourl{clave}|enlace|` para los enlaces; la plantilla los lee con `\V{clave}` y `\U{clave}`, y si falta un dato no compila. XeLaTeX corre con `-no-shell-escape`: lo que va en `datos.tex` lo escribió la gente, y aunque el escape lo deja como texto, ningún comando se ejecuta.
