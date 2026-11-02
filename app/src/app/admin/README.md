# El panel de quien organiza y el informe para quien auspicia

`/admin/<evento>` es el panel; `/admin/<evento>/informe`, el informe para imprimir. Lo que corre en el servidor está en `src/server/panel.ts` (los números, la clave, los códigos de puesto, el contraste con la cadena, el CSV) y `src/server/panel-sesion.ts` (la cookie); lo que se ve, en `src/components/panel/`; los textos, en `src/i18n/panel.ts`; las tablas propias, en `src/server/migrations/003-panel.sql`.

## Entrar

Cada evento tiene una clave de organizador, al azar, guardada en la base. Se entra con el enlace `/admin/<evento>?k=<clave>`: la ruta `/api/admin/<evento>/entrar` la comprueba, la deja en una cookie (`rumbo.panel.<evento>`, treinta días) y vuelve al panel con la dirección limpia. Sin cookie, el panel muestra la puerta con llave, donde se pega la clave. "Salir del panel" borra la cookie.

El enlace con la clave lo imprime `node scripts/panel-clave.mjs [slug]`, junto con los códigos de puesto. Todavía no hay cuentas de organizador: la clave es la forma de entrar del MVP.

## Qué muestra

- **Cuatro contadores con su barra:** credenciales emitidas (sobre el cupo), quiénes entraron (sobre las emitidas), almuerzos canjeados y premios entregados (sobre los otorgados). Salen del espejo en la base y se vuelven a pedir cada cinco segundos (`GET /api/admin/<evento>`, JSON) mientras la pestaña está a la vista.
- **Actualizar desde la cadena** (`POST /api/admin/<evento>/cadena`): lee `info()` y `attendees()` de cada contrato del evento y `status()` de cada pase con cuenta, y compara. Lo que la cadena dice que pasó y acá faltaba se agrega (entradas, canjes, el número de pase, el estado); lo que acá figura y en la cadena no queda como "por sincronizar" si la cola del escáner todavía no lo mandó, o como diferencia para revisar si ya debería estar. Cada contraste queda guardado con lo que encontró.
- **Códigos de puesto:** uno para la puerta y uno por beneficio, de doce letras y números (`ABCD-EFGH-JKLM`). Con el suyo, cada voluntario abre el escáner (`/scan`), que lo resuelve con `resolveStationCode` y recibe la llave del evento. El botón copia las instrucciones listas para mandar.
- **Pases:** nombre, entrada, estado (pendiente, con credencial, entró) y los canjes de cada uno, con buscador.
- **Dobles, revisar:** las entradas y canjes que un escáner registró y ya estaban hechos.
- **Exportar CSV** (`GET /api/admin/<evento>/csv`): pase, nombre, correo, entrada, estado y canjes, en el idioma de la cookie o de `?lang=`.

## El informe

`/admin/<evento>/informe` es para quien auspicia y no trae nombres ni correos: el beneficio principal ("Almuerzo: 38 de 50 canjeados"), credenciales emitidas, quiénes entraron, las entradas por tipo, los canjes por beneficio, los intentos repetidos rechazados y la hora de corte. "Imprimir" usa la hoja de impresión de `panel.css`: sin cabecera ni botones, en claro aunque el tema sea noche.

## Probarlo

```bash
pnpm seed && pnpm seed -- --demo        # el evento de muestra y una persona con cuenta en la red de prueba
node scripts/panel-pases-prueba.mjs     # doce personas de prueba: entradas, canjes, un premio y dos dobles
node scripts/panel-clave.mjs            # el enlace del panel y los códigos de puesto
node scripts/panel-pases-prueba.mjs --cadena   # hace entrar y canjear en el contrato a la persona de ejemplo, sin tocar el espejo
```

Con lo último, "Actualizar desde la cadena" trae esa entrada y ese canje; la segunda vez dice que el panel coincide con la cadena.
