#![no_std]
//! El pase de un evento de Rumbo.
//!
//! Cada evento despliega su propio contrato con la configuración fija: quién
//! organiza, la cuenta de Rumbo que recibe la comisión, la cuenta de puerta
//! (el escáner de los voluntarios), el activo con el que se paga, el precio
//! (0 si el evento es gratis), la comisión en puntos básicos, el cupo y cuántos
//! beneficios canjeables hay (el beneficio 0 es el almuerzo).
//!
//! Lo que la red garantiza sin confiar en Rumbo:
//!
//! - un pase por cuenta, y nunca más que el cupo;
//! - al comprar, la plata va de quien compra a quien organiza y la comisión a
//!   Rumbo en la misma invocación: el contrato nunca retiene saldo;
//! - se entra una sola vez, y cada beneficio se canjea una sola vez por pase;
//! - la entrada la marca solo la cuenta de puerta (el escáner del voluntario),
//!   nunca la propia persona: así `attendees()` es la lista de quienes de verdad
//!   pasaron por la puerta, en orden, y nadie entra al sorteo desde su casa.
//!
//! En la cadena viven cuentas, números de beneficio y marcas de uso. Nombres,
//! correos y todo lo personal quedan fuera, en la base de datos de la app.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    token::TokenClient, Address, Env, Vec,
};

#[cfg(test)]
mod test;

/// Ledgers por día, a un ledger cada cinco segundos.
const DAY_LEDGERS: u32 = 17_280;
/// Cuando a una entrada le quedan menos de 30 días de vida, se la extiende a 120.
const TTL_THRESHOLD: u32 = 30 * DAY_LEDGERS;
const TTL_EXTEND_TO: u32 = 120 * DAY_LEDGERS;

/// La lista de quienes entraron vive en una sola entrada de almacenamiento, y
/// una entrada tiene tope de tamaño. Mil cuentas entran holgadas; más que eso
/// pediría otra forma de guardarlas.
pub const MAX_CAPACITY: u32 = 1_000;
/// Beneficios canjeables por evento. Cada pase guarda cuáles canjeó.
pub const MAX_BENEFITS: u32 = 64;
/// La comisión se expresa en puntos básicos: 10000 es el 100 por ciento.
pub const BPS: u32 = 10_000;
/// El precio más alto que acepta un evento: con él, `price * fee_bps` no desborda
/// ni con la comisión entera, así que `buy` siempre puede calcular el reparto.
pub const MAX_PRICE: i128 = i128::MAX / BPS as i128;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// La configuración del evento. Almacenamiento de instancia.
    Config,
    /// Cuántos pases se emitieron, gratis o pagos. Almacenamiento de instancia.
    Issued,
    /// El pase de una cuenta. Almacenamiento persistente.
    Pass(Address),
    /// Quienes entraron, en orden de llegada. Almacenamiento persistente.
    Attendees,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub organizer: Address,
    /// La cuenta de Rumbo que recibe la comisión.
    pub treasury: Address,
    /// La cuenta de puerta: marca entradas y canjes desde el escáner.
    pub gate: Address,
    /// El activo con el que se paga (su contrato SEP-41).
    pub asset: Address,
    /// 0 si el evento es gratis.
    pub price: i128,
    /// Comisión de Rumbo en puntos básicos sobre el precio.
    pub fee_bps: u32,
    pub capacity: u32,
    /// Cantidad de beneficios canjeables: valen los números de 0 a benefits - 1.
    pub benefits: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Pass {
    /// En qué orden se emitió: el primero es 1.
    pub number: u32,
    pub checked_in: bool,
    /// Los beneficios ya canjeados, en el orden en que se canjearon.
    pub redeemed: Vec<u32>,
}

/// Lo que se sabe de una cuenta: si tiene pase, si entró y qué canjeó.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PassStatus {
    pub has_pass: bool,
    /// El número de pase, o 0 si no tiene.
    pub number: u32,
    pub checked_in: bool,
    pub redeemed: Vec<u32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventInfo {
    pub organizer: Address,
    pub treasury: Address,
    pub gate: Address,
    pub asset: Address,
    pub price: i128,
    pub fee_bps: u32,
    pub capacity: u32,
    pub benefits: u32,
    pub issued: u32,
    pub checked_in: u32,
}

/// Los códigos son parte de la interfaz: nunca se renumeran.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    /// La cuenta no tiene pase.
    NoPass = 1,
    /// La cuenta ya tiene pase: es uno por cuenta.
    AlreadyHasPass = 2,
    /// Se llegó al cupo.
    SoldOut = 3,
    /// Ya entró.
    AlreadyCheckedIn = 4,
    /// Para canjear hay que haber entrado.
    NotCheckedIn = 5,
    /// Ese beneficio ya se canjeó con este pase.
    AlreadyRedeemed = 6,
    /// El evento no tiene ese beneficio.
    NoSuchBenefit = 7,
    /// Quien marca la entrada no es la cuenta de puerta.
    NotAuthorized = 8,
    /// `register` en un evento pago: hay que comprar.
    NotFree = 9,
    /// No hubo pago: `buy` en un evento gratis, o el activo no se pudo mover
    /// (sin saldo, sin línea de confianza).
    NotPaid = 10,
    /// El precio es negativo o pasa de `MAX_PRICE`.
    InvalidPrice = 11,
    InvalidFee = 12,
    InvalidCapacity = 13,
    InvalidBenefits = 14,
    NotConfigured = 15,
}

#[contractevent]
pub struct PassIssued {
    #[topic]
    pub attendee: Address,
    /// El número de pase: el primero es 1.
    pub number: u32,
    /// Lo que pagó (0 si fue gratis) y cuánto de eso fue comisión.
    pub paid: i128,
    pub fee: i128,
}

#[contractevent]
pub struct CheckedIn {
    #[topic]
    pub attendee: Address,
    /// En qué lugar entró: el primero es 1.
    pub arrival: u32,
}

#[contractevent]
pub struct Redeemed {
    #[topic]
    pub attendee: Address,
    pub benefit: u32,
}

#[contract]
pub struct RumboPass;

#[contractimpl]
impl RumboPass {
    /// Se configura una sola vez, al desplegar, y no se puede cambiar: ni el
    /// precio, ni la comisión, ni el cupo se tocan después de que alguien tiene
    /// su pase.
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        organizer: Address,
        treasury: Address,
        gate: Address,
        asset: Address,
        price: i128,
        fee_bps: u32,
        capacity: u32,
        benefits: u32,
    ) {
        if !(0..=MAX_PRICE).contains(&price) {
            panic_with_error!(&env, Error::InvalidPrice);
        }
        if fee_bps > BPS {
            panic_with_error!(&env, Error::InvalidFee);
        }
        if capacity == 0 || capacity > MAX_CAPACITY {
            panic_with_error!(&env, Error::InvalidCapacity);
        }
        if benefits > MAX_BENEFITS {
            panic_with_error!(&env, Error::InvalidBenefits);
        }
        env.storage().instance().set(
            &DataKey::Config,
            &Config { organizer, treasury, gate, asset, price, fee_bps, capacity, benefits },
        );
        env.storage().instance().set(&DataKey::Issued, &0u32);
    }

    /// Emite un pase gratis. Firma quien se inscribe. Solo en eventos gratis:
    /// en uno pago falla con `NotFree`. Un pase por cuenta y nunca más que el
    /// cupo. Devuelve el número de pase.
    pub fn register(env: Env, attendee: Address) -> Result<u32, Error> {
        attendee.require_auth();
        let cfg = config(&env)?;
        if cfg.price != 0 {
            return Err(Error::NotFree);
        }
        let number = next_pass_number(&env, &cfg, &attendee)?;
        write_pass(&env, &attendee, number);
        PassIssued { attendee, number, paid: 0, fee: 0 }.publish(&env);
        Ok(number)
    }

    /// Compra un pase. Firma quien compra. Cobra `price` del activo y, en la
    /// misma invocación, le pasa a quien organiza su parte y a la cuenta de
    /// Rumbo la comisión (`price * fee_bps / 10000`, redondeada hacia abajo).
    /// El contrato nunca retiene saldo: si una transferencia falla, no hay
    /// pase y nadie pagó nada. Un pase por cuenta y nunca más que el cupo.
    /// Devuelve el número de pase.
    pub fn buy(env: Env, buyer: Address) -> Result<u32, Error> {
        buyer.require_auth();
        let cfg = config(&env)?;
        if cfg.price == 0 {
            return Err(Error::NotPaid);
        }
        let number = next_pass_number(&env, &cfg, &buyer)?;

        // No desborda: el constructor acota el precio a MAX_PRICE y la comisión a BPS.
        let fee = cfg.price * i128::from(cfg.fee_bps) / i128::from(BPS);
        let token = TokenClient::new(&env, &cfg.asset);
        pay(&token, &buyer, &cfg.organizer, cfg.price - fee)?;
        pay(&token, &buyer, &cfg.treasury, fee)?;

        write_pass(&env, &buyer, number);
        PassIssued { attendee: buyer, number, paid: cfg.price, fee }.publish(&env);
        Ok(number)
    }

    /// Marca la entrada, una sola vez. Firma `by`, que tiene que ser la cuenta
    /// de puerta: la marca el escáner del voluntario en la puerta, nunca la
    /// propia persona, que de otro modo podría entrar a la lista (y al sorteo)
    /// sin haber ido. `attendee` es solo el dato de quién entró. `by` queda como
    /// parámetro para que, si un día hay varias puertas, la firma siga siendo de
    /// una cuenta concreta. Devuelve en qué lugar entró (el primero es 1).
    pub fn check_in(env: Env, attendee: Address, by: Address) -> Result<u32, Error> {
        let cfg = config(&env)?;
        if by != cfg.gate {
            return Err(Error::NotAuthorized);
        }
        by.require_auth();

        let key = DataKey::Pass(attendee.clone());
        let mut pass: Pass = env.storage().persistent().get(&key).ok_or(Error::NoPass)?;
        if pass.checked_in {
            return Err(Error::AlreadyCheckedIn);
        }
        pass.checked_in = true;
        env.storage().persistent().set(&key, &pass);
        env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        let mut list = attendees(&env);
        list.push_back(attendee.clone());
        env.storage().persistent().set(&DataKey::Attendees, &list);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Attendees, TTL_THRESHOLD, TTL_EXTEND_TO);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        let arrival = list.len();
        CheckedIn { attendee, arrival }.publish(&env);
        Ok(arrival)
    }

    /// Canjea un beneficio del pase de `attendee`, una sola vez por pase y
    /// beneficio. Firma la cuenta de puerta. Hay que haber entrado antes.
    pub fn redeem(env: Env, attendee: Address, benefit: u32) -> Result<(), Error> {
        let cfg = config(&env)?;
        cfg.gate.require_auth();
        if benefit >= cfg.benefits {
            return Err(Error::NoSuchBenefit);
        }

        let key = DataKey::Pass(attendee.clone());
        let mut pass: Pass = env.storage().persistent().get(&key).ok_or(Error::NoPass)?;
        if !pass.checked_in {
            return Err(Error::NotCheckedIn);
        }
        if pass.redeemed.contains(benefit) {
            return Err(Error::AlreadyRedeemed);
        }
        pass.redeemed.push_back(benefit);
        env.storage().persistent().set(&key, &pass);
        env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        Redeemed { attendee, benefit }.publish(&env);
        Ok(())
    }

    /// Lo que se sabe de una cuenta: si tiene pase, si entró y qué canjeó.
    pub fn status(env: Env, who: Address) -> PassStatus {
        match env.storage().persistent().get::<_, Pass>(&DataKey::Pass(who)) {
            Some(pass) => PassStatus {
                has_pass: true,
                number: pass.number,
                checked_in: pass.checked_in,
                redeemed: pass.redeemed,
            },
            None => PassStatus {
                has_pass: false,
                number: 0,
                checked_in: false,
                redeemed: Vec::new(&env),
            },
        }
    }

    /// Quienes entraron, en orden de llegada. Es la lista que se sortea.
    pub fn attendees(env: Env) -> Vec<Address> {
        attendees(&env)
    }

    /// La configuración del evento y los contadores.
    pub fn info(env: Env) -> Result<EventInfo, Error> {
        let cfg = config(&env)?;
        Ok(EventInfo {
            organizer: cfg.organizer,
            treasury: cfg.treasury,
            gate: cfg.gate,
            asset: cfg.asset,
            price: cfg.price,
            fee_bps: cfg.fee_bps,
            capacity: cfg.capacity,
            benefits: cfg.benefits,
            issued: issued(&env),
            checked_in: attendees(&env).len(),
        })
    }
}

fn config(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotConfigured)
}

fn issued(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::Issued).unwrap_or(0)
}

fn attendees(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::Attendees)
        .unwrap_or(Vec::new(env))
}

/// Comprueba que `who` puede recibir un pase y devuelve el número que le toca.
/// Se comprueba antes de mover plata, para que a nadie se le cobre un pase que
/// no va a recibir.
fn next_pass_number(env: &Env, cfg: &Config, who: &Address) -> Result<u32, Error> {
    if env.storage().persistent().has(&DataKey::Pass(who.clone())) {
        return Err(Error::AlreadyHasPass);
    }
    let issued = issued(env);
    if issued >= cfg.capacity {
        return Err(Error::SoldOut);
    }
    Ok(issued + 1)
}

fn write_pass(env: &Env, who: &Address, number: u32) {
    let key = DataKey::Pass(who.clone());
    env.storage().persistent().set(
        &key,
        &Pass { number, checked_in: false, redeemed: Vec::new(env) },
    );
    env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    env.storage().instance().set(&DataKey::Issued, &number);
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Mueve `amount` del activo de `from` a `to`. Si el activo no se puede mover
/// (sin saldo, sin línea de confianza, cuenta congelada), devuelve `NotPaid`
/// y la invocación entera se deshace: ninguna transferencia anterior queda.
fn pay(token: &TokenClient, from: &Address, to: &Address, amount: i128) -> Result<(), Error> {
    if amount == 0 {
        return Ok(());
    }
    match token.try_transfer(from, to, &amount) {
        Ok(Ok(())) => Ok(()),
        _ => Err(Error::NotPaid),
    }
}
