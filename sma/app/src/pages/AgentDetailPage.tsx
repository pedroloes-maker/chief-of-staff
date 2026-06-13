import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Archive, Boxes, Cpu, Plug, Wrench } from "lucide-react";
import {
  useApi,
  type AgentDetail,
  type AgentRole,
  type AgentSummary,
} from "../lib/api";

const ROLE_LABEL: Record<AgentRole, string> = {
  orchestrator: "Orquestrador",
  builder: "Builder",
  sub_agent: "Sub-agente",
};

export default function AgentDetailPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const api = useApi();
  const navigate = useNavigate();

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [all, setAll] = useState<AgentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id || !slug) return;
    api
      .getAgent(id)
      .then(setAgent)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    api
      .listAgents(slug)
      .then(setAll)
      .catch(() => {});
  }, [api, id, slug]);

  useEffect(() => {
    setAgent(null);
    setError(null);
    load();
  }, [load]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-10 py-12">
        <div className="rounded-card border border-line bg-surface p-6 text-sm text-fg shadow-card">
          Erro ao carregar agente: {error}
        </div>
      </div>
    );
  }
  if (!agent || !slug || !id) {
    return <div className="px-10 py-12 text-sm text-fg-muted">Carregando agente…</div>;
  }

  const archived = agent.status === "archived";

  return (
    <div className="mx-auto max-w-3xl px-10 py-12">
      <Link
        to={`/w/${slug}/agents`}
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        Agentes
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-[24px] font-semibold tracking-tight text-fg">
            {agent.slug}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-fg-muted">
              {ROLE_LABEL[agent.role]}
            </span>
            <span className="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-fg-muted">
              v{agent.liveVersion}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-fg-muted">
              <span
                className={`h-1.5 w-1.5 rounded-full ${archived ? "bg-fg-faint" : "bg-fg"}`}
              />
              {archived ? "Arquivado" : "Ativo"}
            </span>
            <span className="font-mono text-fg-faint">{agent.anthropicAgentId}</span>
          </div>
        </div>
      </div>

      {archived && (
        <div className="mt-6 rounded-card border border-line bg-elev px-4 py-3 text-sm text-fg-muted">
          Este agente está arquivado. Agentes arquivados são read-only por design
          da Anthropic.
        </div>
      )}

      <ConfigSection agent={agent} archived={archived} onSaved={setAgent} />

      {agent.isCoordinator && (
        <RosterSection
          agent={agent}
          candidates={all}
          archived={archived}
          onSaved={setAgent}
        />
      )}

      <ReadOnlyLists agent={agent} />

      {agent.role !== "orchestrator" && !archived && (
        <ArchiveSection agentId={id} onArchived={() => navigate(`/w/${slug}/agents`)} />
      )}
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-card border border-line bg-surface p-6 shadow-card">
      <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        <Icon className="h-4 w-4" strokeWidth={1.5} />
        {title}
      </div>
      {children}
    </section>
  );
}

function ConfigSection({
  agent,
  archived,
  onSaved,
}: {
  agent: AgentDetail;
  archived: boolean;
  onSaved: (a: AgentDetail) => void;
}) {
  const api = useApi();
  const [system, setSystem] = useState(agent.system ?? "");
  const [model, setModel] = useState(agent.liveModel ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dirty = system !== (agent.system ?? "") || model !== (agent.liveModel ?? "");

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const updated = await api.updateAgent(agent.id, {
        system: system,
        model: model.trim() || undefined,
      });
      onSaved(updated);
      setSystem(updated.system ?? "");
      setModel(updated.liveModel ?? "");
      setMsg(`Salvo — v${updated.liveVersion}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard icon={Cpu} title="Configuração">
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
          Modelo
        </span>
        <input
          value={model}
          disabled={archived}
          onChange={(e) => setModel(e.target.value)}
          placeholder="claude-opus-4-7"
          className="mt-1.5 w-full rounded-xl border border-line bg-surface px-4 py-2.5 font-mono text-sm text-fg outline-none transition focus:border-line-strong disabled:opacity-60"
        />
      </label>
      <label className="mt-4 block">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
          System prompt
        </span>
        <textarea
          value={system}
          disabled={archived}
          onChange={(e) => setSystem(e.target.value)}
          rows={12}
          placeholder="(vazio)"
          className="mt-1.5 w-full resize-y rounded-xl border border-line bg-surface px-4 py-3 font-mono text-[13px] leading-relaxed text-fg outline-none transition focus:border-line-strong disabled:opacity-60"
        />
      </label>

      {!archived && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-fg-muted">{msg}</span>
          <button
            onClick={save}
            disabled={busy || !dirty}
            className="rounded-full bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:bg-black active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      )}
    </SectionCard>
  );
}

function RosterSection({
  agent,
  candidates,
  archived,
  onSaved,
}: {
  agent: AgentDetail;
  candidates: AgentSummary[];
  archived: boolean;
  onSaved: (a: AgentDetail) => void;
}) {
  const api = useApi();
  const initial = useMemo(
    () => new Set(agent.roster.map((r) => r.anthropicAgentId)),
    [agent.roster],
  );
  const [selected, setSelected] = useState<Set<string>>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setSelected(initial);
  }, [initial]);

  // Candidatos: ativos, não-orchestrator, não o próprio agente.
  const pool = candidates.filter(
    (c) =>
      c.status === "active" &&
      c.role !== "orchestrator" &&
      c.anthropicAgentId !== agent.anthropicAgentId,
  );

  const toggle = (aid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(aid)) next.delete(aid);
      else next.add(aid);
      return next;
    });
  };

  const dirty =
    selected.size !== initial.size ||
    [...selected].some((aid) => !initial.has(aid));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const updated = await api.updateAgent(agent.id, {
        roster: [...selected],
      });
      onSaved(updated);
      setMsg(`Roster salvo — v${updated.liveVersion}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard icon={Boxes} title="Roster multiagent (coordinator)">
      <p className="-mt-1 mb-4 text-sm text-fg-muted">
        Sub-agentes que este orquestrador pode acionar como threads paralelas.
        Marque pra anexar; o orquestrador decide em runtime quando delegar.
      </p>

      {/* visualização simples do roster atual */}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-black/[0.12] bg-elev px-4 py-3 text-sm">
        <span className="font-mono font-medium text-fg">{agent.slug}</span>
        <span className="text-fg-faint">→</span>
        {agent.roster.length === 0 ? (
          <span className="text-fg-muted">nenhum sub-agente anexado</span>
        ) : (
          agent.roster.map((r) => (
            <span
              key={r.anthropicAgentId}
              className="inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-0.5 font-mono text-xs text-fg"
            >
              {r.slug ?? r.anthropicAgentId}
            </span>
          ))
        )}
      </div>

      {pool.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Nenhum sub-agente disponível. Crie um na lista de agentes primeiro.
        </p>
      ) : (
        <div className="space-y-1.5">
          {pool.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm transition hover:bg-elev"
            >
              <input
                type="checkbox"
                disabled={archived}
                checked={selected.has(c.anthropicAgentId)}
                onChange={() => toggle(c.anthropicAgentId)}
                className="h-4 w-4 accent-black"
              />
              <span className="font-mono font-medium text-fg">{c.slug}</span>
              <span className="ml-auto inline-flex items-center rounded-full border border-line px-2 py-0.5 text-xs text-fg-muted">
                {ROLE_LABEL[c.role]}
              </span>
            </label>
          ))}
        </div>
      )}

      {!archived && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-fg-muted">{msg}</span>
          <button
            onClick={save}
            disabled={busy || !dirty}
            className="rounded-full bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:bg-black active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? "Salvando…" : "Salvar roster"}
          </button>
        </div>
      )}
    </SectionCard>
  );
}

function ReadOnlyLists({ agent }: { agent: AgentDetail }) {
  return (
    <>
      <SectionCard icon={Wrench} title="Ferramentas">
        {agent.tools.length === 0 ? (
          <p className="text-sm text-fg-muted">Nenhuma ferramenta.</p>
        ) : (
          <ul className="space-y-1.5">
            {agent.tools.map((t, i) => (
              <li
                key={i}
                className="rounded-xl border border-line bg-elev px-4 py-2.5 text-sm text-fg"
              >
                {t.label}
              </li>
            ))}
          </ul>
        )}
        {agent.skills.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
              Skills
            </p>
            <div className="flex flex-wrap gap-2">
              {agent.skills.map((s, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-full border border-line bg-surface px-3 py-1 font-mono text-xs text-fg-muted"
                >
                  {s.type}:{s.skillId}
                </span>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {agent.mcpServers.length > 0 && (
        <SectionCard icon={Plug} title="Servidores MCP">
          <ul className="space-y-1.5">
            {agent.mcpServers.map((m, i) => (
              <li
                key={i}
                className="rounded-xl border border-line bg-elev px-4 py-2.5 text-sm"
              >
                <span className="font-medium text-fg">{m.name}</span>
                <span className="ml-2 font-mono text-xs text-fg-faint">{m.url}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </>
  );
}

function ArchiveSection({
  agentId,
  onArchived,
}: {
  agentId: string;
  onArchived: () => void;
}) {
  const api = useApi();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doArchive = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.archiveAgent(agentId);
      onArchived();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-card border border-line bg-surface p-6 shadow-card">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-fg">Arquivar agente</p>
          <p className="mt-0.5 text-sm text-fg-muted">
            Remove dos rosters e torna read-only. Irreversível por design da
            Anthropic.
          </p>
        </div>
        <button
          onClick={() => setConfirm(true)}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line-strong bg-surface px-5 py-2.5 text-sm font-medium text-fg transition hover:bg-elev active:scale-[0.98]"
        >
          <Archive className="h-4 w-4" strokeWidth={1.5} />
          Arquivar
        </button>
      </div>

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
          onClick={() => !busy && setConfirm(false)}
        >
          <div
            className="glass w-full max-w-md rounded-card border border-line p-7 shadow-float"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold tracking-tight text-fg">
              Arquivar este agente?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              O agente será removido de qualquer roster do orquestrador e ficará
              read-only. A Anthropic não permite desarquivar — esta ação é
              permanente.
            </p>
            {err && <p className="mt-3 text-sm text-fg">{err}</p>}
            <div className="mt-6 flex justify-end gap-2.5">
              <button
                onClick={() => setConfirm(false)}
                disabled={busy}
                className="rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-medium text-fg transition hover:bg-elev disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={doArchive}
                disabled={busy}
                className="rounded-full bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:bg-black active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? "Arquivando…" : "Arquivar definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
