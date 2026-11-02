#![cfg(test)]
//! Las pruebas del pase: cada función, cada error, el reparto exacto de la
//! comisión con el activo de prueba del SDK, el cupo, el doble canje y quién
//! tiene que firmar cada cosa (la entrada, solo la puerta).

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, IntoVal,
};

/// 10 USDC de prueba, con siete decimales.
const PRICE: i128 = 100_000_000;
/// 2,5 por ciento de comisión.
const FEE_BPS: u32 = 250;
/// Lo que la comisión de arriba da sobre el precio de arriba.
const FEE: i128 = 2_500_000;
const LUNCH: u32 = 0;
const SHIRT: u32 = 1;

struct Setup {
    env: Env,
    contract: Address,
    organizer: Address,
    treasury: Address,
    gate: Address,
    asset: Address,
}

fn setup_with(price: i128, fee_bps: u32, capacity: u32, benefits: u32) -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let asset = env.register_stellar_asset_contract_v2(admin).address();
    let organizer = Address::generate(&env);
    let treasury = Address::generate(&env);
    let gate = Address::generate(&env);
    let contract = env.register(
        RumboPass,
        (
            organizer.clone(),
            treasury.clone(),
            gate.clone(),
            asset.clone(),
            price,
            fee_bps,
            capacity,
            benefits,
        ),
    );
    Setup { env, contract, organizer, treasury, gate, asset }
}

/// Un evento pago con dos beneficios: el almuerzo y la polera.
fn paid(capacity: u32) -> Setup {
    setup_with(PRICE, FEE_BPS, capacity, 2)
}

/// Un evento gratis con los mismos dos beneficios.
fn free(capacity: u32) -> Setup {
    setup_with(0, FEE_BPS, capacity, 2)
}

impl Setup {
    fn client(&self) -> RumboPassClient<'_> {
        RumboPassClient::new(&self.env, &self.contract)
    }

    /// Una cuenta nueva, sin saldo.
    fn person(&self) -> Address {
        Address::generate(&self.env)
    }

    /// Una cuenta nueva con saldo para cinco pases.
    fn buyer(&self) -> Address {
        let a = self.person();
        StellarAssetClient::new(&self.env, &self.asset).mint(&a, &(PRICE * 5));
        a
    }

    fn balance(&self, who: &Address) -> i128 {
        TokenClient::new(&self.env, &self.asset).balance(who)
    }

    /// Una persona inscripta que ya entró por la puerta.
    fn inside(&self) -> Address {
        let a = self.person();
        self.client().register(&a);
        self.client().check_in(&a, &self.gate);
        a
    }
}

// ---------------------------------------------------------------- register

#[test]
fn a_free_event_gives_one_pass_per_account_up_to_capacity() {
    let s = free(2);
    let (a, b, c) = (s.person(), s.person(), s.person());
    assert_eq!(s.client().register(&a), 1);
    assert_eq!(s.client().register(&b), 2);
    assert_eq!(s.client().try_register(&a), Err(Ok(Error::AlreadyHasPass)));
    assert_eq!(s.client().try_register(&c), Err(Ok(Error::SoldOut)));

    let st = s.client().status(&a);
    assert!(st.has_pass);
    assert_eq!(st.number, 1);
    assert!(!st.checked_in);
    assert_eq!(st.redeemed.len(), 0);
    assert!(!s.client().status(&c).has_pass);
    assert_eq!(s.client().info().issued, 2);
}

#[test]
fn registering_is_signed_by_the_attendee() {
    let s = free(10);
    let a = s.person();
    s.client().register(&a);
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, a);
}

#[test]
fn a_paid_event_does_not_register_for_free() {
    let s = paid(10);
    let a = s.buyer();
    assert_eq!(s.client().try_register(&a), Err(Ok(Error::NotFree)));
    assert!(!s.client().status(&a).has_pass);
    assert_eq!(s.client().info().issued, 0);
}

// --------------------------------------------------------------------- buy

#[test]
fn buying_pays_organizer_and_treasury_in_the_same_call() {
    let s = paid(10);
    let a = s.buyer();
    assert_eq!(s.client().buy(&a), 1);
    assert_eq!(s.balance(&a), PRICE * 4);
    assert_eq!(s.balance(&s.organizer), PRICE - FEE);
    assert_eq!(s.balance(&s.treasury), FEE);
    // la plata no queda en el contrato
    assert_eq!(s.balance(&s.contract), 0);

    let st = s.client().status(&a);
    assert!(st.has_pass);
    assert_eq!(st.number, 1);
}

#[test]
fn buying_is_signed_by_the_buyer_and_covers_both_transfers() {
    let s = paid(10);
    let a = s.buyer();
    s.client().buy(&a);
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, a);
    // las dos transferencias cuelgan de la misma autorización
    assert_eq!(auths[0].1.sub_invocations.len(), 2);
}

#[test]
fn the_fee_rounds_down_and_the_organizer_gets_the_rest() {
    // precio 3, comisión 33,33 por ciento: 0,9999 se redondea a 0
    let s = setup_with(3, 3_333, 10, 1);
    let a = s.person();
    StellarAssetClient::new(&s.env, &s.asset).mint(&a, &3);
    s.client().buy(&a);
    assert_eq!(s.balance(&a), 0);
    assert_eq!(s.balance(&s.organizer), 3);
    assert_eq!(s.balance(&s.treasury), 0);
}

#[test]
fn without_fee_everything_goes_to_the_organizer() {
    let s = setup_with(PRICE, 0, 10, 1);
    let a = s.buyer();
    s.client().buy(&a);
    assert_eq!(s.balance(&s.organizer), PRICE);
    assert_eq!(s.balance(&s.treasury), 0);
}

#[test]
fn with_the_whole_fee_everything_goes_to_the_treasury() {
    let s = setup_with(PRICE, BPS, 10, 1);
    let a = s.buyer();
    s.client().buy(&a);
    assert_eq!(s.balance(&s.organizer), 0);
    assert_eq!(s.balance(&s.treasury), PRICE);
}

#[test]
fn a_free_event_is_not_bought() {
    let s = free(10);
    let a = s.buyer();
    assert_eq!(s.client().try_buy(&a), Err(Ok(Error::NotPaid)));
    assert!(!s.client().status(&a).has_pass);
    assert_eq!(s.balance(&a), PRICE * 5);
}

#[test]
fn without_balance_there_is_no_payment_and_no_pass() {
    let s = paid(10);
    let a = s.person();
    assert_eq!(s.client().try_buy(&a), Err(Ok(Error::NotPaid)));
    assert!(!s.client().status(&a).has_pass);
    assert_eq!(s.balance(&s.organizer), 0);
    assert_eq!(s.balance(&s.treasury), 0);
    assert_eq!(s.client().info().issued, 0);
}

#[test]
fn a_pass_is_not_bought_twice_and_the_second_try_costs_nothing() {
    let s = paid(10);
    let a = s.buyer();
    s.client().buy(&a);
    assert_eq!(s.client().try_buy(&a), Err(Ok(Error::AlreadyHasPass)));
    assert_eq!(s.balance(&a), PRICE * 4);
    assert_eq!(s.balance(&s.organizer), PRICE - FEE);
    assert_eq!(s.client().info().issued, 1);
}

#[test]
fn capacity_is_respected_and_the_extra_buyer_is_not_charged() {
    let s = paid(2);
    let (a, b, c) = (s.buyer(), s.buyer(), s.buyer());
    assert_eq!(s.client().buy(&a), 1);
    assert_eq!(s.client().buy(&b), 2);
    assert_eq!(s.client().try_buy(&c), Err(Ok(Error::SoldOut)));
    assert_eq!(s.balance(&c), PRICE * 5);
    assert_eq!(s.balance(&s.organizer), (PRICE - FEE) * 2);
    assert_eq!(s.balance(&s.treasury), FEE * 2);
}

// ---------------------------------------------------------------- check_in

#[test]
fn one_enters_through_the_gate_and_only_once() {
    let s = free(10);
    let (a, b) = (s.person(), s.person());
    s.client().register(&a);
    s.client().register(&b);

    assert_eq!(s.client().check_in(&a, &s.gate), 1);
    assert_eq!(s.client().check_in(&b, &s.gate), 2);
    assert_eq!(s.client().try_check_in(&a, &s.gate), Err(Ok(Error::AlreadyCheckedIn)));
    assert_eq!(s.client().try_check_in(&b, &s.gate), Err(Ok(Error::AlreadyCheckedIn)));

    assert!(s.client().status(&a).checked_in);
    assert!(s.client().status(&b).checked_in);
    assert_eq!(s.client().attendees(), vec![&s.env, a, b]);
    assert_eq!(s.client().info().checked_in, 2);
}

#[test]
fn nobody_marks_their_own_entry() {
    let s = free(10);
    let a = s.person();
    s.client().register(&a);
    // aunque la persona firme, su propia cuenta no marca la entrada: la marca solo la puerta
    assert_eq!(s.client().try_check_in(&a, &a), Err(Ok(Error::NotAuthorized)));
    assert!(!s.client().status(&a).checked_in);
    assert_eq!(s.client().attendees().len(), 0);
    assert_eq!(s.client().info().checked_in, 0);
    // y como no entró, tampoco canjea nada
    assert_eq!(s.client().try_redeem(&a, &LUNCH), Err(Ok(Error::NotCheckedIn)));
}

#[test]
fn the_attendee_signature_alone_does_not_mark_the_entry_by_the_gate() {
    let s = free(10);
    let a = s.person();
    s.client().register(&a);
    // de acá en más solo firma la persona: que diga que la marca la puerta no alcanza
    s.env.mock_auths(&[MockAuth {
        address: &a,
        invoke: &MockAuthInvoke {
            contract: &s.contract,
            fn_name: "check_in",
            args: (a.clone(), s.gate.clone()).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    assert!(s.client().try_check_in(&a, &s.gate).is_err());
    assert!(!s.client().status(&a).checked_in);
    assert_eq!(s.client().attendees().len(), 0);
}

#[test]
fn nobody_else_marks_an_entry() {
    let s = free(10);
    let a = s.person();
    s.client().register(&a);
    let stranger = s.person();
    assert_eq!(s.client().try_check_in(&a, &stranger), Err(Ok(Error::NotAuthorized)));
    // ni quien organiza, si no es la cuenta de puerta
    assert_eq!(s.client().try_check_in(&a, &s.organizer), Err(Ok(Error::NotAuthorized)));
    assert!(!s.client().status(&a).checked_in);
    assert_eq!(s.client().attendees().len(), 0);
}

#[test]
fn the_entry_is_signed_by_the_gate() {
    let s = free(10);
    let a = s.person();
    s.client().register(&a);
    s.client().check_in(&a, &s.gate);
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.gate);
}

#[test]
fn without_a_pass_there_is_no_entry() {
    let s = free(10);
    let intruder = s.person();
    assert_eq!(s.client().try_check_in(&intruder, &s.gate), Err(Ok(Error::NoPass)));
    // por su cuenta ni siquiera llega a mirar el pase: quien marca no es la puerta
    assert_eq!(s.client().try_check_in(&intruder, &intruder), Err(Ok(Error::NotAuthorized)));
    assert!(!s.client().status(&intruder).has_pass);
    assert_eq!(s.client().attendees().len(), 0);
}

#[test]
fn the_list_is_who_came_in_arrival_order() {
    let s = free(10);
    let (a, b, c) = (s.person(), s.person(), s.person());
    for x in [&a, &b, &c] {
        s.client().register(x);
    }
    s.client().check_in(&c, &s.gate);
    s.client().check_in(&a, &s.gate);
    // b tiene pase pero no vino: no está en la lista
    assert_eq!(s.client().attendees(), vec![&s.env, c, a]);
    let info = s.client().info();
    assert_eq!((info.issued, info.checked_in), (3, 2));
}

// ------------------------------------------------------------------ redeem

#[test]
fn a_benefit_is_redeemed_once_per_pass() {
    let s = free(10);
    let a = s.inside();
    s.client().redeem(&a, &LUNCH);
    assert_eq!(s.client().try_redeem(&a, &LUNCH), Err(Ok(Error::AlreadyRedeemed)));
    // otro beneficio del mismo pase, sí
    s.client().redeem(&a, &SHIRT);
    assert_eq!(s.client().try_redeem(&a, &SHIRT), Err(Ok(Error::AlreadyRedeemed)));
    assert_eq!(s.client().status(&a).redeemed, vec![&s.env, LUNCH, SHIRT]);
}

#[test]
fn each_pass_has_its_own_benefits() {
    let s = free(10);
    let (a, b) = (s.inside(), s.inside());
    s.client().redeem(&a, &LUNCH);
    s.client().redeem(&b, &LUNCH);
    assert_eq!(s.client().status(&a).redeemed, vec![&s.env, LUNCH]);
    assert_eq!(s.client().status(&b).redeemed, vec![&s.env, LUNCH]);
}

#[test]
fn no_redeem_before_entering() {
    let s = free(10);
    let a = s.person();
    s.client().register(&a);
    assert_eq!(s.client().try_redeem(&a, &LUNCH), Err(Ok(Error::NotCheckedIn)));
    s.client().check_in(&a, &s.gate);
    s.client().redeem(&a, &LUNCH);
    assert_eq!(s.client().status(&a).redeemed, vec![&s.env, LUNCH]);
}

#[test]
fn no_redeem_without_a_pass() {
    let s = free(10);
    let intruder = s.person();
    assert_eq!(s.client().try_redeem(&intruder, &LUNCH), Err(Ok(Error::NoPass)));
}

#[test]
fn unknown_benefits_are_rejected() {
    let s = free(10);
    let a = s.inside();
    assert_eq!(s.client().try_redeem(&a, &2), Err(Ok(Error::NoSuchBenefit)));
    assert_eq!(s.client().status(&a).redeemed.len(), 0);

    // un evento sin beneficios no canjea nada
    let none = setup_with(0, 0, 10, 0);
    let b = none.inside();
    assert_eq!(none.client().try_redeem(&b, &LUNCH), Err(Ok(Error::NoSuchBenefit)));
}

#[test]
fn redeeming_is_signed_by_the_gate() {
    let s = free(10);
    let a = s.inside();
    s.client().redeem(&a, &LUNCH);
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.gate);
}

#[test]
fn the_attendee_alone_cannot_redeem_their_own_benefit() {
    let s = free(10);
    let a = s.inside();
    // de acá en más solo firma la persona, no la puerta
    s.env.mock_auths(&[MockAuth {
        address: &a,
        invoke: &MockAuthInvoke {
            contract: &s.contract,
            fn_name: "redeem",
            args: (a.clone(), LUNCH).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    assert!(s.client().try_redeem(&a, &LUNCH).is_err());
    assert_eq!(s.client().status(&a).redeemed.len(), 0);
}

#[test]
fn the_gate_alone_cannot_buy_for_someone_else() {
    let s = paid(10);
    let a = s.buyer();
    s.env.mock_auths(&[MockAuth {
        address: &s.gate,
        invoke: &MockAuthInvoke {
            contract: &s.contract,
            fn_name: "buy",
            args: (a.clone(),).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    assert!(s.client().try_buy(&a).is_err());
    assert!(!s.client().status(&a).has_pass);
    assert_eq!(s.balance(&a), PRICE * 5);
}

// ------------------------------------------------------------ status, info

#[test]
fn status_of_an_unknown_account_is_empty() {
    let s = free(10);
    let st = s.client().status(&s.person());
    assert_eq!(
        st,
        PassStatus { has_pass: false, number: 0, checked_in: false, redeemed: vec![&s.env] }
    );
}

#[test]
fn info_shows_the_configuration_and_the_counters() {
    let s = paid(50);
    let a = s.buyer();
    s.client().buy(&a);
    s.client().check_in(&a, &s.gate);
    let info = s.client().info();
    assert_eq!(info.organizer, s.organizer);
    assert_eq!(info.treasury, s.treasury);
    assert_eq!(info.gate, s.gate);
    assert_eq!(info.asset, s.asset);
    assert_eq!(info.price, PRICE);
    assert_eq!(info.fee_bps, FEE_BPS);
    assert_eq!(info.capacity, 50);
    assert_eq!(info.benefits, 2);
    assert_eq!(info.issued, 1);
    assert_eq!(info.checked_in, 1);
}

// ------------------------------------------------------------- constructor

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn a_negative_price_is_rejected_at_deploy() {
    setup_with(-1, FEE_BPS, 10, 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn a_fee_above_one_hundred_percent_is_rejected_at_deploy() {
    setup_with(PRICE, BPS + 1, 10, 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn a_capacity_of_zero_is_rejected_at_deploy() {
    setup_with(PRICE, FEE_BPS, 0, 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn a_capacity_above_the_list_limit_is_rejected_at_deploy() {
    setup_with(PRICE, FEE_BPS, MAX_CAPACITY + 1, 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn too_many_benefits_are_rejected_at_deploy() {
    setup_with(PRICE, FEE_BPS, 10, MAX_BENEFITS + 1);
}

#[test]
fn the_list_holds_a_full_house_at_the_maximum_capacity() {
    let s = free(MAX_CAPACITY);
    s.env.cost_estimate().budget().reset_unlimited();
    let mut people = std::vec::Vec::new();
    for _ in 0..MAX_CAPACITY {
        let a = s.person();
        s.client().register(&a);
        people.push(a);
    }
    assert_eq!(s.client().try_register(&s.person()), Err(Ok(Error::SoldOut)));
    for a in &people {
        s.env.cost_estimate().budget().reset_unlimited();
        s.client().check_in(a, &s.gate);
    }
    let list = s.client().attendees();
    assert_eq!(list.len(), MAX_CAPACITY);
    assert_eq!(list.get(0).unwrap(), people[0]);
    assert_eq!(list.get(MAX_CAPACITY - 1).unwrap(), people[people.len() - 1]);
    assert_eq!(s.client().info().checked_in, MAX_CAPACITY);
}
