// Idioma y tema de la página. El castellano vive en el HTML; acá está el inglés.
// Elegir: ?lang=en o ?lang=es, ?theme=dark o ?theme=light; lo elegido se recuerda en el navegador.

// Los pasos de "La idea en 30 segundos" se resaltan siguiendo la animación: cada uno desde su segundo,
// y ninguno antes de PASOS_DEMO[0] ni después de FIN_DEMO. Si el video cambia, se ajusta acá.
const PASOS_DEMO = [4.3, 12.6, 16.3, 24.7];
const FIN_DEMO = 29.2;
// Lo mismo para el corte del producto real (mvp-corte-*.mp4, 23 s, armado con ffmpeg desde mvp-*.mp4):
// la credencial, la puerta (con la segunda vez), el canje sin señal y el panel.
const PASOS_CORTE = [0, 4.5, 12.5, 19.5];

// Lo que se anima solo se oculta con la clase js (la cabecera de la página ya la pone).
document.documentElement.classList.add("js");
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", animar);
else setTimeout(animar);

const EN = {
  "nav.ver": "See it",
  "nav.probar": "Try it",
  "nav.informe": "Reports",
  "nav.hace": "What it does",
  "nav.viene": "What's next",
  "nav.idioma": "ES",
  "nav.github": "GitHub",
  "nav.entrar": "Sign in",

  "aria.inicio": "Rumbo, home",
  "aria.tema": "Switch theme",
  "aria.secciones": "Sections",
  "aria.credencial": "A sample pass",
  "aria.pausar": "Pause the pass animation",
  "aria.videos": "Which video to watch",
  "aria.corte": "The Rumbo app running: the pass, the door, an offline redemption and the dashboard",
  "aria.video": "Animation of the Rumbo flow",
  "aria.informe": "A sample report that builds itself",
  "aria.arquitectura": "How the pieces connect",
  "aria.enlaces": "Links",
  "aria.huella": "What gets recorded on Stellar during a sample event",

  "sello.hecho": "Built on",
  "etiqueta.anda": "Live now",
  "etiqueta.parte": "Partly live",
  "etiqueta.pronto": "Coming soon",
  "etiqueta.diciembre": "Coming later",
  "cta.crear": "Create your event",
  "cta.probar": "Try the real thing",

  "ver.mas": "See more",
  "ver.ruta": "See the full roadmap",

  "portada.titulo": "Your whole event <em>in one QR&nbsp;code</em>.",
  "portada.bajada": "Register people for free or bring your guest list. Event day and the report, sorted.",
  "portada.ver": "See how it works",
  "portada.confianza": "Signing up is free. The first version already works, in test mode.",

  "cred.evento": "Community hackathon",
  "cred.tipo": "General admission",
  "cred.ejemplo": "Example",
  "cred.numero": "Pass 37 of 120",
  "cred.nombre": "Ana R.",
  "cred.estado0": "Registered",
  "cred.estado": "Checked in",
  "cred.b1": "Lunch",
  "cred.b1e": "pending",
  "cred.b1c": "redeemed",
  "cred.b2": "T-shirt, size M",
  "cred.b2e": "paid, pick up",
  "cred.b2c": "picked up",
  "cred.b3": "Booth-route prize",
  "cred.b3s": "5 of 6 booths",
  "cred.b3e": "won",

  "ver.ante": "How it looks",
  "ver.titulo": "From the QR to the door, for real.",
  "ver.real": "The real product",
  "ver.idea": "The idea in 30 seconds",
  "ver.p1": "The QR code that changes.",
  "ver.p2": "The door scans.",
  "ver.p3": "No signal, it keeps going.",
  "ver.p4": "The dashboard, live.",
  "ver.completo": "Watch the full video",
  "ver.probalo": "Try it yourself, right here",
  "demo.p1": "Sign-up is free; if they pay, the money arrives already split.",
  "demo.p2": "The QR pass lands on the phone, with everything they get.",
  "demo.p3": "The volunteer redeems, and a second try shows in big letters.",
  "demo.p4": "The dashboard counts everything, and the sponsor report writes itself.",
  "demo.nota": "A hand-made animation of the idea: not a recording.",

  "sumar.ante": "With what you already use",
  "sumar.titulo": "You do not have to switch platforms.",
  "sumar.linea": "Stay on your platform and bring your list, or register people for free here.",
  "sumar.lista": "Your guest list",
  "sumar.o": "or",
  "sumar.gratis": "Free sign-up on Rumbo",
  "sumar.s1": "QR pass",
  "sumar.s2": "Door",
  "sumar.s3": "Redemptions",
  "sumar.s4": "Reports",
  "eventos.ante": "For any event",
  "eventos.titulo": "Set your event's course.",
  "eventos.linea": "A hackathon, a fair or a festival: the same pass, the same door.",
  "eventos.e1": "Hackathons",
  "eventos.e1c": "Saturday lunch",
  "eventos.e2": "Meetups and chapters",
  "eventos.e2c": "Verified attendance",
  "eventos.e3": "Conferences",
  "eventos.e3c": "Workshop kit",
  "eventos.e4": "Fairs",
  "eventos.e4c": "Booth route",
  "eventos.e5": "Festivals",
  "eventos.e5c": "Welcome drink",
  "eventos.e6": "Theater, film and culture",
  "eventos.e6c": "Free entry",
  "sumar.lector": "Bring your guest list or register people for free on Rumbo; Rumbo builds the QR pass, the door, the redemptions and the reports.",

  "informe.ante": "Reports",
  "informe.titulo": "The report builds itself.",
  "informe.linea": "Picture having to report on your event: it is already counted.",
  "informe.a.t": "For sponsors",
  "informe.a.p": "How many checked in and used their benefit, with no names.",
  "informe.b.t": "For Stellar ambassadors",
  "informe.b.p": "Today: the verified count and the minimum of twenty, from your assistant. The report in the dashboard, coming soon.",
  "informe.pronto": "The event wrap-up, in Word to edit and send.",
  "inf.titulo": "Event report",
  "inf.evento": "Chapter meetup, November",
  "inf.f1": "Registered",
  "inf.f2": "Checked in, verified",
  "inf.f3": "Lunches redeemed",
  "inf.f4": "Sponsor's coffee",
  "inf.s1": "Twenty or more verified attendees",
  "inf.s2": "Row ready for the chapter spreadsheet",
  "capitulos.bajada": "The Stellar Ambassador Program counts an event when it has at least twenty verified attendees. Rumbo gets that count ready, and anyone can check it.",
  "capitulos.a.t": "Twenty, verified",
  "capitulos.a.p": "Every entry is recorded on Stellar, and the count adds itself up: attendees only, no speakers or organizers.",
  "capitulos.b.t": "Food, accounted for",
  "capitulos.b.p": "The food spend you report, divided by the people who checked in, is compared with the per-person cap; lunch redemptions say how many ate.",
  "capitulos.c.t": "The report, ready",
  "capitulos.c.p": "Attendance, redemptions and the link to the draw, if the organizer adds it, in one report for the monthly update, with no names on chain.",
  "capitulos.fuente": "What the ambassador program asks for",

  "hace.ante": "What it does",
  "hace.titulo": "Event day, sorted.",
  "hace.c1": "A QR code that changes: a screenshot will not work.",
  "hace.c2": "The door, from a phone and with no signal.",
  "hace.c3": "Each redemption, only once.",
  "hace.c4": "The dashboard, live.",
  "hace.mas": "See what it does for each person and each event",
  "como.bajada": "Today a community event takes six tools and a spreadsheet, and in many countries you cannot charge for tickets.",
  "problema.h1": "Registration",
  "problema.h1b": "a form",
  "problema.h2": "Badges",
  "problema.h2b": "a hand-made design",
  "problema.h3": "Lunch and snacks",
  "problema.h3b": "paper tickets or a column ticked by hand",
  "problema.h4": "Merch",
  "problema.h4b": "social and chat messages",
  "problema.h5": "Prizes",
  "problema.h5b": "a photo",
  "problema.h6": "Sponsor report",
  "problema.h6b": "assembled from memory",
  "problema.remate.p": "In much of the world charging for tickets by card is not possible: payment gateways do not pay out in that country. Bolivia is one of them.",
  "como.para": "Rumbo is made for community events of 20 to 500 people with several benefits: hackathons, chapter meetups, conferences, fairs, festivals and theater or film nights.",
  "casos.bajada": "What you do today with a form, a group chat and a spreadsheet, in one place, with what gets handed out under control.",
  "como.r1.n": "If you organize",
  "como.r1.l": "Build the page, get paid and follow it all live.",
  "como.r1.a": "Create the event and publish the page, with free or paid registration.",
  "como.r1.b": "Get paid in digital dollars (USDC); the bank QR code comes next. The money arrives already split (on testnet, to a sample organizer account).",
  "como.r1.c": "Print the passes (as SVG) or leave them on each phone.",
  "como.r1.d": "Watch the live dashboard and send each sponsor their report.",
  "como.r1.e": "If your event is free, Rumbo is free. If you charge, the fee is written into your event's contract, for anyone to read, and stays the same to the end.",
  "como.r2.n": "If you attend",
  "como.r2.l": "No new password, and your pass on your phone.",
  "como.r2.a": "Sign in with Google or with a code sent to your email. No new password (your phone's fingerprint, a passkey, comes next).",
  "como.r2.b": "Get a personal link to your pass (email comes next). Never keys or passwords.",
  "como.r2.c": "Keep your pass on your phone and see what you are entitled to.",
  "como.r2.d": "If you paid and the event is cancelled, protected payment (coming next) will return your money on its own.",
  "como.r3.n": "If you volunteer",
  "como.r3.l": "Scan and see what each person gets, no training needed.",
  "como.r3.a": "Scan the QR code and see what this person gets.",
  "como.r3.b": "Mark it as redeemed. If it was already redeemed, the scanner says so in big letters and the line keeps moving.",
  "como.r3.c": "No account, no training. It works offline and syncs later.",
  "como.r4.n": "If you sponsor",
  "como.r4.l": "Offer a benefit and know how many were really delivered.",
  "como.r4.a": "Offer a benefit, like a coffee for every attendee, and see how many were redeemed.",
  "como.r4.b": "Keep the contact of the people who agree to share it at your booth.",
  "como.r4.c": "Get the report with what was actually delivered.",
  "casos.titulo": "For a meetup of twenty or a hackathon of three hundred.",
  "casos.c1.t": "A hackathon",
  "casos.c1.p": "Team sign-up, and each day's breakfasts, lunches and dinners with their own redemption. Passes for mentors and judges. A draw among the people who checked in, with a list anyone can check; the prize will land on the winner's pass.",
  "casos.c2.t": "A meetup",
  "casos.c2.p": "A meetup or a DevFest: a free list, confirmation on screen and check-in at the door. Snacks and merch redeemed once, and a verifiable list of the people who actually showed up, for the draw.",
  "casos.c3.t": "A conference",
  "casos.c3.p": "A conference or a congress: several ticket types, free or paid, redemptions with a cap (40 workshop kits), booths that collect contacts with each person's permission, and a report for every sponsor.",
  "casos.c4.t": "A community",
  "casos.c4.p": "Today the home page lists the events. Later, a community with a calendar: every event of a GDG, a chapter or a university on one page, with the people who already came and their attendance history.",

  "pagos.ante": "How people pay",
  "pagos.titulo": "Signing up is free. Charging, if you want.",
  "pagos.g.t": "Free means free",
  "pagos.g.p": "If your event is free, so is Rumbo.",
  "pagos.c.t": "If you charge",
  "pagos.c.p": "The money arrives already split.",
  "pagos.m.t": "With your bank's QR code",
  "pagos.m.p": "Pay in bolivianos.",
  "paga.ver": "See who pays and how",
  "pagos.m1.t": "With your bank's QR code, in bolivianos (coming soon)",
  "pagos.m1.p": "People will pay the way they pay for everything: by scanning their bank's QR code. A licensed ramp converts the bolivianos and the organizer receives USDC on the spot. Bolivia first, then each country with its own ramp.",
  "pagos.m2.t": "In USDC, from any country",
  "pagos.m2.p": "With the account that creates itself when you sign in with Google or your email. No card, no XLM and no bank account on the other side. Today it runs on the test network. Real-money payments come later.",
  "pagos.m3.t": "No money in the middle",
  "pagos.m3.p": "The contract splits the organizer's share and the fee in the same operation. Rumbo never holds the money, and if the event is cancelled, protected payment (coming next) will refund it on its own.",
  "pagos.bajada": "In much of Latin America you cannot charge through card gateways, and local ones ask for a company, paperwork and days of waiting. Here the money goes from the buyer to the organizer in a single operation.",
  "paga.ante": "Who pays",
  "paga.titulo": "Communities have almost no money. So someone else pays.",
  "paga.f1": "Tickets",
  "paga.f2": "Merch and workshops",
  "paga.f3": "Sponsorships",
  "paga.f4": "Large events",
  "paga.f5": "Monthly plan",
  "paga.f6": "Community networks",
  "paga.f7": "Apps, per use",
  "paga.f8": "Small communities, free",
  "paga.bajada": "Free events are free, and that is how people arrive. The fee appears when money changes hands, and sponsors pay to know what happened with what they put in.",
  "paga.c1.t": "If you sell tickets",
  "paga.c1.p": "A fee per paid ticket, written into the event's contract. It is charged in the same operation: nobody holds the money in between.",
  "paga.c8.t": "If you sell merch or workshops",
  "paga.c8.p": "The same fee as a ticket. Whatever the event sells (the T-shirt, the workshop kit) goes inside a paid ticket and lands on the pass as one more redemption.",
  "paga.c2.t": "If you sponsor",
  "paga.c2.p": "Per campaign: \"a coffee for every attendee\", with verified redemption, a report and the booth contacts of those who agree to share them.",
  "paga.c3.t": "Large events",
  "paga.c3.p": "Those that sell tickets or have sponsors: per attendee, with passes, scanners, several days and ticket types, and reports. A free community event does not pay, however big.",
  "paga.c7.t": "If you organize often",
  "paga.c7.p": "We are planning an affordable monthly plan, in USDC or bolivianos, with more capacity, your brand on the page and your people's history. Small communities stay free.",
  "paga.c4.t": "Community networks",
  "paga.c4.p": "Later on, one license per network, for all its chapters, with aggregated data. It is how to grow without selling one by one.",
  "paga.c5.t": "Other apps and agents",
  "paga.c5.p": "Per use, later on, when they create events at volume through the API, paying cents in USDC. For your own events, the API and the MCP server are free.",
  "paga.c6.t": "Small communities",
  "paga.c6.p": "Free, with a cap on people per event that is set with the first communities. That is how every community starts, and how the word gets around.",
  "paga.nota": "Prices are set with the first communities that use it, not before.",
  "llamado.p": "Organizing an event in 2027? We want to build it with you.",
  "llamado.boton": "Tell us on GitHub",

  "viene.ante": "What's next",
  "viene.titulo": "The roadmap, out in the open.",
  "viene.v1.t": "The event wrap-up, in Word",
  "viene.v2.t": "Your bank's QR code",
  "viene.v3.t": "Social media challenges, checked by&nbsp;QR",
  "viene.v4.t": "Big doors, no queue",
  "viene.v5.t": "Payments with real money",
  "viene.v5.p": "Get paid from any country, with the money already split.",
  "viene.v6.t": "Booths that sell with the same QR&nbsp;code",
  "viene.v7.t": "Gifts, each with its own QR code",
  "crece.porque": "Communities bring sponsors, paid events bring networks, and networks bring the platforms that want to build on top.",
  "crece.e1.tag": "First",
  "crece.e1.t": "One community",
  "crece.e2.tag": "Then",
  "crece.e2.t": "Events that charge",
  "crece.e3.tag": "Later",
  "crece.e3.t": "Networks and platforms",
  "crece.e1.a": "Event page with free or paid registration",
  "crece.e1.b": "Templates, and importing your guest list",
  "crece.e1.c": "Pass with QR code, on the phone and for printing",
  "crece.e1.d": "Check-in and redemptions with an offline scanner",
  "crece.e1.e": "Organizer dashboard and sponsor report",
  "crece.e1.f": "An MCP server: the event is set up from your assistant, in plain words",
  "crece.e2.a": "Protected payment with automatic refund",
  "crece.e2.b": "The pass by email, then webhooks and Telegram notices",
  "crece.e2.c": "The prize from a draw landing on the winner's pass",
  "crece.e2.d": "Sign-in with a passkey (your phone's fingerprint)",
  "crece.e2.e": "Passes in Apple and Google Wallet",
  "crece.e3.a": "Bank QR payments in bolivianos",
  "crece.e3.b": "Resale at the original price",
  "crece.e3.c": "Pay-per-use API",
  "crece.e3.d": "Payments to speakers",
  "crece.e3.e": "Licenses for community networks",
  "crece.alojado": "Developers at a GDG or a WTM chapter learn Stellar by adapting their own event's system. The hosted service will be the convenient part: event setup, emails, real time, payments and reports.",
  "crece.remate.t": "Open core, hosted service.",
  "crece.remate.p": "People learn Stellar by adapting the code, and Rumbo will charge for the hosted service.",

  "stellar.titulo": "Every ticket leaves its mark.",
  "stellar.linea": "Every ticket, redemption and sale is recorded on Stellar: nobody can erase it or count it twice.",
  "stellar.g1": "Sponsors see what was really handed out.",
  "stellar.g2": "Attendees sign in with Google or their email.",
  "stellar.g3": "Organizers will get paid from any country.",
  "huella.titulo": "Recorded on Stellar",
  "huella.f1": "Ticket 37",
  "huella.e1": "checked in",
  "huella.f2": "Lunch",
  "huella.e2": "redeemed",
  "huella.f3": "T-shirt, size M",
  "huella.e3": "sold",
  "huella.f4": "Lunch, again",
  "huella.e4": "already redeemed",
  "huella.pie": "No names or emails, just the number. Each one, for a fraction of a cent.",
  "stellar.estado": "First version, in test mode. The code is open.",
  "stellar.ver": "Why Stellar",
  "stellar.bajada": "For counting lunches a spreadsheet would do. This is what Stellar adds.",
  "stellar.v1": "<strong>Get paid from any country,</strong> with the fee split off in the same operation.",
  "stellar.v2": "<strong>Single-use vouchers,</strong> with each pass redemption recorded on the ledger, not in a spreadsheet.",
  "stellar.v3": "<strong>An account that lasts</strong> for the next event, no XLM needed.",
  "stellar.m2.t": "Protected payments, coming next",
  "stellar.m2.p": "The ticket will stay in a contract until the event happens. If it is cancelled, refunds go out on their own.",
  "stellar.m5.t": "Payments to speakers and volunteers, later",
  "stellar.m5.p": "They will go out to any country, in one click. No bank accounts in between and no wire fees.",
  "stellar.m6.t": "An API other apps will pay per use",
  "stellar.m6.p": "Later on, other platforms and agents will create events, passes and vouchers at volume, paying cents in USDC through x402. For your own events, the API and the MCP server are free.",
  "stellar.nota": "On the test network the voucher is not money, but the lunch is real. The booth-route prize is the exception: that redemption lives in the database, not on the ledger.",

  "hecho.ver": "How it is built",
  "arq.n1": "The person",
  "arq.n1b": "registers and pays from the phone",
  "arq.n2": "The Rumbo app",
  "arq.n2b": "event page, pass, dashboard",
  "arq.n2c": "account with Google or your email",
  "arq.n2d": "in Spanish and English",
  "arq.n3": "The contract on Stellar",
  "arq.n3b": "charges and splits in one operation",
  "arq.n3c": "check-in and each redemption, once",
  "arq.n3d": "no names or emails inside",
  "arq.n4": "The organizer",
  "arq.n4b": "is paid right away",
  "arq.n5": "The sponsor",
  "arq.n5b": "sees the redemptions",
  "arq.n6": "The volunteer's scanner",
  "arq.n6b": "validates the QR offline and syncs later",
  "arq.f2": "USDC",
  "arq.l1": "The attendee registers and pays from the phone, signing in with Google or with their email.",
  "arq.l2": "The app builds the event page, the pass and the dashboard, in Spanish and English.",
  "arq.l3": "The contract on Stellar charges and splits in one operation, and marks the check-in and each redemption once. There are no names or emails inside.",
  "arq.l4": "The volunteer's scanner validates the QR offline and syncs later. The organizer receives the money right away (on testnet, to a sample organizer account) and the sponsor sees the redemptions.",
  "hecho.linea": "A Soroban contract and a Next.js app on Supabase. <a href=\"https://github.com/nema1502/rumbo/blob/main/docs/stack.md\" rel=\"noopener\">The stack, piece by piece</a> (in Spanish).",
  "hecho.bajada": "What guarantees that a voucher is used once and that the money arrives split lives in a contract on Stellar. Everything else is an app anyone opens from their phone.",
  "hecho.d1.t": "What it is made of",
  "hecho.d1.p": "A Soroban contract, a Next.js app with Supabase underneath, accounts of your own when you sign in with Google or email, with sponsored fees, and a scanner that works offline.",
  "hecho.d2.t": "Nobody needs XLM",
  "hecho.d2.p": "Rumbo sponsors the network fees. People sign in with Google or with their email and never see anything technical.",
  "hecho.d3.t": "There is already a seed",
  "hecho.d3.p": "The contract starts from an event pass written in September 2026 for Stellar Elite Bolivia, with nine tests and a run on the test network.",

  "abierto.ver": "Open and connected",
  "abierto.c1": "API",
  "abierto.c2": "MCP server",
  "abierto.c3": "Import and export",
  "abierto.c4": "Notifications (coming next)",
  "abierto.c5": "Verifiable draw list",
  "abierto.c6": "Open source",
  "abierto.linea": "Connecting is free for your own events, and the data is yours.",
  "abierto.m1.t": "API, and webhooks next",
  "abierto.m1.p": "Sign people up and read check-ins and redemptions from your own system; to create events, the MCP server. Free for your own events; platforms that create events at volume will pay per use.",
  "abierto.m2.t": "An MCP server",
  "abierto.m2.p": "The assistant you already use sets up the event, loads the list and reads you the numbers and the report, with the same tools the app uses.",
  "abierto.m3.t": "Import and export",
  "abierto.m3.p": "Bring your guest list from the platform you already use or from a spreadsheet, and take everything to CSV whenever you want (Google Sheets next).",
  "abierto.m4.t": "Notices where people are",
  "abierto.m4.p": "The pass, the reminders and last-minute changes will arrive by email, in the calendar and on Telegram; today the link stays on screen and, when a list is imported, comes down as a CSV.",
  "abierto.m5.t": "A verifiable list for the draw",
  "abierto.m5.p": "The list of the people who actually came is frozen with a fingerprint anyone can recompute, and the draw runs over it; the prize will land on the winner's pass.",
  "abierto.m6.t": "Open source under MIT",
  "abierto.m6.p": "The contract, the scanner and the event template are on GitHub. Any community can run them, adapt them and learn Stellar with its own event.",

  "equipo.titulo": "The team",
  "equipo.n1.rol": "Product and smart contracts",
  "equipo.n2.rol": "Full-stack development",
  "principios.titulo": "What Rumbo never does",
  "principios.p1.t": "Hold your money.",
  "principios.p1.p": "It goes straight to the organizer or, once protected payments arrive, sits in the contract.",
  "principios.p2.t": "Convert currencies itself.",
  "principios.p2.p": "Bolivianos are converted by partners who hold the license.",
  "principios.p3.t": "Put personal data on chain.",
  "principios.p3.p": "Names and emails stay off the chain: they live only in Rumbo's database, for the pass, the door and the dashboard. Booth contacts are shared only with consent, at that booth.",
  "principios.p4.t": "Charge for free events.",
  "principios.p4.p": "The fee applies when money changes hands.",
  "principios.p5.t": "Show technical jargon at the door.",
  "principios.p5.p": "Nobody at the door needs to know what is underneath. The technical part is folded away, for whoever wants to read it.",
  "principios.p6.t": "Close what it opened.",
  "principios.p6.p": "The redemption contract, the scanner and the event template are open source under MIT. The hosted service is what Rumbo will charge for.",

  "final.lema": "Set your event's course.",
  "final.titulo": "Your next event, <em>in one QR&nbsp;code</em>.",
  "final.linea": "Signing up is free. Set up in two minutes.",
  "final.entrar": "Already have an event?",
  "final.entrarLink": "Sign in as an organizer",

  "pie.hecho": "From Bolivia. Open source, under the MIT license.",
  "pie.stellar": "Why Stellar",
  "pie.ruta": "Roadmap",
  "pie.codigo": "Code",
  "pie.ideas": "Ideas and questions",
  "pie.licencia": "License",
  "pie.idioma": "Español",
};

const ES = {};
const ES_ARIA = {};
const APP = "https://rumbo-eventos-app.vercel.app";

function guardarCastellano() {
  for (const el of document.querySelectorAll("[data-i18n]")) ES[el.getAttribute("data-i18n")] = el.innerHTML;
  for (const el of document.querySelectorAll("[data-i18n-aria]")) ES_ARIA[el.getAttribute("data-i18n-aria")] = el.getAttribute("aria-label");
}

function aplicarIdioma(lang) {
  const dic = lang === "en" ? EN : ES;
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const k = el.getAttribute("data-i18n");
    if (dic[k] !== undefined) {
      if (el.namespaceURI === "http://www.w3.org/2000/svg") el.textContent = dic[k];
      else el.innerHTML = dic[k];
    }
  }
  for (const el of document.querySelectorAll("[data-i18n-aria]")) {
    const k = el.getAttribute("data-i18n-aria");
    const v = lang === "en" ? EN[k] : ES_ARIA[k];
    if (v) el.setAttribute("aria-label", v);
  }
  document.documentElement.lang = lang;
  document.title = lang === "en" ? "Rumbo: your whole event in one QR code" : "Rumbo: tu evento entero en un QR";
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute("content", lang === "en"
    ? "For any community event: register people for free or bring your guest list. The QR pass, the door, redemptions and the report, sorted. Built on Stellar."
    : "Para cualquier evento de comunidad: inscribí gratis o traé tu lista de inscriptos. La credencial con QR, la puerta, los canjes y el informe, resueltos. Hecho con Stellar.");

  // Quien llega a la app desde la landing en inglés, la ve en inglés.
  for (const a of document.querySelectorAll(`a[href^="${APP}"]`)) {
    try {
      const u = new URL(a.href);
      u.searchParams.set("lang", lang);
      a.href = u.toString();
    } catch { /* enlace raro: queda como está */ }
  }

  ajustarVideos(lang);

  const boton = document.getElementById("idioma");
  if (boton) {
    boton.textContent = lang === "en" ? "ES" : "EN";
    boton.setAttribute("aria-label", lang === "en" ? "Cambiar a castellano" : "Switch to English");
  }
  const pie = document.getElementById("pie-idioma");
  if (pie) pie.setAttribute("href", lang === "en" ? "?lang=es" : "?lang=en");
  try { localStorage.setItem("rumbo.lang", lang); } catch { /* sin almacenamiento */ }
}

const esCelular = () => matchMedia("(max-width: 560px)").matches;
const reducirMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Pone en un video el archivo y el cartel que tocan, sin recargarlo si ya los tiene.
function ponerFuente(video, archivo, cartel) {
  const fuente = video.querySelector("source");
  if (cartel && video.getAttribute("poster") !== cartel) video.setAttribute("poster", cartel);
  if (!fuente || fuente.getAttribute("src") === archivo) return false;
  fuente.setAttribute("src", archivo);
  // Si todavía no arrancó, no se baja nada: se carga recién al reproducirlo (ver reproducir).
  if (video.readyState > 0 || !video.paused) video.load();
  else video.dataset.pendiente = "1";
  return true;
}

// Reproduce un video y, si cambió de archivo mientras estaba quieto, primero lo carga.
function reproducir(video) {
  if (video.dataset.pendiente) {
    delete video.dataset.pendiente;
    video.load();
  }
  return video.play().catch(() => { /* sin autoplay: queda el cartel */ });
}

// Los videos siguen al idioma y al ancho: en el celular, las versiones verticales.
// La animación de la idea carga recién cuando se abre su pestaña.
function ajustarVideos(lang) {
  const v = esCelular() ? "-vertical" : "";
  const corte = document.getElementById("corte-video");
  if (corte && !corte.dataset.completo) {
    const cambio = ponerFuente(corte, `assets/mvp-corte-${lang}${v}.mp4`, `assets/mvp-corte-${lang}${v}.jpg`);
    corte.classList.toggle("vertical", !!v);
    if (cambio) document.dispatchEvent(new Event("rumbo:corte"));
  } else if (corte) {
    ponerFuente(corte, `assets/mvp-${lang}.mp4`, `assets/mvp-${lang}.jpg`);
  }
  const idea = document.getElementById("demo-video");
  if (idea) {
    idea.classList.toggle("vertical", !!v);
    if (idea.dataset.activo) {
      const cambio = ponerFuente(idea, `assets/flujo-${lang}${v}.mp4`, `assets/flujo-${lang}${v}.jpg`);
      if (cambio && !reducirMovimiento) reproducir(idea);
    }
  }
  for (const c of document.querySelectorAll("video[data-clip]")) {
    const nombre = c.dataset.clip;
    c.setAttribute("poster", `assets/clip-${nombre}-${lang}.jpg`);
    if (c.dataset.cargado) {
      const archivo = `assets/clip-${nombre}-${lang}.mp4`;
      if (c.getAttribute("src") !== archivo) {
        c.setAttribute("src", archivo);
        if (c.dataset.enPantalla && !reducirMovimiento) c.play().catch(() => { /* sin autoplay */ });
      }
    }
  }
}
matchMedia("(max-width: 560px)").addEventListener("change", () => ajustarVideos(document.documentElement.lang));

function aplicarTema(tema) {
  document.documentElement.setAttribute("data-theme", tema);
  try { localStorage.setItem("rumbo.theme", tema); } catch { /* sin almacenamiento */ }
}

function leer(nombre, guardado, porDefecto) {
  const q = new URLSearchParams(location.search).get(nombre);
  if (q) return q;
  try { const v = localStorage.getItem(guardado); if (v) return v; } catch { /* sin almacenamiento */ }
  return porDefecto();
}

guardarCastellano();

const temaInicial = leer("theme", "rumbo.theme", () => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
aplicarTema(temaInicial === "dark" ? "dark" : "light");

const idiomaInicial = leer("lang", "rumbo.lang", () => ((navigator.language || "es").toLowerCase().startsWith("es") ? "es" : "en"));
aplicarIdioma(idiomaInicial === "en" ? "en" : "es");

document.getElementById("idioma")?.addEventListener("click", () => {
  aplicarIdioma(document.documentElement.lang === "en" ? "es" : "en");
});
document.getElementById("pie-idioma")?.addEventListener("click", (e) => {
  e.preventDefault();
  aplicarIdioma(document.documentElement.lang === "en" ? "es" : "en");
});
document.getElementById("tema")?.addEventListener("click", () => {
  aplicarTema(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
});

// El movimiento de la página: cada animación cuenta algo del producto o guía la lectura.
// Con movimiento reducido no se oculta nada y la credencial queda en su estado final.
function animar() {
  window.rumboAnimo = true; // le avisa a la cabecera que el script corre
  const quieto = matchMedia("(prefers-reduced-motion: reduce)");
  for (const f of [
    () => entradaPortada(quieto.matches),
    revelarAlRecorrer,
    () => credencialViva(quieto),
    () => arquitecturaViva(quieto),
    pestanasDelVideo,
    () => corteVivo(quieto),
    () => pasosDe(document.getElementById("demo-video"), document.querySelector(".idea-pasos"), PASOS_DEMO, FIN_DEMO),
    () => pasosDe(document.getElementById("corte-video"), document.querySelector(".corte-pasos"), PASOS_CORTE, Infinity),
    () => clipsVivos(quieto),
    () => informeVivo(quieto),
    () => huellaViva(quieto),
    barraMovil,
    cabeceraCompacta,
  ]) {
    try { f(); } catch { document.documentElement.classList.remove("js"); } // si algo falla, se ve todo quieto
  }
}

// Si se ve al menos el umbral; con margen, porque hay navegadores que avisan con el primer píxel.
function seVe(e, umbral) {
  return e.isIntersecting && e.intersectionRatio >= umbral * 0.9;
}

// Avisa cada vez que el elemento entra en la pantalla o sale de ella.
function observar(el, alCambiar, umbral) {
  if (!("IntersectionObserver" in window)) return alCambiar(true);
  new IntersectionObserver((es) => alCambiar(seVe(es[es.length - 1], umbral)), { threshold: umbral }).observe(el);
}

// La portada entra una sola vez, al cargar: el título por palabras y después lo demás.
function entradaPortada(quieto) {
  const portada = document.querySelector(".portada");
  const h1 = portada && portada.querySelector("h1");
  if (h1 && !quieto) partirPalabras(h1);
  if (portada) portada.classList.add("entra");
}

// Cada palabra del título va en su span con su formato adentro (el <em>), y lo que no
// tiene espacio antes, como el punto final, queda pegado a la palabra anterior.
function partirPalabras(h1) {
  const grupos = [[]];
  (function recorrer(nodo, formato) {
    for (const n of nodo.childNodes) {
      if (n.nodeType === 1) recorrer(n, [...formato, n]);
      else if (n.nodeType === 3) {
        for (const t of n.data.split(/([ \t\n\r]+)/)) {
          if (/^[ \t\n\r]+$/.test(t)) grupos.push([]);
          else if (t) grupos[grupos.length - 1].push([t, formato]);
        }
      }
    }
  })(h1, []);
  h1.textContent = "";
  grupos.filter((g) => g.length).forEach((g, i) => {
    const palabra = document.createElement("span");
    palabra.className = "palabra";
    palabra.style.setProperty("--i", i);
    for (const [t, formato] of g) {
      let nodo = document.createTextNode(t);
      for (const el of [...formato].reverse()) {
        const copia = el.cloneNode(false);
        copia.append(nodo);
        nodo = copia;
      }
      palabra.append(nodo);
    }
    if (i) h1.append(" ");
    h1.append(palabra);
  });
}

// Los bloques entran al recorrer la página, una sola vez y de a uno dentro de cada tanda.
// La lista es la misma que en styles.css.
const REVELAR = ".encabezado, .tarjeta, .herramienta, .remate, .arquitectura-lista li, .demo, .sumar-flujo, .informe-vivo, .franja-final .contenedor";
function revelarAlRecorrer() {
  const bloques = document.querySelectorAll(REVELAR);
  const ver = (el, i) => {
    el.style.animationDelay = Math.min(i, 6) * 70 + "ms";
    el.classList.add("visto");
  };
  if (!("IntersectionObserver" in window)) return bloques.forEach((el) => ver(el, 0));
  const io = new IntersectionObserver((entradas) => {
    entradas
      .filter((e) => seVe(e, 0.02))
      .map((e) => e.target)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .forEach((el, i) => {
        io.unobserve(el);
        ver(el, i);
      });
  }, { threshold: 0.02 });
  bloques.forEach((el) => io.observe(el));
}

// La credencial de la portada cuenta su historia: Ana entra, almuerza, retira la polera y
// gana el premio; se sostiene y vuelve a empezar. Cada parte que cambia lleva en data-paso
// el paso en que cambia. Se pausa fuera de la pantalla y con la pestaña oculta.
function credencialViva(quieto) {
  const tarjeta = document.querySelector(".credencial");
  if (!tarjeta) return;
  const partes = tarjeta.querySelectorAll("[data-paso]");
  const boton = tarjeta.querySelector(".credencial-pausa");
  // Cuánto dura cada paso, en ms: el inicial incluye el fundido de entrada; con la vuelta, 12 s.
  const ESPERAS = [2500, 2000, 2000, 2000, 3000];
  let paso = 4;
  let reloj = 0;
  let enPantalla = false;
  let pausado = false;
  // Lo que falta del paso actual: al pausar o salir de pantalla se guarda, y al volver se retoma.
  let restante = ESPERAS[0];
  let inicioPaso = 0;
  const poner = (n, efecto) => {
    paso = n;
    restante = ESPERAS[n];
    for (const p of partes) {
      p.classList.toggle("espera", +p.dataset.paso > n);
      p.classList.toggle("fx", efecto && +p.dataset.paso === n);
    }
  };
  const detener = () => {
    if (reloj) {
      restante = Math.max(0, restante - (performance.now() - inicioPaso));
      clearTimeout(reloj);
      reloj = 0;
    }
    if (tarjeta.classList.contains("reinicio")) {
      poner(0, false);
      tarjeta.classList.remove("reinicio");
    }
  };
  const seguir = () => {
    detener();
    if (enPantalla && !document.hidden && !quieto.matches && !pausado) {
      inicioPaso = performance.now();
      reloj = setTimeout(avanzar, restante);
    }
  };
  const avanzar = () => {
    reloj = 0;
    if (paso < 4) {
      poner(paso + 1, true);
      return seguir();
    }
    tarjeta.classList.add("reinicio"); // fundido de salida
    inicioPaso = performance.now();
    reloj = setTimeout(() => {
      reloj = 0;
      poner(0, false);
      void tarjeta.offsetWidth; // el cambio queda hecho antes de volver a mostrarse
      tarjeta.classList.remove("reinicio");
      seguir();
    }, 500);
  };
  if (!quieto.matches) poner(0, false);
  quieto.addEventListener("change", () => {
    detener();
    poner(quieto.matches ? 4 : 0, false);
    if (boton) boton.hidden = quieto.matches;
    seguir();
  });
  // El botón de pausar: detiene la credencial y también el punto que recorre el diagrama.
  if (boton) {
    boton.hidden = quieto.matches;
    boton.addEventListener("click", () => {
      pausado = !pausado;
      boton.setAttribute("aria-pressed", String(pausado));
      document.documentElement.classList.toggle("pausado", pausado);
      document.dispatchEvent(new CustomEvent("rumbo:pausa", { detail: pausado }));
      seguir();
    });
  }
  observar(tarjeta, (si) => {
    enPantalla = si;
    if (si) tarjeta.classList.add("entra");
    seguir();
  }, 0.25);
  document.addEventListener("visibilitychange", seguir);
}

// El diagrama de cómo está hecho (plegado en "Hecho con Stellar"): las piezas aparecen de
// izquierda a derecha, las flechas se dibujan y un punto lleva el pago de la persona al
// organizador, pasando por la app y el contrato; otro, más tenue, sale hacia quien auspicia.
function arquitecturaViva(quieto) {
  const svg = document.querySelector(".arquitectura-svg");
  if (!svg) return;
  const nodos = svg.querySelectorAll(".arq-nodo");
  const flechas = [...svg.querySelectorAll(".arq-flechas path")];
  const usdc = svg.querySelector(".arq-etiquetas text");
  [0, 90, 180, 330, 390, 260].forEach((ms, i) => nodos[i] && (nodos[i].style.animationDelay = ms + "ms"));
  const DIBUJO = [160, 310, 520, 560, 420];
  const CICLO = 4400;
  const PAGO = [[0, 0, 700], [1, 1050, 1750], [2, 2100, 2800]];
  const AVISO = [3, 2100, 2800];
  let largos = [];
  let puntos = [];
  let inicio = 0;
  let raf = 0;
  let enPantalla = false;
  const tramo = (tr, t) => (t >= tr[1] && t < tr[2] ? tr : null);
  const ubicar = (punto, tr, t, alfa) => {
    if (!tr) return punto.setAttribute("opacity", 0);
    const u = (t - tr[1]) / (tr[2] - tr[1]);
    const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
    const p = flechas[tr[0]].getPointAtLength(largos[tr[0]] * e);
    punto.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
    punto.setAttribute("opacity", (alfa * Math.min(1, u * 5, (1 - u) * 5)).toFixed(2));
  };
  const cuadro = () => {
    const t = (((performance.now() - inicio) % CICLO) + CICLO) % CICLO;
    ubicar(puntos[0], PAGO.find((tr) => tramo(tr, t)), t, 1);
    ubicar(puntos[1], tramo(AVISO, t), t, 0.5);
    const k = tramo(PAGO[1], t) ? Math.sin((Math.PI * (t - PAGO[1][1])) / (PAGO[1][2] - PAGO[1][1])) : 0;
    if (usdc) usdc.style.transform = k > 0 ? `scale(${(1 + 0.06 * k).toFixed(3)})` : "";
    raf = requestAnimationFrame(cuadro);
  };
  const correr = () => {
    const anda = puntos.length > 0 && enPantalla && !document.hidden && !quieto.matches && !document.documentElement.classList.contains("pausado");
    if (anda && !raf) raf = requestAnimationFrame(cuadro);
    if (!anda && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      puntos.forEach((p) => p.setAttribute("opacity", 0));
      if (usdc) usdc.style.transform = "";
    }
  };
  document.addEventListener("rumbo:pausa", correr);
  const ver = () => {
    if (puntos.length) return;
    largos = flechas.map((f) => f.getTotalLength());
    if (!largos[0]) return; // todavía plegado: sin medidas
    flechas.forEach((f, i) => f.style.setProperty("--largo", largos[i]));
    svg.getBoundingClientRect();
    flechas.forEach((f, i) => {
      f.style.transitionDelay = DIBUJO[i] + "ms";
      setTimeout(() => f.classList.add("llego"), DIBUJO[i] + 450);
    });
    svg.classList.add("visto");
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", "arq-puntos");
    puntos = [5.5, 4.5].map((r) => {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("r", r);
      c.setAttribute("opacity", 0);
      return g.appendChild(c);
    });
    svg.querySelector(".arq-etiquetas").before(g);
    inicio = performance.now() + 1300;
  };
  observar(svg, (si) => {
    enPantalla = si;
    if (si) ver();
    correr();
  }, 0.3);
  document.addEventListener("visibilitychange", correr);
  quieto.addEventListener("change", correr);
}

// Las dos pestañas del reproductor: el producto real (por defecto) y la idea en 30 segundos.
// Se manejan con las flechas del teclado, como pide el patrón de pestañas.
function pestanasDelVideo() {
  const tabs = [...document.querySelectorAll('.pestanas [role="tab"]')];
  if (!tabs.length) return;
  const idea = document.getElementById("demo-video");
  const corte = document.getElementById("corte-video");
  const elegir = (tab, foco) => {
    for (const t of tabs) {
      const si = t === tab;
      t.setAttribute("aria-selected", String(si));
      t.tabIndex = si ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !si;
    }
    if (foco) tab.focus();
    const esIdea = tab.id === "pestana-idea";
    if (esIdea && idea && !idea.dataset.activo) {
      idea.dataset.activo = "1";
      ajustarVideos(document.documentElement.lang);
    }
    if (esIdea) {
      corte?.pause();
      if (idea && !reducirMovimiento) reproducir(idea);
    } else {
      idea?.pause();
      document.dispatchEvent(new Event("rumbo:corte"));
    }
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => elegir(t, false));
    t.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { e.preventDefault(); elegir(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
  if (idea && reducirMovimiento) idea.controls = true;
}

// El corte del producto real: mudo y en bucle mientras se ve; se pausa fuera de pantalla.
// "Ver el video completo" pone en el mismo lugar el minuto entero, con sonido y controles
// (en el celular, a pantalla completa) y, al terminar, vuelve al corte.
function corteVivo(quieto) {
  const video = document.getElementById("corte-video");
  const boton = document.getElementById("corte-completo");
  if (!video) return;
  let enPantalla = false;
  if (quieto.matches) video.controls = true;
  const seguir = () => {
    const panel = video.closest("[role=tabpanel]");
    const anda = enPantalla && !document.hidden && !(panel && panel.hidden) && (!quieto.matches || video.dataset.completo);
    if (anda && video.paused && !video.dataset.pausaMano) reproducir(video);
    if (!anda && !video.paused) video.pause();
  };
  observar(video, (si) => { enPantalla = si; seguir(); }, 0.35);
  document.addEventListener("visibilitychange", seguir);
  document.addEventListener("rumbo:corte", seguir);
  video.addEventListener("pause", () => { if (video.dataset.completo && enPantalla && !document.hidden) video.dataset.pausaMano = "1"; });
  video.addEventListener("play", () => { delete video.dataset.pausaMano; });
  const volver = () => {
    delete video.dataset.completo;
    delete video.dataset.pausaMano;
    video.loop = true;
    video.muted = true;
    video.controls = quieto.matches;
    if (document.fullscreenElement === video) document.exitFullscreen?.().catch(() => {});
    boton.hidden = false;
    ajustarVideos(document.documentElement.lang);
    seguir();
  };
  video.addEventListener("ended", () => { if (video.dataset.completo) volver(); });
  boton?.addEventListener("click", () => {
    const lang = document.documentElement.lang === "en" ? "en" : "es";
    video.dataset.completo = "1";
    video.loop = false;
    video.muted = false;
    video.controls = true;
    video.classList.remove("vertical");
    ponerFuente(video, `assets/mvp-${lang}.mp4`, `assets/mvp-${lang}.jpg`);
    boton.hidden = true;
    reproducir(video);
    if (esCelular()) {
      if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    }
  });
}

// Debajo de cada video se resalta el paso que se está mostrando.
function pasosDe(video, lista, pasos, fin) {
  if (!video || !lista) return;
  const items = [...lista.children];
  let actual = null;
  const marcar = () => {
    const sigue = !video.dataset.completo && video.getClientRects().length > 0 && video.played.length > 0;
    const t = video.currentTime;
    let n = -1;
    if (sigue && t < fin) pasos.forEach((desde, i) => { if (t >= desde) n = i; });
    lista.classList.toggle("sincronizado", sigue);
    if (n === actual) return;
    actual = n;
    items.forEach((p, i) => p.classList.toggle("activo", i === n));
  };
  for (const ev of ["timeupdate", "playing", "seeked", "emptied"]) video.addEventListener(ev, marcar);
}

// Los clips de "Qué hace": cargan recién cuando la tarjeta entra en pantalla y se pausan al salir.
// Con movimiento reducido se queda el cartel quieto.
function clipsVivos(quieto) {
  for (const c of document.querySelectorAll("video[data-clip]")) {
    observar(c, (si) => {
      if (si) c.dataset.enPantalla = "1"; else delete c.dataset.enPantalla;
      if (quieto.matches) return;
      if (si && !c.dataset.cargado) {
        c.dataset.cargado = "1";
        c.setAttribute("src", `assets/clip-${c.dataset.clip}-${document.documentElement.lang === "en" ? "en" : "es"}.mp4`);
      }
      if (si) c.play().catch(() => { /* sin autoplay */ });
      else if (!c.paused) c.pause();
    }, 0.4);
  }
}

// El informe de ejemplo se arma cuando entra en pantalla: las filas, los números que suben,
// las barras y los sellos. Una sola vez; con movimiento reducido ya está armado.
function informeVivo(quieto) {
  const fig = document.querySelector(".informe-vivo");
  if (!fig || quieto.matches) return;
  const numeros = [...fig.querySelectorAll("[data-hasta]")];
  fig.classList.add("espera");
  let hecho = false;
  observar(fig, (si) => {
    if (!si || hecho) return;
    hecho = true;
    fig.classList.remove("espera");
    fig.classList.add("arma");
    numeros.forEach((b, i) => {
      const hasta = +b.dataset.hasta;
      const t0 = performance.now() + 250 + i * 220;
      const paso = (t) => {
        const u = Math.min(1, Math.max(0, (t - t0) / 900));
        b.textContent = String(Math.round(hasta * (1 - Math.pow(1 - u, 3))));
        if (u < 1) requestAnimationFrame(paso);
      };
      b.textContent = "0";
      requestAnimationFrame(paso);
    });
  }, 0.45);
}

// La huella en Stellar se anota cuando entra en pantalla: la entrada, el canje, la venta y el
// canje repetido que se frena. Una sola vez; con movimiento reducido ya está anotada.
function huellaViva(quieto) {
  const fig = document.querySelector(".huella");
  if (!fig || quieto.matches) return;
  fig.classList.add("espera");
  let hecho = false;
  observar(fig, (si) => {
    if (!si || hecho) return;
    hecho = true;
    fig.classList.remove("espera");
    fig.classList.add("arma");
  }, 0.45);
}

// En el celular, una barra fija con "Creá tu evento" aparece después de la portada y se esconde
// cuando se ve la franja final. También se corre mientras el teléfono de Probalo está en pantalla:
// ahí la guía va pegada arriba y el teléfono necesita todo el alto que queda. Y mientras se ve el botón
// principal de una sección, para no mostrar el mismo botón dos veces o dos naranjas llenos que compiten.
function barraMovil() {
  const barra = document.getElementById("barra-movil");
  const portada = document.querySelector(".portada .cta");
  const final = document.getElementById("empezar");
  const maqueta = document.getElementById("pb-escenario");
  if (!barra || !portada || !final || !("IntersectionObserver" in window)) return;
  let pasoPortada = false;
  let veFinal = false;
  let veMaqueta = false;
  const botones = new Set();
  const enlace = barra.querySelector("a");
  const poner = () => {
    const si = pasoPortada && !veFinal && !veMaqueta && botones.size === 0;
    barra.classList.toggle("visible", si);
    document.documentElement.classList.toggle("con-crear", si);
    barra.setAttribute("aria-hidden", String(!si));
    enlace.tabIndex = si ? 0 : -1;
  };
  new IntersectionObserver(([e]) => {
    pasoPortada = !e.isIntersecting && e.boundingClientRect.top < 0;
    poner();
  }).observe(portada);
  new IntersectionObserver(([e]) => { veFinal = e.isIntersecting; poner(); }).observe(final);
  if (maqueta) new IntersectionObserver(([e]) => { veMaqueta = e.isIntersecting; poner(); }).observe(maqueta);
  const vigia = new IntersectionObserver((cambios) => {
    for (const c of cambios) c.isIntersecting ? botones.add(c.target) : botones.delete(c.target);
    poner();
  });
  document.querySelectorAll("main .cta-seccion .boton-primario, main .llamado .boton-primario").forEach((b) => vigia.observe(b));
}

// La cabecera se compacta y toma una sombra fina cuando la página bajó más de 40 px.
function cabeceraCompacta() {
  const cabecera = document.querySelector(".cabecera");
  if (!cabecera) return;
  let pedido = false;
  const mirar = () => {
    pedido = false;
    cabecera.classList.toggle("compacta", scrollY > 40);
  };
  addEventListener("scroll", () => {
    if (!pedido) {
      pedido = true;
      requestAnimationFrame(mirar);
    }
  }, { passive: true });
  mirar();
}
