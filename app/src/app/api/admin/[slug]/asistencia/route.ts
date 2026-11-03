// GET /api/admin/<evento>/asistencia: la asistencia del evento como un CSV en la forma de Bevy, con la columna
// `Attended`, para devolver la lista a la plataforma donde se inscribió la gente. Pide la clave de organizador.
import { NextResponse, type NextRequest } from "next/server";
import { buildAttendanceCsv } from "@/server/kit/asistencia.ts";
import { authorizePanelRequest } from "@/server/panel-sesion.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { slug } = await params;
  const auth = await authorizePanelRequest(request, slug);
  if (auth.response) return auth.response;
  const csv = await buildAttendanceCsv(auth.event);
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-asistencia-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
