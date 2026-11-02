# rumbo-pass

El pase de un evento de Rumbo, en Stellar. Rust sobre Soroban (`soroban-sdk` 27), compilado y desplegado con `stellar-cli` 28.

Cada evento despliega su propio contrato con la configuración fija: quién organiza, la cuenta de Rumbo que recibe la comisión, la cuenta de puerta (el escáner de los voluntarios), el activo con el que se paga, el precio (0 si el evento es gratis), la comisión en puntos básicos, el cupo y cuántos beneficios canjeables hay. El beneficio 0 es el almuerzo.

## Qué garantiza la red

- **Un pase por cuenta, y nunca más que el cupo.** Gratis con `register`, pago con `buy`.
- **El reparto en la misma operación.** `buy` cobra el precio en el activo y, dentro de la misma invocación, le pasa a quien organiza su parte y a Rumbo la comisión. El contrato nunca retiene saldo: si una transferencia falla, no hay pase y nadie pagó nada.
- **Se entra una sola vez**, y la marca la pone solo la cuenta de puerta (el escáner del voluntario). La propia persona no puede marcar su entrada: así nadie entra a la lista, ni al sorteo, sin haber pasado por la puerta.
- **Cada beneficio se canjea una sola vez por pase**, y lo marca la cuenta de puerta. Para canjear hay que haber entrado.
- **`attendees()` es la lista de quienes de verdad entraron**, en orden de llegada. Es la lista que se sortea.

En la cadena viven cuentas, números de beneficio y marcas de uso. Nombres, correos y todo lo personal quedan fuera, en la base de datos de la app.

## Las funciones

| Función | Quién firma | Qué hace |
|---|---|---|
| `__constructor(organizer, treasury, gate, asset, price, fee_bps, capacity, benefits)` | quien despliega | Fija la configuración una sola vez. `price` en la unidad mínima del activo (siete decimales en USDC), de 0 a `MAX_PRICE` (`i128::MAX / 10000`, para que la comisión nunca desborde), `fee_bps` de 0 a 10000, `capacity` de 1 a 1000, `benefits` de 0 a 64. Una configuración inválida hace fallar el despliegue |
| `register(attendee) -> u32` | la persona | Emite un pase gratis. Solo en eventos con `price` 0. Devuelve el número de pase (el primero es 1) |
| `buy(buyer) -> u32` | quien compra | Cobra `price` y reparte: `price * fee_bps / 10000` a `treasury` (redondeado hacia abajo) y el resto a `organizer`. Devuelve el número de pase |
| `check_in(attendee, by) -> u32` | `by`, que tiene que ser `gate` | Marca la entrada, una sola vez. Devuelve en qué lugar entró (el primero es 1) |
| `redeem(attendee, benefit)` | `gate` | Canjea el beneficio `benefit` (de 0 a `benefits - 1`), una sola vez por pase y beneficio. Hay que haber entrado |
| `extend_ttl(holders) -> u32` | nadie | Mantiene vivo el evento: deja en 120 días la vida de la instancia (con el código), de la lista de quienes entraron y del pase de cada cuenta de `holders` que tenga uno. No cambia nada más. Devuelve cuántos pases extendió |
| `status(who) -> PassStatus` | nadie, es lectura | `has_pass`, `number`, `checked_in` y `redeemed` (los beneficios canjeados, en el orden en que se canjearon) |
| `attendees() -> Vec<Address>` | nadie, es lectura | Quienes entraron, en orden de llegada |
| `info() -> EventInfo` | nadie, es lectura | La configuración entera (`organizer`, `treasury`, `gate`, `asset`, `price`, `fee_bps`, `capacity`, `benefits`) y los contadores `issued` y `checked_in` |

`check_in` lleva el parámetro `by` porque en Soroban la autorización se pide a una cuenta concreta, y si un día hay varias puertas la firma tiene que seguir siendo de una de ellas. Hoy `by` tiene que ser la cuenta de puerta: si es otra (también la propia cuenta del pase), falla con `NotAuthorized` antes de pedir ninguna firma. `attendee` es solo el dato de quién entró.

## Los errores

Los códigos son parte de la interfaz y no se renumeran. En la red se ven como `Error(Contract, #n)`.

| # | Error | Cuándo |
|---|---|---|
| 1 | `NoPass` | La cuenta no tiene pase |
| 2 | `AlreadyHasPass` | Ya tiene pase: es uno por cuenta |
| 3 | `SoldOut` | Se llegó al cupo |
| 4 | `AlreadyCheckedIn` | Ya entró |
| 5 | `NotCheckedIn` | Quiere canjear sin haber entrado |
| 6 | `AlreadyRedeemed` | Ese beneficio ya se canjeó con este pase |
| 7 | `NoSuchBenefit` | El evento no tiene ese beneficio |
| 8 | `NotAuthorized` | `by` no es la cuenta de puerta |
| 9 | `NotFree` | `register` en un evento pago |
| 10 | `NotPaid` | No hubo pago: `buy` en un evento gratis, o el activo no se pudo mover (sin saldo, sin línea de confianza) |
| 11 a 14 | `InvalidPrice`, `InvalidFee`, `InvalidCapacity`, `InvalidBenefits` | Configuración inválida al desplegar (el precio, negativo o por encima de `MAX_PRICE`) |
| 15 | `NotConfigured` | No debería verse: el constructor siempre configura |

Las firmas que faltan no son errores del contrato sino de la red: `Error(Auth, InvalidAction)`.

## Los eventos que publica

Para el panel, el informe y las métricas, leídos por RPC.

| Evento | Tema | Datos |
|---|---|---|
| `PassIssued` | `attendee` | `number`, `paid` (0 si fue gratis), `fee` |
| `CheckedIn` | `attendee` | `arrival`, el lugar en que entró |
| `Redeemed` | `attendee` | `benefit` |

Además, en cada compra el contrato del activo publica sus dos `transfer`: a quien organiza y a Rumbo.

## Cómo guarda

- **Instancia:** la configuración y el contador de pases emitidos. Viven y mueren con el contrato.
- **Persistente:** un `Pass` por cuenta (`number`, `checked_in`, `redeemed`) y la lista `Attendees`. Cada escritura extiende la vida de la entrada a 120 días cuando le quedan menos de 30.
- **Las lecturas no extienden nada:** `status`, `info` y `attendees` se simulan y no se mandan. Un pase que nadie toca vive 120 días desde su última escritura, y la instancia lo mismo desde la última venta, entrada o canje. **Si la inscripción abre más de 120 días antes del evento, o pasan meses sin movimiento, hay que llamar a `extend_ttl` antes del evento** con las cuentas de los pases (de a tandas, si son muchas): no pide firma y la renta la paga quien la manda, en la app la cuenta patrocinadora. Sin eso, el día de la puerta el pase estaría archivado y habría que restaurarlo antes de marcar la entrada.
- La lista de quienes entraron es una sola entrada, por eso el cupo tiene tope de 1000: mil cuentas entran holgadas en una entrada. Los beneficios tienen tope de 64 por evento.
- La comisión se redondea hacia abajo y quien organiza recibe el resto, así la suma siempre es el precio exacto. El precio tiene tope (`MAX_PRICE`) para que `price * fee_bps` nunca desborde: un error de cuenta sería un pánico sin código y nadie podría comprar.

## Cómo se prueba y se compila

Desde la raíz del repositorio, con Rust estable y el objetivo `wasm32v1-none`:

```bash
cargo test --workspace     # 40 pruebas
stellar contract build     # target/wasm32v1-none/release/rumbo_pass.wasm, 10,9 KB
```

Las pruebas (`src/test.rs`) cubren cada función y cada error, el reparto exacto de la comisión con el activo de prueba del SDK (incluido el redondeo, la comisión cero y la comisión entera), el cupo, el doble canje, la lista completa con mil cuentas, y quién tiene que firmar cada cosa: la compra solo la firma quien compra y cubre las dos transferencias; la entrada y el canje, solo la puerta (la persona no se marca a sí misma, ni con su firma). También que `extend_ttl` deja en 120 días la vida del pase, de la lista y de la instancia sin pedir firma, midiendo lo que le queda a cada entrada después de cien días sin movimiento.

## La corrida en la red de prueba

`scripts/demo_testnet.sh` hace todo de punta a punta y deja lo que respondió la red, tal cual, en [`demo/transcripcion.txt`](demo/transcripcion.txt). Los datos públicos del despliegue quedan en [`deploy/testnet.json`](deploy/testnet.json). Nunca imprime una llave secreta.

```bash
stellar contract build                                  # desde la raíz
cd contracts/rumbo-pass
scripts/demo_testnet.sh                                 # o STELLAR=/ruta/a/stellar.exe scripts/demo_testnet.sh
```

Qué hace:

1. **Las cuentas.** `rb-issuer` emite el USDC de prueba; `rb-organizer` organiza; `rb-treasury` es la cuenta de Rumbo; `rb-gate` es la puerta; `rb-sponsor` paga las comisiones de red; `rb-ana`, `rb-beto`, `rb-caro` y `rb-dani` son las personas. Si no existen, las crea y friendbot las fondea.
2. **El activo.** Un `USDC` emitido por `rb-issuer`, su contrato (`stellar contract asset deploy`), la línea de confianza de cada cuenta que lo recibe y 100 USDC de prueba para quienes compran.
3. **El evento pago.** El WASM sube una vez y cada evento se despliega desde su hash. Precio 10 USDC de prueba, comisión del 2,5 por ciento, cupo de 50, dos beneficios. Tres compras con el reparto a la vista (9,75 a quien organiza y 0,25 a Rumbo en cada una), la entrada por la puerta, el canje del almuerzo, y todo lo que la red rechaza: comprar dos veces (#2), marcar la propia entrada sin la puerta (#8), entrar dos veces (#4), canjear dos veces (#6), canjear sin haber entrado (#5) y canjear un beneficio que no existe (#7).
4. **El evento gratis.** Inscripción y entrada, y lo que la red rechaza: comprar en un evento gratis (#10) e inscribirse gratis en el pago (#9).
5. **El estado final**, los saldos, la lista de quienes entraron y `extend_ttl` sobre los tres pases, como se haría antes de un evento que abrió la inscripción con meses de anticipación.

Las compras, las inscripciones y las entradas las paga `rb-sponsor` (`--source rb-sponsor`), y la persona o la puerta solo firman su autorización, que el CLI agrega desde la identidad local (`--auto-sign`) porque su nombre aparece en los argumentos. Así ninguna cuenta de persona necesita XLM, que es como lo hace la app: el servidor arma la transacción y la paga, y la cuenta de la persona firma solo su entrada de autorización. Los canjes los manda la propia cuenta de puerta (`--source rb-gate`): en `redeem` la puerta no es un argumento sino parte de la configuración, y el CLI no la asocia solo con una identidad local. La app no tiene ese límite, porque firma la autorización de la puerta con su llave de forma explícita.

La corrida se puede repetir: las cuentas y el activo se reusan y cada vez se despliegan dos contratos nuevos. Por eso los saldos se miran antes y después.

### El despliegue del 2 de noviembre de 2026

| Qué | Dónde |
|---|---|
| WASM (hash) | `e0947b8bce2002582add7b1321da0c14b813334504437d96b0a5a9ca1228f574` |
| Evento pago | [`CBGPZQGK6XARBVJG47WM6S6M54ZMSIPM5HSICIHLVE6E3LZNZXQJ4HM5`](https://stellar.expert/explorer/testnet/contract/CBGPZQGK6XARBVJG47WM6S6M54ZMSIPM5HSICIHLVE6E3LZNZXQJ4HM5) |
| Evento gratis | [`CCP3TW6E5F6H55C7TTNHDM5TFJPLRMY2OCFBZIGJVUW44UINZPILLA5D`](https://stellar.expert/explorer/testnet/contract/CCP3TW6E5F6H55C7TTNHDM5TFJPLRMY2OCFBZIGJVUW44UINZPILLA5D) |
| USDC de prueba (emisor) | `GCJU3JEKQOU5A3S7ILVXXVBKZBIOPBXW4ZO2LDSGYCZT3WDRTPEOKYOL` |
| USDC de prueba (contrato) | `CAIOVRPPUFGPHOHBIEFCUJEW6773TH7NXRYSLYSHPJYC33LR4T2JHRGZ` |

Tres compraron, dos entraron, Ana canjeó su almuerzo y el segundo intento falló con `Error(Contract, #6)`. Quien organiza subió 29,25 USDC de prueba y Rumbo 0,75; el contrato quedó con 0.

## Para la app

- Las llaves secretas de `rb-gate`, `rb-sponsor`, `rb-issuer`, `rb-organizer` y `rb-treasury` van en `app/.env.local` como `STELLAR_GATE_SECRET`, `STELLAR_SPONSOR_SECRET`, `STELLAR_ISSUER_SECRET`, `STELLAR_ORGANIZER_SECRET` y `STELLAR_TREASURY_SECRET`. Se sacan con `stellar keys secret <nombre>` y nunca se suben. Lo público está en `deploy/testnet.json`.
- Cada evento nuevo se despliega desde el hash del WASM con su propia configuración; el contrato no se modifica después.
- El escáner manda `check_in(attendee, by = gate)` y `redeem(attendee, benefit)` firmados por la cuenta de puerta, con la comisión de red pagada por la cuenta patrocinadora. Si al sincronizar una cola llega un canje antes que la entrada de esa persona, la red responde `NotCheckedIn` (#5): se reintenta después de la entrada.
- Una cuenta nueva necesita existir en la red y tener la línea de confianza al USDC de prueba antes de comprar; en la corrida lo hace friendbot y `change-trust`, en la app lo hace el servidor al crear la cuenta.
- La red de prueba se reinicia el 16 de diciembre de 2026 y borra contratos y cuentas: ese día se vuelve a correr `scripts/demo_testnet.sh` y se actualiza `deploy/testnet.json`.

## Lo que falta

- Una sola cuenta de puerta por evento. Varios puestos con llaves distintas pedirían una lista de puertas en la configuración.
- Sin reembolsos ni cancelación: la plata ya llegó a quien organiza en el momento de comprar.
- La lista de quienes entraron vive en una sola entrada, por eso el tope de mil. Un evento más grande pediría guardarla por partes.
