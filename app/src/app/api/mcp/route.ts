// POST /api/mcp: el servidor MCP de Rumbo por HTTP (Streamable HTTP), para el asistente que habla con un Rumbo
// desplegado. Sin estado: cada pedido arma su servidor, lo contesta en JSON y lo cierra, porque en Vercel cada pedido
// puede caer en otra instancia. La clave de organizador va en la cabecera Authorization: Bearer <clave> (o en el
// argumento organizer_key de cada herramienta); la clave de la casa, si hace falta para crear eventos, en
// X-Rumbo-Create-Key (o en create_key). Sin cabeceras sirve igual para descubrir las herramientas y para lo público:
// las plantillas y un evento publicado. Las herramientas están en src/server/mcp.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse, type NextRequest } from "next/server";
import { createRumboMcpServer } from "@/server/mcp/servidor.ts";
import { langOfRequest, originOfRequest } from "@/server/pedido.ts";

export const dynamic = "force-dynamic";

function bearer(request: NextRequest): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1]?.trim() || null;
}

export async function POST(request: NextRequest): Promise<Response> {
  const server = createRumboMcpServer({
    organizerKey: bearer(request),
    createKey: request.headers.get("x-rumbo-create-key")?.trim() || null,
    lang: langOfRequest(request),
    origin: originOfRequest(request),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // La respuesta ya está armada (es JSON, no un flujo): el servidor de este pedido se cierra.
    void server.close().catch(() => undefined);
  }
}

/** Sin sesiones no hay flujo de eventos que abrir (GET) ni sesión que cerrar (DELETE). */
function onlyPost(): Response {
  return NextResponse.json({ error: "method_not_allowed", hint: "This endpoint speaks MCP over Streamable HTTP without sessions: send JSON-RPC with POST." }, { status: 405, headers: { Allow: "POST" } });
}

export function GET(): Response {
  return onlyPost();
}

export function DELETE(): Response {
  return onlyPost();
}
