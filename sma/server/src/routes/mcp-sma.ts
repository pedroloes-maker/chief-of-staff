// MCP server `sma` hospedado no nosso backend, scoped por workspace via path
// (/api/mcp/sma/:slug). Autentica por bearer static (encaminhado pela Anthropic
// a partir da vault) e expõe a tool `executive_profile`.
//
// Este endpoint é PÚBLICO (server-to-server da Anthropic, sem Clerk JWT) — a
// auth é o bearer por workspace. Em Fase 1 local, a Anthropic só alcança o
// endpoint via tunnel/deploy (hostname público); em loopback o orchestrator
// nem registra o MCP server, então o endpoint fica ocioso.

import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { workspaces } from "../db/schema";
import { extractBearer, serveMcp, type McpServerConfig } from "../lib/mcp";
import { validMcpBearers } from "../lib/secrets";

// Comparação constant-time (evita timing oracle no bearer).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function loadWorkspaceBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.status, "active")));
  return row ?? null;
}

function configFor(ws: typeof workspaces.$inferSelect): McpServerConfig {
  return {
    name: "sma",
    version: "1.0.0",
    tools: [
      {
        name: "executive_profile",
        description:
          "Retorna o profile do executivo dono deste workspace: nome, nome de exibição e focos atuais. Sem parâmetros — o workspace vem do escopo da credential.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: () =>
          JSON.stringify({
            executive_name: ws.executiveName,
            display_name: ws.displayName,
            focos: [], // placeholder — populado quando a feature de focos existir
          }),
      },
    ],
  };
}

/**
 * Handler do endpoint MCP `sma`. Valida workspace + bearer, depois delega o
 * JSON-RPC pro harness. Loga cada tool call (workspace, tool, latência, erro).
 */
export async function handleSmaMcp(req: Request, slug: string): Promise<Response> {
  const ws = await loadWorkspaceBySlug(slug);
  if (!ws) {
    return new Response("workspace não encontrado", { status: 404 });
  }

  // GET é probe de capabilities — liberado sem bearer (não expõe dados).
  if (req.method !== "GET") {
    const bearer = extractBearer(req);
    const candidates = await validMcpBearers(ws.id);
    const authed = bearer != null && candidates.some((c) => safeEqual(c, bearer));
    if (!authed) {
      console.warn(`[mcp:sma] ws=${slug} bearer inválido ou ausente`);
      return new Response("unauthorized", {
        status: 401,
        headers: { "www-authenticate": "Bearer" },
      });
    }
  }

  return serveMcp(req, configFor(ws), (tool, ms, error) => {
    const base = `[mcp:sma] ws=${slug} tool=${tool} ${ms.toFixed(0)}ms`;
    if (error) console.error(`${base} error=${error}`);
    else console.log(base);
  });
}
