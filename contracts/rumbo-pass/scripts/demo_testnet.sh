#!/usr/bin/env bash
# La corrida de punta a punta en la red de prueba de Stellar, con transcripción.
#
# Qué hace, en orden:
#
#   1. Las cuentas: quien emite el USDC de prueba (issuer), quien organiza
#      (organizer), la cuenta de Rumbo que recibe la comisión (treasury), la
#      cuenta de puerta que marca entradas y canjes desde el escáner (gate), la
#      patrocinadora que paga las comisiones de red (sponsor) y cuatro personas.
#      Si no existen, las crea y las fondea con friendbot.
#   2. El activo: un USDC de prueba emitido por rb-issuer, su contrato (SAC),
#      la línea de confianza de cada cuenta que lo recibe y un saldo inicial
#      para quienes compran.
#   3. Un evento pago: la subida del WASM, el despliegue con comisión del 2,5
#      por ciento, tres compras con el reparto a la vista, la entrada por la
#      puerta, el canje del almuerzo, y todo lo que la red rechaza: comprar dos
#      veces, marcar la propia entrada sin la puerta, entrar dos veces, canjear
#      dos veces, canjear sin haber entrado, canjear un beneficio que no existe.
#   4. Un evento gratis: la inscripción, la entrada, y lo que la red rechaza:
#      comprar en un evento gratis e inscribirse gratis en uno pago.
#   5. El estado final leído del contrato, los saldos, la lista de quienes
#      entraron y extend_ttl sobre los pases (sin firma: la paga la
#      patrocinadora), como antes de un evento que abrió con meses de anticipación.
#
# Las compras, las inscripciones y las entradas las paga la cuenta patrocinadora
# (--source rb-sponsor): la persona o la puerta solo firman su autorización, que
# el CLI agrega desde la identidad local (--auto-sign) porque su nombre aparece
# en los argumentos. Así ninguna cuenta de persona necesita XLM, que es como lo
# hace la app. Los canjes los manda la propia cuenta de puerta (--source
# rb-gate): en redeem la puerta no es un argumento sino parte de la
# configuración del contrato, y el CLI no la asocia solo con una identidad
# local. La app no tiene ese límite, porque firma la autorización de la puerta
# con su llave de forma explícita.
#
# La corrida se puede repetir: las cuentas y el activo se reusan, y cada vez se
# despliegan dos contratos nuevos. Por eso los saldos se miran antes y después.
#
# Lo que se ejecuta y lo que responde la red queda en demo/transcripcion.txt,
# tal cual. Los datos públicos del despliegue quedan en deploy/testnet.json.
# Nunca se imprime una llave secreta.
#
# Uso (Git Bash, desde contracts/rumbo-pass, con el WASM ya compilado con
# `stellar contract build` desde la raíz del repositorio):
#
#   scripts/demo_testnet.sh
#   STELLAR=/ruta/a/stellar.exe scripts/demo_testnet.sh   # si no está en el PATH

set -u
cd "$(dirname "$0")/.."

ST="${STELLAR:-stellar}"
RED="testnet"
LOG="demo/transcripcion.txt"
WASM="../../target/wasm32v1-none/release/rumbo_pass.wasm"

# El evento pago: 10 USDC de prueba el pase (siete decimales), 2,5 por ciento
# de comisión, cupo de 50, dos beneficios (0 el almuerzo, 1 la polera).
PRECIO=100000000
COMISION_BPS=250
CUPO=50
BENEFICIOS=2
# Lo que recibe cada persona para la corrida: 100 USDC de prueba.
SALDO_INICIAL=1000000000

if [ ! -f "$WASM" ]; then
  echo "No está $WASM. Compilá primero, desde la raíz del repositorio: stellar contract build" >&2
  exit 1
fi

mkdir -p demo deploy
: > "$LOG"

# Escribe el comando como se vería en una terminal y lo ejecuta, guardando la
# salida entera (el CLI escribe los enlaces y los eventos por stderr).
correr() {
  printf '\n$ stellar %s\n' "$*" | tee -a "$LOG"
  "$ST" "$@" 2>&1 | tee -a "$LOG"
  return "${PIPESTATUS[0]}"
}

nota() { printf '\n# %s\n' "$*" | tee -a "$LOG"; }

direccion() { "$ST" keys address "$1"; }

# Una invocación que escribe: la paga rb-sponsor y la firma quien corresponda.
invocar() {
  correr contract invoke --id "$ID" --source rb-sponsor --auto-sign --network "$RED" -- "$@"
}

# Un canje: lo manda la cuenta de puerta, que es la que firma.
puerta() {
  correr contract invoke --id "$ID" --source rb-gate --network "$RED" -- "$@"
}

# Una lectura, sin transacción.
leer() {
  correr contract invoke --id "$ID" --source rb-sponsor --network "$RED" --send=no -- "$@"
}

# El saldo de una cuenta en el activo, como número.
saldo() {
  "$ST" contract invoke --id "$SAC" --source rb-sponsor --network "$RED" --send=no -- balance --id "$1" 2>/dev/null | tr -d '"'
}

# Un intento que la red tiene que rechazar. Recibe la función y sus argumentos.
rechaza() {
  if "$@"; then
    echo "ESTO NO TENDRIA QUE HABER PASADO: la red lo aceptó" | tee -a "$LOG"
  fi
}

nota "Corrida del $(date -u +%Y-%m-%d) en la red de prueba de Stellar"

nota "Las cuentas. Si alguna no existe, se crea y friendbot la fondea"
for n in rb-issuer rb-organizer rb-treasury rb-gate rb-sponsor rb-ana rb-beto rb-caro rb-dani; do
  if ! "$ST" keys address "$n" >/dev/null 2>&1; then
    "$ST" keys generate "$n" --network "$RED" --fund >/dev/null 2>&1
  fi
  printf '%-13s %s\n' "$n" "$(direccion "$n")" | tee -a "$LOG"
done

nota "El activo con el que se paga: un USDC de prueba emitido por rb-issuer, y su contrato (SAC)"
EMISOR=$(direccion rb-issuer)
ACTIVO="USDC:$EMISOR"
SAC=$("$ST" contract id asset --asset "$ACTIVO" --network "$RED")
printf 'ACTIVO  %s\nSAC     %s\n' "$ACTIVO" "$SAC" | tee -a "$LOG"
if "$ST" contract invoke --id "$SAC" --source rb-sponsor --network "$RED" --send=no -- name >/dev/null 2>&1; then
  nota "El contrato del activo ya estaba desplegado: se sigue con el mismo"
else
  correr contract asset deploy --asset "$ACTIVO" --source rb-issuer --network "$RED"
fi

nota "Quien recibe el activo necesita su línea de confianza: quien organiza, Rumbo y quienes compran"
for n in rb-organizer rb-treasury rb-ana rb-beto rb-caro; do
  correr tx new change-trust --source "$n" --line "$ACTIVO" --network "$RED"
done

nota "Quienes van a comprar reciben 100 USDC de prueba"
for n in rb-ana rb-beto rb-caro; do
  correr tx new payment --source rb-issuer --destination "$(direccion "$n")" \
    --asset "$ACTIVO" --amount "$SALDO_INICIAL" --network "$RED"
done

nota "El WASM del contrato sube una sola vez; cada evento se despliega desde su hash"
correr contract upload --wasm "$WASM" --source rb-sponsor --network "$RED"
HASH=$(sha256sum "$WASM" | cut -d' ' -f1)
printf 'WASM HASH  %s\n' "$HASH" | tee -a "$LOG"

nota "Los saldos en USDC de prueba antes del evento: quien organiza y Rumbo"
for n in rb-organizer rb-treasury; do
  printf '%-13s %s\n' "$n" "$(saldo "$n")" | tee -a "$LOG"
done

nota "Evento pago: 10 USDC de prueba el pase, 2,5 por ciento para Rumbo, cupo de 50, dos beneficios"
correr contract deploy --wasm-hash "$HASH" --source rb-sponsor --network "$RED" \
  --alias rumbo-pass-pago -- \
  --organizer rb-organizer --treasury rb-treasury --gate rb-gate --asset "$SAC" \
  --price "$PRECIO" --fee_bps "$COMISION_BPS" --capacity "$CUPO" --benefits "$BENEFICIOS"
ID=$("$ST" contract alias show rumbo-pass-pago --network "$RED")
PAGO="$ID"
printf 'CONTRATO  %s\n' "$ID" | tee -a "$LOG"

nota "Tres personas compran su pase. En cada compra, 9,75 van a quien organiza y 0,25 a Rumbo, en la misma operación"
for n in rb-ana rb-beto rb-caro; do
  invocar buy --buyer "$n"
done

nota "Ana intenta comprar otro: es un pase por cuenta (AlreadyHasPass, #2)"
rechaza invocar buy --buyer rb-ana

nota "Ana entra por la puerta (firma la cuenta de puerta). Caro compró pero no vino"
invocar check_in --attendee rb-ana --by rb-gate

nota "Beto intenta marcar su propia entrada desde su casa: la marca solo la pone la puerta (NotAuthorized, #8)"
rechaza invocar check_in --attendee rb-beto --by rb-beto

nota "Beto llega y entra por la puerta"
invocar check_in --attendee rb-beto --by rb-gate

nota "Ana intenta entrar otra vez: se entra una sola vez (AlreadyCheckedIn, #4)"
rechaza invocar check_in --attendee rb-ana --by rb-gate

nota "En la mesa del almuerzo, la puerta canjea el beneficio 0 de Ana"
puerta redeem --attendee rb-ana --benefit 0

nota "El segundo almuerzo de Ana: cada beneficio se canjea una sola vez (AlreadyRedeemed, #6)"
rechaza puerta redeem --attendee rb-ana --benefit 0

nota "Caro no entró, así que no canjea (NotCheckedIn, #5)"
rechaza puerta redeem --attendee rb-caro --benefit 0

nota "El beneficio 2 no existe en este evento (NoSuchBenefit, #7)"
rechaza puerta redeem --attendee rb-ana --benefit 2

nota "El estado, leído del contrato"
leer status --who rb-ana
leer status --who rb-beto
leer status --who rb-caro
leer info

nota "Los saldos después: con tres pases, quien organiza subió 29,25 y Rumbo 0,75. El contrato no retiene nada"
for n in rb-organizer rb-treasury; do
  correr contract invoke --id "$SAC" --source rb-sponsor --network "$RED" --send=no -- balance --id "$n"
done
correr contract invoke --id "$SAC" --source rb-sponsor --network "$RED" --send=no -- balance --id "$ID"

nota "La lista de quienes entraron, en orden de llegada: la lista del sorteo"
leer attendees

nota "Antes del evento se mantiene vivo el contrato y los pases (extend_ttl, sin firma). Devuelve cuántos pases extendió"
invocar extend_ttl --holders "[\"$(direccion rb-ana)\",\"$(direccion rb-beto)\",\"$(direccion rb-caro)\",\"$(direccion rb-dani)\"]"

nota "Evento gratis: precio 0, cupo de 50, un beneficio"
correr contract deploy --wasm-hash "$HASH" --source rb-sponsor --network "$RED" \
  --alias rumbo-pass-gratis -- \
  --organizer rb-organizer --treasury rb-treasury --gate rb-gate --asset "$SAC" \
  --price 0 --fee_bps "$COMISION_BPS" --capacity "$CUPO" --benefits 1
ID=$("$ST" contract alias show rumbo-pass-gratis --network "$RED")
GRATIS="$ID"
printf 'CONTRATO  %s\n' "$ID" | tee -a "$LOG"

nota "Dani se inscribe gratis y entra por la puerta"
invocar register --attendee rb-dani
invocar check_in --attendee rb-dani --by rb-gate
leer attendees

nota "En un evento gratis no se compra (NotPaid, #10)"
rechaza invocar buy --buyer rb-dani

nota "Y en el evento pago no se inscribe gratis (NotFree, #9)"
ID="$PAGO"
rechaza invocar register --attendee rb-dani

printf '\nExplorador, evento pago:   https://stellar.expert/explorer/testnet/contract/%s\n' "$PAGO" | tee -a "$LOG"
printf 'Explorador, evento gratis: https://stellar.expert/explorer/testnet/contract/%s\n' "$GRATIS" | tee -a "$LOG"

# Los datos públicos del despliegue, para la app. Solo claves públicas.
cat > deploy/testnet.json <<EOF
{
  "network": "testnet",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "horizonUrl": "https://horizon-testnet.stellar.org",
  "friendbotUrl": "https://friendbot.stellar.org",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "wasmHash": "$HASH",
  "wasmBytes": $(stat -c %s "$WASM"),
  "asset": {
    "code": "USDC",
    "issuer": "$EMISOR",
    "contract": "$SAC",
    "decimals": 7,
    "name": { "es": "USDC de prueba", "en": "test USDC" }
  },
  "accounts": {
    "organizer": "$(direccion rb-organizer)",
    "treasury": "$(direccion rb-treasury)",
    "gate": "$(direccion rb-gate)",
    "sponsor": "$(direccion rb-sponsor)"
  },
  "events": {
    "paid": {
      "contract": "$PAGO",
      "price": "$PRECIO",
      "feeBps": $COMISION_BPS,
      "capacity": $CUPO,
      "benefits": $BENEFICIOS,
      "explorer": "https://stellar.expert/explorer/testnet/contract/$PAGO"
    },
    "free": {
      "contract": "$GRATIS",
      "price": "0",
      "feeBps": $COMISION_BPS,
      "capacity": $CUPO,
      "benefits": 1,
      "explorer": "https://stellar.expert/explorer/testnet/contract/$GRATIS"
    }
  },
  "demoAccounts": {
    "ana": "$(direccion rb-ana)",
    "beto": "$(direccion rb-beto)",
    "caro": "$(direccion rb-caro)",
    "dani": "$(direccion rb-dani)"
  }
}
EOF
printf '\nDatos del despliegue: deploy/testnet.json\nTranscripción: %s\n' "$LOG"
