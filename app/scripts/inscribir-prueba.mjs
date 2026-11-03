// Inscribe a una persona de prueba en el evento de muestra, contra la red de prueba, con el mismo código que
// usa la página: crea a la persona, le pide su cuenta, llama a register (o a buy con --pago) en el contrato,
// guarda el pase, crea el enlace personal y escribe el correo en data/correos/. Después comprueba el pase:
// status() en la cadena, la firma del QR, la clave de acceso, la credencial armada y el SVG (queda en data/).
//
//   node scripts/inscribir-prueba.mjs                      inscripción gratis
//   node scripts/inscribir-prueba.mjs --pago               entrada paga (10 USDC de prueba de la cuenta de la persona)
//   node scripts/inscribir-prueba.mjs --api http://localhost:3000   lo mismo, pero por la API de un servidor levantado
//   --slug <slug>                                          otro evento (por defecto hackaton-comunidad)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR, loadEnv } from "./lib/env.mjs";

process.chdir(APP_DIR);
loadEnv();

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const slug = option("--slug", "hackaton-comunidad");
const paid = flag("--pago");
const api = option("--api", null);
const stamp = Date.now().toString(36);
const person = { name: `Prueba ${stamp}`, email: `prueba-${stamp}@example.com` };

const paso = (texto) => console.log(`\n> ${texto}`);
const check = (condition, message) => {
  if (!condition) throw new Error(`FALLÓ: ${message}`);
  console.log(`  ok: ${message}`);
};
const t0 = Date.now();

if (api) {
  await porApi(api.replace(/\/+$/, ""));
} else {
  await directo();
}
console.log(`\nListo en ${Math.round((Date.now() - t0) / 1000)} s.`);

async function directo() {
  const { getRepo } = await import("../src/server/repo.ts");
  const { registerForEvent } = await import("../src/server/evento/inscripcion.ts");
  const { loadCredential } = await import("../src/server/evento/credencial.ts");
  const { renderCredentialSvg } = await import("../src/server/evento/credencial-svg.ts");
  const { verifyQrPayload } = await import("../src/server/qr.ts");
  const { getEventQrKeys } = await import("../src/server/qr-keys.ts");
  const { buildLivePayload } = await import("../src/lib/qr-live.ts");
  const { rumboPass } = await import("../src/server/stellar.ts");

  const repo = getRepo();
  const event = await repo.getEventBySlug(slug);
  if (!event) throw new Error(`No existe el evento ${slug}: corré pnpm seed`);
  const tickets = await repo.listTicketTypes(event.id);
  const ticket = tickets.find((tt) => (paid ? tt.priceUsdc > 0 : tt.priceUsdc === 0));
  if (!ticket) throw new Error(paid ? "El evento no tiene entrada paga" : "El evento no tiene entrada gratis");

  paso(`${paid ? "Compra" : "Inscripción"} de ${person.name} <${person.email}> con la entrada "${ticket.name}" (${ticket.priceUsdc} USDC de prueba)`);
  const result = await registerForEvent({ slug, ticketTypeId: ticket.id, ...person, lang: "es", origin: process.env.NEXT_PUBLIC_BASE_URL });
  check(result.kind === "created", `la inscripción se creó (${result.kind}${result.kind === "failed" ? `: ${result.reason} ${result.detail}` : ""})`);
  console.log(`  pase ${result.pass.id}, número ${result.chainNumber} en el contrato, transacción ${result.txHash}`);
  console.log(`  enlace: ${result.url}`);

  paso("status() en la cadena");
  const contractId = ticket.contractId ?? event.contractId;
  const status = await rumboPass.status(contractId, result.pass.account);
  check(status.has_pass, "la cuenta tiene su pase en el contrato");
  check(status.number === result.chainNumber, `el número coincide (${status.number})`);
  check(!status.checked_in, "todavía no entró");

  paso("La credencial");
  const view = await loadCredential(result.pass.id, result.accessKey);
  check(view !== null, "se abre con la clave de acceso");
  check((await loadCredential(result.pass.id, "A".repeat(22))) === null, "no se abre con otra clave");
  check((await loadCredential(result.pass.id, null)) === null, "no se abre sin clave");
  check(view.person.name === person.name && view.event.slug === slug, "es la de la persona y el evento");
  check(view.paid === paid && view.checkedIn === false, `estado: ${view.paid ? "entrada paga" : "inscripción lista"}, sin entrar`);
  console.log(`  Credencial ${view.number} de ${view.total}; lo que le toca: ${view.benefits.map((b) => `${b.name} (${b.state})`).join(", ") || "nada"}`);
  const clavePublica = getEventQrKeys(event.id).publicKey;
  check((await verifyQrPayload(view.qrPayload, clavePublica)).ok, `la firma del QR de la credencial impresa es válida (${view.qrPayload})`);
  check(!(await verifyQrPayload(view.qrPayload.replace(/.$/, (c) => (c === "A" ? "B" : "A")), clavePublica)).ok, "un QR con una letra cambiada no pasa");
  const vivo = await buildLivePayload(view.live, Date.now());
  check((await verifyQrPayload(vivo, clavePublica)).ok, "el QR que rota, armado con lo que recibe la credencial, también es válido");
  check(!(await verifyQrPayload(vivo, clavePublica, Date.now() + 100_000)).ok, "y una captura de hace 100 segundos ya no sirve");

  paso("El SVG para imprimir");
  const svg = renderCredentialSvg(view, "es");
  check(svg.startsWith("<?xml") && svg.includes("<svg") && svg.trimEnd().endsWith("</svg>"), "es un SVG entero");
  check(svg.includes(person.name) && svg.includes("Credencial"), "lleva el nombre y el número");
  const file = join(APP_DIR, "data", `credencial-${result.pass.id}.svg`);
  writeFileSync(file, svg, "utf8");
  console.log(`  guardado en ${file}`);

  paso("Otra vez con el mismo correo");
  const again = await registerForEvent({ slug, ticketTypeId: ticket.id, ...person, lang: "es" });
  check(again.kind === "existing" && again.pass.id === result.pass.id, "no crea otro pase: reenvía el enlace por correo");
}

async function porApi(base) {
  paso(`GET ${base}/api/evento/${slug}`);
  const eventRes = await fetch(`${base}/api/evento/${slug}`);
  check(eventRes.ok, `el evento existe (${eventRes.status})`);
  const { tickets } = await eventRes.json();
  const ticket = tickets.find((tt) => (paid ? !tt.free : tt.free));
  if (!ticket) throw new Error("No hay una entrada de ese tipo");

  paso(`POST ${base}/api/evento/${slug}/inscripcion con la entrada "${ticket.name}"`);
  const res = await fetch(`${base}/api/evento/${slug}/inscripcion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketTypeId: ticket.id, ...person, lang: "es" }),
  });
  const body = await res.json();
  check(res.status === 201 && body.status === "created", `se creó (${res.status} ${JSON.stringify(body)})`);
  console.log(`  pase ${body.passId}, enlace ${body.url}`);
  const key = new URL(body.url).searchParams.get("k");

  paso("GET /api/pase/<id>");
  const viewRes = await fetch(`${base}/api/pase/${body.passId}?k=${encodeURIComponent(key)}`);
  check(viewRes.ok, `se abre con la clave (${viewRes.status})`);
  const view = await viewRes.json();
  check(view.person.name === person.name && view.paid === paid, "es la credencial de la persona");
  console.log(`  Credencial ${view.number} de ${view.total}; QR ${view.qr}; lo que le toca: ${view.benefits.map((b) => `${b.name} (${b.state})`).join(", ")}`);
  check((await fetch(`${base}/api/pase/${body.passId}?k=${"A".repeat(22)}`)).status === 404, "con otra clave da 404");

  paso("GET /api/pase/<id>/svg");
  const svgRes = await fetch(`${base}/api/pase/${body.passId}/svg?k=${encodeURIComponent(key)}`);
  const svg = await svgRes.text();
  check(svgRes.ok && svgRes.headers.get("content-type")?.startsWith("image/svg+xml"), "devuelve un SVG");
  check(svg.includes(person.name), "con el nombre");

  paso("GET /p/<id> (la página)");
  const pageRes = await fetch(`${base}/p/${body.passId}?k=${encodeURIComponent(key)}`);
  const html = await pageRes.text();
  check(pageRes.ok && html.includes(person.name), `la página se ve (${pageRes.status})`);
  check((await fetch(`${base}/p/${body.passId}?k=${"A".repeat(22)}`)).status === 404, "con otra clave da 404");

  paso("Otra vez con el mismo correo");
  const again = await fetch(`${base}/api/evento/${slug}/inscripcion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketTypeId: ticket.id, ...person }),
  });
  const againBody = await again.json();
  check(again.status === 200 && againBody.status === "existing" && !againBody.url, "no crea otro pase ni muestra el enlace");
}
