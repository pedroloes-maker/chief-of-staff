import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  ArrowUp,
  ChevronRight,
  CornerDownRight,
  CornerUpLeft,
  Eye,
  EyeOff,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  Wrench,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useApi,
  type AgentRole,
  type AgentSummary,
  type PersistedEvent,
  type SessionView,
} from "../lib/api";

const ROLE_LABEL: Record<AgentRole, string> = {
  orchestrator: "Orquestrador",
  builder: "Builder",
  sub_agent: "Sub-agente",
};

type ToolItem = {
  kind: "tool";
  id: string;
  name: string;
  input: unknown;
  custom: boolean;
  mcpServer?: string; // set quando é uma tool de servidor MCP
  subagent?: string; // set quando a tool foi chamada dentro de um sub-agente
  result?: { text: string; isError: boolean };
};

// Transferência de/para um sub-agente num coordinator (multiagent). `sent` = o
// orchestrator delegou (→), `received` = o sub-agente devolveu o resultado (←).
type TransferItem = {
  kind: "transfer";
  id: string;
  direction: "sent" | "received";
  agent: string | null;
  text: string;
};

type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "agent"; id: string; text: string }
  | ToolItem
  | TransferItem
  | { kind: "error"; id: string; message: string };

// Fase ao vivo do turno — só uma aparece por vez no indicador do rodapé.
// `retrying` = a sessão teve um erro transitório e está reprocessando.
type Phase = "thinking" | "responding" | "retrying";

type CostSummary = {
  usd: number;
  inputTokens: number;
  outputTokens: number;
};

let localSeq = 0;
const nextId = () => `local-${localSeq++}`;

export default function ChatPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const api = useApi();

  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [phase, setPhase] = useState<Phase>("thinking");
  const abortRef = useRef<AbortController | null>(null);
  // Recuperação de turno: se o stream ao vivo cair sem `done` (sem ser stop do
  // usuário), o turno pode ter terminado no servidor — buscamos o estado
  // persistido. `lastEventRef` alimenta o watchdog (stream travado sem eventos).
  const gotDoneRef = useRef(false);
  const intentionalStopRef = useRef(false);
  const lastEventRef = useRef(0);
  const [sessionId, setSessionId] = useState<string | null>(
    searchParams.get("session"),
  );
  const [cost, setCost] = useState<CostSummary | null>(null);
  // Caixas de ferramenta + transferências ficam escondidas por padrão; o toggle
  // do olho no header revela.
  const [showInternals, setShowInternals] = useState(false);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionView[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;

  // Agentes do workspace: alimentam o seletor (só ativos) e resolvem o agente
  // atrelado a uma sessão retomada pra exibir read-only (inclusive arquivados).
  useEffect(() => {
    if (!slug) return;
    void api
      .listAgents(slug)
      .then(setAgents)
      .catch(() => {});
  }, [api, slug]);

  // Default do seletor = orchestrator (só em sessão nova, sem escolha ainda).
  useEffect(() => {
    if (sessionId || selectedAgentId) return;
    const active = agents.filter((a) => a.status === "active");
    if (active.length === 0) return;
    const orch = active.find((a) => a.role === "orchestrator");
    setSelectedAgentId((orch ?? active[0]).id);
  }, [agents, sessionId, selectedAgentId]);

  // Lista de sessões do workspace pro dropdown do header.
  const refetchSessions = useCallback(() => {
    if (!slug) return;
    void api
      .listSessions(slug)
      .then(setSessions)
      .catch(() => {});
  }, [api, slug]);
  useEffect(() => {
    refetchSessions();
  }, [refetchSessions]);

  // Resume: se vier ?session=<id>, carrega metadados (título/modelo/custo) e o
  // histórico renderável persistido. O custo já aparece no topo sem precisar
  // mandar mensagem (usa o usdEstimate acumulado da sessão).
  useEffect(() => {
    const resume = searchParams.get("session");
    if (!resume) return;
    setSessionId(resume);
    void api
      .getSession(resume)
      .then((s) => {
        setCost({
          usd: s.usdEstimate,
          inputTokens: s.inputTokens,
          outputTokens: s.outputTokens,
        });
      })
      .catch(() => {});
    void api.getSessionEvents(resume).then((events) => {
      setItems(buildItemsFromPersisted(events));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("session")]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [items, streaming]);

  const applyEvent = useCallback((event: string, data: unknown) => {
    const d = data as Record<string, unknown>;
    lastEventRef.current = Date.now(); // alimenta o watchdog
    switch (event) {
      case "done":
        gotDoneRef.current = true;
        break;
      case "agent.message":
        setPhase("responding");
        setItems((prev) => [
          ...prev,
          { kind: "agent", id: String(d.id ?? nextId()), text: String(d.text ?? "") },
        ]);
        break;
      case "agent.thinking":
        // Thinking é efêmero — vira a fase do indicador único, não um item fixo.
        setPhase("thinking");
        break;
      case "agent.thread_message_sent":
      case "agent.thread_message_received": {
        // Transferência de/para sub-agente — dá feedback durante a delegação.
        setPhase("responding");
        const id = String(d.id ?? nextId());
        setItems((prev) =>
          prev.some((it) => it.id === id)
            ? prev // dedupe: o stream pode reemitir o mesmo evento
            : [
                ...prev,
                {
                  kind: "transfer",
                  id,
                  direction: d.direction === "received" ? "received" : "sent",
                  agent: d.agent ? String(d.agent) : null,
                  text: String(d.text ?? ""),
                },
              ],
        );
        break;
      }
      case "agent.tool_use":
      case "agent.custom_tool_use":
      case "agent.mcp_tool_use": {
        setPhase("responding");
        const id = String(d.id ?? nextId());
        setItems((prev) =>
          prev.some((it) => it.id === id)
            ? prev // dedupe: custom tools podem vir cross-postadas + do thread
            : [
                ...prev,
                {
                  kind: "tool",
                  id,
                  name: String(d.name ?? "tool"),
                  input: d.input,
                  custom: event === "agent.custom_tool_use",
                  mcpServer:
                    event === "agent.mcp_tool_use"
                      ? String(d.mcpServer ?? "")
                      : undefined,
                  subagent: d.subagent ? String(d.subagent) : undefined,
                },
              ],
        );
        break;
      }
      case "agent.tool_result":
      case "agent.mcp_tool_result":
        setPhase("responding");
        setItems((prev) =>
          prev.map((it) =>
            it.kind === "tool" && it.id === String(d.toolUseId)
              ? { ...it, result: { text: String(d.text ?? ""), isError: Boolean(d.isError) } }
              : it,
          ),
        );
        break;
      case "status":
        // Sinal de fase do servidor (ex.: reprocessando após erro transitório).
        if (d.phase === "retrying") setPhase("retrying");
        break;
      case "cost":
        setCost({
          usd: Number(d.usd ?? 0),
          inputTokens: Number(d.inputTokens ?? 0),
          outputTokens: Number(d.outputTokens ?? 0),
        });
        break;
      case "error":
        setItems((prev) => [
          ...prev,
          { kind: "error", id: nextId(), message: String(d.message ?? "erro") },
        ]);
        break;
      default:
        break;
    }
  }, []);

  // Recuperação: o turno é persistido no servidor mesmo se o stream ao vivo cair.
  // Faz polling do estado persistido até a sessão ficar idle, reconstruindo os
  // itens — garante que a resposta final apareça mesmo se o SSE travar/cair.
  const recoverTurn = useCallback(
    async (id: string) => {
      setStreaming(true);
      setPhase("responding");
      for (let i = 0; i < 40; i++) {
        let finished = false;
        try {
          const events = await api.getSessionEvents(id);
          setItems(buildItemsFromPersisted(events));
          const s = await api.getSession(id);
          finished = s.status === "idle" || s.status === "terminated";
          if (s.usdEstimate || s.inputTokens || s.outputTokens) {
            setCost({
              usd: s.usdEstimate,
              inputTokens: s.inputTokens,
              outputTokens: s.outputTokens,
            });
          }
        } catch {
          // transitório — tenta de novo
        }
        if (finished) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      setStreaming(false);
    },
    [api],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || !slug) return;
    setInput("");
    setItems((prev) => [...prev, { kind: "user", id: nextId(), text }]);
    setPhase("thinking");
    setStreaming(true);
    gotDoneRef.current = false;
    intentionalStopRef.current = false;
    lastEventRef.current = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    let id = sessionIdRef.current;
    try {
      if (!id) {
        const created = await api.createSession(slug, {
          agentId: selectedAgentId ?? undefined,
        });
        id = created.id;
        setSessionId(id);
        refetchSessions();
      }
      await api.streamMessage(id, text, applyEvent, controller.signal);
    } catch (err) {
      // Abort não-intencional (stream travou/caiu) cai no recovery abaixo; só
      // erros de verdade viram item de erro.
      if ((err as Error)?.name !== "AbortError") {
        setItems((prev) => [
          ...prev,
          {
            kind: "error",
            id: nextId(),
            message: err instanceof Error ? err.message : String(err),
          },
        ]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
    // Se o stream acabou sem `done` e não foi stop do usuário, o turno pode ter
    // terminado no servidor (SSE caiu no meio) — recupera do estado persistido.
    if (id && !gotDoneRef.current && !intentionalStopRef.current) {
      await recoverTurn(id);
    }
  }, [
    api,
    applyEvent,
    input,
    slug,
    streaming,
    selectedAgentId,
    refetchSessions,
    recoverTurn,
  ]);

  // Watchdog: se o stream ficar > 45s sem nenhum evento renderável (sub-agente
  // pendurado ou conexão SSE morta), aborta pra encerrar o stream travado — o
  // recovery em `send` então busca o estado persistido. 45s > a janela normal de
  // delegação (~20-30s), então não dispara em turnos saudáveis.
  useEffect(() => {
    if (!streaming) return;
    const t = setInterval(() => {
      if (Date.now() - lastEventRef.current > 45_000) {
        abortRef.current?.abort();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [streaming]);

  // Stop: para o agente server-side (user.interrupt em todos os threads) e
  // aborta o fetch local pra liberar a UI na hora.
  const stop = useCallback(async () => {
    const id = sessionIdRef.current;
    intentionalStopRef.current = true; // não dispara recovery — foi o usuário
    abortRef.current?.abort();
    if (id) {
      try {
        await api.interruptSession(id);
      } catch {
        // best-effort — a UI já foi liberada pelo abort
      }
    }
  }, [api]);

  // Nova sessão: sempre interrompe o turno em andamento (se houver), limpa o
  // ?session e reseta o estado (o AgentPicker reaparece).
  const newSession = useCallback(() => {
    if (streaming) void stop();
    setSearchParams({});
    setSessionId(null);
    setItems([]);
    setCost(null);
    setInput("");
  }, [setSearchParams, streaming, stop]);

  // Troca de sessão pelo dropdown: interrompe o turno atual e navega via
  // ?session=<id> (dispara o resume).
  const selectSession = useCallback(
    (id: string) => {
      if (!id || id === "new") {
        newSession();
        return;
      }
      if (streaming) void stop();
      setSearchParams({ session: id });
    },
    [newSession, setSearchParams, streaming, stop],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="glass z-10 flex h-16 shrink-0 items-center justify-between border-b border-line px-8">
        <div className="flex min-w-0 items-center gap-2">
          <select
            value={sessionId ?? "new"}
            onChange={(e) => selectSession(e.target.value)}
            className="max-w-[55vw] truncate rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] font-medium text-fg shadow-card outline-none transition focus:border-line-strong"
          >
            <option value="new">Nova sessão</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {sessionOption(s)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={newSession}
            title="Nova sessão"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-fg shadow-card transition hover:bg-elev active:scale-95"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <CostPill cost={cost} />
          <button
            type="button"
            onClick={() => setShowInternals((v) => !v)}
            title={
              showInternals
                ? "Esconder ferramentas e transferências"
                : "Mostrar ferramentas e transferências"
            }
            aria-pressed={showInternals}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-fg-muted shadow-card transition hover:bg-elev active:scale-95"
          >
            {showInternals ? (
              <Eye className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <EyeOff className="h-4 w-4" strokeWidth={1.5} />
            )}
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {items.length === 0 && !streaming ? (
            <EmptyState />
          ) : (
            <div className="space-y-4">
              {items
                .filter(
                  (it) =>
                    showInternals ||
                    (it.kind !== "tool" && it.kind !== "transfer"),
                )
                .map((it) => (
                  <Item key={it.id} item={it} />
                ))}
              {streaming && <Pending phase={phase} />}
            </div>
          )}
        </div>
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSend={() => void send()}
        onStop={() => void stop()}
        streaming={streaming}
        picker={
          !sessionId && agents.some((a) => a.status === "active") ? (
            <AgentPicker
              agents={agents.filter((a) => a.status === "active")}
              value={selectedAgentId}
              onChange={setSelectedAgentId}
            />
          ) : null
        }
      />
    </div>
  );
}

/** Seletor "Falando com:" — só em sessão nova (a sessão fixa o agente). */
function AgentPicker({
  agents,
  value,
  onChange,
}: {
  agents: AgentSummary[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2 text-[11px] text-fg-muted">
      <span>Falando com:</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-[11px] text-fg shadow-card outline-none transition focus:border-line-strong"
      >
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.slug} · {ROLE_LABEL[a.role]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Título da sessão: usa o title, senão um id curto. */
function sessionLabel(s: SessionView): string {
  return s.title?.trim() || `Sessão ${s.id.slice(0, 8)}`;
}

/** Rótulo da opção no dropdown: título + data de criação. */
function sessionOption(s: SessionView): string {
  const date = new Date(s.createdAt).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
  return `${sessionLabel(s)} · ${date}`;
}

/** Custo USD sempre visível no topo; tokens só quando há uso. */
function CostPill({ cost }: { cost: CostSummary | null }) {
  const usd = cost?.usd ?? 0;
  const tin = cost?.inputTokens ?? 0;
  const tout = cost?.outputTokens ?? 0;
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[11px] text-fg-muted shadow-card">
      {tin + tout > 0 && (
        <span>
          {tin.toLocaleString("pt-BR")} in · {tout.toLocaleString("pt-BR")} out
        </span>
      )}
      <span className="font-medium text-fg">
        {usd.toLocaleString("pt-BR", {
          style: "currency",
          currency: "USD",
          // Custos de dev são frações de dólar — mostra 4 casas abaixo de US$ 1
          // pra dar precisão; 2 casas pra zero (sessão nova) e valores ≥ US$ 1.
          minimumFractionDigits: usd > 0 && usd < 1 ? 4 : 2,
          maximumFractionDigits: usd > 0 && usd < 1 ? 4 : 2,
        })}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto mt-24 max-w-md text-center">
      <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-bg shadow-card">
        <div className="h-5 w-5 rounded-full border-2 border-white/90" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-fg">
        Converse com o chief-of-staff
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
        Mande uma mensagem pra iniciar uma sessão com o agente orchestrator deste
        workspace. Peça pra configurar agentes, criar jobs, ou consultar a memória.
      </p>
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-bg px-4 py-2.5 text-sm leading-relaxed text-accent-fg shadow-card">
            {item.text}
          </div>
        </div>
      );
    case "agent":
      // Sem balão — texto corrido, markdown renderizado como HTML.
      return (
        <div className="px-1">
          <Markdown text={item.text} />
        </div>
      );
    case "tool":
      return <ToolCard item={item} />;
    case "transfer":
      return <TransferCard item={item} />;
    case "error":
      return (
        <div className="rounded-xl border border-line bg-elev px-4 py-2.5 text-sm text-fg">
          <span className="font-medium">Erro:</span> {item.message}
        </div>
      );
  }
}

// Markdown do agente → HTML estilizado. react-markdown renderiza pra elementos
// React (sem dangerouslySetInnerHTML); gfm adiciona tabelas + autolink de URLs
// cruas (ex.: links de Meet). Estilos por elemento, alinhados ao tema.
const MD_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-1.5 mt-3 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-1.5 mt-3 text-[15px] font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-1 mt-2.5 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="break-words underline underline-offset-2 hover:text-fg-muted"
    >
      {children}
    </a>
  ),
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) =>
    /language-/.test(className ?? "") ? (
      <code className="font-mono text-[12px]">{children}</code>
    ) : (
      <code className="rounded bg-elev px-1 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-elev p-3 font-mono text-[12px] leading-relaxed">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-3 border-line" />,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2 border-l-2 border-line pl-3 text-fg-muted">
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-line px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-line px-2 py-1">{children}</td>
  ),
};

function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed text-fg">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false); // colapsada por padrão
  const label = item.mcpServer
    ? `MCP · ${item.mcpServer}`
    : item.custom
      ? "Ação do builder"
      : "Ferramenta";
  // Fundo pastel: verde = ok, vermelho = falha, neutro enquanto pendente.
  const tone = !item.result
    ? "border-line bg-surface"
    : item.result.isError
      ? "border-red-200 bg-red-50"
      : "border-green-200 bg-green-50";
  return (
    <div className={`rounded-xl border shadow-card ${tone}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-fg-faint transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          strokeWidth={2}
        />
        <Wrench className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.5} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-faint">
          {label}
        </span>
        <span className="font-mono text-xs text-fg">{item.name}</span>
        {item.subagent && (
          <span className="rounded-full border border-line bg-elev px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
            via {item.subagent}
          </span>
        )}
        {item.result?.isError && (
          <span className="ml-auto text-[11px] font-medium text-red-700">falhou</span>
        )}
      </button>
      {open && (
        <div className="space-y-2 border-t border-line/70 px-4 py-3">
          <Labeled label="Entrada">
            <Code value={item.input} />
          </Labeled>
          {item.result && (
            <Labeled label={item.result.isError ? "Erro" : "Resultado"}>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-white/60 p-2.5 font-mono text-[11px] leading-relaxed text-fg">
                {item.result.text || "—"}
              </pre>
            </Labeled>
          )}
        </div>
      )}
    </div>
  );
}

/** Card de transferência de/para sub-agente (→ delegou / ← respondeu). */
function TransferCard({ item }: { item: TransferItem }) {
  const sent = item.direction === "sent";
  const [open, setOpen] = useState(false); // colapsada por padrão
  const agent = item.agent ?? "sub-agente";
  const label = sent ? "Delegou para" : "Respondeu";
  const Icon = sent ? CornerDownRight : CornerUpLeft;
  return (
    // Amarelo pastel pra diferenciar das tool boxes (verde/vermelho).
    <div className="rounded-xl border border-yellow-200 bg-yellow-50 shadow-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 text-fg-faint transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          strokeWidth={2}
        />
        <Icon className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.5} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-faint">
          {label}
        </span>
        <span className="font-mono text-xs text-fg">{agent}</span>
      </button>
      {open && item.text && (
        <div className="border-t border-yellow-200/70 px-4 py-3">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-white/60 p-2.5 font-mono text-[11px] leading-relaxed text-fg">
            {item.text}
          </pre>
        </div>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        {label}
      </div>
      {children}
    </div>
  );
}

function Code({ value }: { value: unknown }) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) || "—";
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-elev p-2.5 font-mono text-[11px] leading-relaxed text-fg">
      {text}
    </pre>
  );
}

// Indicador único do turno: uma fase por vez, nunca duas.
const PHASE_LABEL: Record<Phase, string> = {
  thinking: "Pensando…",
  responding: "O agente está respondendo…",
  retrying: "Reprocessando… (tentando de novo)",
};
function Pending({ phase }: { phase: Phase }) {
  return (
    <div className="flex items-center gap-2 pl-1 text-[11px] text-fg-faint">
      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
      {PHASE_LABEL[phase]}
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  picker,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  picker?: React.ReactNode;
}) {
  return (
    <div className="glass shrink-0 border-t border-line px-6 py-4">
      {picker}
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <button
          type="button"
          disabled
          title="Anexar arquivo — em breve"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-fg-faint"
        >
          <Paperclip className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          disabled
          title="Gravar áudio — em breve"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-fg-faint"
        >
          <Mic className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <div className="flex flex-1 items-end gap-2 rounded-2xl border border-line bg-surface px-3 py-1.5 shadow-card focus-within:border-black/[0.25]">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!streaming) onSend();
              }
            }}
            rows={1}
            placeholder="Mande uma mensagem… (Enter envia, Shift+Enter quebra linha)"
            className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed text-fg placeholder:text-fg-faint focus:outline-none"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              title="Interromper o agente"
              aria-label="Interromper o agente"
              className="mb-0.5 flex h-8 w-8 shrink-0 animate-pulse items-center justify-center rounded-full bg-red-600 text-white shadow-card transition duration-150 hover:bg-red-700 active:scale-95"
            >
              <span className="h-2.5 w-2.5 rounded-[2px] bg-white" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!value.trim()}
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-bg text-accent-fg transition duration-150 hover:bg-black active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Reconstrói os itens do chat a partir do histórico, mesclando tool_result. */
function buildItemsFromPersisted(events: PersistedEvent[]): ChatItem[] {
  const items: ChatItem[] = [];
  const toolById = new Map<string, ToolItem>();
  for (const e of events) {
    const d = e.payload as Record<string, unknown>;
    switch (e.type) {
      case "user.message":
        items.push({ kind: "user", id: `p${e.seq}`, text: String(d.text ?? "") });
        break;
      case "agent.message":
        items.push({ kind: "agent", id: `p${e.seq}`, text: String(d.text ?? "") });
        break;
      case "agent.tool_use":
      case "agent.custom_tool_use":
      case "agent.mcp_tool_use": {
        const id = String(d.id ?? `p${e.seq}`);
        if (toolById.has(id)) break; // dedupe
        const tool: ToolItem = {
          kind: "tool",
          id,
          name: String(d.name ?? "tool"),
          input: d.input,
          custom: e.type === "agent.custom_tool_use",
          mcpServer:
            e.type === "agent.mcp_tool_use" ? String(d.mcpServer ?? "") : undefined,
          subagent: d.subagent ? String(d.subagent) : undefined,
        };
        toolById.set(tool.id, tool);
        items.push(tool);
        break;
      }
      case "agent.tool_result":
      case "agent.mcp_tool_result": {
        const tool = toolById.get(String(d.toolUseId));
        if (tool)
          tool.result = { text: String(d.text ?? ""), isError: Boolean(d.isError) };
        break;
      }
      case "agent.thread_message_sent":
      case "agent.thread_message_received":
        items.push({
          kind: "transfer",
          id: String(d.id ?? `p${e.seq}`),
          direction: d.direction === "received" ? "received" : "sent",
          agent: d.agent ? String(d.agent) : null,
          text: String(d.text ?? ""),
        });
        break;
      default:
        break;
    }
  }
  return items;
}
