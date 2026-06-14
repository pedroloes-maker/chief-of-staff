import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Plus, RefreshCw, Search } from "lucide-react";
import { useApi, type AgentRole, type AgentSummary } from "../lib/api";

const ROLE_LABEL: Record<AgentRole, string> = {
  orchestrator: "Orquestrador",
  builder: "Builder",
  sub_agent: "Sub-agente",
};

// Filtro combinado (single-select): status (Ativos/Arquivados) + papel
// (Orquestrador/Sub-Agentes). "Sub-Agentes" engloba o builder, que é
// conceitualmente um sub-agente. Default Ativos pra arquivados não poluírem.
type AgentFilter =
  | "all"
  | "active"
  | "archived"
  | "orchestrator"
  | "sub_agents";

const FILTER_LABEL: Record<AgentFilter, string> = {
  all: "Todos",
  active: "Ativos",
  archived: "Arquivados",
  orchestrator: "Orquestrador",
  sub_agents: "Sub-Agentes",
};

const FILTER_ORDER: AgentFilter[] = [
  "all",
  "active",
  "archived",
  "orchestrator",
  "sub_agents",
];

function matchesFilter(a: AgentSummary, f: AgentFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "active":
      return a.status === "active";
    case "archived":
      return a.status === "archived";
    case "orchestrator":
      return a.role === "orchestrator";
    case "sub_agents":
      return a.role === "sub_agent" || a.role === "builder";
  }
}

export default function AgentsPage() {
  const { slug } = useParams<{ slug: string }>();
  const api = useApi();
  const [data, setData] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AgentFilter>("active");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const refetch = useCallback(() => {
    if (!slug) return;
    api
      .listAgents(slug)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, slug]);

  useEffect(() => {
    setData(null);
    setError(null);
    refetch();
  }, [refetch]);

  const onSync = async () => {
    if (!slug) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await api.syncAgents(slug);
      setSyncMsg(`Sincronizado: ${r.synced} atualizado(s), ${r.created} novo(s).`);
      refetch();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.filter(
      (a) =>
        matchesFilter(a, filter) &&
        (q === "" || a.slug.toLowerCase().includes(q)),
    );
  }, [data, query, filter]);

  return (
    <div className="mx-auto max-w-5xl px-10 py-12">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        Workspace · {slug}
      </p>
      <div className="mt-1 mb-8 flex items-center justify-between gap-4">
        <h1 className="text-[28px] font-semibold tracking-tight text-fg">Agentes</h1>
        <div className="flex items-center gap-2.5">
          <button
            onClick={onSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-medium text-fg shadow-card transition duration-150 hover:bg-elev active:scale-[0.98] disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`}
              strokeWidth={1.5}
            />
            {syncing ? "Sincronizando…" : "Sincronizar"}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-full bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent-fg shadow-card transition duration-150 hover:bg-black active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Novo sub-agente
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className="mb-4 rounded-card border border-line bg-elev px-4 py-2.5 text-sm text-fg-muted">
          {syncMsg}
        </div>
      )}

      {/* busca + filtro por kind */}
      <div className="mb-5 flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint"
            strokeWidth={1.5}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por slug…"
            className="w-full rounded-xl border border-line bg-surface py-2.5 pl-10 pr-4 text-sm text-fg shadow-card outline-none transition focus:border-line-strong"
          />
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-card">
          {FILTER_ORDER.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-accent-bg text-accent-fg"
                  : "text-fg-muted hover:bg-elev"
              }`}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-card border border-line bg-surface p-6 text-sm text-fg shadow-card">
          Erro ao carregar agentes: {error}
        </div>
      )}

      {!error && data && filtered.length === 0 && (
        <div className="rounded-card border border-dashed border-black/[0.15] p-10 text-center text-sm text-fg-muted">
          {data.length === 0
            ? "Nenhum agente neste workspace. Rode o provision-workspace ou clique em Sincronizar."
            : "Nenhum agente bate com o filtro."}
        </div>
      )}

      {data && filtered.length > 0 && (
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-elev text-[11px] uppercase tracking-[0.08em] text-fg-faint">
              <tr>
                <th className="px-5 py-3.5 font-semibold">Agente</th>
                <th className="px-5 py-3.5 font-semibold">Papel</th>
                <th className="px-5 py-3.5 font-semibold">Modelo</th>
                <th className="px-5 py-3.5 font-semibold">Versão</th>
                <th className="px-5 py-3.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-elev"
                >
                  <td className="px-5 py-3.5">
                    <Link
                      to={`/w/${slug}/agents/${a.id}`}
                      className="font-mono font-medium text-fg underline-offset-4 hover:underline"
                    >
                      {a.slug}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-xs text-fg-muted">
                      {ROLE_LABEL[a.role]}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-fg-muted">
                    {a.model ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-fg-muted">
                    {a.version ? `v${a.version}` : "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs text-fg-muted">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${a.status === "active" ? "bg-fg" : "bg-fg-faint"}`}
                      />
                      {a.status === "active" ? "Ativo" : "Arquivado"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && slug && (
        <CreateSubAgentModal
          slug={slug}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function CreateSubAgentModal({
  slug,
  onClose,
  onCreated,
}: {
  slug: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const api = useApi();
  const [name, setName] = useState("");
  const [system, setSystem] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setErr("Nome é obrigatório.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.createSubAgent(slug, {
        name: name.trim(),
        system: system.trim() || undefined,
        model: model.trim() || undefined,
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
      onClick={onClose}
    >
      <div
        className="glass w-full max-w-lg rounded-card border border-line p-7 shadow-float"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold tracking-tight text-fg">
          Novo sub-agente
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Criado na Anthropic e espelhado localmente. Depois você pode anexá-lo
          ao roster do orquestrador.
        </p>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
              Nome
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex. Pesquisador"
              className="mt-1.5 w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-fg outline-none transition focus:border-line-strong"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
              Modelo <span className="normal-case text-fg-faint">(opcional)</span>
            </span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-haiku-4-5 (default)"
              className="mt-1.5 w-full rounded-xl border border-line bg-surface px-4 py-2.5 font-mono text-sm text-fg outline-none transition focus:border-line-strong"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
              System prompt{" "}
              <span className="normal-case text-fg-faint">(opcional)</span>
            </span>
            <textarea
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              rows={5}
              placeholder="Como esse sub-agente deve se comportar…"
              className="mt-1.5 w-full resize-y rounded-xl border border-line bg-surface px-4 py-2.5 text-sm leading-relaxed text-fg outline-none transition focus:border-line-strong"
            />
          </label>
        </div>

        {err && <p className="mt-3 text-sm text-fg">{err}</p>}

        <div className="mt-6 flex justify-end gap-2.5">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-medium text-fg transition hover:bg-elev disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-full bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:bg-black active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? "Criando…" : "Criar sub-agente"}
          </button>
        </div>
      </div>
    </div>
  );
}
