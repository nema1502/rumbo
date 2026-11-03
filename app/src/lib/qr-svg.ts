// Dibuja el QR de una credencial como SVG. Sirve en el servidor (la exportación) y en el navegador.
import qrcode from "qrcode-generator";

export interface QrSvgOptions {
  /** El tamaño de cada módulo, en unidades del SVG. */
  cellSize?: number;
  /** El margen blanco alrededor, en módulos. La marca pide al menos dos. */
  margin?: number;
}

/** El QR como etiqueta <svg> escalable (con viewBox, sin ancho fijo). */
export function renderQrSvg(payload: string, { cellSize = 4, margin = 2 }: QrSvgOptions = {}): string {
  const qr = qrcode(0, "M");
  qr.addData(payload, "Alphanumeric");
  qr.make();
  return qr.createSvgTag({ cellSize, margin, scalable: true });
}

/** La matriz de módulos (true es oscuro), por si se quiere dibujar con otra cosa. */
export function renderQrMatrix(payload: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(payload, "Alphanumeric");
  qr.make();
  const size = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}
