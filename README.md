<div align="center">

# Rumbo

### Community events on Stellar. Free sign-up or paid tickets from anywhere, and the whole event run from one QR code.

[![Built on Stellar](https://img.shields.io/badge/built%20on-Stellar-7b61ff?style=flat-square)](https://stellar.org)
[![Status: MVP on testnet](https://img.shields.io/badge/status-MVP%20on%20testnet-ffc629?style=flat-square)](#where-it-stands)
[![License: MIT](https://img.shields.io/badge/license-MIT-14b8a6?style=flat-square)](LICENSE)

**[rumbo-eventos.vercel.app](https://rumbo-eventos.vercel.app)** | [Español](README.es.md) | [What it does](#what-it-does) | [Why Stellar](#why-stellar) | [Where it stands](#where-it-stands) | [How it is different](#how-rumbo-is-different) | [For Stellar chapters](#for-stellar-ambassador-chapters) | [Principles](#principles) | [Who](#who)

<img src="site/assets/og.png" alt="Rumbo: your whole event in one QR code. A sample pass with a QR code and its benefits." width="820">

</div>

---

A community event today is six tools and a spreadsheet. Registration lives in Luma. Badges are made in Canva. Lunch vouchers are paper tickets or a column someone ticks by hand. Merch is sold over Instagram messages. Prizes are a photo. And when the event is over, the sponsor report is assembled from memory.

On top of that, in much of the world the organizer cannot charge for tickets at all: the platforms they already use need a Stripe account, and Stripe does not pay out in their country. Bolivia is one of those countries.

**Rumbo puts the whole event in one place, and lets the organizer get paid in seconds from anywhere.** Tickets are paid in digital dollars (USDC on Stellar) and, next, in Bolivia, with the QR code of the buyer's own bank through a licensed partner. Each attendee gets a pass with a QR code. Volunteers scan it to check people in and to hand out what each person is entitled to: lunch, a t-shirt, a prize. Every redemption happens once, and the sponsor sees exactly what was delivered.

Rumbo is made for events of 80 to 500 people with sponsors and several benefits: hackathons, DevFests, community conferences, bootcamps, chapter meetups. It is built in Bolivia, in Spanish and English from day one, by people who organize these events themselves.

## What it does

This is the whole product. The table in [Where it stands](#where-it-stands) says what is built today and what comes next.

**For the organizer**

1. Create the event with a form, or describe it in plain words to the assistant you already use (over MCP) and approve the draft Rumbo proposes: pass types, benefits, scanner stations and caps.
2. Publish the event page, with free or paid registration. Guest lists from Luma or Bevy can be imported as CSV, onto free tickets: each pass is prepared during the import (a few seconds each on testnet), and the personal links come down as a CSV to send by hand until the email service exists.
3. Get paid in USDC from anywhere or, next, in bolivianos with a bank QR code through a licensed on-ramp. The money reaches the organizer (on testnet, a sample organizer account) in the same operation that separates Rumbo's fee. Rumbo never holds the money.
4. Next, optional protected payment: the ticket will stay in a contract until the event happens, and refunds will go out on their own if it is cancelled.
5. Download each pass as an SVG to print (PDF and printing in bulk come next), or leave it on each attendee's phone.
6. On the day, volunteers scan with their phones. The scanner works offline and syncs later: the queue never waits for the network.
7. Afterwards, a live dashboard and a report for each sponsor: "300 coffees redeemed, 12 prizes handed out".

**For the attendee**

- Register with Google or with their email, no new password (passkeys come next). A Stellar account of their own is created underneath without them having to know.
- Get a personal link to the pass on the confirmation screen; the email with that link comes next. Never keys or passwords.
- Keep the pass on the phone and see what they are entitled to: "lunch: pending", "T-shirt M: paid, pick up at the desk", "booth-route prize: won".

**For the volunteer**

- Scan the QR code, see what this person gets, mark it as redeemed. It is recorded once on the ledger (the booth-route prize is the exception: the database keeps it); if two phones were offline, the second one is flagged to review. No account, no training.

**For the sponsor**

- Offer benefits ("a coffee for every attendee") and see how many were redeemed.
- Keep the contact of the people who agree to share it when scanned at the booth.
- Join the booth route: whoever visits the agreed number of booths gets the route prize on their pass and picks it up at the prizes station.
- Get the report.

## How Rumbo is different

Free sign-up is solved: Luma, Bevy and a simple form already do it well. Rumbo starts after the ticket.

- **Each pass says what that person gets:** lunch, a t-shirt, a prize. Volunteers redeem each item from their own phones, even offline; each benefit redemption lands once on the ledger.
- **The draw list has only people who walked in.**
- **The sponsor gets a report of what was actually delivered,** with no names or emails, and booth contacts only with each person's permission.
- **Organizers get paid where Stripe does not operate** (in Latin America it is available only in Brazil and Mexico), in USDC or, next, in bolivianos with the bank's QR code through a licensed ramp, with the fee separated in the same operation.

Tech communities often end up building their own tools, or using wristbands and paper tickets, to run lunch, swag and prizes at their events. Rumbo is that kit, already built, open source, with an API and an MCP server so each community can build on top of it. [Stellar Passport](https://stellarpassport.xyz), which turns attendance into stamps, is a natural complement: a Rumbo check-in could grant a Passport stamp.

## For Stellar ambassador chapters

The [Stellar Ambassador Program](https://stellar.gitbook.io/ambassador-program/resources/terms-and-conditions/goals-and-reporting) counts an event when it has at least twenty verified attendees and twenty minutes of Stellar content, documented for the monthly and quarterly reports, and a chapter's funding can be reduced when that reporting is incomplete. Rumbo produces that documentation while it runs the event:

- **Verified attendance:** every check-in at the door is a transaction on Stellar, with the time it reached the ledger, so anyone can check the count, with no names on chain. The count leaves out speakers, volunteers and the organizing team, as the program asks.
- **Food per person:** with the food spend the organizer reports, Rumbo divides it by the people who checked in and compares it with the program's per-person cap; lunch redemptions show how many actually ate.
- **The package for the report:** after the event, `pnpm paquete-embajadores` (on the organizer's machine; it needs XeLaTeX) writes the event report as a PDF, a CSV with attendance, minutes and links for the monthly report, the contacts of attendees who agreed to hear from the chapter, and a yes or no for each requirement. Each attendee can also get a certificate with a QR code that opens a public verification page.

The program shares its official documentation template with each chapter; the package will follow it as soon as a chapter shares it.

## Why Stellar

For counting lunches a database would do. Stellar adds what a database cannot:

- **Getting paid from any country in seconds,** even where card processors do not pay out. One operation pays the organizer and separates the platform fee, with nobody holding the money in between.
- **Protected payments** (next) that will refund on their own if the event is cancelled.
- **Vouchers that can only be used once,** with each benefit redemption recorded on the ledger, not in a database someone could edit (the booth-route prize is the one exception: that redemption lives in Rumbo's database). On testnet the voucher is not money, but the lunch is real: a community that runs its own copy of the code can use it at a real event today, with no funds at risk.
- **Every attendee leaves with a Stellar account** that works at the next event: their own when they sign in with Google or with their email (in test mode the server can create it for them; passkeys come next), with network fees sponsored so nobody needs to hold XLM.
- **Payments to speakers and volunteers** in any country, later on.
- **Paying in your own currency,** next. In Bolivia, with the bank's QR code through a licensed ramp; the organizer will receive USDC on the spot. No Stripe, no local gateway, no paperwork.
- **An API and an MCP server,** free for your own events; webhooks come next. Platforms and agents that create events at volume will pay per use, with x402, later on.

Rumbo is not a ticket NFT and not a place to speculate on resale. If the organizer allows resale (later on), it will happen at the original price.

## With Tinkazo

[Tinkazo](https://tinkazo.app) runs draws anyone can check from their phone. Rumbo and Tinkazo are different products that fit together: Tinkazo decides who wins, Rumbo delivers what was won and runs everything else at the event. The plan: the prize from a Tinkazo draw lands on the winner's pass, the draw runs over the people who actually checked in, and entering a draw is always free, whether the event is paid or not. Today Rumbo freezes the list of people who checked in, with a SHA-256 fingerprint anyone can recompute and the algorithm published, so the draw can run over it; the prize landing on the winner's pass comes next.

## Where it stands

The first column of the table below is built and runs on Stellar's testnet: the [rumbo-pass contract](contracts/rumbo-pass/README.md) (free or paid pass with the split in the same operation, one check-in and one redemption per benefit, with 43 tests) and the [app](app/README.md) (event page, registration, a pass whose QR code is signed with Ed25519 and changes every 20 seconds, offline scanner with a manual fallback at the door (search by name or email, or sign someone up for free on the spot), organizer panel with a check of its records against the ledger, sponsor booths with a route (its prize lands on the pass of whoever completes it) and a live screen, the draw list frozen with a SHA-256 fingerprint and a published algorithm, the event report on the web to print, with the PDF and the verifiable certificates generated from the command line with XeLaTeX, and the kit: templates for a DevFest, Build with AI, International Women's Day, a hackathon, a meetup or a workshop, and importing the guest list from Luma, or from Bevy, whose columns are an inference (its public documentation does not list them) and have not been checked against a real export). The whole flow, run against testnet with its transaction ids, is in [app/demo/e2e-testnet.txt](app/demo/e2e-testnet.txt), and the paid event's contract can be inspected on [stellar.expert](https://stellar.expert/explorer/testnet/contract/CDKKJV3QFG4RBYLRIRTWMXFBAQVY5NP3THXBNDT7PX7ICWSCN3GCZ5UH).

The MCP server gives the assistant you already use the same functions, over HTTP and stdio: describe the event in plain words and approve the draft, import the list, read the numbers, the sponsor report, the draw list and the chapter summary. That whole flow, run against testnet, is in [app/demo/mcp.txt](app/demo/mcp.txt).

Signing in with Google or with your email, with an account of your own through Pollar, is in the code and ran on testnet with a local key; it still needs a run with a real Google account, and it is switched on with `RUMBO_ACCOUNTS=pollar`. Without it, the server creates the account in test mode. Passkeys come next.

[A video of just over a minute](site/assets/mvp-en.mp4), recorded on November 4, shows the real MVP at work on testnet, no mockups: the free sign-up, the pass with its changing QR code, the volunteer's camera reading that code at the door, an offline redemption that syncs by itself when the network is back, the dashboard and the sign-up transaction on stellar.expert (it is recorded by [app/scripts/grabar-recorrido.mjs](app/scripts/grabar-recorrido.mjs)).

Without installing anything: [the app itself, on testnet](https://rumbo-eventos-app.vercel.app/e/hackaton-comunidad), where you sign up to the sample event and get a real pass, and where organizers [sign in](https://rumbo-eventos-app.vercel.app/admin) to create their own; the [landing page](https://rumbo-eventos.vercel.app) with a 31-second animation of the whole flow, and a [clickable mock-up](https://rumbo-eventos.vercel.app/#probar) (nothing is saved) where you sign up, get your pass, scan it as a volunteer (offline too) and see how the draw would run.

The contract started from an [event pass](https://stellar.expert/explorer/testnet/contract/CDSXJR7MBV3ZLHLQPVTWZYVVP3CNABMGO6RRPLSI2KVFSJ2UX4SUD7DP) written in September 2026 for Stellar Elite Bolivia: buy a pass, check in once, list who came. Rumbo extends it with benefits, redemptions and, later, protected payments.

| Built, on testnet | Next | Later |
|---|---|---|
| Event page with free or paid registration (USDC on testnet), set up from a template; sign-in with Google or email, with an account of the person's own (pending a run with a real Google account) | Passkeys, and the email with the link to the pass | Bank QR payments in bolivianos on mainnet |
| Signed pass with a QR code that changes every 20 seconds, on the phone and printable as SVG | Protected payment with automatic refund | Resale at the original price |
| Offline scanner for the door, each meal and each booth, with a manual fallback at the door | Prize from a Tinkazo draw landing on the pass | Pay-per-use API with x402 |
| Organizer dashboard with the check against the ledger, sponsor report, draw list with its fingerprint, event report to print (PDF and certificates from the command line, with XeLaTeX) | Webhooks, calendar and Telegram notices | Payments to speakers |
| Luma and Bevy import, pass types (speaker, mentor, judge, volunteer) and teams | Passes in Apple and Google Wallet | Licenses for community networks |
| MCP server for your assistant: describe the event in plain words and approve the draft, import the list, read the numbers and the report | PDF passes and printing in bulk | |

## How it is built

A Soroban contract for passes and vouchers, a Next.js app with Supabase underneath and an MCP server with the same functions, accounts of the person's own when they sign in with Google or email (passkeys next) with network fees sponsored, and a scanner that works offline and syncs later. The pieces, the decisions behind them and the four-week build order are in [docs/stack.md](docs/stack.md) (in Spanish). The code lives in [contracts/rumbo-pass](contracts/rumbo-pass/README.md) and [app](app/README.md), each with its own guide.

## Principles

- **No custody.** Money goes straight to the organizer or, once protected payments arrive, sits in their contract. Rumbo never holds it.
- **No on-ramp of its own.** Converting bolivianos is done by partners who hold the license.
- **No personal data on chain.** Names and emails stay off the ledger: they live in Rumbo's database, for the pass, the door and the organizer's panel. Booth contacts are shared only when the person agrees, at that booth.
- **Free events are free.** The fee applies when money changes hands.
- **No technical jargon at the door.** Nobody at the door needs to know there is a blockchain underneath.
- **Open core, hosted service.** The redemption contract, the scanner and the event template are open source under MIT, so any community can run and adapt them. The hosted service (event setup, emails, real-time dashboard, payments and reports) is what Rumbo will charge for.

## Who

Rumbo is made in Santa Cruz de la Sierra, Bolivia, by its two founders: [Nicolás Emir Mejía Agreda](https://github.com/nema1502), product and smart contracts, and [Guido Salazar](https://github.com/GuidoSV7), full-stack development.

Questions and ideas: open an issue.

## License

[MIT](LICENSE).
