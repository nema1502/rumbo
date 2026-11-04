# Los stands, la ruta y los contactos con permiso

Lo que hace que quien auspicia vea algo más que un logo: la gente pasa por su stand, y quienes quieren le dejan su contacto. Todo vive en la base, fuera de la cadena: nombres y correos nunca van al contrato. Lo que corre en el servidor está en `src/server/stands.ts` (los stands, los sellos, el permiso, los números del informe) y `src/server/vivo.ts` (la pantalla en vivo y la lista del sorteo); las tablas, en `src/server/migrations/008-stands.sql`; los textos, en `src/i18n/stands.ts` y `src/i18n/vivo.ts`.

## Cómo funciona

1. **Quien organiza** entra a `/admin/<evento>/stands`: agrega un stand por auspiciante (nombre, logo si quiere y lo que regala) y fija la meta de la ruta ("visitá 4 de 6 stands"). Fijar la meta crea el beneficio "Premio de la ruta", que se canjea en el puesto de Premios. Cada stand recibe su código de puesto de doce letras, del tipo `stand`.
2. **En el stand**, quien atiende abre `/scan` con ese código y escanea la credencial de quien pasa: queda un sello, uno solo por persona y stand, aunque se lea dos veces o con dos celulares. Funciona sin conexión, como el resto del escáner: la visita va a la cola local y sube cuando hay red. El escáner de un stand no recibe la lista de asistentes: solo las personas que ya pasaron por ese stand.
3. **En la credencial** de quien asiste aparece "Tu ruta de stands" (cuántos lleva, cuáles faltan, el premio) y, apenas escanean, la pregunta "¿Querés compartir tu contacto con <auspiciante>?". La responde la persona, desde su celular, con "Sí, compartir" o "No, gracias": las dos pesan lo mismo y ninguna viene elegida. Puede cambiar de idea cuando quiera.
4. **El auspiciante** abre `/stand/<código>` y ve sus visitas. Solo de quienes aceptaron ve nombre y correo, y los califica de 1 a 5 y les anota algo. Exporta a CSV. Quien no contestó, o dijo que no, solo cuenta como visita.
5. **La ruta completa** pasa el premio a la credencial en el mismo momento del sello que cumple la meta. Se canjea en Premios con el escáner de siempre.
6. **La pantalla en vivo** (`/vivo/<evento>`) la abre quien organiza con su clave y se proyecta: tema noche, letra enorme, se actualiza cada tres segundos.

## Por qué el permiso lo da la persona en su credencial

La pregunta podía hacerse en la pantalla del escáner, pero ahí quien contesta es quien tiene el celular en la mano, o sea el auspiciante. En la credencial, la respuesta sale del celular de la persona y con su clave, que el auspiciante no tiene: el permiso es de verdad suyo. Si el celular de la persona no está a mano, la pregunta queda sin responder y no se comparte nada.

## Qué se garantiza y dónde

- **Un sello por persona y stand:** `UNIQUE (stand_id, pass_id)` en la tabla y `INSERT ... ON CONFLICT DO NOTHING`.
- **Una visita vale solo con la credencial de verdad:** la visita viaja con el texto del QR que leyó el escáner (`qr` en `ScanItem`), y el servidor vuelve a comprobar las firmas con la clave pública del evento antes de contarla (`verifyQrSignature`, sin exigir la ventana de tiempo, porque la cola sube tarde), y que el pase del QR sea el de la visita. Con el código de un stand no se suman visitas de ids de pase inventados o sacados de la lista del sorteo. La respuesta no distingue un pase que no existe de uno sin activar.
- **Sin permiso no hay contacto:** `getStandPanel` y `buildContactsCsv` leen solo las visitas con `consent = 'granted'`. Dejar de compartir borra también la calificación y la nota, y volver a compartir no las trae de vuelta. La nota se guarda con `UPDATE ... WHERE consent = 'granted'`: si la persona retiró el permiso un instante antes, no se guarda. El permiso nace en `pending` y solo lo cambia `answerConsent`, que llama la ruta de la credencial con su clave de acceso.
- **El CSV no lleva fórmulas:** las celdas que empiezan con `=`, `+`, `-` o `@` salen con una comilla simple adelante (la misma `csvCell` del panel).
- **El premio de la ruta se canjea una sola vez en la base, no en el contrato** (la ruta no está en la cadena): `claimRoutePrize` marca el primer canje de una sola sentencia, y el segundo, aunque venga de otro escáner, queda como doble para revisar en el panel.
- **En la pantalla en vivo nunca hay correos, teléfonos ni apellidos:** el ranking usa el nombre de pila (la primera palabra, o lo que sigue a la coma en "Apellido, Nombre"; si parece un correo, un enlace o un teléfono, sale "Anónimo") o el alias que la persona eligió (hasta 20 letras, normalizado a NFKC, sin `@`, sin enlaces ni seis dígitos seguidos, sin caracteres invisibles), o "Anónimo" si pidió no aparecer. Quien organiza ve en "Stands y ruta" quiénes están en la pantalla y puede sacar a alguien ("Sacar de la pantalla": queda oculto y su alias se borra).
- **El código de un stand se puede cambiar** desde "Stands y ruta": el de antes deja de abrir el escáner y el panel en el acto.
- **El logo de un stand es una ruta de esta app** (`/muestra/logo.svg`, `src/lib/logo.ts`), nunca un enlace a otro servidor: ese servidor sabría la IP y la hora de cada persona que abre su credencial. La credencial manda además `Content-Security-Policy: img-src 'self' data:`.
- **La lista del sorteo no lleva datos personales:** solo los códigos de credencial de quienes entraron (las credenciales de asistente, salvo que se pida incluir a todas), ordenados, con la huella SHA-256 de la lista y cómo se calcula. Quien organiza la congela desde la pantalla en vivo (`POST /api/vivo/<evento>/sorteo`, tabla `raffle_lists`): desde ahí la que se proyecta, con su huella, es la que se exporta y se sortea, aunque alguien entre después. Esta parte no sortea nada.
- **La computadora del proyector no tiene la clave del panel:** quien organiza abre `/vivo/<evento>` con su clave y copia desde ahí el enlace para el proyector (`?pantalla=<clave>`, tabla `screen_keys`, `verifyScreenKey` en `src/server/vivo.ts`), que abre solo la pantalla en modo proyector y su JSON: sin el sorteo, sin el CSV y sin enlaces al panel. Se cambia desde la misma pantalla, y el anterior deja de servir en el acto.

## Los números para el informe

`getEventStandsReport(evento)` devuelve, por auspiciante, las visitas verificadas, los canjes de su beneficio, los contactos que aceptaron (un número) y cuántos de sus visitantes completaron la ruta, y el resumen de la ruta del evento. `getStandReport(standId)` devuelve uno solo. Son agregados: el PDF del informe los toma de ahí.

## Probarlo

```bash
pnpm test                          # tests/stands.test.mjs: sellos, meta, permiso, CSV, informe, escáner del stand y pantalla en vivo
pnpm build && node scripts/capturas-stands.mjs   # arma un evento de muestra sin contrato, levanta el servidor y saca las capturas
```
