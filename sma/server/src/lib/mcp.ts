/**
 * MCP server mínimo sobre o transporte Streamable HTTP (port do CMA).
 *
 * Um handler despacha as mensagens JSON-RPC 2.0 do cliente MCP: `initialize`,
 * a notificação `notifications/initialized` (sem resposta), `tools/list` e
 * `tools/call`. Stateless — não emitimos Mcp-Session-Id.
 *
 *   serveMcp(req, {
 *     name: "sma", version: "1.0.0",
 *     tools: [
 *       { name: "executive_profile", description: "...", inputSchema: {...},
 *         handler: async (args, ctx) => ({ ... }) },
 *     ],
 *   });
 *
 * `ctx.bearer` é o Authorization que a Anthropic encaminha (o token guardado
 * na vault), ou null. A auth de fato é feita pelo chamador antes de serveMcp.
 *
 * Spec: https://modelcontextprotocol.io — Streamable HTTP. Protocolo: 2025-06-18.
 */

const PROTOCOL_VERSION = "2025-06-18";

export interface McpToolContext {
  bearer: string | null;
  request: Request;
}

export interface McpToolResultContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpToolResultContent[];
  isError?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (
    args: Record<string, unknown>,
    ctx: McpToolContext,
  ) => Promise<McpToolResult | string> | McpToolResult | string;
}

export interface McpServerConfig {
  name: string;
  version: string;
  tools: McpTool[];
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function toToolResult(value: McpToolResult | string): McpToolResult {
  if (typeof value === "string") {
    return { content: [{ type: "text", text: value }] };
  }
  return value;
}

export function extractBearer(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

async function dispatch(
  msg: JsonRpcRequest,
  config: McpServerConfig,
  ctx: McpToolContext,
  onToolCall?: (name: string, ms: number, error?: string) => void,
): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null;

  switch (msg.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: config.name, version: config.version },
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: config.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const params = (msg.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      const tool = config.tools.find((t) => t.name === params.name);
      if (!tool) return rpcError(id, -32601, `Unknown tool: ${params.name}`);
      const startedAt = performance.now();
      try {
        const out = await tool.handler(params.arguments ?? {}, ctx);
        onToolCall?.(tool.name, performance.now() - startedAt);
        return ok(id, toToolResult(out));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onToolCall?.(tool.name, performance.now() - startedAt, message);
        return ok(id, {
          content: [{ type: "text", text: message }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function serveMcp(
  req: Request,
  config: McpServerConfig,
  onToolCall?: (name: string, ms: number, error?: string) => void,
): Promise<Response> {
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        name: config.name,
        version: config.version,
        protocolVersion: PROTOCOL_VERSION,
      }),
      { headers: { "content-type": "application/json" } },
    );
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonRpc(rpcError(null, -32700, "Parse error"));
  }

  const ctx: McpToolContext = { bearer: extractBearer(req), request: req };

  if (Array.isArray(body)) {
    const out: JsonRpcResponse[] = [];
    for (const msg of body) {
      const r = await dispatch(msg as JsonRpcRequest, config, ctx, onToolCall);
      if (r) out.push(r);
    }
    if (out.length === 0) return new Response(null, { status: 204 });
    return jsonRpc(out);
  }

  const res = await dispatch(body as JsonRpcRequest, config, ctx, onToolCall);
  if (!res) return new Response(null, { status: 204 });
  return jsonRpc(res);
}

function jsonRpc(payload: JsonRpcResponse | JsonRpcResponse[]): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}
