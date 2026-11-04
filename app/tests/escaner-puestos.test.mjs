// El código de un puesto ya no es una capacidad para siempre: vence un día después del final del evento (o un día y
// medio después del inicio si no tiene final) y el escáner contesta "vencido" sin contarlo como intento; y quien
// organiza cambia cualquier código desde el panel, con lo que el viejo (y la sesión de cualquier celular que lo
// tuviera abierto) deja de servir en el acto. Sin red.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { entornoDePrueba, eventoDePrueba, paseDePrueba, pedido, qrImpreso } from "./lib/entorno.mjs";

entornoDePrueba();
process.env.RUMBO_TRUSTED_IP_HEADER = "x-real-ip";
const { getRepo } = await import("../src/server/repo.ts");
const { getDb } = await import("../src/server/base/index.ts");
const { ensureStationCodes, resolveStationCode, regenerateStationCode, getOrCreateOrganizerKey } = await import("../src/server/panel.ts");
const { stationCodeAttempts } = await import("../src/server/limites.ts");
const { STATION_CODE_GRACE_MS, STATION_CODE_NO_END_MS, stationCodesExpireAt, stationCodesExpired } = await import("../src/lib/station-code.ts");
const { createStand, authorizeStandCode } = await import("../src/server/stands.ts");
const rutas = {
  open: (await import("../src/app/api/scan/open/route.ts")).POST,
  sync: (await import("../src/app/api/scan/sync/route.ts")).POST,
  puestos: (await import("../src/app/api/admin/[slug]/puestos/route.ts")).POST,
};

const repo = getRepo();
const ctx = (params) => ({ params: Promise.resolve(params) });
const llamar = async (ruta, body, ip = "200.1.1.1") => {
  const res = await rutas[ruta](await pedido(`http://localhost/api/scan/${ruta}`, { body, ip }));
  return { status: res.status, cuerpo: await res.json() };
};
const HORA = 3_600_000;

beforeEach(async () => {
  await stationCodeAttempts().clear();
});

test("los códigos vencen un día después del final del evento, o un día y medio después del inicio si no tiene final", () => {
  const conFinal = { startsAt: "2026-11-22T09:00:00-04:00", endsAt: "2026-11-22T18:00:00-04:00" };
  assert.equal(stationCodesExpireAt(conFinal), Date.parse(conFinal.endsAt) + STATION_CODE_GRACE_MS);
  assert.equal(stationCodesExpired(conFinal, Date.parse("2026-11-23T21:59:00Z")), false);
  assert.equal(stationCodesExpired(conFinal, Date.parse("2026-11-23T22:00:00Z")), true);
  const sinFinal = { startsAt: "2026-11-22T09:00:00-04:00", endsAt: null };
  assert.equal(stationCodesExpireAt(sinFinal), Date.parse(sinFinal.startsAt) + STATION_CODE_NO_END_MS);
  assert.equal(stationCodesExpired(sinFinal, Date.parse("2026-11-23T20:00:00Z")), false);
  assert.equal(stationCodesExpired(sinFinal, Date.parse("2026-11-24T01:00:00Z")), true);
  assert.equal(stationCodesExpired({ startsAt: "ayer", endsAt: null }), false, "sin fechas que se puedan leer, no vencen");
});

test("un código de un evento que terminó hace un mes no abre el escáner ni sincroniza, contesta vencido y no cuenta como intento", async () => {
  const d = await eventoDePrueba(repo);
  const codigos = await ensureStationCodes(d.event, repo);
  const puerta = codigos.find((c) => c.kind === "gate").code;
  const nunca = await paseDePrueba(repo, d, { name: "Nunca Vino" });
  // Con el evento vigente, abre, y la sesión sirve.
  const abierto = await llamar("open", { code: puerta, scannerId: "celu" });
  assert.equal(abierto.status, 200);
  const token = abierto.cuerpo.session.token;
  // El evento terminó hace un mes.
  const hace = (h) => new Date(Date.now() - h * HORA).toISOString();
  await getDb().run("UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?", [hace(24 * 31 + 9), hace(24 * 31), d.event.id]);
  for (let i = 0; i < 12; i++) {
    const r = await llamar("open", { code: puerta, scannerId: "celu" });
    assert.deepEqual([r.status, r.cuerpo], [401, { error: "expired" }]);
  }
  const conSesion = await llamar("sync", { token, items: [{ clientId: "tarde-1", action: "checkin", passId: nunca.pass.id, benefitId: null, scannedAt: hace(24 * 31 + 2), scannerId: "celu", qr: await qrImpreso(d.event.id, nunca.pass.id) }] });
  assert.deepEqual([conSesion.status, conSesion.cuerpo], [401, { error: "expired" }]);
  assert.equal((await repo.listCheckInsForPass(nunca.pass.id)).length, 0, "no queda constancia de una entrada que no pasó");
  assert.equal(await stationCodeAttempts().blockedFor("200.1.1.1"), 0, "los intentos con el código bueno no cuentan");
  // Un día antes de vencer, todavía abre: la cola que subió tarde entra.
  await getDb().run("UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?", [hace(30), hace(20), d.event.id]);
  assert.equal((await llamar("open", { code: puerta, scannerId: "celu" })).status, 200);
  // El panel de un stand no vence con el escáner: quien auspicia baja sus contactos después del evento.
  const stand = await createStand(d.event, { name: "Acme" }, repo);
  const codigoStand = (await ensureStationCodes(d.event, repo)).find((c) => c.kind === "stand" && c.standId === stand.id).code;
  await getDb().run("UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?", [hace(24 * 31 + 9), hace(24 * 31), d.event.id]);
  assert.equal((await authorizeStandCode(codigoStand, { get: () => null }, repo)).ok, true);
});

test("quien organiza cambia cualquier código desde el panel: el nuevo abre, el viejo y su sesión dejan de abrir, y el puesto es el mismo", async () => {
  const d = await eventoDePrueba(repo);
  await createStand(d.event, { name: "Acme" }, repo);
  const codigos = await ensureStationCodes(d.event, repo);
  const clave = await getOrCreateOrganizerKey(d.event.id);
  const cambiar = async (slug, body) => {
    const res = await rutas.puestos(await pedido(`http://localhost/api/admin/${slug}/puestos?k=${clave}`, { body }), ctx({ slug }));
    return { status: res.status, cuerpo: await res.json() };
  };
  for (const viejo of codigos) {
    const sesion = (await llamar("open", { code: viejo.code, scannerId: "celu" })).cuerpo.session.token;
    const r = await cambiar(d.event.slug, { code: viejo.code.toLowerCase() });
    assert.equal(r.status, 200, viejo.kind);
    const nuevo = r.cuerpo.code;
    assert.ok(/^[A-Z2-7]{12}$/.test(nuevo) && nuevo !== viejo.code);
    assert.equal(await resolveStationCode(viejo.code, repo), null, "el viejo no abre");
    const acceso = await resolveStationCode(nuevo, repo);
    assert.deepEqual([acceso.kind, acceso.benefit?.id ?? null, acceso.stand?.id ?? null], [viejo.kind, viejo.benefitId, viejo.standId], "el mismo puesto");
    assert.deepEqual((await llamar("sync", { token: sesion, items: [] })).status, 401, "la sesión abierta con el viejo se cierra con él");
    assert.equal((await llamar("open", { code: nuevo, scannerId: "celu" })).status, 200);
    const enPanel = r.cuerpo.state.stations.find((s) => s.kind === viejo.kind && s.benefitId === viejo.benefitId && s.standId === viejo.standId);
    assert.equal(enPanel.code, nuevo, "el panel ya muestra el nuevo");
  }
  assert.equal((await ensureStationCodes(d.event, repo)).length, codigos.length, "ni uno más ni uno menos");
  // Un código de otro evento, o uno que no existe, no se toca con esta clave; y un cuerpo sin código es un pedido malo.
  const otro = await eventoDePrueba(repo);
  const ajeno = (await ensureStationCodes(otro.event, repo)).find((c) => c.kind === "gate").code;
  assert.equal((await cambiar(d.event.slug, { code: ajeno })).status, 404);
  assert.ok(await resolveStationCode(ajeno, repo), "el del otro evento sigue");
  assert.equal((await cambiar(d.event.slug, { code: "ZZZZZZZZZZZZ" })).status, 404);
  assert.equal((await cambiar(d.event.slug, {})).status, 400);
  assert.equal((await cambiar(d.event.slug, null)).status, 400);
  // Sin la clave del panel, nada.
  const sinClave = await rutas.puestos(await pedido(`http://localhost/api/admin/${d.event.slug}/puestos`, { body: { code: ajeno } }), ctx({ slug: d.event.slug }));
  assert.equal(sinClave.status, 401);
  assert.equal(await regenerateStationCode(d.event, "no-es-un-codigo", repo), null);
});
