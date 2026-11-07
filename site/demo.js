// Probalo: la maqueta clickeable del evento. Corre entera en el navegador: no guarda nada ni toca la red.
// Un solo estado para los tres roles; cada acción se ve en los otros dos (en escritorio, en las miniaturas
// vivas al costado; en el celular, en la tira En vivo). El idioma sigue al lang que rumbo.js pone en <html>.
(() => {
const raiz = document.getElementById("probar"), guia = document.getElementById("pb-guia"), escenario = document.getElementById("pb-escenario");
if (!raiz || !guia || !escenario) return;

const es = {
  ante: "Probalo", titulo: "Hacé de cuenta que estás en el evento.",
  bajada: "Tocá y recorré un evento entero: te inscribís gratis, entrás, canjeás y el panel se entera al instante.",
  maqueta: "Es una maqueta: no guarda nada.",
  real: "Y esto ya anda: mirá la app de verdad, grabada de punta a punta.", realVer: "Ver el video", realProbar: "Probala de verdad",
  realAria: "La app de Rumbo andando, de la inscripción al panel",
  rolesL: "Elegí un rol", asiste: "Quien asiste", voluntario: "Voluntario", organiza: "Quien organiza",
  evento: "Hackatón de la comunidad", fecha: "Domingo 22 de noviembre", nombreL: "Tu nombre", eventoL: "Tu evento", opcional: "si querés",
  entrada: "Entrada general", gratis: "Gratis", inscribirme: "Inscribirme", lista: "Inscripción lista",
  correo: "Tu credencial quedó lista: guardá el enlace", ver: "Ver mi credencial",
  polera: "Polera del evento", precio: "$us 10", comprar: "Comprar", oQR: "o con el QR del banco (próximamente)", pagada: "Pagada",
  antes: "Primero inscribite: la polera va a tu credencial.",
  como: "¿Cómo pagás?", poleraM: "Polera del evento, talle M: $us 10", digital: "En dólares digitales", digitalSub: "desde tu cuenta",
  qr: "QR del banco", qrSub: "en bolivianos", pronto: "Próximamente", cancelar: "Cancelar", listo: "Listo",
  pagDig: "Pagado", pagQr: "Así va a ser con el QR del banco",
  subDig: "$us 10, repartidos en el momento.", subQr: "Pagás en bolivianos y llega en dólares, repartido en el momento.",
  aOrg: "$us 9,75 a quien organiza", fee: "$us 0,25 de comisión (2,5 %)",
  volver: "Página del evento", numero: "Credencial 37 de 120", inscripta: "Inscripta", entro: "Entró",
  renueva: "El QR cambia solo: una captura no sirve.",
  almuerzo: "Almuerzo", pendiente: "pendiente", canjeado: "canjeado",
  poleraT: "Polera, talle M", paraRetirar: "pagada, para retirar", retirada: "retirada",
  premio: "Premio del sorteo", premioA: "Premio del sorteo: auriculares",
  enSorteo: "en el sorteo", ganado: "ganado", entregado: "entregado", qrAlt: "QR de la credencial",
  escaner: "Escáner", puesto: "Puesto", puerta: "Puerta", almuerzoP: "Almuerzo", poleraP: "Polera", premios: "Premios",
  apunta: "Apuntá al QR", leyendo: "Leyendo la credencial", escanear: "Escanear la credencial",
  sinConexion: "Sin conexión", sinRed: "Sin red: los canjes quedan en este celular", pend1: "1 pendiente", pendN: "{n} pendientes",
  cola: "En la cola del celular", guardado: "Guardado en el celular: se manda solo al volver la red", sincronizado: "Volvió la red: todo enviado",
  volverEsc: "Volver al escáner",
  vYaEntro: "Ya entró", aLasEntro: "Entró a las {h}", vPrimero: "Primero el check‑in en la puerta",
  vCanj: "Canjeado", vYaCanj: "Ya canjeado", seCanjeo: "Se canjeó a las {h}",
  vNoPolera: "No compró la polera", vEntregada: "Entregada", vYaEntregada: "Ya entregada", seEntrego: "Se entregó a las {h}",
  vNoSorteo: "El sorteo todavía no se hizo", vPremio: "Premio entregado: auriculares", vYaPremio: "Ya entregado",
  vSinCred: "Todavía no hay credencial", vSinCredB: "Inscribite en Quien asiste.",
  panel: "Panel del evento", vivo: "En vivo", pCred: "Credenciales", pEnt: "Entraron",
  pAlm: "Almuerzos canjeados", pPol: "Poleras entregadas", pPrem: "Premios entregados",
  ultimo: "Lo último", f_insc: "{n} se inscribió", f_pago: "{n} compró la polera", f_entro: "{n} entró por la puerta",
  f_alm: "{n} canjeó el almuerzo", f_retirada: "{n} retiró la polera", f_premio: "{n} recibió el premio",
  sortear: "Hacer el sorteo", sorteoHecho: "Sorteo hecho", informe: "Informe para quien auspicia",
  entre: "Sorteo entre las {n} personas que entraron", gano: "Ganó {n}", premioAuri: "Premio: auriculares",
  comp: "Comprobante", compSub: "Con este código cualquiera puede comprobar el resultado.",
  primeroEntrar: "Primero tiene que entrar {n}: escaneá su credencial en la puerta.",
  infQue: "Almuerzo para cada asistente", infCuanto: "{a} de {b} canjeados",
  infPriv: "Sin nombres ni correos: solo los contactos que cada persona aceptó compartir.",
  cierre: "Cierre del evento", ciSub: "El informe para el programa de embajadores de Stellar, armado solo con los números de {n}.",
  ciAsis: "Asistencia verificada", ciAsisN: "asistentes", ciMin: "Mínimo 20: cumplido", ciSin: "Sin contar organización, oradores ni voluntarios.",
  ciCanj: "Canjes", ciAlm: "Almuerzos", ciPol: "Poleras", ciPrem: "Premios",
  ciCont: "Lo que sumás vos", ciCharla: "La charla de Stellar: 20 minutos o más", ciFotos: "Fotos y enlaces del evento",
  ciPie: "Lo revisás en un formulario y lo bajás en Word para editarlo.", ciVolver: "Volver al panel",
  pasoN: "Paso {n} de {m}", completo: "Recorrido completo", reiniciar: "Reiniciar", reiniciado: "La maqueta volvió al principio.",
  auto: "Miralo solo", autoPausa: "Pausa", autoSeguir: "Seguir", autoPaso: "Siguiente paso", autoOtra: "Miralo de nuevo",
  autoCorte: "Lo seguís vos.", pasarA: "Pasar a {n}",
  vi_ini: "Lo que pasa en los otros roles aparece acá.",
  vi_insc: "El panel se enteró: {n} credenciales.", vi_pago: "La polera ya está en tu credencial, y quien organiza ya cobró.",
  vi_entro: "Tu credencial dice Entró, y el panel suma {n}.", vi_alm: "Tu credencial y el panel se enteraron: {n} almuerzos.",
  vi_retirada: "El panel se enteró: {n} poleras entregadas.", vi_premio: "El panel se enteró: {n} premios entregados.",
  vi_ya: "El segundo intento no cuenta: el panel sigue igual.", vi_cola: "Sin red, el canje espera en el celular: el panel todavía no sabe.",
  vi_sync1: "Volvió la red: el canje viajó al panel.", vi_syncN: "Volvió la red: {n} canjes viajaron al panel.", vi_sync0: "Volvió la red: el panel ya estaba al día.",
  vi_sorteo: "Tu credencial dice que ganaste los auriculares.",
  g_inscribir: "Tocá Inscribirme.", s_inscribir: "Si querés, poné tu nombre y el de tu evento. La polera es opcional.",
  g_cred: "Mirá tu credencial.", s_cred: "El QR cambia solo cada pocos segundos: una captura de pantalla no sirve para entrar.",
  g_puerta: "Pasá a Voluntario y escaneá en la puerta.", s_puerta: "El voluntario no necesita cuenta. Tu credencial y el panel se enteran al instante.",
  g_offline: "Se cortó la red: prendé Sin conexión y canjeá el almuerzo.", s_offline: "La fila sigue: el canje queda guardado en el celular del voluntario.",
  g_sync: "Volvió la red: apagá Sin conexión.", s_sync: "Mirá cómo lo guardado viaja solo al panel.",
  g_doble: "Escaneá el almuerzo otra vez.", s_doble: "El segundo intento no pasa: cada canje es una sola vez.",
  g_polera: "Retirá la polera en el puesto Polera.", s_polera: "Ya está pagada y en tu credencial.",
  g_sorteo: "Pasá a Quien organiza y hacé el sorteo.", s_sorteo: "Sortea solo entre quienes de verdad entraron.",
  g_premio: "Entregá el premio en el puesto Premios.", s_premio: "El premio ya está en tu credencial.",
  g_informe: "Abrí el informe para quien auspicia.", s_informe: "Con lo que de verdad se entregó, sin datos de nadie.",
  g_fin: "Listo. Mirá lo que viene: el cierre del evento.", s_fin: "Así se ve un evento con Rumbo, de la inscripción al informe.",
};

const en = {
  ante: "Try it", titulo: "Pretend you are at the event.",
  bajada: "Tap through a whole event: you sign up for free, check in, redeem, and the dashboard knows right away.",
  maqueta: "It is a mock-up: nothing is saved.",
  real: "And this already works: watch the real app, recorded end to end.", realVer: "Watch the video", realProbar: "Try the real thing",
  realAria: "Rumbo's app at work, from sign-up to the dashboard",
  rolesL: "Choose a role", asiste: "Attendee", voluntario: "Volunteer", organiza: "Organizer",
  evento: "Community hackathon", fecha: "Sunday, November 22", nombreL: "Your name", eventoL: "Your event", opcional: "optional",
  entrada: "General ticket", gratis: "Free", inscribirme: "Sign up", lista: "Signed up",
  correo: "Your pass is ready: keep the link", ver: "See my pass",
  polera: "Event T-shirt", precio: "$10", comprar: "Buy", oQR: "or with a bank QR code (coming soon)", pagada: "Paid",
  antes: "Sign up first: the T-shirt goes on your pass.",
  como: "How do you pay?", poleraM: "Event T-shirt, size M: $10", digital: "In digital dollars", digitalSub: "from your account",
  qr: "Bank QR code", qrSub: "in bolivianos", pronto: "Coming soon", cancelar: "Cancel", listo: "Done",
  pagDig: "Paid", pagQr: "This is how the bank QR code will work",
  subDig: "$10, split on the spot.", subQr: "You pay in bolivianos and it arrives in dollars, split on the spot.",
  aOrg: "$9.75 to the organizer", fee: "$0.25 fee (2.5%)",
  volver: "Event page", numero: "Pass 37 of 120", inscripta: "Registered", entro: "Checked in",
  renueva: "The QR code changes on its own: a screenshot will not work.",
  almuerzo: "Lunch", pendiente: "pending", canjeado: "redeemed",
  poleraT: "T-shirt, size M", paraRetirar: "paid, pick up at the desk", retirada: "picked up",
  premio: "Draw prize", premioA: "Draw prize: headphones",
  enSorteo: "in the draw", ganado: "won", entregado: "delivered", qrAlt: "Pass QR code",
  escaner: "Scanner", puesto: "Station", puerta: "Door", almuerzoP: "Lunch", poleraP: "T-shirt", premios: "Prizes",
  apunta: "Point at the QR code", leyendo: "Reading the pass", escanear: "Scan the pass",
  sinConexion: "Offline", sinRed: "No network: redemptions stay on this phone", pend1: "1 pending", pendN: "{n} pending",
  cola: "Queued on the phone", guardado: "Saved on the phone: it goes out on its own when the network is back", sincronizado: "Back online: everything sent",
  volverEsc: "Back to the scanner",
  vYaEntro: "Already checked in", aLasEntro: "Checked in at {h}", vPrimero: "Check in at the door first",
  vCanj: "Redeemed", vYaCanj: "Already redeemed", seCanjeo: "Redeemed at {h}",
  vNoPolera: "No T-shirt on this pass", vEntregada: "Handed over", vYaEntregada: "Already handed over", seEntrego: "Handed over at {h}",
  vNoSorteo: "The draw has not happened yet", vPremio: "Prize handed over: headphones", vYaPremio: "Already handed over",
  vSinCred: "No pass yet", vSinCredB: "Sign up as the attendee first.",
  panel: "Event dashboard", vivo: "Live", pCred: "Passes", pEnt: "Checked in",
  pAlm: "Lunches redeemed", pPol: "T-shirts handed over", pPrem: "Prizes delivered",
  ultimo: "Latest", f_insc: "{n} signed up", f_pago: "{n} bought the T-shirt", f_entro: "{n} checked in at the door",
  f_alm: "{n} redeemed lunch", f_retirada: "{n} picked up the T-shirt", f_premio: "{n} got the prize",
  sortear: "Run the draw", sorteoHecho: "Draw done", informe: "Sponsor report",
  entre: "Draw among the {n} people who checked in", gano: "{n} won", premioAuri: "Prize: headphones",
  comp: "Proof", compSub: "With this code anyone can check the result.",
  primeroEntrar: "{n} has to check in first: scan the pass at the door.",
  infQue: "Lunch for every attendee", infCuanto: "{a} of {b} redeemed",
  infPriv: "No names or emails: only the contacts each person agreed to share.",
  cierre: "Event wrap-up", ciSub: "The report for the Stellar ambassador program, built only from the numbers of {n}.",
  ciAsis: "Verified attendance", ciAsisN: "attendees", ciMin: "Minimum of 20: met", ciSin: "Not counting organizers, speakers or volunteers.",
  ciCanj: "Redemptions", ciAlm: "Lunches", ciPol: "T-shirts", ciPrem: "Prizes",
  ciCont: "What you add", ciCharla: "The Stellar talk: 20 minutes or more", ciFotos: "Photos and links from the event",
  ciPie: "You review it in a form and download it as a Word file to edit.", ciVolver: "Back to the dashboard",
  pasoN: "Step {n} of {m}", completo: "All done", reiniciar: "Start over", reiniciado: "The mock-up is back at the start.",
  auto: "Watch it play", autoPausa: "Pause", autoSeguir: "Resume", autoPaso: "Next step", autoOtra: "Watch it again",
  autoCorte: "Over to you.", pasarA: "Switch to {n}",
  vi_ini: "What happens in the other roles shows up here.",
  vi_insc: "The dashboard knows: {n} passes.", vi_pago: "The T-shirt is on your pass, and the organizer got paid.",
  vi_entro: "Your pass says Checked in, and the dashboard counts {n}.", vi_alm: "Your pass and the dashboard know: {n} lunches.",
  vi_retirada: "The dashboard knows: {n} T-shirts handed over.", vi_premio: "The dashboard knows: {n} prizes delivered.",
  vi_ya: "The second try does not count: the dashboard stays the same.", vi_cola: "No network, so the redemption waits on the phone: the dashboard does not know yet.",
  vi_sync1: "Back online: the redemption traveled to the dashboard.", vi_syncN: "Back online: {n} redemptions traveled to the dashboard.", vi_sync0: "Back online: the dashboard was already up to date.",
  vi_sorteo: "Your pass says you won the headphones.",
  g_inscribir: "Tap Sign up.", s_inscribir: "Add your name and your event's, if you like. The T-shirt is optional.",
  g_cred: "Look at your pass.", s_cred: "The QR code changes every few seconds: a screenshot will not get anyone in.",
  g_puerta: "Switch to Volunteer and scan at the door.", s_puerta: "The volunteer needs no account. Your pass and the dashboard know right away.",
  g_offline: "The network is down: turn on Offline and redeem lunch.", s_offline: "The line keeps moving: the redemption is saved on the volunteer's phone.",
  g_sync: "The network is back: turn Offline off.", s_sync: "Watch what was saved travel to the dashboard on its own.",
  g_doble: "Scan lunch again.", s_doble: "The second try does not go through: each redemption happens once.",
  g_polera: "Pick up the T-shirt at the T-shirt station.", s_polera: "It is paid and already on your pass.",
  g_sorteo: "Switch to Organizer and run the draw.", s_sorteo: "It draws only among the people who actually checked in.",
  g_premio: "Hand over the prize at the Prizes station.", s_premio: "The prize is already on your pass.",
  g_informe: "Open the sponsor report.", s_informe: "What was actually delivered, with nobody's personal data.",
  g_fin: "Done. See what is next: the event wrap-up.", s_fin: "That is an event with Rumbo, from sign-up to report.",
};

let lang = "es";
const t = (k, v = {}) => ((lang === "en" ? en : es)[k] ?? k).replace(/\{(\w)\}/g, (_, x) => v[x]);
const limpio = (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
const quieto = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const ancho = matchMedia("(min-width: 1001px)"); // en escritorio, las miniaturas vivas
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// La hora de cada cosa, en los dos idiomas.
const H = { insc: ["09:12", "9:12 AM"], pago: ["09:15", "9:15 AM"], entro: ["10:14", "10:14 AM"], alm: ["13:02", "1:02 PM"], retirada: ["15:20", "3:20 PM"], premio: ["18:34", "6:34 PM"] };
const hora = (k) => H[k][+(lang === "en")];
const ROLES = ["asiste", "voluntario", "organiza"];
const PUESTOS = ["puerta", "almuerzoP", "poleraP", "premios"];
const OTROS = ["Lucas T.", "Vale M.", "Diego P.", "Sofi R.", "Mateo F.", "Cami L.", "Joaquín B.", "Paula G.", "Tomi S.", "Flor A."];

// Estado inicial: lo que falta arranca vacío.
const nuevo = () => ({ rol: "asiste", vista: "evento", nombre: "Ana R.", evento: "", puesto: "puerta", hoja: "", polera: "", ver: null, sorteo: null, inscripta: false, entro: false, alm: false, retirada: false, premio: false, offline: false, informe: false, cierre: false, cola: [], feed: [], vivo: ["vi_ini"] });
let e = nuevo(), foco = null, vistaPrevia = "";
let fx = {}; // lo que se anima en la próxima pintada
// Lo último mostrado en cada superficie: se anima solo lo que cambió.
let prev = { main: {}, asiste: {}, voluntario: {}, organiza: {} }, P = prev.main;
let firma = {}; // cómo estaba cada miniatura, para latir cuando cambia
const reloj = {};

const cambio = (k, v) => {
  const c = k in P && P[k] !== v;
  return (P[k] = v), c;
};
const ic = (d, c = "pb-i") => `<svg class="${c}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const CHECK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
const PLAY = '<path d="M8 5.5v13l10-6.5z"/>', PAUSA = '<path d="M8 5v14M16 5v14"/>';
const btn = (a, k, c = "", v = "", x = "") => `<button class="pb-btn ${c}" data-a="${a}" data-f="${a}${v && "-" + v}"${v && ` data-v="${v}"`}${x}>${k}</button>`;
const pend = () => t(e.cola.length === 1 ? "pend1" : "pendN", { n: e.cola.length });
const ganado = () => !!e.sorteo;
const nombreEv = () => limpio(e.evento.trim() || t("evento"));
// Lo que el servidor ya sabe: lo que está en la cola del voluntario todavía no llegó.
const sabe = (k) => !!e[k] && !e.cola.some((c) => c.k === k);
const cuenta = () => ({ cred: 119 + e.inscripta, ent: 97 + sabe("entro"), alm: 93 + sabe("alm"), pol: 36 + sabe("retirada"), prem: 11 + sabe("premio") });
// La hora del reloj compartido, así las animaciones en bucle no saltan al volver a pintar.
const fase = (ms) => `--fase:-${Math.round(performance.now() % ms)}ms`;

// El esqueleto fijo: así el aparato anima su ancho y conserva el scroll. El aparato y las miniaturas van
// adentro de .pb-mesa, que es lo que se achica cuando la ventana es baja (demo.css): adentro todo mide lo mismo.
escenario.innerHTML = '<div class="pb-roles" role="group"></div><div class="pb-aparato"><div class="pb-mesa"><div class="pb-tel"><div class="pb-pantalla"><div class="pb-barra" aria-hidden="true"></div><div class="pb-contenido"></div><div class="pb-capa"></div></div></div><div class="pb-minis"></div></div></div><p class="pb-maqueta" data-pb="maqueta"></p><p class="pb-anuncio" role="status" aria-live="polite"></p>';
guia.innerHTML = `<p class="pb-guia-paso"></p><p class="pb-guia-texto" aria-live="polite"></p><p class="pb-guia-sub"></p><ol class="pb-progreso" aria-hidden="true"></ol><p class="pb-tira" aria-hidden="true"></p><div class="pb-guia-botones"><button class="boton boton-secundario pb-auto" type="button" data-a="auto" data-f="auto"></button><button class="boton boton-secundario pb-reset" type="button" data-a="reiniciar" data-f="reiniciar">${ic('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>')}<span></span></button></div>`;
const $ = (s) => escenario.querySelector(s);
const roles = $(".pb-roles"), aparato = $(".pb-aparato"), tel = $(".pb-tel"), barra = $(".pb-barra"), minis = $(".pb-minis");
const cont = $(".pb-contenido"), capa = $(".pb-capa"), anuncio = $(".pb-anuncio");
const [gPaso, gTexto, gSub, gProg, gTira, gBotones] = guia.children;
const [gAuto, gReset] = gBotones.children;
const dedo = document.createElement("span");
dedo.className = "pb-dedo";
dedo.setAttribute("aria-hidden", "true");
raiz.append(dedo);
// Avisos para lectores de pantalla, sin punto doble.
const decir = (...p) => ((anuncio.textContent = ""), setTimeout(() => (anuncio.textContent = p.filter(Boolean).map((s) => s.replace(/\.$/, "")).join(". ") + "."), 60));
// La tira En vivo: lo que les pasó a los otros roles. Devuelve el texto, para decirlo también en voz alta.
const vivo = (k, n) => ((e.vivo = [k, n]), (fx.vivo = 1), t(k, { n }));

/* Las pantallas */

const vBarra = (r) => `<span>9:41</span><span class="pb-isla"></span><span class="pb-iconos">${ic('<path d="M2.5 9a14 14 0 0 1 19 0M5.8 12.4a9.5 9.5 0 0 1 12.4 0M9.1 15.8a5 5 0 0 1 5.8 0M12 19.2h.01"/>' + (r === "voluntario" && e.offline ? '<path class="pb-tacha" d="M4 3.5l16 17"/>' : ""))}<svg class="pb-bat" viewBox="0 0 28 14" aria-hidden="true"><rect x="1" y="1" width="22" height="12" rx="3.5"/><rect x="3.5" y="3.5" width="15" height="7" rx="1.5"/><path d="M25.5 5v4"/></svg></span>`;

const vEvento = () => {
  const ok = (k) => `<p class="pb-ok">${ic(CHECK)}${t(k)}</p>`;
  const campo = (f, l, v, x = "") => `<label class="pb-campo">${l}<input data-f="${f}" value="${limpio(v)}" maxlength="${f === "nombre" ? 24 : 40}" autocomplete="off"${x}></label>`;
  return `<div class="pb-banner"><svg viewBox="0 0 320 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><circle cx="262" cy="24" r="12" fill="#f5c451"/><path d="M0 62l70-28 52 22 64-34 80 30 54-14v42H0z" fill="#2fbfa6"/><path d="M0 80V60c50-12 90 4 140 10s110-4 180 2v8z" fill="#e8541e"/></svg></div>
<h3 class="pb-h">${nombreEv()}</h3><p class="pb-sub">${t("fecha")}</p>
${e.inscripta ? "" : `<div class="pb-campos">${campo("nombre", t("nombreL"), e.nombre)}${campo("evento", t("eventoL"), e.evento, ` placeholder="${t("opcional")}"`)}</div>`}
<div class="pb-item"><p class="pb-sub">${t("entrada")}</p><p class="pb-precio">${t("gratis")}</p>
${e.inscripta ? ok("lista") + `<p class="pb-correo${fx.correo ? " pb-entra" : ""}">${ic('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>')}${t("correo")}</p>` + btn("ver", t("ver"), "pb-pri" + (fx.correo ? " pb-mostrar" : "")) : btn("inscribir", t("inscribirme"), "pb-pri")}</div>
<div class="pb-item"><p class="pb-sub">${t("polera")}</p><p class="pb-precio">${t("precio")}</p>
${e.polera ? ok("pagada") : btn("comprar", t("comprar")) + `<p class="pb-chico">${t("oQR")}</p>`}
${e.avisoCompra && !e.polera ? `<p class="pb-nota pb-mostrar">${t("antes")}</p>` : ""}</div>`;
};

const vCred = () => {
  const s = ganado(), alm = sabe("alm"), ret = sabe("retirada"), prem = sabe("premio"), ent = sabe("entro");
  const filas = [["almuerzo", alm ? "listo:canjeado" : "pendiente:pendiente", "c1"]];
  if (e.polera) filas.push(["poleraT", ret ? "listo:retirada" : "pendiente:paraRetirar", "c2"]);
  filas.push([s ? "premioA" : "premio", prem ? "listo:entregado" : s ? "premio:ganado" : "sorteo:enSorteo", "c3"]);
  return `<button class="pb-atras" data-a="evento" data-f="evento">${ic('<path d="M15 18l-6-6 6-6"/>') + t("volver")}</button>
<h3 class="pb-h">${nombreEv()}</h3><p class="pb-sub">${t("entrada")}</p>
<div class="pb-qr"><img src="assets/qr.svg" alt="${t("qrAlt")}" width="118" height="118" style="${fase(12000)}"></div>
<p class="pb-renueva"><span class="pb-anillo" style="${fase(6000)}"><i></i><i></i></span>${t("renueva")}</p>
<div class="pb-persona"><p class="pb-nombre">${limpio(e.nombre)}</p><p class="pb-sub">${t("numero")}</p></div>
<p class="pb-estado${ent ? " si" : ""}${cambio("est", ent) ? " pb-pop" : ""}">${t(ent ? "entro" : "inscripta")}</p>
<ul class="pb-fil">${filas.map(([k, v, id]) => {
    const [c, tx] = v.split(":");
    return `<li>${t(k)} <span class="chip chip-${c} pb-chip${cambio(id, v) ? " pb-pop" : ""}">${c === "listo" ? ic(CHECK, "check") : ""}${t(tx)}</span></li>`;
  }).join("")}</ul>`;
};

const CONT = { puerta: ["pEnt", "entro", 97], almuerzoP: ["pAlm", "alm", 93], poleraP: ["pPol", "retirada", 36], premios: ["pPrem", "premio", 11] };
const vEscaner = () => {
  const [ck, k, base] = CONT[e.puesto], n = base + e[k];
  // Detrás del veredicto no se marca: el número late al volver.
  const late = !e.ver && cambio("n" + e.puesto, n);
  return `<div class="pb-fila"><h3 class="pb-h">${t("escaner")}</h3><span class="pb-tag">${t("voluntario")}</span></div>
${e.offline || e.cola.length ? `<div class="pb-sinred${e.saliendo ? " pb-sale" : ""}">${e.offline ? `<p><i></i>${t("sinRed")}</p>` : ""}${e.cola.length ? `<ul class="pb-cola" aria-label="${t("cola")}">${e.cola.map((c) => `<li><b>${t(c.p)}</b> ${limpio(e.nombre)}</li>`).join("")}</ul>` : ""}</div>` : ""}
<div class="pb-puestos" role="group" aria-label="${t("puesto")}">${PUESTOS.map((p) => btn("puesto", t(p), "pb-seg", p, ` aria-pressed="${e.puesto === p}"`).replace("pb-btn ", "")).join("")}</div>
<div class="pb-visor${e.leyendo ? " pb-lee" : ""}"><svg viewBox="-14 -14 128 128" aria-hidden="true"><path d="M3 22V9a6 6 0 0 1 6-6h13M78 3h13a6 6 0 0 1 6 6v13M97 78v13a6 6 0 0 1-6 6H78M22 97H9a6 6 0 0 1-6-6V78"/></svg><img src="assets/qr.svg" alt=""><i></i></div>
<p class="pb-apunta">${t(e.leyendo ? "leyendo" : "apunta")}</p>
<p class="pb-cont">${t(ck)} <b${late ? ' class="pb-pop"' : ""}>${n}</b></p>
${btn("escanear", t("escanear"), "pb-pri", "", e.leyendo ? ' aria-disabled="true"' : "")}
<div class="pb-off">${btn("offline", `<span class="pb-perilla"></span>${t("sinConexion")}`, "pb-switch", "", ` role="switch" aria-checked="${e.offline}"`).replace("pb-btn ", "")}${e.cola.length ? `<span class="pb-pend">${pend()}</span>` : ""}</div>`;
};

const vPanel = () => {
  const s = e.sorteo, c = cuenta();
  const cifras = [["pCred", c.cred, "#3d4b5f"], ["pEnt", c.ent, "#e8541e"], ["pAlm", c.alm, "#0b7a68"], ["pPrem", c.prem, "#c99a1e"]];
  return `<div class="pb-izq"><div class="pb-fila pb-cab"><div><h3 class="pb-h">${t("panel")}</h3><p class="pb-sub">${nombreEv()}</p></div><span class="pb-vivo">${t("vivo")}</span></div>
<ul class="pb-cifras">${cifras.map(([k, v, col]) => {
    const d = P[k], late = cambio(k, v);
    return `<li>${t(k)} <b data-n="${v}"${late ? ' class="pb-pop"' : ""}>${v}${late ? `<span class="pb-mas">+${v - d}</span>` : ""}</b><i${late ? ' class="pb-crece"' : ""} style="--p:${(v / 120).toFixed(3)};--c:${col}${late ? `;--d:${(d / 120).toFixed(3)}` : ""}"></i></li>`;
  }).join("")}</ul>
${e.feed.length ? `<div class="pb-feed"><p class="pb-sub">${t("ultimo")}</p><ul>${e.feed.slice(0, 3).map((f, i) => `<li${!i && cambio("feed", e.feed.length) ? ' class="pb-entra"' : ""}><span>${hora(f)}</span>${t("f_" + f, { n: limpio(e.nombre) })}</li>`).join("")}</ul></div>` : ""}</div>
<div class="pb-der">${btn("sortear", ganado() ? ic(CHECK) + t("sorteoHecho") : t("sortear"), "pb-pri" + (ganado() ? " pb-hecho" : ""), "", s ? ' aria-disabled="true"' : "")}
${btn("informe", t("informe"), "", "", ` aria-expanded="${e.informe}"`)}
${btn("cierre", `${t("cierre")}<span class="pb-pronto">${t("pronto")}</span>`, "pb-btn-cierre")}
${e.avisoPanel && !s ? `<p class="pb-nota pb-mostrar">${t("primeroEntrar", { n: limpio(e.nombre) })}</p>` : ""}
${s ? `<div class="pb-carta${fx.sorteo ? " pb-entra pb-mostrar" : ""}"><p class="pb-sub">${t("entre", { n: c.ent })}</p><p class="pb-ruleta${fx.sorteo && !quieto() ? "" : " pb-pop"}">${t("gano", { n: limpio(e.nombre) })}</p><p>${t("premioAuri")}</p><p class="pb-comp">${t("comp")} <b>${s.codigo}</b></p><p class="pb-chico">${t("compSub")}</p></div>` : ""}
${e.informe ? `<div class="pb-carta${fx.informe ? " pb-entra pb-mostrar" : ""}"><p class="pb-sub">${t("informe")}: ${nombreEv()}</p><p>${t("infQue")}</p><p class="pb-cuanto">${t("infCuanto", { a: `<b>${c.alm}</b>`, b: c.ent })}</p><i class="pb-barrita" style="--p:${(c.alm / c.ent).toFixed(3)}"></i><p class="pb-chico">${t("infPriv")}</p></div>` : ""}</div>`;
};

// La promesa: el informe para el programa de embajadores, armándose solo con los números del evento.
const vCierre = () => {
  const c = cuenta(), ok = ic(CHECK, "pb-i pb-tilde");
  const fila = (k, n) => `<li><span>${t(k)}</span><b data-n="${n}">${n}</b></li>`;
  return `<div class="pb-cierre" role="dialog" aria-label="${t("cierre")}"><div class="pb-fila"><p class="pb-h">${t("cierre")}</p><span class="pb-pronto">${t("pronto")}</span></div>
<p class="pb-sub">${t("ciSub", { n: nombreEv() })}</p>
<div class="pb-hojas">
<div class="pb-pag"><p class="pb-pag-t">${t("ciAsis")}</p><p class="pb-pag-n"><b data-n="${c.ent}">${c.ent}</b> ${t("ciAsisN")}</p><p class="pb-cumple">${ok}${t("ciMin")}</p><p class="pb-chico">${t("ciSin")}</p></div>
<div class="pb-pag"><p class="pb-pag-t">${t("ciCanj")}</p><ul>${fila("ciAlm", c.alm)}${fila("ciPol", c.pol)}${fila("ciPrem", c.prem)}</ul></div>
<div class="pb-pag"><p class="pb-pag-t">${t("ciCont")}</p><ul class="pb-casillas"><li><i></i>${t("ciCharla")}</li><li><i></i>${t("ciFotos")}</li></ul></div>
</div>
<p class="pb-cierre-pie">${ic('<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-10z"/><path d="M14 3.5v5h5M9 13.5h6M9 17h4"/>')}${t("ciPie")}</p>
${btn("cerrarCierre", t("ciVolver"))}</div>`;
};

const vHoja = () => {
  const pago = e.hoja !== "elegir", qr = e.hoja === "qr", titulo = t(pago ? (qr ? "pagQr" : "pagDig") : "como");
  return `<div class="pb-fondo" data-a="cerrar"></div><div class="pb-hoja${fx.hoja ? " pb-sube" : ""}${fx.reparto ? " pb-reparte" : ""}" role="dialog" aria-label="${titulo}">${pago
    ? `<p class="pb-h pb-pagado">${ic(CHECK)}${titulo}</p>${qr ? `<span class="pb-pronto">${t("pronto")}</span>` : ""}<p class="pb-sub">${t(qr ? "subQr" : "subDig")}</p><p class="pb-reparto"><i></i><i></i></p><p class="pb-linea">${t("aOrg")}</p><p class="pb-linea">${t("fee")}</p>${btn("cerrar", t("listo"), "pb-pri")}`
    : `<p class="pb-h">${titulo}</p><p class="pb-sub">${t("poleraM")}</p>${btn("pagar", `${t("digital")}<small>${t("digitalSub")}</small>`, "pb-opcion", "dig")}${btn("pagar", `<span>${t("qr")}<small>${t("qrSub")}</small></span><span class="pb-pronto">${t("pronto")}</span>`, "pb-opcion", "qr")}${btn("cerrar", t("cancelar"), "pb-quieto")}`}</div>`;
};

const detalle = (v, f) => (v.b === "@" ? f(e.nombre) : t(v.b, { h: v.h && hora(v.h) }));
const vVer = () => {
  const v = e.ver;
  const icono = v.k === "ok" ? CHECK : v.k === "ya" ? '<path d="M7 7l10 10M17 7 7 17"/>' : '<path d="M12 7.5v.5M12 11v6"/>';
  return `<div class="pb-ver pb-ver-${v.k}${fx.ver ? " pb-entra" : ""}">${v.k === "ok" && fx.ver ? '<i class="pb-destello"></i>' : ""}<span class="pb-ver-ic">${ic(icono)}</span><p class="pb-ver-t">${t(v.t)}</p>${v.a ? `<p>${t(v.a)}</p>` : ""}${v.b ? `<p>${detalle(v, limpio)}</p>` : ""}${v.off ? `<p class="pb-ver-off">${t("guardado")} <span class="pb-pend">${pend()}</span></p>` : ""}${btn("volver", t("volverEsc"))}</div>`;
};

/* Al escanear: cambia el estado y da el veredicto */

const juzgar = () => {
  const r = (k, tt, a = "", b = "", h, cambia) => ({ k, t: tt, a, b, h, cambia }), p = e.puesto;
  const hacer = (k) => ((e[k] = true), k);
  if (!e.inscripta) return r("no", "vSinCred", "", "vSinCredB");
  if (p === "puerta") return e.entro ? r("ya", "vYaEntro", "entrada", "aLasEntro", "entro") : r("ok", "entro", "entrada", "@", 0, hacer("entro"));
  if (p === "almuerzoP") return !e.entro ? r("no", "vPrimero", "almuerzo") : e.alm ? ((e.doble = true), r("ya", "vYaCanj", "almuerzo", "seCanjeo", "alm")) : r("ok", "vCanj", "almuerzo", "@", 0, hacer("alm"));
  if (p === "poleraP") return !e.polera ? r("no", "vNoPolera", "poleraT") : e.retirada ? r("ya", "vYaEntregada", "poleraT", "seEntrego", "retirada") : r("ok", "vEntregada", "poleraT", "@", 0, hacer("retirada"));
  if (!ganado()) return r("no", "vNoSorteo", "premio");
  return e.premio ? r("ya", "vYaPremio", "premioA", "seEntrego", "premio") : r("ok", "vPremio", "", "@", 0, hacer("premio"));
};
const codigo = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? "-" : "") + "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
const CUENTA = { entro: "ent", alm: "alm", retirada: "pol", premio: "prem" };

/* Cada botón; después se vuelve a pintar */

const A = {
  rol(r) { if (r !== e.rol) Object.assign(e, { rol: r, ver: null, hoja: "", cierre: false }), (foco = "tab-" + r), (fx.rol = 1); },
  inscribir() {
    Object.assign(e, { nombre: e.nombre.trim() || "Ana R.", evento: e.evento.trim(), inscripta: true, avisoCompra: false });
    e.feed.unshift("insc"); fx.correo = 1; foco = "ver";
    decir(t("lista"), t("correo"), vivo("vi_insc", cuenta().cred));
  },
  ver() { Object.assign(e, { vista: "cred", vioCred: true }); foco = "evento"; },
  evento() { e.vista = "evento"; foco = "ver"; },
  comprar() {
    if (!e.inscripta) return (e.avisoCompra = true), decir(t("antes"));
    e.hoja = "elegir"; fx.hoja = 1; foco = "pagar-dig";
  },
  pagar(v) { e.hoja = e.polera = v; e.feed.unshift("pago"); fx.reparto = 1; foco = "cerrar"; decir(t(v === "qr" ? "pagQr" : "pagDig"), t("aOrg"), t("fee"), vivo("vi_pago")); },
  cerrar() { e.hoja = ""; foco = e.polera ? "ver" : "comprar"; },
  puesto(p) { Object.assign(e, { puesto: p, ver: null }); foco = "puesto-" + p; },
  escanear() {
    e.leyendo = true;
    reloj.esc = setTimeout(() => {
      const v = juzgar();
      let dicho = "";
      if ((v.off = e.offline)) e.cola.push({ k: v.cambia || "", p: e.puesto }), (e.offScan = true), (dicho = vivo("vi_cola"));
      else if (v.cambia) e.feed.unshift(v.cambia), (dicho = vivo("vi_" + v.cambia, cuenta()[CUENTA[v.cambia]]));
      else if (v.k === "ya") dicho = vivo("vi_ya");
      Object.assign(e, { leyendo: false, ver: v }); fx.ver = 1; foco = "volver";
      decir(t(v.t), v.a && t(v.a), v.b && detalle(v, String), v.off && t("guardado") + ", " + pend(), dicho);
      pintar();
    }, quieto() ? 400 : 1100);
  },
  volver() { e.ver = null; foco = "escanear"; },
  offline() {
    e.offline = !e.offline; foco = "offline";
    if (e.offline) return;
    e.sync = e.offScan;
    // Lo guardado viaja al panel: primero se va de la cola, después el panel suma.
    const llegan = e.cola.filter((c) => c.k), n = llegan.length;
    const fin = () => {
      llegan.forEach((c) => e.feed.unshift(c.k));
      Object.assign(e, { cola: [], saliendo: false, toast: true }); fx.toast = 1;
      decir(t("sincronizado"), vivo(n ? (n === 1 ? "vi_sync1" : "vi_syncN") : "vi_sync0", n));
      clearTimeout(reloj.toast);
      reloj.toast = setTimeout(() => { e.toast = false; capa.querySelector(".pb-toast")?.remove(); }, 2600);
    };
    if (!e.cola.length || quieto()) return fin();
    e.saliendo = true; fx.viaje = 1;
    reloj.sync = setTimeout(() => (fin(), pintar()), 750);
  },
  sortear() {
    if (!e.entro) return (e.avisoPanel = true), decir(t("primeroEntrar", { n: e.nombre }));
    e.sorteo = { codigo: codigo() }; fx.sorteo = 1;
    decir(t("gano", { n: e.nombre }), t("premioAuri"), vivo("vi_sorteo"));
  },
  informe() { e.informe = !e.informe; if (e.informe) e.vioInf = fx.informe = true; foco = "informe"; },
  cierre() { e.cierre = e.vioCierre = true; fx.cierre = 1; foco = "cerrarCierre"; decir(t("cierre"), t("pronto"), t("ciPie")); },
  cerrarCierre() { e.cierre = false; foco = "cierre"; },
  reiniciar() {
    parar(); e.girando = false; ["esc", "toast", "sync"].forEach((k) => clearTimeout(reloj[k]));
    e = nuevo(); prev = { main: {}, asiste: {}, voluntario: {}, organiza: {} }; firma = {}; foco = "reiniciar"; decir(t("reiniciado"));
  },
  auto() {
    if (quieto()) return void (!pasoActual() && e.vioCierre ? (A.reiniciar(), pintar(), gAuto.focus({ preventScroll: true })) : unPaso());
    if (auto) return void (auto.pausa = !auto.pausa);
    if (!pasoActual() || e.vioCierre) A.reiniciar(), pintar();
    correr();
  },
};

/* La guía: el primer paso que falta y qué tocar */

const pasos = () => {
  const l = [["inscribir", e.inscripta], ["cred", e.vioCred], ["puerta", e.entro], ["offline", e.offScan], ["sync", e.sync], ["doble", e.doble]];
  if (e.polera) l.push(["polera", e.retirada]);
  return l.concat([["sorteo", ganado()], ["premio", e.premio], ["informe", e.vioInf]]);
};
const pasoActual = () => pasos().find((p) => !p[1])?.[0] || "";
// Cada paso: rol, puesto si hace falta y botón.
const OBJ = {
  inscribir: ["asiste", "", "inscribir"], cred: ["asiste", "", "ver"], puerta: ["voluntario", "puerta"],
  offline: ["voluntario", "almuerzoP"], sync: ["voluntario", "", "offline"], doble: ["voluntario", "almuerzoP"], polera: ["voluntario", "poleraP"],
  sorteo: ["organiza", "", "sortear"], premio: ["voluntario", "premios"], informe: ["organiza", "", "informe"], fin: ["organiza", "", "cierre"],
};
const objetivo = (k) => {
  const [r, p, a] = OBJ[k];
  if (e.rol !== r) return "tab-" + r;
  if (e.hoja) return "";
  if (r === "asiste") return e.vista === "evento" ? a : "evento";
  if (r === "organiza") return e.cierre ? "" : a;
  if (e.ver) return "volver";
  if (k === "offline" && !e.offline) return "offline";
  if (k !== "offline" && k !== "sync" && e.offline) return "offline";
  return p && e.puesto !== p ? "puesto-" + p : a || "escanear";
};
const pintarGuia = () => {
  const l = pasos(), i = l.findIndex((p) => !p[1]), k = i < 0 ? "fin" : l[i][0];
  gPaso.textContent = i < 0 ? t("completo") : t("pasoN", { n: i + 1, m: l.length });
  if (gTexto.textContent !== t("g_" + k)) gTexto.textContent = t("g_" + k);
  gSub.textContent = t("s_" + k);
  gProg.innerHTML = l.map((p) => `<li${p[1] ? ' class="si"' : ""}></li>`).join("");
  const tira = t(e.vivo[0], { n: e.vivo[1] });
  if (gTira.lastChild?.textContent !== tira) gTira.innerHTML = `<b>${t("vivo")}</b><span${fx.vivo && !quieto() ? ' class="pb-entra"' : ""}>${tira}</span>`;
  const r = quieto(), etiqueta = r ? (i < 0 && e.vioCierre ? "autoOtra" : "autoPaso") : !auto ? (i < 0 ? "autoOtra" : "auto") : auto.pausa ? "autoSeguir" : "autoPausa";
  gAuto.innerHTML = ic(auto && !auto.pausa ? PAUSA : PLAY) + `<span>${t(etiqueta)}</span>`;
  gAuto.setAttribute("aria-label", t(etiqueta));
  gAuto.classList.toggle("pb-andando", !!auto);
  gReset.lastChild.textContent = t("reiniciar");
  gReset.setAttribute("aria-label", t("reiniciar"));
  const o = objetivo(k);
  if (o) raiz.querySelectorAll(`[data-f="${o}"]${o.startsWith("tab-") ? `, [data-f="mini-${o.slice(4)}"]` : ""}`).forEach((el) => el.classList.add("pb-sug"));
};

/* Las miniaturas vivas: los otros dos roles en chico, tocables, que laten cuando algo les cambia */

const firmaDe = (r) => {
  const c = cuenta();
  return r === "asiste" ? [e.inscripta, e.vioCred, sabe("entro"), sabe("alm"), sabe("retirada"), sabe("premio"), ganado(), e.polera].join()
    : r === "voluntario" ? [e.offline, e.cola.length, e.puesto].join()
    : [c.cred, c.ent, c.alm, c.pol, c.prem, ganado(), e.feed.length].join();
};
const pintarMinis = () => {
  if (!ancho.matches) return void (minis.innerHTML && (minis.innerHTML = ""));
  delete firma[e.rol];
  const laten = [];
  minis.innerHTML = `<p class="pb-minis-t"><span class="pb-vivo">${t("vivo")}</span></p>` + ROLES.filter((r) => r !== e.rol).map((r) => {
    P = prev[r];
    const html = (r === "asiste" ? (e.inscripta && e.vioCred ? vCred() : vEvento()) : r === "voluntario" ? vEscaner() : vPanel()).replace(/ data-[afv]="[^"]*"/g, "");
    const f = firmaDe(r), late = r in firma && firma[r] !== f && !fx.rol;
    firma[r] = f;
    if (late) laten.push(r);
    const t2 = r === "organiza" ? " pb-ancho" : "";
    return `<div class="pb-mini${t2 ? " pb-mini-tableta" : ""}${late ? " pb-late" : ""}" data-r="${r}"><button class="pb-mini-btn" type="button" data-a="rol" data-v="${r}" data-f="mini-${r}" aria-label="${t("pasarA", { n: t(r) })}">${t(r)}</button><div class="pb-mini-caja"><div class="pb-tel pb-mini-tel${t2}" inert aria-hidden="true"><div class="pb-pantalla"><div class="pb-barra">${vBarra(r)}</div><div class="pb-contenido${t2 ? " pb-panel" : ""}">${html}</div></div></div></div></div>`;
  }).join("");
  P = prev.main;
  if (laten.length && !quieto()) requestAnimationFrame(() => laten.forEach((r) => viajar(tel, minis.querySelector(`[data-r="${r}"] .pb-mini-caja`))));
};

// Una señal que sale de un lado y llega al otro: solo transform y opacity.
const viajar = (de, a, texto = "", demora = 0) => {
  if (!de || !a) return;
  const base = aparato.getBoundingClientRect(), r1 = de.getBoundingClientRect(), r2 = a.getBoundingClientRect();
  const s = document.createElement("span");
  s.className = texto ? "pb-viaja" : "pb-senal";
  s.textContent = texto;
  aparato.append(s);
  const x = (r) => r.left + r.width / 2 - base.left - s.offsetWidth / 2, y = (r) => r.top + r.height / 2 - base.top - s.offsetHeight / 2;
  const an = s.animate([
    { transform: `translate(${x(r1)}px, ${y(r1)}px) scale(.6)`, opacity: 0 },
    { transform: `translate(${x(r1)}px, ${y(r1)}px) scale(1)`, opacity: 1, offset: 0.15 },
    { transform: `translate(${x(r2)}px, ${y(r2)}px) scale(.8)`, opacity: 1, offset: 0.85 },
    { transform: `translate(${x(r2)}px, ${y(r2)}px) scale(.4)`, opacity: 0 },
  ], { duration: texto ? 800 : 650, delay: demora, easing: "cubic-bezier(.5, 0, .3, 1)", fill: "both" });
  an.onfinish = () => s.remove();
};

/* Lo que se anima después de pintar */

const correrNumero = (el, desde, hasta, ms = 700) => {
  const t0 = performance.now();
  const paso = (ahora) => {
    const p = Math.min(1, (ahora - t0) / ms);
    if (!el.isConnected) return;
    el.firstChild.textContent = Math.round(desde + (hasta - desde) * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
};
const ruleta = () => {
  const el = cont.querySelector(".pb-ruleta");
  if (!el) return;
  const final = el.textContent, nombres = OTROS.slice().sort(() => Math.random() - 0.5);
  let i = 0, ms = 55;
  e.girando = true;
  const vuelta = () => {
    if (!el.isConnected) return void (e.girando = false);
    if (i >= 11) {
      e.girando = false;
      el.textContent = final;
      el.classList.add("pb-pop");
      return festejo();
    }
    el.textContent = nombres[i++ % nombres.length];
    el.animate([{ transform: "translateY(-35%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: Math.min(ms, 160) });
    setTimeout(vuelta, (ms *= 1.22));
  };
  vuelta();
};
const festejo = () => {
  const f = document.createElement("div");
  f.className = "pb-festejo";
  const colores = ["#e8541e", "#2fbfa6", "#f5c451", "#0f1c2e", "#ff7a45"];
  f.innerHTML = Array.from({ length: 26 }, (_, i) => `<i style="--x:${Math.round(Math.random() * 100)}%;--dx:${Math.round(Math.random() * 120 - 60)}px;--r:${Math.round(Math.random() * 540 - 270)}deg;--t:${(0.9 + Math.random() * 0.8).toFixed(2)}s;--w:${(Math.random() * 0.25).toFixed(2)}s;background:${colores[i % 5]}"></i>`).join("");
  capa.append(f);
  setTimeout(() => f.remove(), 2000);
};
const despues = (f) => {
  if (quieto()) return;
  if (f.corre) cont.querySelectorAll(".pb-cifras b[data-n]").forEach((b) => correrNumero(b, 0, +b.dataset.n));
  if (f.cierre) capa.querySelectorAll(".pb-cierre b[data-n]").forEach((b, i) => setTimeout(() => correrNumero(b, 0, +b.dataset.n, 900), 350 + i * 250));
  if (f.sorteo) ruleta();
  if (f.viaje) {
    const destino = minis.querySelector('[data-r="organiza"] .pb-mini-caja') || gTira;
    cont.querySelectorAll(".pb-cola li").forEach((li, i) => viajar(li, destino, li.textContent, i * 120));
  }
};

/* Pintar: todo sale del estado; el foco y el scroll se conservan */

function pintar() {
  const act = document.activeElement;
  const antes = act && raiz.contains(act) ? act.getAttribute("data-f") : null;
  const clave = e.rol + e.vista, sc = clave === vistaPrevia ? cont.scrollTop : 0;
  const asiste = e.rol === "asiste", vol = e.rol === "voluntario", org = e.rol === "organiza";
  if (org && clave !== vistaPrevia) fx.corre = 1;
  const f0 = fx;
  roles.innerHTML = ROLES.map((r) => `<button class="pb-rol" aria-pressed="${e.rol === r}" data-a="rol" data-v="${r}" data-f="tab-${r}">${t(r)}</button>`).join("");
  tel.classList.toggle("pb-ancho", org);
  barra.innerHTML = vBarra(e.rol);
  cont.className = "pb-contenido" + (org ? " pb-panel" : "") + (fx.corre && !quieto() ? " pb-corre" : "");
  P = prev.main;
  cont.innerHTML = asiste ? (e.vista === "cred" ? vCred() : vEvento()) : vol ? vEscaner() : vPanel();
  capa.innerHTML = asiste && e.hoja ? vHoja() : vol ? (e.ver ? vVer() : "") + (e.toast ? `<p class="pb-toast${fx.toast ? " pb-entra" : ""}">${ic(CHECK)}${t("sincronizado")}</p>` : "") : org && e.cierre ? vCierre() : "";
  cont.inert = (asiste && !!e.hoja) || (vol && !!e.ver) || (org && e.cierre);
  cont.scrollTop = sc;
  vistaPrevia = clave;
  const m = cont.querySelector(".pb-mostrar");
  if (m) {
    const fin = m.offsetTop + m.offsetHeight + 16;
    if (fin > cont.scrollTop + cont.clientHeight) cont.scrollTo({ top: fin - cont.clientHeight, behavior: quieto() ? "auto" : "smooth" });
    // En el celular el teléfono no tiene scroll propio: lo que apareció abajo (el sorteo, el informe) se trae a la vista.
    const r = m.getBoundingClientRect();
    if (!ancho.matches && !auto && r.bottom > innerHeight - 12) scrollBy({ top: Math.min(r.bottom - innerHeight + 24, r.top - guia.getBoundingClientRect().bottom - 12), behavior: quieto() ? "auto" : "smooth" });
  }
  // El cierre en el celular reemplaza la pantalla: se muestra desde arriba, bajo la guía.
  const ci = f0.cierre && !ancho.matches && capa.querySelector(".pb-cierre");
  if (ci) scrollBy({ top: ci.getBoundingClientRect().top - guia.getBoundingClientRect().bottom - 12, behavior: quieto() ? "auto" : "smooth" });
  pintarMinis();
  pintarGuia();
  // Lo que la guía pide tocar adentro del teléfono queda a la vista (en escritorio la pantalla tiene scroll propio).
  const sug = !m && cont.querySelector(".pb-sug");
  if (sug && cont.scrollHeight > cont.clientHeight) {
    const r = sug.getBoundingClientRect(), c = cont.getBoundingClientRect();
    if (r.bottom > c.bottom - 8 || r.top < c.top) cont.scrollTo({ top: cont.scrollTop + r.bottom - c.bottom + 16, behavior: quieto() ? "auto" : "smooth" });
  }
  const destino = foco || antes, el = destino && raiz.querySelector(`[data-f="${destino}"]`);
  foco = null;
  const f = fx;
  fx = {};
  if (el && el !== document.activeElement && !auto) el.focus({ preventScroll: true });
  despues(f);
}

/* Miralo solo: un dedo recorre los pasos y toca lo que hay que tocar. Se corta apenas la persona toca algo. */

let auto = null;
const visible = async (el) => {
  // Adentro de la pantalla: que el botón quede a la vista.
  const sc = el.closest(".pb-contenido");
  if (sc) {
    const r = el.getBoundingClientRect(), c = sc.getBoundingClientRect();
    if (r.bottom > c.bottom - 8 || r.top < c.top) sc.scrollTo({ top: sc.scrollTop + r.top - c.top - c.height / 3, behavior: "smooth" }), await espera(350);
  }
  // En la página: debajo de la guía pegada arriba y sobre el borde de abajo. Lo que está en la guía ya se ve.
  if (guia.contains(el) && !ancho.matches) return;
  const r = el.getBoundingClientRect(), techo = (ancho.matches ? cabecera?.offsetHeight || 0 : Math.max(guia.getBoundingClientRect().bottom, 0)) + 12;
  // Si entra, al medio de lo que queda libre; si es más alto (el cierre en el celular), su borde de arriba bajo la guía.
  const libre = innerHeight - 12 - techo, y = r.height > libre ? r.top - techo : r.top - techo - (libre - r.height) / 2;
  if (r.top < techo || r.bottom > innerHeight - 12) scrollBy({ top: y, behavior: "smooth" }), await espera(450);
};
const tocar = async (el) => {
  const b = raiz.getBoundingClientRect(), r = el.getBoundingClientRect(), primera = !dedo.classList.contains("pb-ve");
  // La primera vez aparece donde va a tocar; después, viaja.
  if (primera) dedo.style.transition = "none";
  dedo.style.transform = `translate(${r.left + r.width / 2 - b.left}px, ${r.top + r.height / 2 - b.top}px)`;
  if (primera) void dedo.offsetWidth, (dedo.style.transition = "");
  dedo.classList.add("pb-ve");
  await espera(560);
  if (!auto) return;
  dedo.classList.remove("pb-toca");
  void dedo.offsetWidth;
  dedo.classList.add("pb-toca");
  await espera(180);
  if (auto && el.isConnected) el.click();
};
const blanco = () => {
  const k = pasoActual() || "fin", o = objetivo(k);
  if (o) return raiz.querySelector(`[data-f="${o}"]`);
  // Una hoja o el cierre abiertos fuera del recorrido: primero se cierran.
  return e.hoja || e.cierre ? raiz.querySelector(`[data-f="${e.hoja ? "cerrar" : "cerrarCierre"}"]`) : null;
};
async function correr() {
  const yo = (auto = { pausa: false });
  pintarGuia();
  while (auto === yo) {
    if (yo.pausa || e.leyendo || e.saliendo || e.girando) { await espera(150); continue; }
    if (!pasoActual() && e.cierre) { await espera(1200); break; }
    const el = blanco();
    if (!el) { await espera(150); continue; }
    await visible(el);
    if (auto !== yo || yo.pausa) continue;
    await tocar(el);
    // Lo que apareció abajo (el sorteo, el informe, un aviso) se muestra antes de seguir.
    const m = cont.querySelector(".pb-mostrar") || capa.querySelector(".pb-cierre");
    if (m && auto === yo) await espera(300), await visible(m);
    await espera(e.ver || e.cierre || m ? 1500 : 900);
  }
  if (auto === yo) parar();
}
function parar(corte) {
  if (!auto) return;
  auto = null;
  dedo.classList.remove("pb-ve", "pb-toca");
  pintarGuia();
  if (corte) decir(t("autoCorte"));
}
// Con movimiento reducido no hay dedo: cada toque del botón hace un paso entero, al instante.
async function unPaso() {
  const k = pasoActual() || "fin";
  for (let i = 0; i < 8 && (pasoActual() || "fin") === k && !(k === "fin" && e.cierre); i++) {
    const el = blanco();
    if (!el) break;
    el.click();
    while (e.leyendo || e.saliendo) await espera(100);
  }
  gAuto.focus({ preventScroll: true });
}

/* Los eventos */

raiz.addEventListener("pointerdown", (ev) => ev.isTrusted && auto && !ev.target.closest(".pb-auto") && parar(true), true);
raiz.addEventListener("click", (ev) => {
  // La miniatura entera es tocable: lo de adentro es inerte, así que el toque llega a su caja.
  const b = ev.target.closest("[data-a]") || ev.target.closest(".pb-mini")?.querySelector(".pb-mini-btn");
  if (!b || b.getAttribute("aria-disabled") === "true") return;
  A[b.dataset.a](b.dataset.v);
  pintar();
});
raiz.addEventListener("input", (ev) => {
  const f = ev.target.getAttribute("data-f");
  if (f === "nombre" || f === "evento") e[f] = ev.target.value;
  if (f === "evento") cont.querySelector(".pb-h").textContent = e.evento.trim() || t("evento");
  // El nombre del evento ya se ve en el panel de al lado mientras se escribe.
  if (f === "evento") pintarMinis();
});
raiz.addEventListener("keydown", (ev) => {
  const k = ev.key;
  if (auto && !ev.target.closest(".pb-auto")) parar(true);
  if (k === "Enter" && ev.target.matches("input[data-f]")) A.inscribir();
  else if (k === "Escape" && e.rol === "asiste" && e.hoja) A.cerrar();
  else if (k === "Escape" && e.rol === "voluntario" && e.ver) A.volver();
  else if (k === "Escape" && e.rol === "organiza" && e.cierre) A.cerrarCierre();
  else return;
  ev.preventDefault(); // que el Enter no active además el botón nuevo
  pintar();
});
// En el celular y la tableta, las pestañas de rol van arriba de la guía pegada: quién sos, qué hacer y qué
// pasó en los otros roles, siempre a la vista junto al aparato. En escritorio vuelven sobre el aparato.
const ubicar = () => (ancho.matches ? escenario.prepend(roles) : guia.prepend(roles));
ancho.addEventListener("change", () => (ubicar(), pintar()));
ubicar();
// La guía se pega debajo de la cabecera en el celular: su alto cambia con el ancho.
const cabecera = document.querySelector(".cabecera");
const medirCabecera = () => cabecera && raiz.style.setProperty("--pb-cab", cabecera.offsetHeight + "px");
addEventListener("resize", medirCabecera, { passive: true });
medirCabecera();

// El video de la app real: no tiene archivo hasta que se pide (ni siquiera el cartel), así que no baja nada
// antes. El botón le pone el del idioma y lo reproduce; en el celular, a pantalla completa, donde se lee.
// Sin JavaScript, el enlace abre el archivo.
const mvp = document.getElementById("mvp-video"), mvpAbrir = document.getElementById("mvp-abrir");
const mvpPoner = () => {
  const archivo = `assets/mvp-${lang}.mp4`;
  if (mvp.getAttribute("src") === archivo) return;
  mvp.setAttribute("poster", `assets/mvp-${lang}.jpg`);
  mvp.setAttribute("src", archivo);
};
const mvpIdioma = () => {
  if (!mvp || !mvpAbrir) return;
  mvpAbrir.setAttribute("href", `assets/mvp-${lang}.mp4`);
  mvp.setAttribute("aria-label", t("realAria"));
  if (!mvp.hidden) mvpPoner();
};
mvpAbrir?.addEventListener("click", (ev) => {
  if (!mvp) return;
  ev.preventDefault();
  mvpPoner();
  mvp.hidden = false;
  mvpAbrir.hidden = true;
  mvp.focus();
  mvp.play().catch(() => { /* sin reproducción automática: quedan los controles */ });
  if (matchMedia("(max-width: 560px)").matches) (mvp.requestFullscreen?.() || mvp.webkitEnterFullscreen?.())?.catch?.(() => {});
});

// El idioma cambia sin perder el estado.
const idioma = () => {
  lang = document.documentElement.lang === "en" ? "en" : "es";
  document.querySelectorAll("[data-pb]").forEach((el) => (el.textContent = t(el.dataset.pb)));
  roles.setAttribute("aria-label", t("rolesL"));
  mvpIdioma();
  pintar();
};
new MutationObserver(idioma).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
idioma();
})();
