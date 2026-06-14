import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  agentMemoryStores,
  agents,
  costEntries,
  memoryStores,
  sessionEvents,
  sessions,
  workspaces,
} from "../db/schema";
import { decryptSecret } from "../lib/crypto";
import { getSecret, MCP_VAULT_ID_KEY } from "../lib/secrets";
import { getWorkspaceGoogleVaultId } from "../lib/google-connections";
import { priceUsage, type TokenUsage } from "../lib/pricing";
import { sessionErrorInfo } from "../lib/session-errors";
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

type MemoryTier = "short" | "long" | "knowledge";
type MemoryAccess = "read_write" | "read_only";

type MemoryResource = {
  type: "memory_store";
  memory_store_id: string;
  access: MemoryAccess;
  instructions: string;
};

// Guia de uso do mount, injetada no system prompt da sessão por store (PRD §7.2).
// Varia por tier e por acesso (long rw = consolidador; long ro = leitor).
function memoryInstructions(tier: MemoryTier, access: MemoryAccess): string {
  // Caminhos são relativos à raiz deste store (o sistema injeta o mount path
  // exato de cada um) — não cravar /mnt/memory/<x> aqui porque o nome do store
  // é derivado por workspace.
  switch (tier) {
    case "short":
      return "Working memory (hoje/esta semana). Organize em sub-pastas por domínio dentro deste store: calendar/, email/, files/, builder/, geral/ — arquivos YYYY-MM-DD.md. Cada sub-agente só na sua sub-pasta. Cheque antes de responder; registre o relevante continuamente.";
    case "long":
      return access === "read_write"
        ? "Longo prazo (consolidador). Mantenha index.md (1 linha por dia/assunto) na raiz deste store + os rollups YYYY-MM-DD.md e YYYY-WW.md. Comprima o curto prazo ao consolidar."
        : "Longo prazo. Leia o index.md (raiz deste store) PRIMEIRO — 1 linha por dia/assunto — pra localizar o que precisa, e só então abra o arquivo específico (YYYY-MM-DD.md / YYYY-WW.md). Não escreva aqui.";
    case "knowledge":
      return "Base de conhecimento curada. Referência factual sobre projetos, pessoas e decisões anteriores. Consulte quando o executivo perguntar 'sobre o X'.";
  }
}

// Monta os resources de memória da sessão a partir do mapeamento agente↔store
// (mirror Neon, populado pelo provision). A memória é anexada na SESSÃO, não no
// agente (PRD §7.1.1); num coordinator todos os threads compartilham os mounts.
async function loadMemoryResources(agentRowId: string): Promise<MemoryResource[]> {
  const rows = await db
    .select({
      anthropicId: memoryStores.anthropicMemoryStoreId,
      tier: memoryStores.tier,
      access: agentMemoryStores.accessLevel,
    })
    .from(agentMemoryStores)
    .innerJoin(
      memoryStores,
      eq(agentMemoryStores.memoryStoreId, memoryStores.id),
    )
    .where(eq(agentMemoryStores.agentId, agentRowId));

  return rows.map((r) => ({
    type: "memory_store" as const,
    memory_store_id: r.anthropicId,
    access: r.access,
    instructions: memoryInstructions(r.tier, r.access),
  }));
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

  // Monta os memory stores que este agente enxerga (PRD §7.1.1). Num coordinator,
  // os sub-agentes herdam estes mounts (filesystem compartilhado).
  const memoryResources = await loadMemoryResources(agent.id);

  // Anthropic-first.
  const created = await client.beta.sessions.create({
    agent: agent.anthropicAgentId,
    environment_id: ws.defaultEnvironmentId,
    title: input.title?.trim() || null,
    ...(memoryResources.length ? { resources: memoryResources } : {}),
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
  // Transferências de/para sub-agentes num coordinator (multiagent). São o único
  // sinal do trabalho delegado que aflora no event-stream da sessão — as tool
  // calls internas do sub-agente não aparecem aqui, só a ida (→) e a volta (←).
  // Renderizá-las dá feedback ao usuário durante a janela de delegação.
  "agent.thread_message_sent",
  "agent.thread_message_received",
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
    case "agent.thread_message_sent":
      return {
        type,
        data: {
          id: ev.id,
          direction: "sent",
          // `to_agent_name` ausente = primary agent; rotulamos como sub-agente.
          agent: (ev.to_agent_name as string | null) ?? null,
          text: textOf(ev.content as Array<{ type: string; text?: string }>),
        },
      };
    case "agent.thread_message_received":
      return {
        type,
        data: {
          id: ev.id,
          direction: "received",
          agent: (ev.from_agent_name as string | null) ?? null,
          text: textOf(ev.content as Array<{ type: string; text?: string }>),
        },
      };
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

// Busca o timeline interno de um thread de sub-agente e emite só as tool calls
// (use + result), rotuladas com o sub-agente. As MCP tool calls do sub-agente
// não afloram no stream primary — só via threads.events.list. Best-effort: se
// falhar, não derruba o turno (o ← ainda é emitido).
async function emitSubagentTools(
  client: Anthropic,
  row: typeof sessions.$inferSelect,
  threadId: string | undefined,
  agentName: string | null,
  persist: (n: NormalizedEvent, anthropicEventId?: string) => Promise<void>,
  safeSse: (event: string, data: unknown) => void,
): Promise<void> {
  if (!threadId) return;
  try {
    const page = await client.beta.sessions.threads.events.list(threadId, {
      session_id: row.anthropicSessionId,
    });
    for await (const sev of page as AsyncIterable<Record<string, unknown>>) {
      const t = sev.type as string | undefined;
      if (!t || (!t.includes("tool_use") && !t.includes("tool_result"))) continue;
      const sn = normalize(sev);
      if (!sn) continue;
      sn.data.subagent = agentName; // rótulo "via <sub-agente>" no card
      await persist(sn, sev.id as string | undefined);
      safeSse(sn.type, sn.data);
    }
  } catch {
    // best-effort — segue sem as tool calls do sub-agente
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

// Fase 1 é PT-BR com o executivo no Brasil — fuso único. Quando houver tz por
// workspace, trocar por uma coluna em `workspaces`.
const EXEC_TIMEZONE = "America/Sao_Paulo";

/**
 * Bloco de contexto temporal prefixado na content de cada mensagem enviada à
 * Anthropic. O orchestrator (`claude-sonnet-4-6`) **não aceita** `system.message`
 * mid-conversa (a API responde 400), então "agora" entra na própria user.message.
 * Persistimos só o texto original do usuário — este bloco não vai pra UI nem pro
 * histórico. Sem ele o agente assume um "hoje" do treino (erra ano e dia da semana).
 */
function datetimeContextPrefix(now: Date): string {
  const full = new Intl.DateTimeFormat("pt-BR", {
    timeZone: EXEC_TIMEZONE,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  // sv-SE dá um formato ISO-like (YYYY-MM-DD HH:mm:ss) no fuso pedido.
  const iso = now
    .toLocaleString("sv-SE", { timeZone: EXEC_TIMEZONE })
    .replace(" ", "T");
  return `[Contexto do sistema — agora é ${full} (${iso}, fuso ${EXEC_TIMEZONE}). Use esta data/hora como "hoje"/"agora" ao resolver referências como "amanhã", "hoje", "semana que vem". Não repita este bloco na resposta.]`;
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

  // Anthropic-first: manda a mensagem com o contexto de data/hora prefixado na
  // content (ver datetimeContextPrefix). Se falhar, exceção → handler responde
  // JSON e nada foi persistido.
  const sent = `${datetimeContextPrefix(new Date())}\n\n${text}`;
  await client.beta.sessions.events.send(row.anthropicSessionId, {
    events: [{ type: "user.message", content: [{ type: "text", text: sent }] }],
  });

  // Mensagem aceita → persiste só o texto original do usuário pro reload (o
  // prefixo de contexto não deve aparecer na UI/histórico).
  await db.insert(sessionEvents).values({
    sessionId: row.id,
    type: "user.message",
    payload: { text },
  });

  const stream = new ReadableStream({
    async start(controller) {
      // Durabilidade: o turno é consumido e PERSISTIDO até o fim (idle/terminated/
      // erro) **independente** da conexão do cliente. Se o navegador cair no meio
      // (abort) — ex.: durante a janela de delegação (~20s sem eventos) — paramos
      // só de ESCREVER no SSE; seguimos persistindo, pra que o reload/refetch
      // mostre o turno completo. Antes, um abort interrompia o loop e a resposta
      // final do sub-agente se perdia (não chegava nem no chat nem no histórico).
      let clientGone = signal.aborted;
      signal.addEventListener("abort", () => {
        clientGone = true;
        console.log(`[stream] cliente desconectou (session ${row.id}) — seguindo até o fim do turno pra persistir`);
      });

      const persist = async (n: NormalizedEvent, anthropicEventId?: string) => {
        await db.insert(sessionEvents).values({
          sessionId: row.id,
          anthropicEventId: anthropicEventId ?? null,
          type: n.type,
          payload: n.data,
        });
      };
      // Escrita best-effort no SSE: se o cliente sumiu, vira no-op (mas o loop
      // continua persistindo).
      const safeSse = (event: string, data: unknown) => {
        if (clientGone) return;
        try {
          sse(controller, event, data);
        } catch {
          clientGone = true;
        }
      };

      // Keep-alive: a janela de delegação passa ~20-30s sem evento renderável; um
      // comentário SSE periódico evita que a conexão ociosa caia. Linhas com ":"
      // são ignoradas pelo parser do client.
      const encoder = new TextEncoder();
      const ping = setInterval(() => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clientGone = true;
        }
      }, 10_000);

      try {
        const events = await client.beta.sessions.events.stream(
          row.anthropicSessionId,
        );
        for await (const ev of events as AsyncIterable<Record<string, unknown>>) {
          const type = ev.type as string;

          const n = normalize(ev);
          if (n) {
            // Antes de renderizar o ← (sub-agente devolveu o resultado), traz as
            // tool calls internas dele — elas vivem no stream do thread do
            // sub-agente, não no primary, então não chegam pelo events.stream().
            if (type === "agent.thread_message_received") {
              await emitSubagentTools(
                client,
                row,
                ev.from_session_thread_id as string | undefined,
                (n.data.agent as string | null) ?? null,
                persist,
                safeSse,
              );
            }
            await persist(n, ev.id as string | undefined);
            safeSse(n.type, n.data);
            continue;
          }

          if (type === "session.status_idle") {
            const summary = await captureCost(client, row, "idle");
            safeSse("cost", summary);
            safeSse("done", { status: "idle" });
            break;
          }
          if (type === "session.status_terminated") {
            const summary = await captureCost(client, row, "terminated");
            safeSse("cost", summary);
            safeSse("done", { status: "terminated" });
            break;
          }
          if (type === "session.status_rescheduled") {
            // Reagendamento = retentativa após erro transitório (não é o fim do
            // turno). Mantém feedback na UI e segue aguardando a recuperação.
            safeSse("status", { phase: "retrying" });
            continue;
          }
          if (type === "session.error") {
            const info = sessionErrorInfo(ev.error);
            if (info.retry === "retrying") {
              // Transitório: a sessão vai retentar sozinha. Não aborta — sinaliza
              // e continua; ela vai a idle (sucesso) ou emite um erro terminal.
              safeSse("status", { phase: "retrying", message: info.message });
              continue;
            }
            // Terminal/exhausted: surface a mensagem específica e encerra.
            safeSse("error", { message: info.message, kind: info.kind });
            break;
          }
        }
      } catch (err) {
        safeSse("error", {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          // já fechado pelo cliente — ok
        }
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
