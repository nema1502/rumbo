// La cuenta propia (Pollar), sin red: el desafío SEP-53 y su firma, que un desafío no sirva dos veces, que una
// firma de otra cuenta no valga, la autorización firmada por el dispositivo (que sea la misma que se dio a firmar,
// de esa cuenta y con una firma que valga), y la inscripción en dos pasos por la API, con la cadena de mentira.
// Una llave local hace de cuenta de Pollar: firma el desafío y la autorización como lo haría su dispositivo.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { beforeEach, test } from "node:test";
import { entornoDePrueba, eventoDePrueba, pedido } from "./lib/entorno.mjs";

entornoDePrueba();
process.env.RUMBO_TRUSTED_IP_HEADER = "x-real-ip";
const { Address, Keypair, Networks, StrKey, authorizeEntry, xdr } = await import("@stellar/stellar-sdk");
const { getRepo } = await import("../src/server/repo.ts");
const stellar = await import("../src/server/stellar.ts");
const propia = await import("../src/server/cuenta-propia.ts");
const { registrationAttempts, walletChallengeAttempts } = await import("../src/server/limites.ts");
const { POST: inscribir } = await import("../src/app/api/evento/[slug]/inscripcion/route.ts");
const { POST: firmar } = await import("../src/app/api/evento/[slug]/inscripcion/firma/route.ts");
const { POST: pedirDesafio } = await import("../src/app/api/cuenta/desafio/route.ts");

const repo = getRepo();
const gratis = await eventoDePrueba(repo);
const pago = await eventoDePrueba(repo, { slug: `pago-${Date.now().toString(36)}`, precio: 10 });
const CONTRATO = StrKey.encodeContract(randomBytes(32));

// Sin red: las cuentas de prueba, el contrato y el correo son de mentira.
globalThis.__rumboAccounts = {
  kind: "dev",
  getOrCreateForPerson: async (personId) => `G${personId.replace(/-/g, "").toUpperCase().padEnd(55, "A").slice(0, 55)}`,
  getForPerson: async () => null,
  authSigner: async () => ({ address: "GFIRMA", signAuthEntry: async (entry) => entry }),
};
globalThis.__rumboMailer = { kind: "dev", send: async () => ({ id: "1" }) };

/** La autorización que pediría el contrato, sin firmar: credenciales de antes de CAP-71, como las pide prepare. */
function autorizacionSinFirmar(cuenta, fn = "register", contrato = CONTRATO) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(cuenta).toScAddress(),
        nonce: randomBytes(8).readBigInt64BE(),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: new Address(contrato).toScAddress(), functionName: fn, args: [new Address(cuenta).toScVal()] }),
      ),
      subInvocations: [],
    }),
  });
}

const cadena = { preparadas: [], mandadas: [], yaTiene: new Set(), conLinea: new Set(), creadas: [], recargas: [] };
let numero = 0;
stellar.walletChain.ensureAccount = async (cuenta) => {
  cadena.creadas.push(cuenta);
  return true;
};
stellar.walletChain.hasTestTrustline = async (cuenta) => cadena.conLinea.has(cuenta);
stellar.walletChain.topUpTestUsdc = async (cuenta, minimo) => {
  cadena.recargas.push({ cuenta, minimo });
};
stellar.rumboPass.prepare = async (contractId, fn, cuenta) => {
  if (cadena.yaTiene.has(cuenta)) throw new stellar.ContractError("El contrato rechazó la operación: Error(Contract, #2)", 2);
  cadena.preparadas.push({ contractId, fn, cuenta });
  return { entryXdr: autorizacionSinFirmar(cuenta, fn).toXdr("base64"), validUntilLedger: 1060, latestLedger: 1000 };
};
stellar.rumboPass.submitSigned = async (contractId, fn, cuenta, entry) => {
  cadena.mandadas.push({ contractId, fn, cuenta, entry });
  numero++;
  return { hash: `h-${numero}`, ledger: 1001, returnValue: numero, number: numero };
};
stellar.rumboPass.status = async () => ({ has_pass: true, number: 42, checked_in: false, redeemed: [] });

beforeEach(async () => {
  await registrationAttempts().clear();
  await walletChallengeAttempts().clear();
});

/** Una firma (ed25519, como la da Keypair.sign) en base64. */
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const enRuta = (slug) => ({ params: Promise.resolve({ slug }) });
async function api(fn, url, body, slug) {
  const res = await fn(await pedido(url, { ip: "190.0.0.1", body }), slug ? enRuta(slug) : undefined);
  return { status: res.status, cuerpo: await res.json() };
}

/** Lo que hace el navegador con Pollar: pide el desafío y lo firma (SEP-53) con la cuenta. */
async function probar(llave, { firmaCon = llave } = {}) {
  const d = await api(pedirDesafio, "http://localhost/api/cuenta/desafio", { publicKey: llave.publicKey(), lang: "es" });
  assert.equal(d.status, 201, JSON.stringify(d.cuerpo));
  const firma = b64(firmaCon.sign(propia.sep53Digest(d.cuerpo.message)));
  return { provider: "pollar", publicKey: llave.publicKey(), challengeId: d.cuerpo.challengeId, signature: firma };
}

const inscripcion = (datos, ticket, wallet) =>
  api(inscribir, `http://localhost/api/evento/${datos.event.slug}/inscripcion`, { ticketTypeId: ticket.id, name: "Persona Prueba", email: datos.email, lang: "es", wallet }, datos.event.slug);
const firma = (slug, requestId, signedAuthEntry) => api(firmar, `http://localhost/api/evento/${slug}/inscripcion/firma`, { requestId, signedAuthEntry }, slug);
const firmarAutorizacion = async (xdrB64, llave, hasta = 1060) => (await authorizeEntry(xdr.SorobanAuthorizationEntry.fromXdr(xdrB64, "base64"), llave, hasta, Networks.TESTNET)).toXdr("base64");

// ---------- SEP-53 ----------

test("SEP-53: se firma SHA-256 del prefijo más el mensaje, y la firma vale solo con esa cuenta y ese mensaje", () => {
  const llave = Keypair.random();
  const mensaje = "Rumbo: confirmo que la cuenta es mía.\nCódigo: ñandú";
  const digest = createHash("sha256").update(Buffer.from(`Stellar Signed Message:\n${mensaje}`, "utf8")).digest();
  assert.deepEqual(propia.sep53Digest(mensaje), digest);
  const firmaBuena = b64(llave.sign(digest));
  assert.equal(propia.verifySep53(llave.publicKey(), mensaje, firmaBuena), true);
  assert.equal(propia.verifySep53(Keypair.random().publicKey(), mensaje, firmaBuena), false, "otra cuenta");
  assert.equal(propia.verifySep53(llave.publicKey(), `${mensaje}.`, firmaBuena), false, "otro mensaje");
  assert.equal(propia.verifySep53(llave.publicKey(), mensaje, b64(llave.sign(Buffer.from(mensaje)))), false, "sin el prefijo ni el SHA-256");
  assert.equal(propia.verifySep53(llave.publicKey(), mensaje, "AAAA"), false, "una firma corta");
  assert.equal(propia.verifySep53("GNOESUNACUENTA", mensaje, firmaBuena), false, "una cuenta que no es una clave pública");
});

test("el desafío sirve una sola vez, para esa cuenta, y vence a los cinco minutos", async () => {
  const llave = Keypair.random();
  const d = await propia.issueChallenge(repo, llave.publicKey(), "es");
  assert.match(d.message, new RegExp(llave.publicKey()));
  assert.equal(await repo.useWalletChallenge(d.challengeId, Keypair.random().publicKey()), null, "de otra cuenta no sirve");
  assert.ok(await repo.useWalletChallenge(d.challengeId, llave.publicKey()), "la primera vez sí");
  assert.equal(await repo.useWalletChallenge(d.challengeId, llave.publicKey()), null, "la segunda no");
  const viejo = await propia.issueChallenge(repo, llave.publicKey(), "en", Date.now() - propia.CHALLENGE_TTL_MS - 1000);
  assert.equal(await repo.useWalletChallenge(viejo.challengeId, llave.publicKey()), null, "vencido no sirve");
});

test("la prueba de la cuenta: vale con su firma; con la firma de otra cuenta no, y ese desafío ya no sirve", async () => {
  const llave = Keypair.random();
  const d = await propia.issueChallenge(repo, llave.publicKey(), "es");
  const buena = { provider: "pollar", publicKey: llave.publicKey(), challengeId: d.challengeId, signature: b64(llave.sign(propia.sep53Digest(d.message))) };
  assert.deepEqual(await propia.verifyWalletProof(repo, buena), { ok: true, publicKey: llave.publicKey(), provider: "pollar" });
  assert.deepEqual(await propia.verifyWalletProof(repo, buena), { ok: false, why: "challenge" }, "el mismo desafío dos veces");

  const otro = await propia.issueChallenge(repo, llave.publicKey(), "es");
  const ajena = b64(Keypair.random().sign(propia.sep53Digest(otro.message)));
  assert.deepEqual(await propia.verifyWalletProof(repo, { ...buena, challengeId: otro.challengeId, signature: ajena }), { ok: false, why: "signature" });
  const correcta = b64(llave.sign(propia.sep53Digest(otro.message)));
  assert.deepEqual(await propia.verifyWalletProof(repo, { ...buena, challengeId: otro.challengeId, signature: correcta }), { ok: false, why: "challenge" }, "después de una firma equivocada hay que pedir otro");
  assert.deepEqual(await propia.verifyWalletProof(repo, { ...buena, provider: "otro" }), { ok: false, why: "malformed" });
});

// ---------- La autorización firmada ----------

test("la autorización firmada: vale la misma, de esa cuenta; con otra cuenta, cambiada o sin firmar no", async () => {
  const llave = Keypair.random();
  const pedida = autorizacionSinFirmar(llave.publicKey());
  const request = { entryXdr: pedida.toXdr("base64"), publicKey: llave.publicKey() };
  const revisar = (b64) => propia.checkSignedAuthEntry(b64, request, Networks.TESTNET);

  const firmada = await firmarAutorizacion(request.entryXdr, llave);
  const ok = revisar(firmada);
  assert.equal(ok.ok, true);

  assert.deepEqual(revisar(await firmarAutorizacion(request.entryXdr, Keypair.random())), { ok: false, problem: "other_account" }, "firmada por otra llave");
  assert.deepEqual(revisar(request.entryXdr), { ok: false, problem: "unsigned" });
  assert.deepEqual(revisar("esto no es XDR"), { ok: false, problem: "malformed" });
  // otra función (o el mismo pedido con otro nonce): no es lo que se dio a firmar
  assert.deepEqual(revisar(await firmarAutorizacion(autorizacionSinFirmar(llave.publicKey(), "buy").toXdr("base64"), llave)), { ok: false, problem: "changed" });
  // de otra cuenta, aunque esté bien firmada por ella
  const ajena = Keypair.random();
  assert.deepEqual(revisar(await firmarAutorizacion(autorizacionSinFirmar(ajena.publicKey()).toXdr("base64"), ajena)), { ok: false, problem: "other_account" });
  // la misma firma con otro vencimiento (lo firmado cambió), o firmada para otra red
  const entry = xdr.SorobanAuthorizationEntry.fromXdr(firmada, "base64");
  const c = entry.credentials.address;
  const tocada = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({ address: c.address, nonce: c.nonce, signatureExpirationLedger: c.signatureExpirationLedger + 1, signature: c.signature }),
    ),
    rootInvocation: entry.rootInvocation,
  });
  assert.deepEqual(revisar(tocada.toXdr("base64")), { ok: false, problem: "bad_signature" });
  const otraRed = (await authorizeEntry(pedida, llave, 1060, Networks.PUBLIC)).toXdr("base64");
  assert.deepEqual(revisar(otraRed), { ok: false, problem: "bad_signature" });
});

// ---------- La inscripción en dos pasos, por la API ----------

test("POST /api/cuenta/desafio: da un desafío para una cuenta, y nada para algo que no lo es", async () => {
  const llave = Keypair.random();
  const ok = await api(pedirDesafio, "http://localhost/api/cuenta/desafio", { publicKey: llave.publicKey(), lang: "en" });
  assert.equal(ok.status, 201);
  assert.match(ok.cuerpo.message, /I confirm the Stellar account/);
  assert.ok(ok.cuerpo.challengeId.length >= 20 && ok.cuerpo.expiresAt);
  const mal = await api(pedirDesafio, "http://localhost/api/cuenta/desafio", { publicKey: "GNOESUNACUENTA" });
  assert.deepEqual([mal.status, mal.cuerpo], [400, { error: "invalid_account" }]);
});

test("inscripción gratis con la cuenta propia: prueba, autorización para firmar, firma y credencial; nada sirve dos veces", async () => {
  const llave = Keypair.random();
  const datos = { ...gratis, email: "valeria-propia@example.com" };
  const wallet = await probar(llave);
  const r1 = await inscripcion(datos, gratis.ticket, wallet);
  assert.equal(r1.status, 202, JSON.stringify(r1.cuerpo));
  assert.equal(r1.cuerpo.status, "needs_signature");
  assert.equal(r1.cuerpo.fn, "register");
  assert.equal(r1.cuerpo.validUntilLedger, 1060);
  assert.ok(cadena.creadas.includes(llave.publicKey()), "la cuenta quedó creada en la red antes de firmar");
  assert.ok(!JSON.stringify(r1.cuerpo).includes("@example.com"), "lo que se da a firmar no lleva el correo");
  const persona = await repo.getPersonByEmail(datos.email);
  const ligada = await repo.getWalletLink(persona.id);
  assert.deepEqual([ligada.provider, ligada.publicKey], ["pollar", llave.publicKey()], "la persona quedó ligada a su cuenta, con Pollar");
  assert.equal((await repo.getPass(r1.cuerpo.passId)).status, "pending", "hasta la firma, pendiente");

  // el mismo desafío otra vez: no
  const otraVez = await inscripcion(datos, gratis.ticket, wallet);
  assert.deepEqual([otraVez.status, otraVez.cuerpo], [401, { error: "wallet_invalid" }]);

  const firmada = await firmarAutorizacion(r1.cuerpo.authEntry, llave);
  const r2 = await firma(gratis.event.slug, r1.cuerpo.requestId, firmada);
  assert.equal(r2.status, 201, JSON.stringify(r2.cuerpo));
  assert.equal(r2.cuerpo.status, "created");
  const pase = await repo.getPass(r1.cuerpo.passId);
  assert.equal(pase.status, "active");
  assert.equal(pase.account, llave.publicKey(), "la credencial quedó en la cuenta de la persona");
  assert.equal(pase.txHash, `h-${numero}`);
  assert.equal(cadena.mandadas.at(-1).cuenta, llave.publicKey());
  assert.equal(await repo.getDevAccount(persona.id), null, "el servidor no guardó ninguna llave de esta persona");

  // el mismo pedido de firma otra vez: no
  const r3 = await firma(gratis.event.slug, r1.cuerpo.requestId, firmada);
  assert.deepEqual([r3.status, r3.cuerpo], [410, { error: "signature_expired" }]);
});

test("una autorización firmada por otra cuenta no se manda, y ese pedido ya no sirve", async () => {
  const llave = Keypair.random();
  const datos = { ...gratis, email: "beto-propia@example.com" };
  const r1 = await inscripcion(datos, gratis.ticket, await probar(llave));
  assert.equal(r1.status, 202);
  const antes = cadena.mandadas.length;
  const r2 = await firma(gratis.event.slug, r1.cuerpo.requestId, await firmarAutorizacion(r1.cuerpo.authEntry, Keypair.random()));
  assert.deepEqual([r2.status, r2.cuerpo], [400, { error: "signature_invalid" }]);
  assert.equal(cadena.mandadas.length, antes, "no se mandó nada");
  assert.equal((await repo.getPass(r1.cuerpo.passId)).status, "pending");
  const r3 = await firma(gratis.event.slug, r1.cuerpo.requestId, await firmarAutorizacion(r1.cuerpo.authEntry, llave));
  assert.equal(r3.status, 410, "hay que empezar de nuevo");
  // empezando de nuevo, sale
  const r4 = await inscripcion(datos, gratis.ticket, await probar(llave));
  const r5 = await firma(gratis.event.slug, r4.cuerpo.requestId, await firmarAutorizacion(r4.cuerpo.authEntry, llave));
  assert.equal(r5.status, 201);
});

test("una prueba firmada por otra cuenta no inscribe a nadie", async () => {
  const llave = Keypair.random();
  const r = await inscripcion({ ...gratis, email: "ajena@example.com" }, gratis.ticket, await probar(llave, { firmaCon: Keypair.random() }));
  assert.deepEqual([r.status, r.cuerpo], [401, { error: "wallet_invalid" }]);
  assert.equal(await repo.getPersonByEmail("ajena@example.com"), null);
  assert.equal(await repo.getWalletLinkByAccount(llave.publicKey()), null);
});

test("una cuenta es de una sola persona y una persona tiene una sola cuenta propia", async () => {
  const llave = Keypair.random();
  const primera = await inscripcion({ ...gratis, email: "carla-propia@example.com" }, gratis.ticket, await probar(llave));
  assert.equal(primera.status, 202);
  // la misma cuenta con otro correo
  const otroCorreo = await inscripcion({ ...gratis, email: "carla-trabajo@example.com" }, gratis.ticket, await probar(llave));
  assert.deepEqual([otroCorreo.status, otroCorreo.cuerpo], [409, { error: "wallet_taken" }]);
  assert.equal(await repo.getPersonByEmail("carla-trabajo@example.com"), null, "ni se crea la persona");
  // el mismo correo con otra cuenta, en otro evento
  const otraCuenta = await inscripcion({ ...pago, email: "carla-propia@example.com" }, pago.ticket, await probar(Keypair.random()));
  assert.deepEqual([otraCuenta.status, otraCuenta.cuerpo], [409, { error: "wallet_mismatch" }]);
  // y sin cuenta propia (el modo de prueba) tampoco: el servidor no puede firmar por ella
  const sinCuenta = await inscripcion({ ...pago, email: "carla-propia@example.com" }, pago.ticket, undefined);
  assert.deepEqual([sinCuenta.status, sinCuenta.cuerpo], [401, { error: "wallet_required" }]);
});

test("la entrada paga: primero la cuenta acepta el USDC de prueba, después recibe saldo y autoriza buy", async () => {
  const llave = Keypair.random();
  const datos = { ...pago, email: "mateo-propia@example.com" };
  const r1 = await inscripcion(datos, pago.ticket, await probar(llave));
  assert.equal(r1.status, 202);
  assert.equal(r1.cuerpo.status, "needs_trustline");
  assert.equal(r1.cuerpo.asset.code, stellar.getTestAsset().code);
  cadena.conLinea.add(llave.publicKey());
  const r2 = await inscripcion(datos, pago.ticket, await probar(llave));
  assert.equal(r2.cuerpo.status, "needs_signature");
  assert.equal(r2.cuerpo.fn, "buy");
  assert.deepEqual(cadena.recargas.at(-1), { cuenta: llave.publicKey(), minimo: 10 });
  const r3 = await firma(pago.event.slug, r2.cuerpo.requestId, await firmarAutorizacion(r2.cuerpo.authEntry, llave));
  assert.equal(r3.status, 201);
  assert.equal(r3.cuerpo.paid, true);
});

test("si la cuenta ya tenía su pase en el contrato, la inscripción termina sin pedir firma", async () => {
  const llave = Keypair.random();
  cadena.yaTiene.add(llave.publicKey());
  const r = await inscripcion({ ...gratis, email: "dora-propia@example.com" }, gratis.ticket, await probar(llave));
  assert.equal(r.status, 201, JSON.stringify(r.cuerpo));
  const pase = await repo.getPass(r.cuerpo.passId);
  assert.deepEqual([pase.status, pase.account, pase.chainNumber], ["active", llave.publicKey(), 42]);
});

test("un pedido de firma de otro evento no vale en esta ruta", async () => {
  const llave = Keypair.random();
  const r1 = await inscripcion({ ...gratis, email: "eva-propia@example.com" }, gratis.ticket, await probar(llave));
  const r2 = await firma(pago.event.slug, r1.cuerpo.requestId, await firmarAutorizacion(r1.cuerpo.authEntry, llave));
  assert.deepEqual([r2.status, r2.cuerpo], [410, { error: "signature_expired" }]);
});

test("con Pollar prendido, quien se inscribe sola tiene que traer su cuenta; con el modo de prueba, no", async () => {
  const antes = { cuentas: process.env.RUMBO_ACCOUNTS, clave: process.env.NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY };
  try {
    process.env.RUMBO_ACCOUNTS = "pollar";
    process.env.NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY = "pk_prueba";
    const sin = await inscripcion({ ...gratis, email: "sin-cuenta@example.com" }, gratis.ticket, undefined);
    assert.deepEqual([sin.status, sin.cuerpo], [401, { error: "wallet_required" }]);
    const con = await inscripcion({ ...gratis, email: "con-cuenta@example.com" }, gratis.ticket, await probar(Keypair.random()));
    assert.equal(con.cuerpo.status, "needs_signature");
    // sin la clave publicable, Pollar no anda en el navegador: queda el modo de prueba
    delete process.env.NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY;
    stellar.rumboPass.register = async () => ({ hash: "h-dev", ledger: 1, returnValue: 7, number: 7 });
    const dePrueba = await inscripcion({ ...gratis, email: "de-prueba@example.com" }, gratis.ticket, undefined);
    assert.equal(dePrueba.status, 201, JSON.stringify(dePrueba.cuerpo));
  } finally {
    for (const [nombre, valor] of [["RUMBO_ACCOUNTS", antes.cuentas], ["NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY", antes.clave]]) {
      if (valor === undefined) delete process.env[nombre];
      else process.env[nombre] = valor;
    }
  }
});
