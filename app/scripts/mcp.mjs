#!/usr/bin/env node
// El servidor MCP de Rumbo por stdio: para el asistente que corre en la máquina de quien organiza (el de escritorio,
// el de la terminal o el del editor), que levanta este proceso y le habla por la entrada y la salida estándar. No tiene
// lógica propia: es un puente hacia el servidor MCP que vive en la app (POST /api/mcp) de tu propio Rumbo, el de
// pnpm dev o el desplegado. Así las herramientas existen en un solo lugar, al lado del código del servidor, y la clave
// de quien organiza viaja solo entre esta máquina y ese servidor.
//
//   RUMBO_BASE_URL        dónde está tu Rumbo (http://localhost:3000 si no se dice)
//   RUMBO_ORGANIZER_KEY   la clave de organizador de tu evento, la del enlace del panel (?k=). Opcional: cada
//                         herramienta la acepta también como argumento organizer_key
//   RUMBO_CREATE_KEY      la clave de la casa, si ese servidor la pide para crear eventos. Opcional
//   --base, --key, --create-key   lo mismo, por argumentos
//
// Uso: pnpm mcp (desde app/), o node scripts/mcp.mjs desde donde sea. Todo lo que no es protocolo sale por stderr:
// stdout es solo para el asistente.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = option("--base", process.env.RUMBO_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const KEY = option("--key", process.env.RUMBO_ORGANIZER_KEY || "");
const CREATE_KEY = option("--create-key", process.env.RUMBO_CREATE_KEY || "");
const ENDPOINT = new URL("/api/mcp", `${BASE}/`);
/** Publicar un evento o preparar una tanda de credenciales tarda minutos en la red de prueba. */
const TIMEOUT_MS = 15 * 60_000;
const VERSION = "0.1.0";

const log = (message) => process.stderr.write(`[rumbo-mcp] ${message}\n`);
const describe = (error) => (error instanceof Error ? error.message : String(error));

const headers = {};
if (KEY) headers.Authorization = `Bearer ${KEY}`;
if (CREATE_KEY) headers["X-Rumbo-Create-Key"] = CREATE_KEY;

// ---------- El Rumbo de verdad, por HTTP ----------

let remote = null;

async function connectRemote() {
  const client = new Client({ name: "rumbo-stdio-bridge", version: VERSION });
  await client.connect(new StreamableHTTPClientTransport(ENDPOINT, { requestInit: { headers } }));
  return client;
}

/** Corre fn con el cliente remoto; si la conexión se cayó (el servidor se reinició), vuelve a conectar una vez. */
async function withRemote(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      remote ??= await connectRemote();
      return await fn(remote);
    } catch (error) {
      // Un error que contestó el servidor (argumentos inválidos, una herramienta que no existe) pasa tal cual.
      if (error instanceof McpError && error.code !== ErrorCode.ConnectionClosed) throw error;
      remote = null;
      if (attempt >= 1) throw new McpError(ErrorCode.InternalError, `Rumbo is not reachable at ${ENDPOINT} (${describe(error)}). Is the server running? RUMBO_BASE_URL=${BASE}`);
    }
  }
}

// ---------- Arrancar ----------

for (let attempt = 1; !remote; attempt++) {
  try {
    remote = await connectRemote();
  } catch (error) {
    if (attempt >= 3) {
      log(`no pude conectarme a ${ENDPOINT}: ${describe(error)}. ¿Está levantado tu Rumbo? RUMBO_BASE_URL=${BASE}`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
}

const caps = remote.getServerCapabilities() ?? {};
const capabilities = {};
for (const name of ["tools", "prompts", "resources", "completions"]) if (caps[name]) capabilities[name] = caps[name];
const server = new Server({ name: "rumbo", version: remote.getServerVersion()?.version ?? VERSION }, { capabilities, instructions: remote.getInstructions() });
const forward = (schema, call) => server.setRequestHandler(schema, (request) => withRemote((client) => call(client, request.params)));
const options = { timeout: TIMEOUT_MS };

if (caps.tools) {
  forward(ListToolsRequestSchema, (client, params) => client.listTools(params, options));
  forward(CallToolRequestSchema, (client, params) => client.callTool(params, undefined, options));
}
if (caps.prompts) {
  forward(ListPromptsRequestSchema, (client, params) => client.listPrompts(params, options));
  forward(GetPromptRequestSchema, (client, params) => client.getPrompt(params, options));
}
if (caps.resources) {
  forward(ListResourcesRequestSchema, (client, params) => client.listResources(params, options));
  forward(ListResourceTemplatesRequestSchema, (client, params) => client.listResourceTemplates(params, options));
  forward(ReadResourceRequestSchema, (client, params) => client.readResource(params, options));
}
if (caps.completions) forward(CompleteRequestSchema, (client, params) => client.complete(params, options));

await server.connect(new StdioServerTransport());
log(`listo: las herramientas de ${ENDPOINT}${KEY ? ", con la clave de organizador de la sesión" : ", sin clave de organizador (cada herramienta la pide como organizer_key)"}`);
