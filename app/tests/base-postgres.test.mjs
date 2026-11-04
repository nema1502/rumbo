// La base con el motor Postgres: lo que solo pasa ahí (y por eso estas pruebas corren con pnpm test:pg). Los
// secretos guardados van cifrados; sin RUMBO_DATA_KEY la app no arranca; con Postgres no se carga node:sqlite;
// los turnos y los frenos que antes vivían en la memoria de un proceso valen entre instancias; y lo que dos
// pedidos hacen a la vez (el mismo clientId, el mismo correo, el mismo premio) queda una sola vez.
// Las migraciones de Postgres se prueban siempre, con un PGlite propio: no dependen del motor de la corrida.
//
// Lo que estas pruebas no ejercitan: el Postgres local (PGlite, también cuando se sirve por la red) atiende una
// transacción por vez, así que nunca hay dos transacciones abiertas a la par. Las pruebas de "dos pedidos a la
// vez" comprueban el resultado (una sola fila), pero no que un candado como el FOR UPDATE del freno frene de
// verdad a una transacción mientras otra escribe: eso solo se ve contra un Postgres de varias conexiones.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { APP_DIR, MOTOR, entornoDePrueba, eventoDePrueba, paseDePrueba } from "./lib/entorno.mjs";

entornoDePrueba();
const { assertDataConfig, getDb } = await import("../src/server/base/index.ts");
const { plainSecrets } = await import("../src/server/base/cifrado.ts");
const { openPglite } = await import("../src/server/base/pglite.ts");
const { migratePostgres } = await import("../src/server/base/migrar.ts");
const { getRepo } = await import("../src/server/repo.ts");
const { getEventQrKeys } = await import("../src/server/qr-keys.ts");
const { getOrCreateAccessKey } = await import("../src/server/evento/acceso.ts");
const { getPanelState } = await import("../src/server/panel.ts");
const { AttemptLimiter, DbAttemptLimiter } = await import("../src/server/limites.ts");
const { BUSY, LeaseLost, acquireLease, releaseLease, serialized, tryExclusive } = await import("../src/server/compartido.ts");
const { withSponsorLock } = await import("../src/server/stellar.ts");
const stands = await import("../src/server/stands.ts");

const PG = MOTOR !== "sqlite";
const soloPg = PG ? {} : { skip: "solo con el motor Postgres (pnpm test:pg)" };
const repo = getRepo();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIGRACIONES_PG = join(APP_DIR, "src", "server", "migrations-pg");

test("con Postgres no se carga node:sqlite", soloPg, async () => {
  const d = await eventoDePrueba(repo);
  const { pass } = await paseDePrueba(repo, d);
  await getEventQrKeys(d.event.id);
  await getOrCreateAccessKey(pass.id);
  await getPanelState(d.event, repo);
  assert.ok(!process.moduleLoadList.includes("NativeModule sqlite"), "node:sqlite quedó cargado");
});

test("las llaves de los QR y las de las cuentas de prueba se guardan cifradas, cada una atada a su fila", soloPg, async () => {
  const d = await eventoDePrueba(repo);
  const llaves = await getEventQrKeys(d.event.id);
  const fila = await getDb().one("SELECT public_key, private_key, credential_root FROM event_qr_keys WHERE event_id = ?", [d.event.id]);
  // la clave pública va en claro: es lo que recibe el escáner
  assert.deepEqual(Array.from(fila.public_key), Array.from(llaves.publicKey));
  for (const [columna, claro] of [["private_key", llaves.privateKey], ["credential_root", llaves.credentialRoot]]) {
    const guardado = Buffer.from(fila[columna]);
    assert.equal(guardado[0], 1, `${columna}: la versión del cifrado`);
    assert.equal(guardado.length, 1 + 12 + 16 + 32, `${columna}: nonce, etiqueta y los 32 bytes cifrados`);
    assert.ok(!guardado.includes(Buffer.from(claro)), `${columna} no puede estar en claro`);
  }
  assert.deepEqual(Array.from((await getEventQrKeys(d.event.id)).privateKey), Array.from(llaves.privateKey), "vuelve igual");

  // copiada a la fila de otro evento, la llave no se descifra
  const otro = await eventoDePrueba(repo);
  await getEventQrKeys(otro.event.id);
  await getDb().run("UPDATE event_qr_keys SET private_key = ? WHERE event_id = ?", [fila.private_key, otro.event.id]);
  await assert.rejects(getEventQrKeys(otro.event.id), /No se pudo descifrar/);

  const persona = await repo.upsertPerson({ name: "Cuenta Prueba", email: `cuenta-${randomUUID()}@example.com` });
  const secreto = `semilla-de-prueba-${randomUUID()}`;
  await repo.saveDevAccount({ personId: persona.id, publicKey: `G${randomUUID()}`, secretKey: secreto, funded: false });
  const cruda = await getDb().one("SELECT secret_key FROM dev_accounts WHERE person_id = ?", [persona.id]);
  assert.ok(!Buffer.from(cruda.secret_key).toString("latin1").includes("semilla"), "la llave de la cuenta no puede estar en claro");
  assert.equal((await repo.getDevAccount(persona.id)).secretKey, secreto);
});

test("con Postgres, sin RUMBO_DATA_KEY o sin DATABASE_URL la app no arranca, y dice qué falta", async () => {
  const nombres = ["RUMBO_REPO", "DATABASE_URL", "RUMBO_DATA_KEY", "VERCEL"];
  const antes = Object.fromEntries(nombres.map((n) => [n, process.env[n]]));
  const { register } = await import("../src/instrumentation.ts");
  try {
    process.env.RUMBO_REPO = "postgres";
    process.env.DATABASE_URL = "postgres://rumbo@localhost:6543/postgres";
    delete process.env.RUMBO_DATA_KEY;
    assert.throws(() => assertDataConfig(), /Falta RUMBO_DATA_KEY/);
    // lo mismo al levantar el servidor: Next llama a register() una vez por instancia
    process.env.NEXT_RUNTIME = "nodejs";
    await assert.rejects(register(), /Falta RUMBO_DATA_KEY/);
    process.env.RUMBO_DATA_KEY = "corta";
    assert.throws(() => assertDataConfig(), /32 bytes en base64/);
    process.env.RUMBO_DATA_KEY = randomBytes(24).toString("base64");
    assert.throws(() => assertDataConfig(), /32 bytes en base64/);
    process.env.RUMBO_DATA_KEY = randomBytes(32).toString("base64");
    delete process.env.DATABASE_URL;
    assert.throws(() => assertDataConfig(), /Falta DATABASE_URL/);
    process.env.DATABASE_URL = "postgres://rumbo@localhost:6543/postgres";
    assert.equal(assertDataConfig(), "postgres");
    await register();
    // un motor mal escrito no cae en SQLite
    process.env.RUMBO_REPO = "supabase";
    assert.throws(() => assertDataConfig(), /RUMBO_REPO=supabase/);
    // y en Vercel SQLite no sirve: cada instancia tendría su archivo
    process.env.RUMBO_REPO = "sqlite";
    process.env.VERCEL = "1";
    assert.throws(() => assertDataConfig(), /En Vercel la base tiene que ser Postgres/);
  } finally {
    delete process.env.NEXT_RUNTIME;
    for (const n of nombres) {
      if (antes[n] === undefined) delete process.env[n];
      else process.env[n] = antes[n];
    }
  }
});

test("un turno de la base: de a uno, aunque lo pidan varios a la vez", soloPg, async () => {
  let dentro = 0;
  let maximo = 0;
  const trabajo = (n) => async () => {
    dentro++;
    maximo = Math.max(maximo, dentro);
    await sleep(25);
    dentro--;
    return n;
  };
  const opciones = { ttlMs: 5_000, renewMs: 1_000, waitMs: 10_000 };
  const hechos = await Promise.all([1, 2, 3, 4, 5].map((n) => serialized("prueba-fila", trabajo(n), opciones)));
  assert.deepEqual([...hechos].sort(), [1, 2, 3, 4, 5]);
  assert.equal(maximo, 1, "nunca dos a la vez");
  assert.equal(await getDb().one("SELECT 1 AS yes FROM leases WHERE name = 'prueba-fila'"), null, "al terminar, el turno queda libre");

  // sin esperar: mientras uno lo tiene, el otro recibe BUSY
  let soltar;
  const primero = tryExclusive("prueba-tanda", () => new Promise((r) => (soltar = r)));
  while (!(await getDb().one("SELECT 1 AS yes FROM leases WHERE name = 'prueba-tanda'"))) await sleep(5);
  assert.equal(await tryExclusive("prueba-tanda", async () => "no debería correr"), BUSY);
  soltar("listo");
  assert.equal(await primero, "listo");
  assert.equal(await tryExclusive("prueba-tanda", async () => "ahora sí"), "ahora sí");
});

test("el turno de una instancia que se cayó vence solo, y quien lo soltó tarde no le saca el turno al siguiente", soloPg, async () => {
  // otra instancia tomó el turno y se cayó: no lo renueva más
  const caida = await acquireLease(getDb(), "prueba-caida", 300);
  assert.ok(caida);
  const desde = Date.now();
  const hecho = await serialized("prueba-caida", async () => "después", { ttlMs: 5_000, renewMs: 1_000, waitMs: 5_000 });
  assert.equal(hecho, "después");
  assert.ok(Date.now() - desde >= 250, "esperó a que venciera");

  const vieja = await acquireLease(getDb(), "prueba-tarde", 50);
  await sleep(80);
  const nueva = await acquireLease(getDb(), "prueba-tarde", 5_000);
  assert.ok(nueva && nueva !== vieja, "vencido, lo toma otra");
  await releaseLease(getDb(), "prueba-tarde", vieja);
  assert.equal((await getDb().one("SELECT holder FROM leases WHERE name = 'prueba-tarde'")).holder, nueva, "soltar con la ficha vieja no hace nada");
});

test("la cuenta patrocinadora: si otra instancia tiene el turno, esta espera a que lo suelte para mandar", soloPg, async () => {
  const otra = await acquireLease(getDb(), "sponsor", 30_000);
  assert.ok(otra, "la otra instancia tiene el turno");
  let mando = false;
  const envio = withSponsorLock(async () => {
    mando = true;
    return "enviada";
  });
  await sleep(400);
  assert.equal(mando, false, "con el turno de otra instancia, no manda");
  await releaseLease(getDb(), "sponsor", otra);
  assert.equal(await envio, "enviada");
  assert.equal(mando, true);
});

test("el freno en la base cuenta igual que el de la memoria", soloPg, async () => {
  const minuto = 60_000;
  const limites = { windowMs: 10 * minuto, perKey: 3, global: 6, lockMs: 10 * minuto, maxLockMs: 40 * minuto, forgetMs: 60 * minuto };
  let reloj = Date.parse("2026-11-22T12:00:00.000Z");
  const memoria = new AttemptLimiter(limites, () => reloj);
  const base = new DbAttemptLimiter(`paridad-${randomUUID()}`, limites, getDb, () => reloj);
  const claves = ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"];
  const comparar = async (cuando) => {
    for (const k of claves) assert.equal(await base.blockedFor(k), memoria.blockedFor(k), `${cuando}: ${k}`);
  };
  const intento = async (k) => {
    memoria.note(k);
    await base.note(k);
  };
  // una IP que prueba de más: freno, y el freno siguiente dura el doble, hasta el tope
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    for (let i = 0; i < 3; i++) await intento(claves[0]);
    await comparar(`freno ${vuelta + 1}`);
    reloj += memoria.blockedFor(claves[0]) + 1;
  }
  // muchas IP a la vez encienden la alarma global; quien no falló nunca sigue entrando
  for (const k of claves.slice(1)) {
    await intento(k);
    await intento(k);
  }
  await comparar("alarma global");
  reloj += 11 * minuto;
  await comparar("pasada la ventana");
  // después de una hora sin intentos, la clave se olvida (y con ella el freno creciente)
  reloj += 2 * 60 * minuto;
  for (let i = 0; i < 3; i++) await intento(claves[0]);
  await comparar("olvidada");
});

test("el freno en la base no pierde intentos cuando llegan todos juntos", soloPg, async () => {
  const freno = new DbAttemptLimiter(`juntos-${randomUUID()}`, { windowMs: 600_000, perKey: 8, global: 1_000, lockMs: 600_000, maxLockMs: 600_000, forgetMs: 3_600_000 });
  await Promise.all(Array.from({ length: 7 }, () => freno.note("200.1.1.1")));
  assert.equal(await freno.blockedFor("200.1.1.1"), 0, "siete no frenan");
  await freno.note("200.1.1.1");
  assert.ok((await freno.blockedFor("200.1.1.1")) > 0, "el octavo frena: no se perdió ninguno");
});

test("lo que llega dos veces a la vez queda una sola vez: el clientId, el correo, el equipo y el premio de la ruta", soloPg, async () => {
  const d = await eventoDePrueba(repo);
  const { pass } = await paseDePrueba(repo, d);
  const entradas = await Promise.all(Array.from({ length: 5 }, () => repo.recordCheckIn({ clientId: "a-la-vez", eventId: d.event.id, passId: pass.id, scannerId: "x" })));
  assert.equal(new Set(entradas.map((c) => c.id)).size, 1);
  assert.equal((await repo.listCheckInsForPass(pass.id)).length, 1);

  const correo = `doble-${randomUUID()}@example.com`;
  const personas = await Promise.all(Array.from({ length: 5 }, () => repo.upsertPerson({ name: "Doble Prueba", email: correo })));
  assert.equal(new Set(personas.map((p) => p.id)).size, 1);

  const equipos = await Promise.all(["Los Rápidos", "los rápidos", "LOS RÁPIDOS", "Los Rápidos "].map((nombre) => repo.createTeam(d.event.id, nombre)));
  assert.equal(new Set(equipos.map((e) => e.team.id)).size, 1);
  assert.equal(equipos.filter((e) => e.created).length, 1);

  const premio = await repo.createBenefit({ eventId: d.event.id, name: "Premio de la ruta", kind: "prize", station: "Premios" });
  await repo.grantBenefit(pass.id, premio.id, "manual");
  const [uno, dos] = await Promise.all(["premio-1", "premio-2"].map((clientId) => repo.recordRedemption({ clientId, eventId: d.event.id, passId: pass.id, benefitId: premio.id, scannerId: "x" })));
  const ganados = await Promise.all([stands.claimRoutePrize(uno.id), stands.claimRoutePrize(dos.id)]);
  assert.deepEqual([...ganados].sort(), [false, true], "uno solo gana el premio");
});

test("si el turno se pierde a mitad del trabajo, quien lo pidió recibe LeaseLost en vez de un resultado, y el siguiente puede tomarlo", soloPg, async () => {
  const opciones = { ttlMs: 400, renewMs: 50, waitMs: 5_000 };
  let terminoA = false;
  const a = serialized(
    "prueba-perdido",
    async () => {
      await sleep(700);
      terminoA = true;
      return "A";
    },
    opciones,
  );
  // Mientras A trabaja, su turno desaparece (venció sin renovarse y otra instancia lo tomó: acá, se borra la fila).
  await sleep(120);
  await getDb().run("DELETE FROM leases WHERE name = 'prueba-perdido'");
  await assert.rejects(a, (error) => error instanceof LeaseLost && /prueba-perdido/.test(error.message));
  assert.equal(terminoA, false, "se avisó enseguida, sin esperar a que A terminara");
  // El trabajo que sigue corriendo no le saca el turno a quien lo tomó después.
  const b = await serialized("prueba-perdido", async () => "B", opciones);
  assert.equal(b, "B");
  await sleep(700);
  assert.equal(await getDb().one("SELECT 1 AS yes FROM leases WHERE name = 'prueba-perdido'"), null, "al final, libre");
});

test("el turno se mide con el reloj de la base: tomarlo, renovarlo y vencer no dependen de la hora de la instancia", soloPg, async () => {
  const ficha = await acquireLease(getDb(), "prueba-reloj", 5_000);
  assert.ok(ficha);
  const fila = await getDb().one("SELECT expires_at, now() AS ahora FROM leases WHERE name = 'prueba-reloj'");
  const restante = Date.parse(fila.expires_at) - Date.parse(fila.ahora);
  assert.ok(restante > 4_000 && restante <= 5_000, `vence en ${restante} ms según la base`);
  await releaseLease(getDb(), "prueba-reloj", ficha);
});

test("un NUL en un texto no corta nada: Postgres no lo guarda, y la capa de datos lo saca antes de mandarlo", soloPg, async () => {
  const persona = await repo.upsertPerson({ name: "Caro\u0000Tres", email: `caro-nul-${randomUUID()}@example.com` });
  assert.equal(persona.name, "CaroTres");
  const d = await eventoDePrueba(repo);
  const { pass } = await paseDePrueba(repo, d);
  const entrada = await repo.recordCheckIn({ clientId: "nul\u0000-1", eventId: d.event.id, passId: pass.id, scannerId: "p\u0000uerta" });
  assert.deepEqual([entrada.clientId, entrada.scannerId], ["nul-1", "puerta"]);
});

test("la 012 cierra para la API de Supabase las funciones y las secuencias que vengan después", async () => {
  // Una base con los roles de la API y los permisos por omisión que trae un proyecto de Supabase, antes de migrar.
  const sinMigraciones = mkdtempSync(join(tmpdir(), "rumbo-sin-migraciones-"));
  const db = await pgliteCon(sinMigraciones);
  try {
    await db.exec(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    `);
    await migratePostgres(db, MIGRACIONES_PG);
    // Lo que una migración futura agregaría sin acordarse de los permisos: una función que lee personas y una secuencia.
    await db.exec("CREATE FUNCTION public.cuantas_personas() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*) FROM persons $$; CREATE SEQUENCE public.numero_seq;");
    const como = async (rol, sql) => {
      await db.exec(`SET ROLE ${rol}`);
      try {
        await db.one(sql);
        return "puede";
      } catch {
        return "no puede";
      } finally {
        await db.exec("RESET ROLE");
      }
    };
    assert.equal(await como("anon", "SELECT public.cuantas_personas() AS n"), "no puede", "anon no ejecuta una función nueva");
    assert.equal(await como("authenticated", "SELECT public.cuantas_personas() AS n"), "no puede");
    assert.equal(await como("anon", "SELECT nextval('public.numero_seq') AS n"), "no puede", "anon no usa una secuencia nueva");
    assert.equal(await como("anon", "SELECT * FROM persons"), "no puede", "y las tablas siguen cerradas (011)");
    assert.equal(await como("service_role", "SELECT public.cuantas_personas() AS n"), "puede", "la llave de servicio sigue pudiendo");
    assert.equal(await como("anon", "SELECT 1 AS uno"), "puede", "anon sigue existiendo para lo suyo");
  } finally {
    await db.close();
  }
});

/** Una base PGlite propia, en memoria, con las migraciones de `dir` (todas, si no se dice). */
async function pgliteCon(dir = MIGRACIONES_PG) {
  const antes = process.env.RUMBO_PG_MIGRATIONS_DIR;
  process.env.RUMBO_PG_MIGRATIONS_DIR = dir;
  const db = openPglite(null, plainSecrets);
  try {
    await db.one("SELECT 1 AS yes");
  } finally {
    if (antes === undefined) delete process.env.RUMBO_PG_MIGRATIONS_DIR;
    else process.env.RUMBO_PG_MIGRATIONS_DIR = antes;
  }
  return db;
}

test("las migraciones de Postgres: en orden, una sola vez, y la 005 borra los códigos de ocho letras", async () => {
  const todas = readdirSync(MIGRACIONES_PG).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(todas.length >= 11, "las nueve de SQLite y las de Postgres");
  for (const f of readdirSync(join(APP_DIR, "src", "server", "migrations")).filter((f) => f.endsWith(".sql"))) {
    assert.ok(todas.includes(f), `${f} tiene su traducción a Postgres`);
  }
  // una base con las de antes de los códigos largos, y un código viejo adentro
  const viejas = mkdtempSync(join(tmpdir(), "rumbo-migraciones-pg-"));
  for (const f of todas.filter((f) => f < "005")) copyFileSync(join(MIGRACIONES_PG, f), join(viejas, f));
  const db = await pgliteCon(viejas);
  try {
    await db.run(
      "INSERT INTO events (id, slug, name, starts_at, place, organizer_name, qr_key, created_at) VALUES ('evento-viejo', 'viejo', 'Viejo', '2026-11-22T09:00:00-04:00', 'Santa Cruz', 'La comunidad', ?, ?)",
      [new Uint8Array([1, 2]), new Date().toISOString()],
    );
    await db.run("INSERT INTO station_codes (code, event_id, kind, benefit_id, created_at) VALUES ('ABCDEFGH', 'evento-viejo', 'gate', NULL, ?)", [new Date().toISOString()]);
    const informe = await migratePostgres(db, MIGRACIONES_PG);
    assert.deepEqual(informe.applied, todas.filter((f) => f >= "005"));
    assert.equal((await db.one("SELECT COUNT(*) AS n FROM station_codes")).n, 0, "el código de ocho letras ya no está");
    assert.equal((await db.one("SELECT slug FROM events WHERE id = 'evento-viejo'")).slug, "viejo", "el evento queda");
    assert.equal(await db.one("SELECT 1 AS yes FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'qr_key'"), null, "la llave compartida de antes se fue");
    // otra vez: nada que aplicar
    const otraVez = await migratePostgres(db, MIGRACIONES_PG);
    assert.deepEqual([otraVez.applied, otraVez.skipped.length], [[], todas.length]);
    assert.equal((await db.one("SELECT COUNT(*) AS n FROM schema_migrations")).n, todas.length);
  } finally {
    await db.close();
  }
});

test("las restricciones de SQLite valen en Postgres, con sus tipos, y el acceso por fila queda prendido", async () => {
  const db = await pgliteCon();
  const ahora = new Date().toISOString();
  try {
    const tipo = async (tabla, columna) => (await db.one("SELECT data_type FROM information_schema.columns WHERE table_name = ? AND column_name = ?", [tabla, columna]))?.data_type;
    assert.equal(await tipo("passes", "created_at"), "timestamp with time zone");
    assert.equal(await tipo("redemptions", "duplicate"), "boolean");
    assert.equal(await tipo("event_qr_keys", "private_key"), "bytea");
    assert.equal(await tipo("dev_accounts", "secret_key"), "bytea");
    assert.equal(await tipo("chain_syncs", "summary"), "jsonb");

    await db.run("INSERT INTO events (id, slug, name, starts_at, place, organizer_name, created_at) VALUES ('e1', 'uno', 'Uno', ?, 'Santa Cruz', 'La comunidad', ?)", [ahora, ahora]);
    await db.run("INSERT INTO ticket_types (id, event_id, name) VALUES ('t1', 'e1', 'Inscripción')");
    await db.run("INSERT INTO benefits (id, event_id, name, kind) VALUES ('b1', 'e1', 'Almuerzo', 'lunch')");
    await db.run("INSERT INTO persons (id, name, email, created_at) VALUES ('p1', 'Ana', 'ana@example.com', ?)", [ahora]);
    await db.run("INSERT INTO passes (id, event_id, person_id, ticket_type_id, status, created_at) VALUES ('AAAAAAA2', 'e1', 'p1', 't1', 'active', ?)", [ahora]);
    const falla = (sql, params, porque) => assert.rejects(db.run(sql, params), undefined, porque);
    await falla("INSERT INTO persons (id, name, email, created_at) VALUES ('p2', 'Otra', 'ana@example.com', ?)", [ahora], "un correo, una persona");
    await falla("INSERT INTO passes (id, event_id, person_id, ticket_type_id, status, created_at) VALUES ('AAAAAAA3', 'e1', 'p1', 't1', 'active', ?)", [ahora], "una credencial por persona y evento");
    await db.run("INSERT INTO pass_benefits (pass_id, benefit_id, source, granted_at) VALUES ('AAAAAAA2', 'b1', 'ticket', ?)", [ahora]);
    await falla("INSERT INTO pass_benefits (pass_id, benefit_id, source, granted_at) VALUES ('AAAAAAA2', 'b1', 'manual', ?)", [ahora], "un beneficio por pase");
    await db.run("INSERT INTO redemptions (id, client_id, event_id, pass_id, benefit_id, scanned_at, created_at) VALUES ('r1', 'c-1', 'e1', 'AAAAAAA2', 'b1', ?, ?)", [ahora, ahora]);
    await falla("INSERT INTO redemptions (id, client_id, event_id, pass_id, benefit_id, scanned_at, created_at) VALUES ('r2', 'c-1', 'e1', 'AAAAAAA2', 'b1', ?, ?)", [ahora, ahora], "un clientId, un registro");
    await falla("INSERT INTO passes (id, event_id, person_id, ticket_type_id, status, created_at) VALUES ('AAAAAAA4', 'e1', 'p1', 't1', 'perdido', ?)", [ahora], "el estado del pase es uno de tres");
    await db.run("INSERT INTO station_codes (code, event_id, kind, created_at) VALUES ('AAAABBBBCCCC', 'e1', 'gate', ?)", [ahora]);
    await falla("INSERT INTO station_codes (code, event_id, kind, created_at) VALUES ('DDDDEEEEFFFF', 'e1', 'gate', ?)", [ahora], "una puerta por evento");
    await db.run("INSERT INTO stands (id, event_id, name, created_at) VALUES ('s1', 'e1', 'Acme', ?)", [ahora]);
    await db.run("INSERT INTO station_codes (code, event_id, kind, stand_id, created_at) VALUES ('GGGGHHHHJJJJ', 'e1', 'stand', 's1', ?)", [ahora]);
    await db.run("INSERT INTO stand_visits (id, stand_id, event_id, pass_id, scanned_at, created_at) VALUES ('v1', 's1', 'e1', 'AAAAAAA2', ?, ?)", [ahora, ahora]);
    await falla("INSERT INTO stand_visits (id, stand_id, event_id, pass_id, scanned_at, created_at) VALUES ('v2', 's1', 'e1', 'AAAAAAA2', ?, ?)", [ahora, ahora], "un sello por persona y stand");
    await falla("UPDATE stand_visits SET rating = 6 WHERE id = 'v1'", [], "la calificación va de 1 a 5");
    await db.run("INSERT INTO teams (id, event_id, name, created_at) VALUES ('q1', 'e1', 'Los Rápidos', ?)", [ahora]);
    await falla("INSERT INTO teams (id, event_id, name, created_at) VALUES ('q2', 'e1', 'los rápidos', ?)", [ahora], "el nombre del equipo no se repite, sin importar mayúsculas");
    await falla("DELETE FROM ticket_types WHERE id = 't1'", [], "una entrada con credenciales no se borra");

    const sinReglas = await db.all("SELECT relname FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND NOT relrowsecurity");
    assert.deepEqual(sinReglas, [], "todas las tablas con el acceso por fila prendido");
  } finally {
    await db.close();
  }
});

test("PGlite con carpeta: los datos quedan al cerrar, y al volver a abrir no se migra de nuevo", async () => {
  const carpeta = mkdtempSync(join(tmpdir(), "rumbo-pglite-"));
  const ahora = new Date().toISOString();
  let db = openPglite(carpeta, plainSecrets);
  await db.run("INSERT INTO persons (id, name, email, created_at) VALUES ('p1', 'Ana', 'ana@example.com', ?)", [ahora]);
  await db.close();
  db = openPglite(carpeta, plainSecrets);
  try {
    assert.equal((await db.one("SELECT name FROM persons WHERE id = 'p1'")).name, "Ana");
    const aplicadas = await db.all("SELECT name FROM schema_migrations");
    assert.equal(aplicadas.length, readdirSync(MIGRACIONES_PG).filter((f) => f.endsWith(".sql")).length);
  } finally {
    await db.close();
  }
});
