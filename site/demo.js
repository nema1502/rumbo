// Probalo: la maqueta clickeable del flujo. Corre entera en el navegador: no guarda nada ni toca
// la red. Un solo estado para los tres roles; el idioma sigue al lang que rumbo.js pone en <html>.
(() => {
const raiz = document.getElementById("probar"), guia = document.getElementById("pb-guia"), escenario = document.getElementById("pb-escenario");
if (!raiz || !guia || !escenario) return;

const es = {
  ante: "Probalo", ir: "Ahora probalo vos",
  titulo: "Hacé de cuenta que estás en el evento.",
  bajada: "Tocá y recorré el flujo entero: te inscribís, te llega la credencial, un voluntario la escanea y el panel se entera. Es una maqueta del recorrido que buscamos: nada se guarda ni toca la red, y el QR del banco, el sorteo y el premio en la credencial todavía no están en el producto.",
  real: "Y no es solo una maqueta: así anda el MVP real, grabado en la red de prueba de Stellar.", realVer: "Ver el video",
  realAria: "El MVP de Rumbo andando en la red de prueba de Stellar, de la inscripción a la transacción",
  rolesL: "Elegí un rol", asiste: "Quien asiste", voluntario: "Voluntario", organiza: "Quien organiza",
  evento: "Hackatón de la comunidad", fecha: "Domingo 22 de noviembre", nombreL: "Tu nombre",
  entrada: "Entrada general", gratis: "Gratis", inscribirme: "Inscribirme", lista: "Inscripción lista",
  correo: "Tu credencial quedó lista: guardá el enlace", ver: "Ver mi credencial",
  polera: "Polera del evento", comprar: "Comprar", oQR: "o con el QR del banco (pronto)", pagada: "Pagada",
  antes: "Primero inscribite: la polera va a tu credencial.",
  como: "¿Cómo pagás?", poleraM: "Polera del evento, talle M: 10 USDC", usdcSub: "desde tu cuenta",
  qr: "QR del banco", qrSub: "en bolivianos, pronto", cancelar: "Cancelar", listo: "Listo",
  pagUsdc: "Pagado en USDC", pagQr: "Pagado con el QR del banco",
  subUsdc: "10 USDC, repartidos en la misma operación.",
  subQr: "Pagaste en bolivianos y llegó en USDC, repartido en la misma operación.",
  aOrg: "9,75 USDC a quien organiza", fee: "0,25 USDC de comisión (2,5 %)",
  volver: "Página del evento", numero: "Credencial 37 de 120", inscripta: "Inscripta", entro: "Entró",
  almuerzo: "Almuerzo", pendiente: "pendiente", canjeado: "canjeado",
  poleraT: "Polera, talle M", paraRetirar: "pagada, para retirar", retirada: "retirada",
  premio: "Premio del sorteo", premioA: "Premio del sorteo: auriculares",
  enSorteo: "en el sorteo", ganado: "ganado", entregado: "entregado", qrAlt: "QR de la credencial",
  escaner: "Escáner", puesto: "Puesto", puerta: "Puerta", almuerzoP: "Almuerzo", poleraP: "Polera", premios: "Premios",
  apunta: "Apuntá al QR", leyendo: "Leyendo la credencial", escanear: "Escanear la credencial",
  sinConexion: "Sin conexión", pend1: "1 pendiente", pendN: "{n} pendientes",
  guardado: "Guardado en el celular, se sincroniza al volver la red", sincronizado: "Sincronizado",
  volverEsc: "Volver al escáner",
  vYaEntro: "Ya entró", aLasEntro: "Entró a las {h}", vPrimero: "Primero el check‑in en la puerta",
  vCanj: "Canjeado", vYaCanj: "Ya canjeado", seCanjeo: "Se canjeó a las {h}",
  vNoPolera: "No compró la polera", vEntregada: "Entregada", vYaEntregada: "Ya entregada", seEntrego: "Se entregó a las {h}",
  vNoSorteo: "El sorteo todavía no se hizo", vPremio: "Premio entregado: auriculares", vYaPremio: "Ya entregado",
  vSinCred: "Todavía no hay credencial", vSinCredB: "Inscribite en Quien asiste.",
  panel: "Panel del evento", vivo: "En vivo", pCred: "Credenciales", pEnt: "Entraron",
  pAlm: "Almuerzos canjeados", pPol: "Poleras entregadas", pPrem: "Premios entregados",
  sortear: "Hacer el sorteo", sorteoHecho: "Sorteo hecho", informe: "Informe para quien auspicia",
  entre: "Sorteo entre {n} personas que entraron", gano: "Ganó {n}", premioAuri: "Premio: auriculares",
  comp: "Comprobante", compSub: "Con este código cualquiera puede verificar el resultado.",
  primeroEntrar: "Primero tiene que entrar {n}: escaneá su credencial en la puerta.",
  infQue: "Almuerzo para cada asistente", infCuanto: "{a} de {b} canjeados",
  infPriv: "Sin nombres ni correos: solo los contactos que cada persona aceptó compartir.",
  pasoN: "Paso {n} de {m}", completo: "Recorrido completo", reiniciar: "Reiniciar", reiniciado: "La maqueta volvió al principio.",
  g_inscribir: "Tocá Inscribirme.", s_inscribir: "Si querés, cambiá el nombre. La polera es opcional.",
  g_cred: "Mirá tu credencial.", s_cred: "Abrila desde tu enlace: ahí está lo que te toca.",
  g_puerta: "Pasá a Voluntario y escaneá en la puerta.", s_puerta: "El voluntario no necesita cuenta ni entrenamiento.",
  g_almuerzo: "Ahora en el puesto del almuerzo, y escaneá dos veces.", s_almuerzo: "El segundo intento no pasa: cada canje es una sola vez.",
  g_polera: "Retirá la polera en el puesto Polera.", s_polera: "Ya está pagada y en tu credencial.",
  g_offline: "Prendé Sin conexión y escaneá otra vez.", s_offline: "Aunque se caiga la red, la fila sigue.",
  g_sync: "Apagá Sin conexión.", s_sync: "Lo guardado en el celular se sincroniza solo.",
  g_sorteo: "Mirá el panel y hacé el sorteo.", s_sorteo: "Sortea solo entre quienes de verdad entraron.",
  g_premio: "Entregá el premio en el puesto Premios.", s_premio: "El premio ya está en tu credencial.",
  g_informe: "Abrí el informe para quien auspicia.", s_informe: "Con lo que de verdad se entregó, sin datos de nadie.",
  g_fin: "Listo. Reiniciá cuando quieras.", s_fin: "Así se ve un evento con Rumbo, de la inscripción al informe.",
};

const en = {
  ante: "Try it", ir: "Now try it yourself",
  titulo: "Pretend you are at the event.",
  bajada: "Tap your way through the whole flow: you sign up, your pass arrives, a volunteer scans it and the dashboard finds out. It is a mock-up of the flow we are building: nothing is saved and nothing touches the network, and the bank QR code, the draw and the prize on the pass are not in the product yet.",
  real: "And it is not just a mock-up: this is the real MVP at work, recorded on the Stellar testnet.", realVer: "Watch the video",
  realAria: "Rumbo's MVP running on the Stellar testnet, from sign-up to the transaction",
  rolesL: "Choose a role", asiste: "Attendee", voluntario: "Volunteer", organiza: "Organizer",
  evento: "Community hackathon", fecha: "Sunday, November 22", nombreL: "Your name",
  entrada: "General ticket", gratis: "Free", inscribirme: "Sign up", lista: "Signed up",
  correo: "Your pass is ready: keep the link", ver: "See my pass",
  polera: "Event T-shirt", comprar: "Buy", oQR: "or with a bank QR code (soon)", pagada: "Paid",
  antes: "Sign up first: the T-shirt goes on your pass.",
  como: "How do you pay?", poleraM: "Event T-shirt, size M: 10 USDC", usdcSub: "from your account",
  qr: "Bank QR code", qrSub: "in bolivianos, soon", cancelar: "Cancel", listo: "Done",
  pagUsdc: "Paid in USDC", pagQr: "Paid with a bank QR code",
  subUsdc: "10 USDC, split in the same operation.",
  subQr: "You paid in bolivianos and it arrived as USDC, split in the same operation.",
  aOrg: "9.75 USDC to the organizer", fee: "0.25 USDC fee (2.5%)",
  volver: "Event page", numero: "Pass 37 of 120", inscripta: "Registered", entro: "Checked in",
  almuerzo: "Lunch", pendiente: "pending", canjeado: "redeemed",
  poleraT: "T-shirt, size M", paraRetirar: "paid, pick up at the desk", retirada: "picked up",
  premio: "Draw prize", premioA: "Draw prize: headphones",
  enSorteo: "in the draw", ganado: "won", entregado: "delivered", qrAlt: "Pass QR code",
  escaner: "Scanner", puesto: "Station", puerta: "Door", almuerzoP: "Lunch", poleraP: "T-shirt", premios: "Prizes",
  apunta: "Point at the QR code", leyendo: "Reading the pass", escanear: "Scan the pass",
  sinConexion: "Offline", pend1: "1 pending", pendN: "{n} pending",
  guardado: "Saved on the phone, syncs when the network is back", sincronizado: "Synced",
  volverEsc: "Back to the scanner",
  vYaEntro: "Already checked in", aLasEntro: "Checked in at {h}", vPrimero: "Check in at the door first",
  vCanj: "Redeemed", vYaCanj: "Already redeemed", seCanjeo: "Redeemed at {h}",
  vNoPolera: "No T-shirt on this pass", vEntregada: "Handed over", vYaEntregada: "Already handed over", seEntrego: "Handed over at {h}",
  vNoSorteo: "The draw has not happened yet", vPremio: "Prize handed over: headphones", vYaPremio: "Already handed over",
  vSinCred: "No pass yet", vSinCredB: "Sign up as the attendee first.",
  panel: "Event dashboard", vivo: "Live", pCred: "Passes", pEnt: "Checked in",
  pAlm: "Lunches redeemed", pPol: "T-shirts handed over", pPrem: "Prizes delivered",
  sortear: "Run the draw", sorteoHecho: "Draw done", informe: "Sponsor report",
  entre: "Draw among the {n} people who checked in", gano: "{n} won", premioAuri: "Prize: headphones",
  comp: "Proof", compSub: "With this code anyone can check the result.",
  primeroEntrar: "{n} has to check in first: scan the pass at the door.",
  infQue: "Lunch for every attendee", infCuanto: "{a} of {b} redeemed",
  infPriv: "No names or emails: only the contacts each person agreed to share.",
  pasoN: "Step {n} of {m}", completo: "All done", reiniciar: "Start over", reiniciado: "The mock-up is back at the start.",
  g_inscribir: "Tap Sign up.", s_inscribir: "Change the name if you like. The T-shirt is optional.",
  g_cred: "Look at your pass.", s_cred: "Open it from your link: everything you get is there.",
  g_puerta: "Switch to Volunteer and scan at the door.", s_puerta: "The volunteer needs no account and no training.",
  g_almuerzo: "Now go to the lunch station and scan twice.", s_almuerzo: "The second attempt does not go through: each redemption happens once.",
  g_polera: "Pick up the T-shirt at the T-shirt station.", s_polera: "It is paid and already on your pass.",
  g_offline: "Turn on Offline and scan again.", s_offline: "Even if the network drops, the line keeps moving.",
  g_sync: "Turn Offline back off.", s_sync: "What was saved on the phone syncs on its own.",
  g_sorteo: "Check the dashboard and run the draw.", s_sorteo: "It draws only among the people who actually checked in.",
  g_premio: "Hand over the prize at the Prizes station.", s_premio: "The prize is already on your pass.",
  g_informe: "Open the sponsor report.", s_informe: "What was actually delivered, with nobody's personal data.",
  g_fin: "Done. Start over whenever you like.", s_fin: "That is an event with Rumbo, from sign-up to report.",
};

let lang = "es";
const t = (k, v) => ((lang === "en" ? en : es)[k] ?? k).replace(/\{(\w)\}/g, (_, x) => v[x]);
const limpio = (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
const quieto = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// La hora de cada canje, en los dos idiomas.
const H = { puerta: ["10:14", "10:14 AM"], almuerzo: ["13:02", "1:02 PM"], polera: ["15:20", "3:20 PM"], premio: ["18:34", "6:34 PM"] };
const ROLES = ["asiste", "voluntario", "organiza"];
const PUESTOS = ["puerta", "almuerzoP", "poleraP", "premios"];

// Estado inicial: lo que falta arranca vacío.
const nuevo = () => ({ rol: "asiste", vista: "evento", nombre: "Ana R.", puesto: "puerta", hoja: "", polera: "", pend: 0, ver: null, sorteo: null, inscripta: false, entro: false, alm: false, retirada: false, premio: false, offline: false, informe: false });
let e = nuevo(), foco = null, vistaPrevia = "";
let fx = {}; // lo que se anima en la próxima pintada
let previo = {}; // lo último mostrado: se anima solo lo que cambió
const reloj = {};

const cambio = (k, v) => {
  const c = k in previo && previo[k] !== v;
  return (previo[k] = v), c;
};
const ic = (d, c = "pb-i") => `<svg class="${c}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const CHECK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
const btn = (a, k, c = "", v = "", x = "") => `<button class="pb-btn ${c}" data-a="${a}" data-f="${a}${v && "-" + v}"${v && ` data-v="${v}"`}${x}>${k}</button>`;
const pend = () => t(e.pend === 1 ? "pend1" : "pendN", { n: e.pend });
const ganado = () => !!e.sorteo;

// El esqueleto fijo: así el aparato anima su ancho y conserva el scroll.
// El aparato va adentro de .pb-aparato, que es lo que se achica cuando la ventana es baja (demo.css): el teléfono
// adentro sigue midiendo lo mismo y se escala entero, así ninguna pantalla lo corta.
escenario.innerHTML = '<div class="pb-roles" role="group"></div><div class="pb-aparato"><div class="pb-tel"><div class="pb-pantalla"><div class="pb-barra" aria-hidden="true"></div><div class="pb-contenido"></div><div class="pb-capa"></div></div></div></div><p class="pb-anuncio" role="status" aria-live="polite"></p>';
guia.innerHTML = `<p class="pb-guia-paso"></p><p class="pb-guia-texto" aria-live="polite"></p><p class="pb-guia-sub"></p><ol class="pb-progreso" aria-hidden="true"></ol><button class="boton boton-secundario" type="button" data-a="reiniciar" data-f="reiniciar">${ic('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>')}<span></span></button>`;
const $ = (s) => escenario.querySelector(s);
const roles = $(".pb-roles"), tel = $(".pb-tel"), barra = $(".pb-barra");
const cont = $(".pb-contenido"), capa = $(".pb-capa"), anuncio = $(".pb-anuncio");
const [gPaso, gTexto, gSub, gProg, gReset] = guia.children;
// Avisos para lectores de pantalla, sin punto doble.
const decir = (...p) => ((anuncio.textContent = ""), setTimeout(() => (anuncio.textContent = p.filter(Boolean).map((s) => s.replace(/\.$/, "")).join(". ") + "."), 60));

/* Las pantallas */

const vBarra = () => `<span>9:41</span><span class="pb-isla"></span><span class="pb-iconos">${ic('<path d="M2.5 9a14 14 0 0 1 19 0M5.8 12.4a9.5 9.5 0 0 1 12.4 0M9.1 15.8a5 5 0 0 1 5.8 0M12 19.2h.01"/>' + (e.rol === "voluntario" && e.offline ? '<path class="pb-tacha" d="M4 3.5l16 17"/>' : ""))}<svg class="pb-bat" viewBox="0 0 28 14" aria-hidden="true"><rect x="1" y="1" width="22" height="12" rx="3.5"/><rect x="3.5" y="3.5" width="15" height="7" rx="1.5"/><path d="M25.5 5v4"/></svg></span>`;

const vEvento = () => {
  const ok = (k) => `<p class="pb-ok">${ic(CHECK)}${t(k)}</p>`;
  return `<div class="pb-banner"><svg viewBox="0 0 320 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><circle cx="262" cy="24" r="12" fill="#f5c451"/><path d="M0 62l70-28 52 22 64-34 80 30 54-14v42H0z" fill="#2fbfa6"/><path d="M0 80V60c50-12 90 4 140 10s110-4 180 2v8z" fill="#e8541e"/></svg></div>
<h3 class="pb-h">${t("evento")}</h3><p class="pb-sub">${t("fecha")}</p>
${e.inscripta ? "" : `<label class="pb-campo">${t("nombreL")}<input data-f="nombre" value="${limpio(e.nombre)}" maxlength="24" autocomplete="off"></label>`}
<div class="pb-item"><p class="pb-sub">${t("entrada")}</p><p class="pb-precio">${t("gratis")}</p>
${e.inscripta ? ok("lista") + `<p class="pb-correo${fx.correo ? " pb-entra" : ""}">${ic('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>')}${t("correo")}</p>` + btn("ver", t("ver"), "pb-pri" + (fx.correo ? " pb-mostrar" : "")) : btn("inscribir", t("inscribirme"), "pb-pri")}</div>
<div class="pb-item"><p class="pb-sub">${t("polera")}</p><p class="pb-precio">10 USDC</p>
${e.polera ? ok("pagada") : btn("comprar", t("comprar")) + `<p class="pb-chico">${t("oQR")}</p>`}
${e.avisoCompra && !e.polera ? `<p class="pb-nota pb-mostrar">${t("antes")}</p>` : ""}</div>`;
};

const vCred = () => {
  const s = ganado();
  const filas = [["almuerzo", e.alm ? "listo:canjeado" : "pendiente:pendiente", "c1"]];
  if (e.polera) filas.push(["poleraT", e.retirada ? "listo:retirada" : "pendiente:paraRetirar", "c2"]);
  filas.push([s ? "premioA" : "premio", e.premio ? "listo:entregado" : s ? "premio:ganado" : "sorteo:enSorteo", "c3"]);
  return `<button class="pb-atras" data-a="evento" data-f="evento">${ic('<path d="M15 18l-6-6 6-6"/>') + t("volver")}</button>
<h3 class="pb-h">${t("evento")}</h3><p class="pb-sub">${t("entrada")}</p>
<div class="pb-qr"><img src="assets/qr.svg" alt="${t("qrAlt")}" width="118" height="118"></div>
<div class="pb-persona"><p class="pb-nombre">${limpio(e.nombre)}</p><p class="pb-sub">${t("numero")}</p></div>
<p class="pb-estado${e.entro ? " si" : ""}${cambio("est", e.entro) ? " pb-pop" : ""}">${t(e.entro ? "entro" : "inscripta")}</p>
<ul class="pb-fil">${filas.map(([k, v, id]) => {
    const [c, tx] = v.split(":");
    return `<li>${t(k)} <span class="chip chip-${c} pb-chip${cambio(id, v) ? " pb-pop" : ""}">${c === "listo" ? ic(CHECK, "check") : ""}${t(tx)}</span></li>`;
  }).join("")}</ul>`;
};

const CONT = { puerta: ["pEnt", () => 97 + e.entro], almuerzoP: ["pAlm", () => 93 + e.alm], poleraP: ["pPol", () => 36 + e.retirada], premios: ["pPrem", () => 11 + e.premio] };
const vEscaner = () => {
  const [ck, cv] = CONT[e.puesto], n = cv();
  // Detrás del veredicto no se marca: el número late al volver.
  const late = !e.ver && cambio("n" + e.puesto, n);
  return `<div class="pb-fila"><h3 class="pb-h">${t("escaner")}</h3><span class="pb-tag">${t("voluntario")}</span></div>
<div class="pb-puestos" role="group" aria-label="${t("puesto")}">${PUESTOS.map((p) => btn("puesto", t(p), "pb-seg", p, ` aria-pressed="${e.puesto === p}"`).replace("pb-btn ", "")).join("")}</div>
<div class="pb-visor${e.leyendo ? " pb-lee" : ""}"><svg viewBox="-14 -14 128 128" aria-hidden="true"><path d="M3 22V9a6 6 0 0 1 6-6h13M78 3h13a6 6 0 0 1 6 6v13M97 78v13a6 6 0 0 1-6 6H78M22 97H9a6 6 0 0 1-6-6V78"/></svg><img src="assets/qr.svg" alt=""><i></i></div>
<p class="pb-apunta">${t(e.leyendo ? "leyendo" : "apunta")}</p>
<p class="pb-cont">${t(ck)} <b${late ? ' class="pb-pop"' : ""}>${n}</b></p>
${btn("escanear", t("escanear"), "pb-pri", "", e.leyendo ? ' aria-disabled="true"' : "")}
<div class="pb-off">${btn("offline", `<span class="pb-perilla"></span>${t("sinConexion")}`, "pb-switch", "", ` role="switch" aria-checked="${e.offline}"`).replace("pb-btn ", "")}${e.pend ? `<span class="pb-pend">${pend()}</span>` : ""}</div>`;
};

const vPanel = () => {
  const s = e.sorteo, a = 93 + e.alm, b = 97 + e.entro;
  const cifras = [["pCred", 119 + e.inscripta, "#3d4b5f"], ["pEnt", b, "#e8541e"], ["pAlm", a, "#0b7a68"], ["pPrem", 11 + e.premio, "#f5c451"]];
  return `<div class="pb-izq"><div class="pb-fila pb-cab"><div><h3 class="pb-h">${t("panel")}</h3><p class="pb-sub">${t("evento")}</p></div><span class="pb-vivo">${t("vivo")}</span></div>
<ul class="pb-cifras">${cifras.map(([k, v, c]) => {
    const d = previo[k], late = cambio(k, v);
    return `<li>${t(k)} <b${late ? ' class="pb-pop"' : ""}>${v}</b><i${late ? ' class="pb-crece"' : ""} style="--p:${(v / 1.2).toFixed(1)}%;--c:${c}${late ? `;--d:${(d / 1.2).toFixed(1)}%` : ""}"></i></li>`;
  }).join("")}</ul></div>
<div class="pb-der">${btn("sortear", ganado() ? ic(CHECK) + t("sorteoHecho") : t("sortear"), "pb-pri" + (ganado() ? " pb-hecho" : ""), "", s ? ' aria-disabled="true"' : "")}
${btn("informe", t("informe"), "", "", ` aria-expanded="${e.informe}"`)}
${e.avisoPanel && !s ? `<p class="pb-nota pb-mostrar">${t("primeroEntrar", { n: limpio(e.nombre) })}</p>` : ""}
${s ? `<div class="pb-carta${fx.sorteo ? " pb-entra pb-mostrar" : ""}"><p class="pb-sub">${t("entre", { n: b })}</p><p class="pb-ruleta${fx.sorteo ? " pb-pop" : ""}">${t("gano", { n: limpio(e.nombre) })}</p><p>${t("premioAuri")}</p><p class="pb-comp">${t("comp")} <b>${s.codigo}</b></p><p class="pb-chico">${t("compSub")}</p></div>` : ""}
${e.informe ? `<div class="pb-carta${fx.informe ? " pb-entra pb-mostrar" : ""}"><p class="pb-sub">${t("informe")}</p><p>${t("infQue")}</p><p class="pb-cuanto">${t("infCuanto", { a: `<b>${a}</b>`, b })}</p><i class="pb-barrita" style="--p:${((a / b) * 100).toFixed(1)}%"></i><p class="pb-chico">${t("infPriv")}</p></div>` : ""}</div>`;
};

const vHoja = () => {
  const pago = e.hoja !== "elegir", qr = e.hoja === "qr", titulo = t(pago ? (qr ? "pagQr" : "pagUsdc") : "como");
  return `<div class="pb-fondo" data-a="cerrar"></div><div class="pb-hoja${fx.hoja ? " pb-sube" : ""}${fx.reparto ? " pb-reparte" : ""}" role="dialog" aria-label="${titulo}">${pago
    ? `<p class="pb-h pb-pagado">${ic(CHECK)}${titulo}</p><p class="pb-sub">${t(qr ? "subQr" : "subUsdc")}</p><p class="pb-reparto"><i></i><i></i></p><p class="pb-linea">${t("aOrg")}</p><p class="pb-linea">${t("fee")}</p>${btn("cerrar", t("listo"), "pb-pri")}`
    : `<p class="pb-h">${titulo}</p><p class="pb-sub">${t("poleraM")}</p>${btn("pagar", `USDC<small>${t("usdcSub")}</small>`, "pb-opcion", "usdc")}${btn("pagar", `${t("qr")}<small>${t("qrSub")}</small>`, "pb-opcion", "qr")}${btn("cerrar", t("cancelar"), "pb-quieto")}`}</div>`;
};

const detalle = (v, f) => (v.b === "@" ? f(e.nombre) : t(v.b, { h: v.h?.[+(lang === "en")] }));
const vVer = () => {
  const v = e.ver;
  const icono = v.k === "ok" ? CHECK : v.k === "ya" ? '<path d="M7 7l10 10M17 7 7 17"/>' : '<path d="M12 7.5v.5M12 11v6"/>';
  return `<div class="pb-ver pb-ver-${v.k}${fx.ver ? " pb-entra" : ""}"><span class="pb-ver-ic">${ic(icono)}</span><p class="pb-ver-t">${t(v.t)}</p>${v.a ? `<p>${t(v.a)}</p>` : ""}${v.b ? `<p>${detalle(v, limpio)}</p>` : ""}${v.off ? `<p class="pb-ver-off">${t("guardado")} <span class="pb-pend">${pend()}</span></p>` : ""}${btn("volver", t("volverEsc"))}</div>`;
};

/* Al escanear: cambia el estado y da el veredicto */

const juzgar = () => {
  const r = (k, tt, a = "", b = "", h) => ({ k, t: tt, a, b, h }), p = e.puesto;
  if (!e.inscripta) return r("no", "vSinCred", "", "vSinCredB");
  if (p === "puerta") return e.entro ? r("ya", "vYaEntro", "entrada", "aLasEntro", H.puerta) : ((e.entro = true), r("ok", "entro", "entrada", "@"));
  if (p === "almuerzoP") return !e.entro ? r("no", "vPrimero", "almuerzo") : e.alm ? ((e.doble = true), r("ya", "vYaCanj", "almuerzo", "seCanjeo", H.almuerzo)) : ((e.alm = true), r("ok", "vCanj", "almuerzo", "@"));
  if (p === "poleraP") return !e.polera ? r("no", "vNoPolera", "poleraT") : e.retirada ? r("ya", "vYaEntregada", "poleraT", "seEntrego", H.polera) : ((e.retirada = true), r("ok", "vEntregada", "poleraT", "@"));
  if (!ganado()) return r("no", "vNoSorteo", "premio");
  return e.premio ? r("ya", "vYaPremio", "premioA", "seEntrego", H.premio) : ((e.premio = true), r("ok", "vPremio", "", "@"));
};
const codigo = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? "-" : "") + "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

/* Cada botón; después se vuelve a pintar */

const A = {
  rol(r) { if (r !== e.rol) Object.assign(e, { rol: r, ver: null, hoja: "" }), (foco = "tab-" + r); },
  inscribir() { Object.assign(e, { nombre: e.nombre.trim() || "Ana R.", inscripta: true, avisoCompra: false }); fx.correo = 1; foco = "ver"; decir(t("lista"), t("correo")); },
  ver() { Object.assign(e, { vista: "cred", vioCred: true }); foco = "evento"; },
  evento() { e.vista = "evento"; foco = "ver"; },
  comprar() {
    if (!e.inscripta) return (e.avisoCompra = true), decir(t("antes"));
    e.hoja = "elegir"; fx.hoja = 1; foco = "pagar-usdc";
  },
  pagar(v) { e.hoja = e.polera = v; fx.reparto = 1; foco = "cerrar"; decir(t(v === "qr" ? "pagQr" : "pagUsdc"), t("aOrg"), t("fee")); },
  cerrar() { e.hoja = ""; foco = e.polera ? "ver" : "comprar"; },
  puesto(p) { Object.assign(e, { puesto: p, ver: null }); foco = "puesto-" + p; },
  escanear() {
    e.leyendo = true;
    reloj.esc = setTimeout(() => {
      const v = juzgar();
      if ((v.off = e.offline)) e.pend++, (e.offScan = true);
      Object.assign(e, { leyendo: false, ver: v }); fx.ver = 1; foco = "volver";
      decir(t(v.t), v.a && t(v.a), v.b && detalle(v, String), v.off && t("guardado") + ", " + pend());
      pintar();
    }, quieto() ? 400 : 1100);
  },
  volver() { e.ver = null; foco = "escanear"; },
  offline() {
    e.offline = !e.offline; foco = "offline";
    if (e.offline) return;
    Object.assign(e, { pend: 0, sync: e.offScan, toast: true }); fx.toast = 1; decir(t("sincronizado"));
    clearTimeout(reloj.toast);
    reloj.toast = setTimeout(() => { e.toast = false; capa.querySelector(".pb-toast")?.remove(); }, 2600);
  },
  sortear() {
    if (!e.entro) return (e.avisoPanel = true), decir(t("primeroEntrar", { n: e.nombre }));
    e.sorteo = { codigo: codigo() }; fx.sorteo = 1;
    decir(t("gano", { n: e.nombre }), t("premioAuri"));
  },
  informe() { e.informe = !e.informe; if (e.informe) e.vioInf = fx.informe = true; foco = "informe"; },
  reiniciar() { clearTimeout(reloj.esc); clearTimeout(reloj.toast); e = nuevo(); previo = {}; foco = "reiniciar"; decir(t("reiniciado")); },
};

/* La guía: el primer paso que falta y qué tocar */

const pasos = () => {
  const l = [["inscribir", e.inscripta], ["cred", e.vioCred], ["puerta", e.entro], ["almuerzo", e.doble]];
  if (e.polera) l.push(["polera", e.retirada]);
  return l.concat([["offline", e.offScan], ["sync", e.sync], ["sorteo", ganado()], ["premio", e.premio], ["informe", e.vioInf]]);
};
// Cada paso: rol, puesto si hace falta y botón.
const OBJ = {
  inscribir: ["asiste", "", "inscribir"], cred: ["asiste", "", "ver"], puerta: ["voluntario", "puerta"],
  almuerzo: ["voluntario", "almuerzoP"], polera: ["voluntario", "poleraP"], offline: ["voluntario", ""],
  sync: ["voluntario", "", "offline"], sorteo: ["organiza", "", "sortear"], premio: ["voluntario", "premios"], informe: ["organiza", "", "informe"],
};
const objetivo = (k) => {
  const [r, p, a] = OBJ[k];
  if (e.rol !== r) return "tab-" + r;
  if (e.hoja) return "";
  if (r === "asiste") return e.vista === "evento" ? a : "evento";
  if (r === "organiza") return a;
  if (e.ver) return "volver";
  if (k === "offline" && !e.offline) return "offline";
  return p && e.puesto !== p ? "puesto-" + p : a || "escanear";
};
const pintarGuia = () => {
  const l = pasos(), i = l.findIndex((p) => !p[1]), k = i < 0 ? "fin" : l[i][0];
  gPaso.textContent = i < 0 ? t("completo") : t("pasoN", { n: i + 1, m: l.length });
  if (gTexto.textContent !== t("g_" + k)) gTexto.textContent = t("g_" + k);
  gSub.textContent = t("s_" + k);
  gProg.innerHTML = l.map((p) => `<li${p[1] ? ' class="si"' : ""}></li>`).join("");
  gReset.lastChild.textContent = t("reiniciar");
  const o = i < 0 ? "" : objetivo(k);
  if (o) raiz.querySelector(`[data-f="${o}"]`)?.classList.add("pb-sug");
};

/* Pintar: todo sale del estado; el foco y el scroll se conservan */

function pintar() {
  const act = document.activeElement;
  const antes = act && raiz.contains(act) ? act.getAttribute("data-f") : null;
  const clave = e.rol + e.vista, sc = clave === vistaPrevia ? cont.scrollTop : 0;
  const asiste = e.rol === "asiste", vol = e.rol === "voluntario";
  roles.innerHTML = ROLES.map((r) => `<button class="pb-rol" aria-pressed="${e.rol === r}" data-a="rol" data-v="${r}" data-f="tab-${r}">${t(r)}</button>`).join("");
  tel.classList.toggle("pb-ancho", e.rol === "organiza");
  barra.innerHTML = vBarra();
  cont.className = "pb-contenido" + (e.rol === "organiza" ? " pb-panel" : "");
  cont.innerHTML = asiste ? (e.vista === "cred" ? vCred() : vEvento()) : vol ? vEscaner() : vPanel();
  capa.innerHTML = asiste && e.hoja ? vHoja() : vol ? (e.ver ? vVer() : "") + (e.toast ? `<p class="pb-toast${fx.toast ? " pb-entra" : ""}">${ic(CHECK)}${t("sincronizado")}</p>` : "") : "";
  cont.inert = (asiste && !!e.hoja) || (vol && !!e.ver);
  cont.scrollTop = sc;
  vistaPrevia = clave;
  const m = cont.querySelector(".pb-mostrar");
  if (m) {
    const fin = m.offsetTop + m.offsetHeight + 16;
    if (fin > cont.scrollTop + cont.clientHeight) cont.scrollTo({ top: fin - cont.clientHeight, behavior: quieto() ? "auto" : "smooth" });
  }
  pintarGuia();
  const destino = foco || antes, el = destino && raiz.querySelector(`[data-f="${destino}"]`);
  foco = null;
  fx = {};
  if (el && el !== document.activeElement) el.focus({ preventScroll: true });
}

raiz.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-a]");
  if (!b || b.getAttribute("aria-disabled") === "true") return;
  A[b.dataset.a](b.dataset.v);
  pintar();
});
raiz.addEventListener("input", (ev) => ev.target.matches("input[data-f=nombre]") && (e.nombre = ev.target.value));
raiz.addEventListener("keydown", (ev) => {
  const k = ev.key;
  if (k === "Enter" && ev.target.matches("input[data-f=nombre]")) A.inscribir();
  else if (k === "Escape" && e.rol === "asiste" && e.hoja) A.cerrar();
  else if (k === "Escape" && e.rol === "voluntario" && e.ver) A.volver();
  else return;
  ev.preventDefault(); // que el Enter no active además el botón nuevo
  pintar();
});

// El MVP real, grabado: el video no tiene archivo hasta que se pide (ni siquiera el cartel), así que no baja
// nada antes. El botón le pone el del idioma y lo reproduce. Sin JavaScript, el enlace abre el archivo.
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
