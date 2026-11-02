<div align="center">

# Rumbo

### Community events on Stellar. Sell tickets from anywhere, and run the whole event from one QR code.

[![Built on Stellar](https://img.shields.io/badge/built%20on-Stellar-7b61ff?style=flat-square)](https://stellar.org)
[![Status: design](https://img.shields.io/badge/status-design%20stage-ffc629?style=flat-square)](#where-it-stands)
[![License: MIT](https://img.shields.io/badge/license-MIT-14b8a6?style=flat-square)](LICENSE)

[Español](README.es.md) | [What it does](#what-it-does) | [Why Stellar](#why-stellar) | [Where it stands](#where-it-stands) | [Principles](#principles) | [Who](#who)

</div>

---

A community event today is six tools and a spreadsheet. Registration lives in Luma. Badges are made in Canva. Lunch vouchers are paper tickets or a column someone ticks by hand. Merch is sold over Instagram messages. Prizes are a photo. And when the event is over, the sponsor report is assembled from memory.

On top of that, in much of the world the organizer cannot charge for tickets at all: the platforms they already use need a Stripe account, and Stripe does not pay out in their country. Bolivia is one of those countries.

**Rumbo puts the whole event in one place, and lets the organizer get paid in seconds from anywhere.** Tickets are paid in digital dollars (USDC on Stellar) or, in Bolivia, with the QR code of the buyer's own bank through a licensed partner. Each attendee gets a pass with a QR code. Volunteers scan it to check people in and to hand out what each person is entitled to: lunch, a t-shirt, a prize. Every redemption happens once, and the sponsor sees exactly what was delivered.

Rumbo is made for events of 80 to 500 people with sponsors and several benefits: hackathons, DevFests, community conferences, bootcamps, chapter meetups. It is built in Bolivia, in Spanish and English from day one, by people who organize these events themselves.

## What it does

**For the organizer**

1. Create the event, with a form or by describing it in plain words and approving the draft Rumbo proposes: ticket types, benefits, the pass design, the welcome email.
2. Publish the event page, with free or paid registration. Guest lists from Luma can be imported as CSV.
3. Get paid in USDC from anywhere, or in bolivianos with a bank QR code through a licensed on-ramp. The money reaches the organizer in the same operation that separates Rumbo's fee. Rumbo never holds the money.
4. Optionally, protected payment: the ticket stays in a contract until the event happens, and refunds go out on their own if it is cancelled.
5. Export the passes as SVG or PDF to print, or leave them on each attendee's phone.
6. On the day, volunteers scan with their phones. The scanner works offline and syncs later: the queue never waits for the network.
7. Afterwards, a live dashboard and a report for each sponsor: "300 coffees redeemed, 12 prizes delivered with proof".

**For the attendee**

- Register with Google or a passkey. A Stellar account is created underneath without them having to know.
- Receive an email with a personal link. Never keys or passwords.
- Keep the pass on the phone and see what they are entitled to: "Saturday lunch: pending", "T-shirt M: paid, pick up at the desk", "Draw prize: a pair of headphones".

**For the volunteer**

- Scan the QR code, see what this person gets, mark it as redeemed. It cannot be redeemed twice. No account, no training.

**For the sponsor**

- Offer benefits ("a coffee for every attendee") and see how many were redeemed.
- Keep the contact of the people who agree to share it when scanned at the booth.
- Get the report.

## Why Stellar

For counting lunches a database would do. Stellar adds what a database cannot:

- **Getting paid from any country in seconds,** even where card processors do not pay out. One operation pays the organizer and separates the platform fee, with nobody holding the money in between.
- **Protected payments** that refund on their own if the event is cancelled.
- **Vouchers that can only be used once,** and prizes delivered with a proof that does not depend on Rumbo. On testnet the voucher is not money, but the lunch is real: a community can run real events on Rumbo today, with no funds at risk.
- **Every attendee leaves with a Stellar account** that works at the next event, created with Google or a passkey, with network fees sponsored so nobody needs to hold XLM.
- **Payments to speakers and volunteers** in any country.
- **An API other apps and agents can pay per use,** with x402.

Rumbo is not a ticket NFT and not a place to speculate on resale. If the organizer allows resale, it happens at the original price.

## With Tinkazo

[Tinkazo](https://tinkazo.app) runs draws anyone can check from their phone. Rumbo and Tinkazo are different products that fit together: Tinkazo decides who wins, Rumbo delivers what was won and runs everything else at the event. The prize from a Tinkazo draw lands on the winner's pass, the draw runs over the people who actually checked in, and entering a draw is always free, whether the event is paid or not.

## Where it stands

Rumbo is at the design stage. The product is specified in detail and the first code lands in November 2026.

The contract starts from an event pass written in September 2026 for Stellar Elite Bolivia: buy a pass, check in once, list who came, with nine tests and a run on testnet. Rumbo extends it with benefits, redemptions and protected payments.

| First | Then | Later |
|---|---|---|
| Event page with free or paid registration (USDC on testnet) | Protected payment with automatic refund | Bank QR payments in bolivianos on mainnet |
| Account with Google or a passkey, fees sponsored | Describe the event in plain words and approve the draft | Resale at the original price |
| Pass with QR code, on the phone and as SVG or PDF | Prize from a Tinkazo draw landing on the pass | Pay-per-use API with x402 |
| Check-in and redemptions with an offline scanner | Sponsor report | Payments to speakers |
| Organizer dashboard | Luma CSV import | Licenses for community networks |

## Principles

- **No custody.** Money goes straight to the organizer or sits in the contract of a protected payment. Rumbo never holds it.
- **No on-ramp of its own.** Converting bolivianos is done by partners who hold the license.
- **No personal data on chain.** Names and emails stay off the ledger and are used only to notify people. Booth contacts are shared only when the person agrees, at that booth.
- **Free events are free.** The fee applies when money changes hands.
- **No technical jargon on screen.** Nobody at the door needs to know there is a blockchain underneath.
- **Open core, hosted service.** The redemption contract, the scanner and the event template are open source under MIT, so any community can run and adapt them. The hosted service (event setup, emails, real-time dashboard, payments and reports) is what Rumbo charges for.

## Who

Rumbo is made in Santa Cruz de la Sierra, Bolivia, by its two founders: [Nicolás Emir Mejía Agreda](https://github.com/nema1502), who has organized community tech events with n8n, Clerk, Chainlink, Supabase, Women Techmakers and Team1 and writes the contracts, and [Guido Salazar](https://github.com/GuidoSV7), who builds the frontend.

Questions and ideas: open an issue.

## License

[MIT](LICENSE).
