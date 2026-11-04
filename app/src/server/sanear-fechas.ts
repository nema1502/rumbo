// Las lecturas del espejo con una hora que no existe o de antes del año 2000 (ver MIN_YEAR en src/lib/fecha-iso.ts):
// listarlas y borrarlas. Una fila así, guardada antes de que el servidor validara la hora de cada lectura, rompía
// la lectura de todo el evento con Postgres (el driver no sabe leer un año de menos de cien) y la pantalla con
// SQLite. Lo usa scripts/sanear-fechas.mjs; las pruebas lo llaman directo, en los tres motores.
import { isRealIsoDate } from "../lib/fecha-iso.ts";
import type { Db, Row } from "./base/index.ts";

/** Las tablas del espejo con una hora de lectura. */
export const SCANNED_TABLES = ["checkins", "redemptions", "stand_visits"] as const;
export type ScannedTable = (typeof SCANNED_TABLES)[number];

/** Desde cuándo vale una lectura: el primer instante de MIN_YEAR. */
const SINCE = "2000-01-01T00:00:00Z";

export interface BadDateRow {
  id: string;
  clientId: string | null;
  scannedAt: string;
}

/**
 * Las filas malas de una tabla. Con Postgres la fecha siempre existe (es un timestamptz), así que alcanza con mirar
 * el año, y se lee como texto para que el driver no tenga que convertirla; con SQLite es texto libre y se mira acá,
 * con la misma regla que valida cada lectura.
 */
export async function listBadScannedAt(db: Db, table: ScannedTable): Promise<BadDateRow[]> {
  const rows: Row[] =
    db.dialect === "postgres"
      ? await db.all(`SELECT id, client_id, scanned_at::text AS scanned_at FROM ${table} WHERE scanned_at < CAST(? AS timestamptz) ORDER BY id`, [SINCE])
      : (await db.all(`SELECT id, client_id, scanned_at FROM ${table} ORDER BY id`)).filter((r) => !isRealIsoDate(String(r.scanned_at)));
  return rows.map((r) => ({ id: String(r.id), clientId: r.client_id === null || r.client_id === undefined ? null : String(r.client_id), scannedAt: String(r.scanned_at) }));
}

/** Las credenciales cuya hora de entrada quedó así (la puso una lectura mala). */
export async function listBadCheckedInAt(db: Db): Promise<Array<{ id: string; checkedInAt: string }>> {
  const rows: Row[] =
    db.dialect === "postgres"
      ? await db.all("SELECT id, checked_in_at::text AS checked_in_at FROM passes WHERE checked_in_at < CAST(? AS timestamptz) ORDER BY id", [SINCE])
      : (await db.all("SELECT id, checked_in_at FROM passes WHERE checked_in_at IS NOT NULL ORDER BY id")).filter((r) => !isRealIsoDate(String(r.checked_in_at)));
  return rows.map((r) => ({ id: String(r.id), checkedInAt: String(r.checked_in_at) }));
}

/** Borra las filas malas de la tabla y devuelve cuántas. */
export async function deleteBadScannedAt(db: Db, table: ScannedTable): Promise<number> {
  const bad = await listBadScannedAt(db, table);
  for (const row of bad) await db.run(`DELETE FROM ${table} WHERE id = ?`, [row.id]);
  return bad.length;
}

/** Deja en blanco la hora de entrada mala de cada credencial (la credencial sigue entrada) y devuelve cuántas. */
export async function clearBadCheckedInAt(db: Db): Promise<number> {
  const bad = await listBadCheckedInAt(db);
  for (const row of bad) await db.run("UPDATE passes SET checked_in_at = NULL WHERE id = ?", [row.id]);
  return bad.length;
}
