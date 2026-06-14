import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  agents,
  costEntries,
  sessionEvents,
  sessions,
  workspaces,
} from "../db/schema";
import { decryptSecret } from "../lib/crypto";
import { getSecret, MCP_VAULT_ID_KEY } from "../lib/secrets";
import { getWorkspaceGoogleVaultId } from "../lib/google-connections";
import { priceUsage, type TokenUsage } from "../lib/pricing";
import type { AuthContext } from "../lib/auth";
import { ValidationError } from "./workspaces";

export type SessionView = {
  id: string;
  anthropicSessionId: string;
  title: string | null;
  source: "web" | "whatsapp" | "job";
  status: "rescheduling" | "running" | "idle" | "terminated";
  model: string | null;
  // Agente-alvo da sessão (fixado na criação). Null se o mirror sumiu.
  agentId: string | null;
  usdEstimate: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  updatedAt: string;
};

function toView(s: typeof sessions.$inferSelect): SessionView {
  return {
    id: s.id,
    anthropicSessionId: s.anthropicSessionId,
    title: s.title,
    source: s.source,
    status: s.status,
    model: s.model,
    agentId: s.agentId,
    usdEstimate: Number(s.usdEstimate),
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

async function loadWorkspaceRow(slug: string) {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.status, "active")));
  return row ?? null;
}

async function loadWorkspaceById(id: string) {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, id));
  return row ?? null;
}

async function loadOrchestrator(workspaceId: string) {
  const [row] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.workspaceId, workspaceId),
        eq(agents.role, "orchestrator"),
        eq(agents.status, "active"),
      ),
    );
  return row ?? null;
}

// Carrega um agente ativo escolhido pra sessão, scoped ao workspace (impede
// abrir sessão contra agente de outro workspace ou arquivado).
async function loadAgentInWorkspace(agentId: string, workspaceId: string) {
  const [row] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.workspaceId, workspaceId),
        eq(agents.status, "active"),
      ),
    );
  return row ?? null;
}

async function loadSessionRow(id: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
  return row ?? null;
}

function clientFor(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

/**
 * Cria uma session Anthropic-first contra um agente do workspace (orchestrator
 * por padrão; ou o `agentId` escolhido), depois espelha no Neon. Se a Anthropic
 * falhar, nada é escrito localmente. A sessão fixa o agente na criação — a API
 * não permite trocá-lo depois.
 */
export async function createSession(
  slug: string,
  input: { title?: string; agentId?: string },
  auth: AuthContext,
): Promise<SessionView> {
  const ws = await loadWorkspaceRow(slug);
  if (!ws) throw new ValidationError("workspace não encontrado");
  if (!ws.defaultEnvironmentId) {
    throw new ValidationError(
      "workspace sem environment default — reconecte o workspace",
    );
  }

  const agent = input.agentId
    ? await loadAgentInWorkspace(input.agentId, ws.id)
    : await loadOrchestrator(ws.id);
  if (!agent) {
    throw new ValidationError(
      input.agentId
        ? "agente não encontrado, arquivado, ou fora deste workspace"
        : "workspace não provisionado — rode scripts/provision-workspace.ts antes de abrir o chat",
    );
  }

  const apiKey = await decryptSecret(ws.anthropicApiKeyEncrypted);
  const client = clientFor(apiKey);

  // Anexa as vaults (MCP `sma` + Google conectado) pra Anthropic encaminhar os
  // bearers aos endpoints MCP quando o agente chamar as tools.
  const smaVaultId = await getSecret(ws.id, MCP_VAULT_ID_KEY);
  const googleVaultId = await getWorkspaceGoogleVaultId(ws.id);
  const vaultIds = [smaVaultId, googleVaultId].filter(
    (v): v is string => !!v,
  );

  // Anthropic-first.
  const created = await client.beta.sessions.create({
    agent: agent.anthropicAgentId,
    environment_id: ws.defaultEnvironmentId,
    title: input.title?.trim() || null,
    ...(vaultIds.length ? { vault_ids: vaultIds } : {}),
  });

  const [row] = await db
    .insert(sessions)
    .values({
      workspaceId: ws.id,
      anthropicSessionId: created.id,
      agentId: agent.id,
      source: "web",
      status: created.status,
      title: created.title ?? input.title?.trim() ?? null,
      model: agent.model,
      createdBy: auth.userId,
    })
    .returning();

  return toView(row);
}

export async function listSessions(slug: string): Promise<SessionView[]> {
  const ws = await loadWorkspaceRow(slug);
  if (!ws) throw new ValidationError("workspace não encontrado");
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.workspaceId, ws.id))
    .orderBy(desc(sessions.createdAt));
  return rows.map(toView);
}

export async function getSession(id: string): Promise<SessionView | null> {
  const row = await loadSessionRow(id);
  return row ? toView(row) : null;
}

/**
 * Interrompe o turno em andamento da sessão. Manda `user.interrupt` sem
 * `session_thread_id` — interrompe TODOS os threads (orchestrator + sub-agentes
 * num coordinator), pausando a execução e devolvendo o controle ao usuário.
 * Usado pelo botão stop e pelo "+"/troca de sessão durante streaming.
 */
export async function interruptSession(id: string): Promise<{ ok: true }> {
  const row = await loadSessionRow(id);
  if (!row) throw new ValidationError("session não encontrada");
  const ws = await loadWorkspaceById(row.workspaceId);
  if (!ws) throw new ValidationError("workspace da session não encontrado");
  const apiKey = await decryptSecret(ws.anthropicApiKeyEncrypted);
  const client = clientFor(apiKey);
  await client.beta.sessions.events.send(row.anthropicSessionId, {
    events: [{ type: "user.interrupt" }],
  });
  return { ok: true };
}

/** Eventos renderáveis persistidos, em ordem, pra reload do chat. */
export async function listSessionEvents(
  id: string,
): Promise<Array<{ seq: number; type: string; payload: unknown }>> {
  const rows = await db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, id))
    .orderBy(sessionEvents.seq);
  return rows.map((r) => ({ seq: r.seq, type: r.type, payload: r.payload }));
}

// Eventos que a UI renderiza — o resto do stream (status running, spans,
// thread bookkeeping) é ignorado pro mirror.
const RENDERABLE = new Set([
  "agent.message",
  "agent.thinking",
  "agent.tool_use",
  "agent.tool_result",
  "agent.custom_tool_use",
  "agent.mcp_tool_use",
  "agent.mcp_tool_result",
]);

type NormalizedEvent = { type: string; data: Record<string, unknown> };

function textOf(content: Array<{ type: string; text?: string }> | undefined): string {
  if (!content) return "";
  return content
    .map((b) => (b.type === "text" && b.text ? b.text : b.type === "text" ? "" : `[${b.type}]`))
    .join("");
}

/** Normaliza um evento do stream Anthropic no payload mínimo que a UI usa. */
function normalize(ev: Record<string, unknown>): NormalizedEvent | null {
  const type = ev.type as string;
  if (!RENDERABLE.has(type)) return null;
  switch (type) {
    case "agent.message":
      return {
        type,
        data: {
          id: ev.id,
          text: textOf(ev.content as Array<{ type: string; text?: string }>),
        },
      };
    case "agent.thinking":
      return { type, data: { id: ev.id } };
    case "agent.tool_use":
    case "agent.custom_tool_use":
      return { type, data: { id: ev.id, name: ev.name, input: ev.input } };
    case "agent.mcp_tool_use":
      return {
        type,
        data: {
          id: ev.id,
          name: ev.name,
          input: ev.input,
          mcpServer: ev.mcp_server_name,
        },
      };
    case "agent.tool_result":
      return {
        type,
        data: {
          id: ev.id,
          toolUseId: ev.tool_use_id,
          isError: ev.is_error ?? false,
          text: textOf(ev.content as Array<{ type: string; text?: string }>),
        },
      };
    case "agent.mcp_tool_result":
      return {
        type,
        data: {
          id: ev.id,
          toolUseId: ev.mcp_tool_use_id,
          isError: ev.is_error ?? false,
          text: textOf(ev.content as Array<{ type: string; text?: string }>),
        },
      };
    default:
      return null;
  }
}

function usageOf(usage: Anthropic.Beta.Sessions.BetaManagedAgentsSessionUsage | undefined): TokenUsage {
  const cacheCreation =
    (usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
    (usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: cacheCreation,
  };
}

/**
 * Captura custo da session por polling (Fase 1, sem webhook): lê o usage
 * cumulativo da Anthropic, converte em USD e faz upsert da CostEntry +
 * atualiza os campos de custo da session. Retorna o resumo pra emitir no stream.
 */
async function captureCost(
  client: Anthropic,
  row: typeof sessions.$inferSelect,
  status: "rescheduling" | "running" | "idle" | "terminated",
) {
  const live = await client.beta.sessions.retrieve(row.anthropicSessionId);
  const usage = usageOf(live.usage);
  const model = row.model ?? "";
  const usd = model ? await priceUsage(model, usage) : 0;

  await db
    .update(sessions)
    .set({
      status,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      usdEstimate: String(usd),
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, row.id));

  await db
    .insert(costEntries)
    .values({
      workspaceId: row.workspaceId,
      sessionId: row.id,
      model: row.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      usdEstimate: String(usd),
      capturedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: costEntries.sessionId,
      set: {
        model: row.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        usdEstimate: String(usd),
        capturedAt: new Date(),
      },
    });

  return { usd, ...usage };
}

function sse(controller: ReadableStreamDefaultController, event: string, data: unknown) {
  controller.enqueue(
    new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  );
}

/**
 * Envia uma mensagem de texto na session e devolve um Response SSE com o stream
 * de eventos do agente até o turno terminar (status_idle). Persiste os eventos
 * renderáveis e captura custo no fim. Anthropic-first: se o `send` falhar, nada
 * é escrito no Neon e o erro sobe como exceção (vira JSON 502 no handler).
 */
export async function streamMessage(
  id: string,
  text: string,
  signal: AbortSignal,
): Promise<Response> {
  if (!text?.trim()) throw new ValidationError("mensagem vazia");

  const row = await loadSessionRow(id);
  if (!row) throw new ValidationError("session não encontrada");

  const ws = await loadWorkspaceById(row.workspaceId);
  if (!ws) throw new ValidationError("workspace da session não encontrado");

  const apiKey = await decryptSecret(ws.anthropicApiKeyEncrypted);
  const client = clientFor(apiKey);

  // Anthropic-first: manda a mensagem. Se falhar, exceção → handler responde
  // JSON e nada foi persistido.
  await client.beta.sessions.events.send(row.anthropicSessionId, {
    events: [{ type: "user.message", content: [{ type: "text", text }] }],
  });

  // Mensagem aceita → persiste o evento do usuário pro reload.
  await db.insert(sessionEvents).values({
    sessionId: row.id,
    type: "user.message",
    payload: { text },
  });

  const stream = new ReadableStream({
    async start(controller) {
      const persist = async (n: NormalizedEvent, anthropicEventId?: string) => {
        await db.insert(sessionEvents).values({
          sessionId: row.id,
          anthropicEventId: anthropicEventId ?? null,
          type: n.type,
          payload: n.data,
        });
      };

      try {
        const events = await client.beta.sessions.events.stream(
          row.anthropicSessionId,
        );
        for await (const ev of events as AsyncIterable<Record<string, unknown>>) {
          if (signal.aborted) break;
          const type = ev.type as string;

          const n = normalize(ev);
          if (n) {
            await persist(n, ev.id as string | undefined);
            sse(controller, n.type, n.data);
            continue;
          }

          if (type === "session.status_idle") {
            const summary = await captureCost(client, row, "idle");
            sse(controller, "cost", summary);
            sse(controller, "done", { status: "idle" });
            break;
          }
          if (type === "session.status_terminated") {
            const summary = await captureCost(client, row, "terminated");
            sse(controller, "cost", summary);
            sse(controller, "done", { status: "terminated" });
            break;
          }
          if (type === "session.error" || type === "session.status_error") {
            sse(controller, "error", { message: "erro na sessão Anthropic" });
            break;
          }
        }
      } catch (err) {
        sse(controller, "error", {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
