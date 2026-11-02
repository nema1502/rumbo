// Idioma y tema de la página. El castellano vive en el HTML; acá está el inglés.
// Elegir: ?lang=en o ?lang=es, ?theme=dark o ?theme=light; lo elegido se recuerda en el navegador.

const EN = {
  "nav.como": "How it works",
  "nav.demo": "How it looks",
  "nav.stellar": "Why Stellar",
  "nav.crece": "How it grows",
  "nav.equipo": "The team",
  "nav.idioma": "ES",
  "nav.github": "GitHub",

  "aria.inicio": "Rumbo, home",
  "aria.tema": "Switch theme",
  "aria.secciones": "Sections",
  "aria.esencial": "The essentials",
  "aria.credencial": "A sample pass",
  "aria.video": "Animation of the Rumbo flow",
  "aria.arquitectura": "How the pieces connect",
  "aria.enlaces": "Links",

  "portada.ante": "Community events on Stellar",
  "portada.titulo": "Your whole event <em>in one QR&nbsp;code</em>.",
  "portada.bajada": "Register for free or sell tickets in seconds from any country, in digital dollars or with your bank's QR code. Pass, check-in, lunch, merch and prizes in one place, and every redemption happens once.",
  "portada.cta": "See how it works",
  "portada.codigo": "The code, on GitHub",
  "portada.s1": "Paid in seconds",
  "portada.s2": "Redeemed once",
  "portada.s3": "Works offline",
  "portada.nota": "Made in Bolivia, in Spanish and English from day one. Open core under MIT.",
  "portada.estado": "Design stage. The pass contract already has nine tests and a run on Stellar's test network. First code in November 2026.",

  "cred.evento": "Community hackathon",
  "cred.tipo": "General ticket",
  "cred.ejemplo": "Example",
  "cred.numero": "Pass 37 of 120",
  "cred.nombre": "Ana R.",
  "cred.estado": "Checked in",
  "cred.b1": "Saturday lunch",
  "cred.b1e": "pending",
  "cred.b2": "T-shirt, size M",
  "cred.b2e": "paid, pick up",
  "cred.b3": "Draw prize: headphones",
  "cred.b3e": "won",

  "demo.ante": "How it looks",
  "demo.titulo": "From sign-up to report, in half a minute.",
  "demo.bajada": "People sign up for free, or buy a ticket or merch and the money arrives split. The pass appears, a volunteer scans and redeems once, and the dashboard counts what happened.",
  "demo.abrir": "Watch the animation",
  "demo.p1": "Signing up is free. If the event charges for a ticket or sells its merch, the money reaches the organizer with the fee separated, in the same operation.",
  "demo.p2": "The pass with its QR code stays on the phone, with what each person is entitled to.",
  "demo.p3": "The volunteer scans and redeems. A second attempt does not go through, and offline the queue keeps moving.",
  "demo.p4": "The dashboard counts passes, check-ins and redemptions, and the sponsor report is ready.",
  "demo.nota": "An animated mock-up of what gets built in November, not a recording of the product.",

  "problema.ante": "The problem",
  "problema.titulo": "A community event today is six tools and a spreadsheet.",
  "problema.bajada": "Registration in one place, badges in another, lunch tickets on paper, merch over direct messages, prizes in a photo, and a sponsor report assembled from memory.",
  "problema.h1": "Registration",
  "problema.h1b": "Luma",
  "problema.h2": "Badges",
  "problema.h2b": "Canva",
  "problema.h3": "Lunch and snacks",
  "problema.h3b": "paper tickets or a column ticked by hand",
  "problema.h4": "Merch",
  "problema.h4b": "Instagram and WhatsApp messages",
  "problema.h5": "Prizes",
  "problema.h5b": "a photo",
  "problema.h6": "Sponsor report",
  "problema.h6b": "assembled from memory",
  "problema.remate.t": "And often, no way to get paid.",
  "problema.remate.p": "In much of the world the organizer cannot charge for tickets: the platforms they already use need a Stripe account, and Stripe does not pay out in their country. Bolivia is one of them.",

  "como.ante": "How it works",
  "como.titulo": "One place for everyone at the event.",
  "como.bajada": "Rumbo is made for events of 80 to 500 people with sponsors and several benefits: hackathons, DevFests, community conferences, bootcamps, chapter meetups.",
  "como.r1.n": "If you organize",
  "como.r1.a": "Create the event and publish the page, with free or paid registration.",
  "como.r1.b": "Get paid in USDC or with a bank QR code. The money arrives already split.",
  "como.r1.c": "Print the passes or leave them on each phone.",
  "como.r1.d": "Watch the live dashboard and send each sponsor their report.",
  "como.r2.n": "If you attend",
  "como.r2.a": "Sign in with Google or a passkey. A Stellar account is created underneath without you having to know.",
  "como.r2.b": "Get an email with a personal link. Never keys or passwords.",
  "como.r2.c": "Keep your pass on your phone and see what you are entitled to.",
  "como.r3.n": "If you volunteer",
  "como.r3.a": "Scan the QR code and see what this person gets.",
  "como.r3.b": "Mark it as redeemed. It cannot be redeemed twice.",
  "como.r3.c": "No account, no training. It works offline and syncs later.",
  "como.r4.n": "If you sponsor",
  "como.r4.a": "Offer a benefit, like a coffee for every attendee, and see how many were redeemed.",
  "como.r4.b": "Keep the contact of the people who agree to share it at your booth.",
  "como.r4.c": "Get the report with what was actually delivered.",

  "stellar.ante": "Why Stellar",
  "stellar.titulo": "What a database cannot do.",
  "stellar.bajada": "For counting lunches a spreadsheet would do. This is what Stellar adds.",
  "stellar.m1.t": "Paid from any country, in seconds",
  "stellar.m1.p": "Even where card processors do not pay out. One operation pays the organizer and separates the fee, with nobody holding the money in between.",
  "stellar.m2.t": "Protected payments",
  "stellar.m2.p": "The ticket stays in a contract until the event happens. If it is cancelled, refunds go out on their own.",
  "stellar.m3.t": "Vouchers that work once",
  "stellar.m3.p": "Each benefit is redeemed exactly once, and prizes are delivered with a proof that does not depend on Rumbo. On the test network the voucher is not money, but the lunch is real.",
  "stellar.m4.t": "An account that lasts",
  "stellar.m4.p": "Every attendee leaves with a Stellar account that works at the next event, created with Google or a passkey, with fees sponsored so nobody needs XLM.",
  "stellar.m5.t": "Payments to speakers and volunteers",
  "stellar.m5.p": "In any country, in one click. No bank accounts in between and no wire fees.",
  "stellar.m6.t": "An API other apps can pay per use",
  "stellar.m6.p": "Other platforms and agents create events, passes and vouchers at volume, paying cents in USDC through x402. For your own events, the API is free.",

  "hecho.ante": "How it is built",
  "hecho.titulo": "A contract, an app and a scanner. Nothing else in between.",
  "hecho.bajada": "What guarantees that a voucher is used once and that the money arrives split lives in a contract on Stellar. Everything else is an app anyone opens from their phone.",
  "arq.n1": "The person",
  "arq.n1b": "registers and pays from the phone",
  "arq.n2": "The Rumbo app",
  "arq.n2b": "event page, pass, dashboard",
  "arq.n2c": "account with Google or a passkey",
  "arq.n2d": "in Spanish and English",
  "arq.n3": "The contract on Stellar",
  "arq.n3b": "charges and splits in one operation",
  "arq.n3c": "check-in and each redemption, once",
  "arq.n3d": "no names or emails inside",
  "arq.n4": "The organizer",
  "arq.n4b": "receives the money right away",
  "arq.n5": "The sponsor",
  "arq.n5b": "sees redemptions and the report",
  "arq.n6": "The volunteer's scanner",
  "arq.n6b": "validates the QR offline and syncs later",
  "arq.f2": "USDC",
  "arq.l1": "The attendee registers and pays from the phone, with a Google account or a passkey.",
  "arq.l2": "The app builds the event page, the pass and the dashboard, in Spanish and English.",
  "arq.l3": "The contract on Stellar charges and splits in one operation, and marks the check-in and each redemption once. There are no names or emails inside.",
  "arq.l4": "The volunteer's scanner validates the QR offline and syncs later. The organizer receives the money right away and the sponsor sees the redemptions.",
  "hecho.d1.t": "Open core",
  "hecho.d1.p": "The contract, the scanner and the event template, under MIT. Any community can set them up and adapt them.",
  "hecho.d2.t": "Nobody needs XLM",
  "hecho.d2.p": "Rumbo sponsors the network fees. People sign in with Google or a passkey and never see anything technical.",
  "hecho.d3.t": "There is already a seed",
  "hecho.d3.p": "The contract starts from an event pass written in September 2026 for Stellar Elite Bolivia, with nine tests and a run on the test network.",

  "crece.ante": "How it grows",
  "crece.titulo": "It starts with one community and ends with a network.",
  "crece.bajada": "Each stage pays for the next: communities bring sponsors, paid events bring networks, and networks bring the platforms that want to build on top.",
  "crece.e1.tag": "First",
  "crece.e1.t": "One community",
  "crece.e1.p": "Passes, check-in and redemptions on the test network, for free. The voucher is not money, but the lunch is real.",
  "crece.e1.a": "Event page with free or paid registration",
  "crece.e1.b": "Account with Google or a passkey, no XLM needed",
  "crece.e1.c": "Pass with QR code, on the phone and for printing",
  "crece.e1.d": "Check-in and redemptions with an offline scanner",
  "crece.e1.e": "Organizer dashboard",
  "crece.e2.tag": "Then",
  "crece.e2.t": "Events that charge",
  "crece.e2.p": "Tickets with real payments in USDC, and sponsors with verified redemption and a report.",
  "crece.e2.a": "Protected payment with automatic refund",
  "crece.e2.b": "Describe the event in plain words and approve the draft",
  "crece.e2.c": "The prize from a draw landing on the winner's pass",
  "crece.e2.d": "Sponsor report",
  "crece.e2.e": "Import the Luma guest list",
  "crece.e3.tag": "Later",
  "crece.e3.t": "Networks and platforms",
  "crece.e3.p": "Licenses for community networks, and an API other apps and agents pay per use.",
  "crece.e3.a": "Bank QR payments in bolivianos",
  "crece.e3.b": "Resale at the original price",
  "crece.e3.c": "Pay-per-use API",
  "crece.e3.d": "Payments to speakers",
  "crece.e3.e": "Licenses for community networks",
  "crece.remate.t": "Open core, hosted service.",
  "crece.remate.p": "Developers at a GDG or a WTM chapter learn Stellar by adapting their own event's system. The convenient part, and the part Rumbo charges for, is the hosted service: event setup, emails, real time, payments and reports.",

  "paga.ante": "Who pays",
  "paga.titulo": "Communities have almost no money. So someone else pays.",
  "paga.bajada": "Free events are free, and that is how people arrive. The fee appears when money changes hands, and sponsors pay to know what happened with what they put in.",
  "paga.c1.t": "If you sell tickets",
  "paga.c1.p": "A fee per paid ticket, below what card platforms charge on their free plans. It is taken in the same operation: nobody holds the money in between.",
  "paga.c2.t": "If you sponsor",
  "paga.c2.p": "Per campaign: \"a coffee for every attendee\", with verified redemption, a report and the booth contacts of those who agree to share them.",
  "paga.c3.t": "Large events",
  "paga.c3.p": "Per attendee: passes, scanners, several days and ticket types, reports. Hackathons, DevFests, conferences.",
  "paga.c4.t": "Community networks",
  "paga.c4.p": "One license per network, for all its chapters, with aggregated data. It is how to grow without selling one by one.",
  "paga.c5.t": "Other apps and agents",
  "paga.c5.p": "Per use, when they create events at volume through the API, paying cents in USDC. For your own events, the API and the MCP server are free.",
  "paga.c6.t": "Small communities",
  "paga.c6.p": "Free, with a cap on people per event. They are the distribution, as in every events platform.",
  "paga.nota": "Prices are set with the first communities that use it, not before.",

  "principios.ante": "Principles",
  "principios.titulo": "What Rumbo never does",
  "principios.p1.t": "Hold your money.",
  "principios.p1.p": "It goes straight to the organizer or sits in the contract of a protected payment.",
  "principios.p2.t": "Convert currencies itself.",
  "principios.p2.p": "Bolivianos are converted by partners who hold the license.",
  "principios.p3.t": "Put personal data on chain.",
  "principios.p3.p": "Names and emails stay off the chain and are used only to notify people. Booth contacts are shared only with consent, at that booth.",
  "principios.p4.t": "Charge for free events.",
  "principios.p4.p": "The fee applies when money changes hands.",
  "principios.p5.t": "Show technical jargon.",
  "principios.p5.p": "Nobody at the door needs to know what is underneath. The technical part is folded away, for whoever wants to read it.",
  "principios.p6.t": "Close what it opened.",
  "principios.p6.p": "The redemption contract, the scanner and the event template are open source under MIT. The hosted service is what Rumbo charges for.",

  "equipo.ante": "The people",
  "equipo.titulo": "The team",
  "equipo.bajada": "Rumbo is made in Santa Cruz de la Sierra, Bolivia, by two founders who organize and live these events.",
  "equipo.n1.rol": "Product and smart contracts",
  "equipo.n2.rol": "Full-stack development",
  "equipo.cta": "Questions and ideas: open an issue on GitHub.",

  "nav.pagos": "Payments",
  "nav.abierto": "Open",
  "casos.ante": "What it is for",
  "casos.titulo": "A twenty-person meetup or a three-hundred-person hackathon.",
  "casos.bajada": "What you do today with a form, a WhatsApp group and a spreadsheet, in one place, with what gets handed out under control.",
  "casos.c1.t": "A hackathon",
  "casos.c1.p": "Team sign-up and day passes. Passes for mentors and judges. Lunches and dinners redeemed once, so nobody eats twice while someone else goes without. And the prize lands on the winner's pass.",
  "casos.c2.t": "A meetup or a DevFest",
  "casos.c2.p": "Free list, email confirmation and check-in at the door. Snacks and merch redeemed once, and a draw among the people who actually showed up.",
  "casos.c3.t": "A conference",
  "casos.c3.p": "Several ticket types and prices, workshops with limited seats, booths that collect contacts with each person's permission, and a report for every sponsor.",
  "casos.c4.t": "A community with a calendar",
  "casos.c4.p": "Every event of a GDG, a chapter or a university on one page, with the people who already came and their attendance history.",
  "pagos.ante": "How people pay",
  "pagos.titulo": "In your currency, with your bank's QR code. Or in USDC, from any country.",
  "pagos.bajada": "In much of Latin America you cannot charge with Stripe, and local gateways ask for a company, paperwork and days of waiting. Here the money goes from the buyer to the organizer in a single operation.",
  "pagos.m1.t": "With your bank's QR code, in bolivianos",
  "pagos.m1.p": "People pay the way they pay for everything: they scan their bank's QR code. A licensed ramp converts the bolivianos and the organizer receives USDC on the spot. Bolivia first, then each country with its own ramp.",
  "pagos.m2.t": "In USDC, from any country",
  "pagos.m2.p": "With the account that creates itself through Google or a passkey, or from any Stellar wallet. No card, no XLM and no bank account on the other side.",
  "pagos.m3.t": "No money in the middle",
  "pagos.m3.p": "The contract splits the organizer's share, the fee and the sponsor's share in the same operation. Rumbo never holds the money, and if the event is cancelled, the protected payment refunds itself.",
  "abierto.ante": "Open and connected",
  "abierto.titulo": "Connecting is free: API, MCP and open source.",
  "abierto.bajada": "Rumbo does not want to be another island. What you already use connects, the data is yours, and whoever wants to build on top, can.",
  "abierto.m1.t": "API and webhooks",
  "abierto.m1.p": "Create events, sign people up and read check-ins and redemptions from your own system. Free for your own events; platforms that create events at volume pay per use.",
  "abierto.m2.t": "An MCP server",
  "abierto.m2.p": "Your AI assistant sets up the event, loads the list, sends the reminders and reads you the report, with the same tools the app uses.",
  "abierto.m3.t": "Import and export",
  "abierto.m3.p": "Bring your list from Luma or a spreadsheet, and take everything to CSV or Google Sheets whenever you want.",
  "abierto.m4.t": "Notices where people are",
  "abierto.m4.p": "The pass, the reminders and last-minute changes arrive by email, in the calendar and on Telegram.",
  "abierto.m5.t": "Verifiable draws",
  "abierto.m5.p": "A draw among the people who actually came, with a result anyone can verify, and the prize landing on the winner's pass.",
  "abierto.m6.t": "Open source under MIT",
  "abierto.m6.p": "The contract, the scanner and the event template are on GitHub. Any community can run them, adapt them and learn Stellar with its own event.",
  "paga.c7.t": "If you organize often",
  "paga.c7.p": "An affordable monthly plan, in USDC or bolivianos, with more capacity, your brand on the page and your people's history. Small communities stay free.",
  "paga.c8.t": "If you sell merch or workshops",
  "paga.c8.p": "The same fee as a ticket. Whatever the event sells is paid on its own page and lands on the pass as one more redemption.",
  "pie.hecho": "Made in Santa Cruz de la Sierra, Bolivia.",
  "pie.codigo": "Code",
  "pie.licencia": "MIT license",
  "pie.idioma": "Español",
};

const ES = {};
const ES_ARIA = {};

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
    ? "Community events on Stellar. Register for free or sell tickets from anywhere and run the whole event from one QR code."
    : "Eventos de comunidad sobre Stellar. Inscribí gratis o cobrá entradas desde cualquier país y operá todo tu evento desde un QR.");

  ajustarDemo(lang);

  const boton = document.getElementById("idioma");
  if (boton) {
    boton.textContent = lang === "en" ? "ES" : "EN";
    boton.setAttribute("aria-label", lang === "en" ? "Cambiar a castellano" : "Switch to English");
  }
  const pie = document.getElementById("pie-idioma");
  if (pie) pie.setAttribute("href", lang === "en" ? "?lang=es" : "?lang=en");
  try { localStorage.setItem("rumbo.lang", lang); } catch { /* sin almacenamiento */ }
}

// La animación: horizontal en pantallas grandes; en el celular, la vertical si existe,
// y si no, un cartel con botón que abre el video.
const esCelular = () => matchMedia("(max-width: 560px)").matches;
const verticales = {};
async function hayVertical(lang) {
  if (verticales[lang] === undefined) {
    try {
      const r = await fetch(`assets/flujo-${lang}-vertical.mp4`, { method: "HEAD" });
      verticales[lang] = r.ok;
    } catch {
      verticales[lang] = false;
    }
  }
  return verticales[lang];
}
async function ajustarDemo(lang) {
  const video = document.getElementById("demo-video");
  const abrir = document.getElementById("demo-abrir");
  const poster = document.getElementById("demo-poster");
  if (!video || !abrir) return;
  const vertical = esCelular() && (await hayVertical(lang));
  if (document.documentElement.lang !== lang) return;
  const sufijo = vertical ? "-vertical" : "";
  const archivo = `assets/flujo-${lang}${sufijo}.mp4`;
  const cartel = `assets/flujo-${lang}${sufijo}.jpg`;
  video.classList.toggle("vertical", vertical);
  abrir.hidden = vertical;
  abrir.setAttribute("href", `assets/flujo-${lang}.mp4`);
  if (poster) poster.setAttribute("src", `assets/flujo-${lang}.jpg`);
  const fuente = video.querySelector("source");
  if (fuente && !fuente.getAttribute("src").endsWith(archivo)) {
    fuente.setAttribute("src", archivo);
    video.setAttribute("poster", cartel);
    video.load();
    if (!reducirMovimiento) video.play().catch(() => { /* sin autoplay */ });
  }
}
matchMedia("(max-width: 560px)").addEventListener("change", () => ajustarDemo(document.documentElement.lang));

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

const reducirMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;

guardarCastellano();

const temaInicial = leer("theme", "rumbo.theme", () => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
aplicarTema(temaInicial === "dark" ? "dark" : "light");

const idiomaInicial = leer("lang", "rumbo.lang", () => ((navigator.language || "es").toLowerCase().startsWith("es") ? "es" : "en"));
aplicarIdioma(idiomaInicial === "en" ? "en" : "es");

// Con movimiento reducido, el video no arranca solo y se puede controlar.
const demo = document.getElementById("demo-video");
if (demo && reducirMovimiento) {
  demo.removeAttribute("autoplay");
  demo.pause();
  demo.controls = true;
}

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
