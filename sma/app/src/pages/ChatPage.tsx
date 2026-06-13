import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  ArrowUp,
  ChevronRight,
  Loader2,
  Mic,
  Paperclip,
  Wrench,
} from "lucide-react";
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
  result?: { text: string; isError: boolean };
};

type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "agent"; id: string; text: string }
  | { kind: "thinking"; id: string }
  | ToolItem
  | { kind: "error"; id: string; message: string };

type CostSummary = {
  usd: number;
  inputTokens: number;
  outputTokens: number;
};

let localSeq = 0;
const nextId = () => `local-${localSeq++}`;

export default function ChatPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const api = useApi();

  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(
    searchParams.get("session"),
  );
  const [session, setSession] = useState<SessionView | null>(null);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

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

  // Agente em uso: o da sessão (retomada/criada) ou o escolhido no seletor.
  const activeAgent = useMemo(() => {
    const aid = session?.agentId ?? selectedAgentId;
    return agents.find((a) => a.id === aid) ?? null;
  }, [agents, session, selectedAgentId]);

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
        setSession(s);
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
    switch (event) {
      case "agent.message":
        setItems((prev) => [
          ...prev,
          { kind: "agent", id: String(d.id ?? nextId()), text: String(d.text ?? "") },
        ]);
        break;
      case "agent.thinking":
        setItems((prev) => [...prev, { kind: "thinking", id: String(d.id ?? nextId()) }]);
        break;
      case "agent.tool_use":
      case "agent.custom_tool_use":
      case "agent.mcp_tool_use":
        setItems((prev) => [
          ...prev,
          {
            kind: "tool",
            id: String(d.id ?? nextId()),
            name: String(d.name ?? "tool"),
            input: d.input,
            custom: event === "agent.custom_tool_use",
            mcpServer:
              event === "agent.mcp_tool_use" ? String(d.mcpServer ?? "") : undefined,
          },
        ]);
        break;
      case "agent.tool_result":
      case "agent.mcp_tool_result":
        setItems((prev) =>
          prev.map((it) =>
            it.kind === "tool" && it.id === String(d.toolUseId)
              ? { ...it, result: { text: String(d.text ?? ""), isError: Boolean(d.isError) } }
              : it,
          ),
        );
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

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || !slug) return;
    setInput("");
    setItems((prev) => [...prev, { kind: "user", id: nextId(), text }]);
    setStreaming(true);
    try {
      let id = sessionIdRef.current;
      if (!id) {
        const created = await api.createSession(slug, {
          agentId: selectedAgentId ?? undefined,
        });
        id = created.id;
        setSessionId(id);
        setSession(created);
      }
      await api.streamMessage(id, text, applyEvent);
    } catch (err) {
      setItems((prev) => [
        ...prev,
        {
          kind: "error",
          id: nextId(),
          message: err instanceof Error ? err.message : String(err),
        },
      ]);
    } finally {
      setStreaming(false);
    }
  }, [api, applyEvent, input, slug, streaming, selectedAgentId]);

  return (
    <div className="flex h-full flex-col">
      <header className="glass z-10 flex h-16 shrink-0 items-center justify-between border-b border-line px-8">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold tracking-tight text-fg">
            {session ? sessionLabel(session) : "Nova sessão"}
          </h1>
          <p className="truncate text-[11px] text-fg-muted">
            <span className="font-mono">{activeAgent?.slug ?? "orchestrator"}</span>
            {session?.model && (
              <>
                {" · "}
                <span className="font-mono">{session.model}</span>
              </>
            )}
            {" · "}workspace <span className="font-mono">{slug}</span>
          </p>
        </div>
        <CostPill cost={cost} />
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {items.length === 0 && !streaming ? (
            <EmptyState />
          ) : (
            <div className="space-y-4">
              {items.map((it) => (
                <Item key={it.id} item={it} />
              ))}
              {streaming && <Pending />}
            </div>
          )}
        </div>
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSend={() => void send()}
        disabled={streaming}
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

/** Título da sessão pro cabeçalho: usa o title, senão um id curto. */
function sessionLabel(s: SessionView): string {
  return s.title?.trim() || `Sessão ${s.id.slice(0, 8)}`;
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
      return (
        <div className="flex justify-start">
          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-2.5 text-sm leading-relaxed text-fg shadow-card">
            {item.text}
          </div>
        </div>
      );
    case "thinking":
      return (
        <div className="flex items-center gap-2 pl-1 text-[11px] text-fg-faint">
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
          Pensando…
        </div>
      );
    case "tool":
      return <ToolCard item={item} />;
    case "error":
      return (
        <div className="rounded-xl border border-line bg-elev px-4 py-2.5 text-sm text-fg">
          <span className="font-medium">Erro:</span> {item.message}
        </div>
      );
  }
}

function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(item.custom || !!item.mcpServer);
  const label = item.mcpServer
    ? `MCP · ${item.mcpServer}`
    : item.custom
      ? "Ação do builder"
      : "Ferramenta";
  return (
    <div className="rounded-xl border border-line bg-surface shadow-card">
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
        {item.result?.isError && (
          <span className="ml-auto text-[11px] font-medium text-fg-muted">falhou</span>
        )}
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          <Labeled label="Entrada">
            <Code value={item.input} />
          </Labeled>
          {item.result && (
            <Labeled label={item.result.isError ? "Erro" : "Resultado"}>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-elev p-2.5 font-mono text-[11px] leading-relaxed text-fg">
                {item.result.text || "—"}
              </pre>
            </Labeled>
          )}
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

function Pending() {
  return (
    <div className="flex items-center gap-2 pl-1 text-[11px] text-fg-faint">
      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
      O agente está respondendo…
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  disabled,
  picker,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
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
                onSend();
              }
            }}
            rows={1}
            placeholder="Mande uma mensagem… (Enter envia, Shift+Enter quebra linha)"
            className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed text-fg placeholder:text-fg-faint focus:outline-none"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={disabled || !value.trim()}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-bg text-accent-fg transition duration-150 hover:bg-black active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {disabled ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <ArrowUp className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
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
      case "agent.thinking":
        items.push({ kind: "thinking", id: `p${e.seq}` });
        break;
      case "agent.tool_use":
      case "agent.custom_tool_use":
      case "agent.mcp_tool_use": {
        const tool: ToolItem = {
          kind: "tool",
          id: String(d.id ?? `p${e.seq}`),
          name: String(d.name ?? "tool"),
          input: d.input,
          custom: e.type === "agent.custom_tool_use",
          mcpServer:
            e.type === "agent.mcp_tool_use" ? String(d.mcpServer ?? "") : undefined,
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
      default:
        break;
    }
  }
  return items;
}
