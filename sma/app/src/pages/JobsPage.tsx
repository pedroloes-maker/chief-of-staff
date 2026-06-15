import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CalendarClock,
  CheckCircle2,
  History,
  Pause,
  Play,
  Plus,
  Archive,
  XCircle,
  X,
} from "lucide-react";
import {
  useApi,
  type AgentRole,
  type AgentSummary,
  type DeploymentRunView,
  type DeploymentView,
} from "../lib/api";

const ROLE_LABEL: Record<AgentRole, string> = {
  orchestrator: "Orquestrador",
  builder: "Builder",
  sub_agent: "Sub-agente",
};

const STATUS_LABEL: Record<DeploymentView["status"], string> = {
  active: "Ativo",
  paused: "Pausado",
  archived: "Arquivado",
};

const CRON_PRESETS: Array<{ label: string; expr: string }> = [
  { label: "Todo dia 6h", expr: "0 6 * * *" },
  { label: "Todo dia 8h", expr: "0 8 * * *" },
  { label: "Seg–Sex 9h", expr: "0 9 * * 1-5" },
  { label: "Domingo 23h", expr: "0 23 * * 0" },
  { label: "A cada 30 min", expr: "*/30 * * * *" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function JobsPage() {
  const { slug } = useParams<{ slug: string }>();
  const api = useApi();

  const [deployments, setDeployments] = useState<DeploymentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      setDeployments(await api.listDeployments(slug));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, slug]);

  useEffect(() => {
    setDeployments(null);
    setError(null);
    setSelectedId(null);
    setCreating(false);
    setAgents([]);
    if (!slug) return;
    void load();
    api
      .listAgents(slug)
      .then(setAgents)
      .catch(() => {});
  }, [api, slug, load]);

  const selected = deployments?.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-6xl px-10 py-12">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        Workspace · {slug}
      </p>
      <h1 className="mt-1 mb-2 text-[28px] font-semibold tracking-tight text-fg">
        Agendamento
      </h1>
      <p className="mb-8 max-w-2xl text-sm text-fg-muted">
        Crons que disparam um agente — brief matinal, triagem de email,
        consolidação de memória. Rodam como Scheduled Deployments nativos da
        Anthropic (server-side, sempre ligados). Cada disparo cria uma sessão
        autônoma registrada no histórico.
      </p>

      {error && (
        <div className="mb-5 rounded-card border border-line bg-surface p-4 text-sm text-fg shadow-card">
          {error}
        </div>
      )}

      {!error && deployments && (
        <div className="flex gap-6">
          <aside className="w-80 shrink-0 space-y-2">
            <button
              onClick={() => {
                setCreating(true);
                setSelectedId(null);
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-card border border-line bg-surface px-4 py-2.5 text-sm font-medium text-fg shadow-card transition hover:bg-elev"
            >
              <Plus className="h-4 w-4" strokeWidth={1.5} />
              Novo agendamento
            </button>

            {deployments.length === 0 && (
              <div className="rounded-card border border-dashed border-black/[0.15] p-6 text-center text-sm text-fg-muted">
                Nenhum agendamento ainda.
              </div>
            )}

            {deployments.map((d) => {
              const active = d.id === selectedId && !creating;
              return (
                <button
                  key={d.id}
                  onClick={() => {
                    setSelectedId(d.id);
                    setCreating(false);
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-card border border-line px-4 py-3 text-left shadow-card transition-colors ${
                    active ? "bg-elev" : "bg-surface hover:bg-elev"
                  }`}
                >
                  <CalendarClock
                    className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted"
                    strokeWidth={1.5}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">
                      {d.name}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-fg-faint">
                      {d.schedule?.expression ?? "sem schedule"} ·{" "}
                      {d.agentSlug ?? d.agentId}
                    </span>
                    <span className="mt-1.5 inline-flex items-center gap-1.5">
                      <StatusDot status={d.status} />
                      <span className="text-[10px] text-fg-muted">
                        {STATUS_LABEL[d.status]}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </aside>

          <main className="min-w-0 flex-1">
            {creating ? (
              <CreateForm
                slug={slug!}
                agents={agents}
                onCancel={() => setCreating(false)}
                onCreated={async (id) => {
                  setCreating(false);
                  await load();
                  setSelectedId(id);
                }}
              />
            ) : selected ? (
              <DeploymentDetail
                key={selected.id}
                slug={slug!}
                deployment={selected}
                onChanged={load}
              />
            ) : (
              <div className="rounded-card border border-dashed border-black/[0.15] p-12 text-center text-sm text-fg-muted">
                Selecione um agendamento à esquerda, ou crie um novo.
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: DeploymentView["status"] }) {
  const cls =
    status === "active"
      ? "bg-fg"
      : status === "paused"
        ? "bg-fg-faint ring-1 ring-fg-faint"
        : "bg-transparent ring-1 ring-fg-faint";
  return <span className={`h-1.5 w-1.5 rounded-full ${cls}`} />;
}

function CreateForm({
  slug,
  agents,
  onCancel,
  onCreated,
}: {
  slug: string;
  agents: AgentSummary[];
  onCancel: () => void;
  onCreated: (id: string) => void | Promise<void>;
}) {
  const api = useApi();
  const pool = agents.filter((a) => a.status === "active");
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState(
    pool.find((a) => a.role === "orchestrator")?.id ?? pool[0]?.id ?? "",
  );
  const [cron, setCron] = useState("0 8 * * *");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [kickoff, setKickoff] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = name.trim() && agentId && cron.trim() && timezone.trim() && kickoff.trim();

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const created = await api.createDeployment(slug, {
        agentId,
        name: name.trim(),
        cronExpression: cron.trim(),
        timezone: timezone.trim(),
        kickoff: kickoff.trim(),
      });
      await onCreated(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-line bg-surface p-6 shadow-card">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-fg">
          Novo agendamento
        </h2>
        <button
          onClick={onCancel}
          className="text-fg-faint transition hover:text-fg"
          aria-label="Cancelar"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      <div className="space-y-4">
        <Field label="Nome">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Brief matinal"
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-fg outline-none transition focus:border-line-strong"
          />
        </Field>

        <Field label="Agente alvo">
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={pool.length === 0}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-fg outline-none transition focus:border-line-strong disabled:opacity-60"
          >
            {pool.length === 0 && <option value="">Nenhum agente ativo</option>}
            {pool.map((a) => (
              <option key={a.id} value={a.id}>
                {a.slug} · {ROLE_LABEL[a.role]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Cron (min hora dia mês dia-semana) + timezone">
          <div className="flex gap-2">
            <input
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 8 * * *"
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 py-2.5 font-mono text-sm text-fg outline-none transition focus:border-line-strong"
            />
            <input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/Sao_Paulo"
              className="w-48 shrink-0 rounded-xl border border-line bg-surface px-4 py-2.5 font-mono text-[13px] text-fg outline-none transition focus:border-line-strong"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CRON_PRESETS.map((p) => (
              <button
                key={p.expr}
                type="button"
                onClick={() => setCron(p.expr)}
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg-muted transition hover:bg-elev"
              >
                {p.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Mensagem de kickoff (enviada ao agente a cada disparo)">
          <textarea
            value={kickoff}
            onChange={(e) => setKickoff(e.target.value)}
            rows={5}
            placeholder="Leia minha inbox das últimas 24h e me dê um resumo do que é relevante."
            className="w-full resize-y rounded-xl border border-line bg-surface px-4 py-3 text-[13px] leading-relaxed text-fg outline-none transition focus:border-line-strong"
          />
        </Field>
      </div>

      {err && <p className="mt-3 text-sm text-fg">{err}</p>}

      <div className="mt-5 flex items-center justify-end gap-2.5">
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-medium text-fg transition hover:bg-elev disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={busy || !valid}
          className="rounded-full bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:bg-black active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? "Criando…" : "Criar agendamento"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

function DeploymentDetail({
  slug,
  deployment,
  onChanged,
}: {
  slug: string;
  deployment: DeploymentView;
  onChanged: () => Promise<void> | void;
}) {
  const api = useApi();
  const [runs, setRuns] = useState<DeploymentRunView[] | null>(null);
  const [runsErr, setRunsErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const archived = deployment.status === "archived";

  const loadRuns = useCallback(async () => {
    setRunsErr(null);
    try {
      setRuns(await api.listDeploymentRuns(slug, deployment.id));
    } catch (e) {
      setRunsErr(e instanceof Error ? e.message : String(e));
    }
  }, [api, slug, deployment.id]);

  useEffect(() => {
    setRuns(null);
    void loadRuns();
  }, [loadRuns]);

  const act = async (
    label: string,
    fn: () => Promise<unknown>,
    reloadRuns = false,
  ) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      await onChanged();
      if (reloadRuns) await loadRuns();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-1 h-5 w-5 text-fg-muted" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-fg">
              {deployment.name}
            </h2>
            <p className="font-mono text-xs text-fg-faint">{deployment.id}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-fg-muted">
                <StatusDot status={deployment.status} />
                {STATUS_LABEL[deployment.status]}
                {deployment.pausedReason && deployment.status === "paused"
                  ? ` · ${deployment.pausedReason}`
                  : ""}
              </span>
              <span className="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-fg-muted">
                {deployment.agentSlug ?? deployment.agentId}
                {deployment.agentRole ? ` · ${ROLE_LABEL[deployment.agentRole]}` : ""}
              </span>
            </div>
          </div>
        </div>

        {/* Schedule */}
        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
              Cron
            </p>
            <p className="mt-1 font-mono text-fg">
              {deployment.schedule?.expression ?? "—"}
            </p>
            <p className="font-mono text-[11px] text-fg-faint">
              {deployment.schedule?.timezone ?? ""}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
              Próximo disparo
            </p>
            <p className="mt-1 text-fg">
              {deployment.schedule?.upcomingRunsAt?.[0]
                ? formatDate(deployment.schedule.upcomingRunsAt[0])
                : archived
                  ? "—"
                  : "sem agenda"}
            </p>
            {deployment.schedule?.lastRunAt && (
              <p className="text-[11px] text-fg-faint">
                último: {formatDate(deployment.schedule.lastRunAt)}
              </p>
            )}
          </div>
        </div>

        {deployment.kickoff && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
              Kickoff
            </p>
            <p className="text-[13px] leading-relaxed text-fg-muted">
              {deployment.kickoff}
            </p>
          </div>
        )}

        {/* Ações */}
        {!archived && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <button
              onClick={() =>
                act("run", () => api.runDeployment(slug, deployment.id), true)
              }
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent-bg px-4 py-2 text-sm font-medium text-accent-fg transition hover:bg-black active:scale-[0.98] disabled:opacity-40"
            >
              <Play className="h-4 w-4" strokeWidth={1.5} />
              {busy === "run" ? "Disparando…" : "Rodar agora"}
            </button>
            {deployment.status === "paused" ? (
              <button
                onClick={() =>
                  act("unpause", () => api.unpauseDeployment(slug, deployment.id))
                }
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:bg-elev disabled:opacity-50"
              >
                <Play className="h-4 w-4" strokeWidth={1.5} />
                {busy === "unpause" ? "Retomando…" : "Retomar"}
              </button>
            ) : (
              <button
                onClick={() =>
                  act("pause", () => api.pauseDeployment(slug, deployment.id))
                }
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:bg-elev disabled:opacity-50"
              >
                <Pause className="h-4 w-4" strokeWidth={1.5} />
                {busy === "pause" ? "Pausando…" : "Pausar"}
              </button>
            )}
            <button
              onClick={() => setConfirmArchive(true)}
              disabled={!!busy}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:bg-elev disabled:opacity-50"
            >
              <Archive className="h-4 w-4" strokeWidth={1.5} />
              Arquivar
            </button>
          </div>
        )}

        {msg && <p className="mt-3 text-sm text-fg">{msg}</p>}
      </div>

      {/* Histórico de runs */}
      <div className="rounded-card border border-line bg-surface shadow-card">
        <div className="flex items-center gap-2.5 border-b border-line bg-elev px-5 py-3">
          <History className="h-4 w-4 text-fg-muted" strokeWidth={1.5} />
          <span className="text-sm font-medium text-fg">Disparos</span>
          {runs && (
            <span className="ml-auto text-[11px] text-fg-faint">
              {runs.length} run{runs.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {runsErr ? (
          <p className="px-5 py-4 text-sm text-fg">{runsErr}</p>
        ) : runs === null ? (
          <p className="px-5 py-4 text-sm text-fg-muted">Carregando…</p>
        ) : runs.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-muted">
            Nenhum disparo ainda. Use "Rodar agora" pra testar.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {runs.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                {r.status === "success" ? (
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-fg"
                    strokeWidth={1.5}
                  />
                ) : (
                  <XCircle
                    className="mt-0.5 h-4 w-4 shrink-0 text-fg-faint"
                    strokeWidth={1.5}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-muted">
                      {r.trigger === "manual" ? "Manual" : "Agendado"}
                    </span>
                    <span className="text-[11px] text-fg-muted">
                      {formatDate(r.createdAt)}
                    </span>
                  </div>
                  {r.status === "success" ? (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-fg-faint">
                      {r.sessionId}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[12px] text-fg-muted">
                      {r.errorType}
                      {r.errorMessage ? ` — ${r.errorMessage}` : ""}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirmArchive && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6"
          onClick={() => !busy && setConfirmArchive(false)}
        >
          <div
            className="glass w-full max-w-md rounded-card border border-line p-7 shadow-float"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold tracking-tight text-fg">
              Arquivar este agendamento?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              O schedule para imediatamente e o deployment fica imutável. A
              Anthropic não permite desarquivar — esta ação é permanente. Pra
              algo reversível, use Pausar.
            </p>
            <div className="mt-6 flex justify-end gap-2.5">
              <button
                onClick={() => setConfirmArchive(false)}
                disabled={!!busy}
                className="rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-medium text-fg transition hover:bg-elev disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() =>
                  act("archive", () =>
                    api.archiveDeployment(slug, deployment.id),
                  ).then(() => setConfirmArchive(false))
                }
                disabled={!!busy}
                className="rounded-full bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:bg-black active:scale-[0.98] disabled:opacity-50"
              >
                {busy === "archive" ? "Arquivando…" : "Arquivar definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
