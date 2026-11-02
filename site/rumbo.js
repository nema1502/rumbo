// Idioma y tema de la página. El castellano vive en el HTML; acá está el inglés.
// Elegir: ?lang=en o ?lang=es, ?theme=dark o ?theme=light; lo elegido se recuerda en el navegador.

const EN = {
  "nav.que": "What it does",
  "nav.stellar": "Why Stellar",
  "nav.equipo": "The team",
  "nav.idioma": "ES",
  "nav.github": "GitHub",
  "nav.tema": "Theme",

  "portada.ante": "Community events on Stellar",
  "portada.titulo": "Your whole event <em>in one QR code</em>.",
  "portada.bajada": "Sell tickets in seconds from any country, in digital dollars or with your bank's QR code. Pass, check-in, lunch, merch and prizes in one place, and every redemption happens once.",
  "portada.cta": "See the project on GitHub",
  "portada.como": "How it works",
  "portada.nota": "Made in Bolivia, in Spanish and English from day one. Open core under MIT.",

  "cred.evento": "Community hackathon",
  "cred.tipo": "General ticket",
  "cred.numero": "Pass 37 of 120",
  "cred.nombre": "Ana R.",
  "cred.estado": "Checked in",
  "cred.b1": "Saturday lunch",
  "cred.b1e": "pending",
  "cred.b2": "T-shirt, size M",
  "cred.b2e": "paid, pick up",
  "cred.b3": "Draw prize: headphones",
  "cred.b3e": "won",

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

  "como.titulo": "One place for everyone at the event.",
  "como.bajada": "Rumbo is made for events of 80 to 500 people with sponsors and several benefits: hackathons, DevFests, community conferences, bootcamps, chapter meetups.",
  "como.r1.n": "If you organize",
  "como.r1.a": "Create the event with a form, or describe it in plain words and approve the draft.",
  "como.r1.b": "Publish the page with free or paid registration. Import your guest list as CSV.",
  "como.r1.c": "Get paid in USDC from anywhere, or in bolivianos with a bank QR code. The money reaches you in the same operation that separates Rumbo's fee.",
  "como.r1.d": "Print the passes or leave them on each phone. Watch the live dashboard and send each sponsor their report.",
  "como.r2.n": "If you attend",
  "como.r2.a": "Register with Google or a passkey. A Stellar account is created underneath without you having to know.",
  "como.r2.b": "Get an email with a personal link. Never keys or passwords.",
  "como.r2.c": "Keep your pass on your phone and see what you are entitled to.",
  "como.r3.n": "If you volunteer",
  "como.r3.a": "Scan the QR code and see what this person gets.",
  "como.r3.b": "Mark it as redeemed. It cannot be redeemed twice.",
  "como.r3.c": "No account, no training. It works offline and syncs later: the queue never waits for the network.",
  "como.r4.n": "If you sponsor",
  "como.r4.a": "Offer a benefit, like a coffee for every attendee, and see how many were redeemed.",
  "como.r4.b": "Keep the contact of the people who agree to share it at your booth.",
  "como.r4.c": "Get the report with what was actually delivered.",

  "stellar.titulo": "Why Stellar, and not just a database.",
  "stellar.bajada": "For counting lunches a database would do. Stellar adds what a database cannot.",
  "stellar.m1.t": "Paid from any country, in seconds",
  "stellar.m1.p": "Even where card processors do not pay out. One operation pays the organizer and separates the fee, with nobody holding the money in between.",
  "stellar.m2.t": "Protected payments",
  "stellar.m2.p": "The ticket stays in a contract until the event happens. If it is cancelled, refunds go out on their own.",
  "stellar.m3.t": "Vouchers that work once",
  "stellar.m3.p": "Each benefit is redeemed exactly once, and prizes are delivered with a proof that does not depend on Rumbo. On testnet the voucher is not money, but the lunch is real.",
  "stellar.m4.t": "An account that lasts",
  "stellar.m4.p": "Every attendee leaves with a Stellar account that works at the next event, created with Google or a passkey, with fees sponsored so nobody needs XLM.",
  "stellar.m5.t": "Payments to speakers and volunteers",
  "stellar.m5.p": "In any country, in one click.",
  "stellar.m6.t": "An API other apps can pay per use",
  "stellar.m6.p": "Other platforms and agents create events, passes and vouchers paying cents in USDC, with x402.",

  "tinkazo.titulo": "With Tinkazo",
  "tinkazo.p": "Tinkazo runs draws anyone can check from their phone. Tinkazo decides who wins; Rumbo delivers what was won and runs everything else at the event. The prize lands on the winner's pass, the draw runs over the people who actually checked in, and entering a draw is always free, whether the event is paid or not.",
  "tinkazo.cta": "See Tinkazo",

  "ruta.titulo": "Where it stands",
  "ruta.bajada": "Rumbo is at the design stage: the product is specified in detail and the first code lands in November 2026. The contract starts from an event pass written in September 2026 for Stellar Elite Bolivia, with nine tests and a run on testnet.",
  "ruta.ahora": "First",
  "ruta.despues": "Then",
  "ruta.luego": "Later",
  "ruta.a1": "Event page with free or paid registration (USDC on testnet)",
  "ruta.a2": "Account with Google or a passkey, fees sponsored",
  "ruta.a3": "Pass with QR code, on the phone and as SVG or PDF",
  "ruta.a4": "Check-in and redemptions with an offline scanner",
  "ruta.a5": "Organizer dashboard",
  "ruta.d1": "Protected payment with automatic refund",
  "ruta.d2": "Describe the event in plain words and approve the draft",
  "ruta.d3": "Prize from a Tinkazo draw landing on the pass",
  "ruta.d4": "Sponsor report",
  "ruta.d5": "Luma CSV import",
  "ruta.l1": "Bank QR payments in bolivianos on mainnet",
  "ruta.l2": "Resale at the original price",
  "ruta.l3": "Pay-per-use API with x402",
  "ruta.l4": "Payments to speakers",
  "ruta.l5": "Licenses for community networks",
  "ruta.estado": "Design stage. First code in November 2026.",

  "principios.titulo": "What Rumbo never does",
  "principios.p1.t": "Hold your money.",
  "principios.p1.p": "It goes straight to the organizer or sits in the contract of a protected payment.",
  "principios.p2.t": "Convert currencies itself.",
  "principios.p2.p": "Bolivianos are converted by partners who hold the license.",
  "principios.p3.t": "Put personal data on chain.",
  "principios.p3.p": "Names and emails stay off the ledger and are used only to notify people. Booth contacts are shared only with consent, at that booth.",
  "principios.p4.t": "Charge for free events.",
  "principios.p4.p": "The fee applies when money changes hands.",
  "principios.p5.t": "Show technical jargon.",
  "principios.p5.p": "Nobody at the door needs to know there is a blockchain underneath.",
  "principios.p6.t": "Close what it opened.",
  "principios.p6.p": "The redemption contract, the scanner and the event template are open source under MIT. The hosted service is what Rumbo charges for.",

  "equipo.titulo": "The team",
  "equipo.bajada": "Rumbo is made in Santa Cruz de la Sierra, Bolivia, by its two founders.",
  "equipo.n1.rol": "Product and smart contracts",
  "equipo.n2.rol": "Full-stack development",
  "equipo.cta": "Questions and ideas: open an issue on GitHub.",

  "pie.hecho": "Made in Santa Cruz de la Sierra, Bolivia.",
  "pie.codigo": "Code",
  "pie.licencia": "MIT license",
  "pie.idioma": "Español",
};

const ES = {};
const clave = (el) => el.getAttribute("data-i18n");

function guardarCastellano() {
  for (const el of document.querySelectorAll("[data-i18n]")) ES[clave(el)] = el.innerHTML;
}

function aplicarIdioma(lang) {
  const dic = lang === "en" ? EN : ES;
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const k = clave(el);
    if (dic[k] !== undefined) el.innerHTML = dic[k];
  }
  document.documentElement.lang = lang;
  document.title = lang === "en" ? "Rumbo: your whole event in one QR code" : "Rumbo: tu evento entero en un QR";
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute("content", lang === "en"
    ? "Community events on Stellar. Sell tickets from anywhere and run the whole event from one QR code."
    : "Eventos de comunidad sobre Stellar. Cobrá entradas desde cualquier país y operá todo tu evento desde un QR.");
  const boton = document.getElementById("idioma");
  if (boton) {
    boton.textContent = lang === "en" ? "ES" : "EN";
    boton.setAttribute("aria-label", lang === "en" ? "Cambiar a castellano" : "Switch to English");
  }
  try { localStorage.setItem("rumbo.lang", lang); } catch { /* sin almacenamiento */ }
}

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
document.getElementById("tema")?.addEventListener("click", () => {
  aplicarTema(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
});
