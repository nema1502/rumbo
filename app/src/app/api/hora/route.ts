// GET /api/hora: la hora del servidor, en milisegundos. La credencial del celular la usa para corregir su
// reloj si está desfasado, así el QR que rota sale con la ventana de tiempo que el escáner espera.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
