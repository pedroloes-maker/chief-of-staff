import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { History, Package, Plus, Wrench, X } from "lucide-react";
import {
  useApi,
  type AgentRole,
  type AgentSummary,
  type SkillVersionView,
  type SkillView,
} from "../lib/api";

const ROLE_LABEL: Record<AgentRole, string> = {
  orchestrator: "Orquestrador",
  builder: "Builder",
  sub_agent: "Sub-agente",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

const SKILL_TEMPLATE = `---
name: minha_skill
description: Quando e como usar esta skill (o modelo lê isto pra decidir).
---

# Instruções

Escreva aqui o passo-a-passo, exemplos e boas práticas da skill.
`;

export default function SkillsPage() {
  const { slug } = useParams<{ slug: string }>();
  const api = useApi();

  const [skills, setSkills] = useState<SkillView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    if (!slug) return;
    try {
      setSkills(await api.listSkills(slug));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, slug]);

  useEffect(() => {
    setSkills(null);
    setError(null);
    setSelectedId(null);
    setAgents([]);
    if (!slug) return;
    void loadSkills();
    api
      .listAgents(slug)
      .then(setAgents)
      .catch(() => {});
  }, [api, slug, loadSkills]);

  const selected = skills?.find((s) => s.skillId === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-6xl px-10 py-12">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        Workspace · {slug}
      </p>
      <h1 className="mt-1 mb-2 text-[28px] font-semibold tracking-tight text-fg">
        Skills
      </h1>
      <p className="mb-8 max-w-2xl text-sm text-fg-muted">
        Skills deste workspace — instruções especializadas que os agentes carregam
        sob demanda. As custom são suas (com histórico de versões); as prebuilt
        são da Anthropic. Selecione uma pra ver quem a usa, anexá-la a um agente e
        gerenciar versões.
      </p>

      {error && (
        <div className="mb-5 rounded-card border border-line bg-surface p-4 text-sm text-fg shadow-card">
          {error}
        </div>
      )}

      {!error && skills && (
        <div className="flex gap-6">
          <aside className="w-80 shrink-0 space-y-2">
            {skills.map((s) => {
              const active = s.skillId === selectedId;
              return (
                <button
                  key={s.skillId}
                  onClick={() => setSelectedId(s.skillId)}
                  className={`flex w-full items-start gap-2.5 rounded-card border border-line px-4 py-3 text-left shadow-card transition-colors ${
                    active ? "bg-elev" : "bg-surface hover:bg-elev"
                  }`}
                >
                  {s.source === "custom" ? (
                    <Wrench
                      className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <Package
                      className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted"
                      strokeWidth={1.5}
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">
                      {s.title ?? s.slug}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-fg-faint">
                      {s.slug}
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-fg-muted">
                        {s.source === "custom" ? "Custom" : "Anthropic"}
                      </span>
                      {s.usedBy.length > 0 && (
                        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-fg-muted">
                          {s.usedBy.length} agente
                          {s.usedBy.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </aside>

          <main className="min-w-0 flex-1">
            {!selected ? (
              <div className="rounded-card border border-dashed border-black/[0.15] p-12 text-center text-sm text-fg-muted">
                Selecione uma skill à esquerda pra ver detalhes.
              </div>
            ) : (
              <SkillDetail
                key={selected.skillId}
                slug={slug!}
                skill={selected}
                agents={agents}
                onChanged={loadSkills}
              />
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function SkillDetail({
  slug,
  skill,
  agents,
  onChanged,
}: {
  slug: string;
  skill: SkillView;
  agents: AgentSummary[];
  onChanged: () => Promise<void> | void;
}) {
  const api = useApi();
  const [attachTo, setAttachTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const usedAgentIds = new Set(skill.usedBy.map((u) => u.agentId));
  const pool = agents.filter(
    (a) => a.status === "active" && !usedAgentIds.has(a.id),
  );

  const attach = async () => {
    if (!attachTo) return;
    setBusy("attach");
    setMsg(null);
    try {
      await api.attachSkill(attachTo, {
        source: skill.source,
        skillId: skill.skillId,
        version: skill.latestVersion,
      });
      setAttachTo("");
      await onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const detach = async (agentId: string) => {
    setBusy(agentId);
    setMsg(null);
    try {
      await api.detachSkill(agentId, skill.skillId);
      await onChanged();
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
          {skill.source === "custom" ? (
            <Wrench className="mt-1 h-5 w-5 text-fg-muted" strokeWidth={1.5} />
          ) : (
            <Package className="mt-1 h-5 w-5 text-fg-muted" strokeWidth={1.5} />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-fg">
              {skill.title ?? skill.slug}
            </h2>
            <p className="font-mono text-xs text-fg-faint">{skill.skillId}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-fg-muted">
                {skill.source === "custom" ? "Custom" : "Anthropic prebuilt"}
              </span>
              {skill.latestVersion && (
                <span className="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 font-mono text-fg-muted">
                  latest {skill.latestVersion}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Uso por agente + anexar */}
      <div className="rounded-card border border-line bg-surface shadow-card">
        <div className="flex items-center gap-2.5 border-b border-line bg-elev px-5 py-3">
          <Wrench className="h-4 w-4 text-fg-muted" strokeWidth={1.5} />
          <span className="text-sm font-medium text-fg">Usada por</span>
          <span className="ml-auto text-[11px] text-fg-faint">
            {skill.usedBy.length} agente{skill.usedBy.length === 1 ? "" : "s"}
          </span>
        </div>

        {skill.usedBy.length === 0 ? (
          <p className="px-5 py-4 text-sm text-fg-muted">
            Nenhum agente usa esta skill ainda.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {skill.usedBy.map((u) => (
              <li
                key={u.agentId}
                className="flex items-center gap-3 px-5 py-3 text-sm"
              >
                <span className="font-mono font-medium text-fg">
                  {u.agentSlug}
                </span>
                <span className="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-muted">
                  {ROLE_LABEL[u.agentRole]}
                </span>
                <span className="font-mono text-[11px] text-fg-faint">
                  v{u.version}
                </span>
                <button
                  onClick={() => detach(u.agentId)}
                  disabled={busy === u.agentId}
                  className="ml-auto shrink-0 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-fg transition hover:bg-elev disabled:opacity-50"
                >
                  {busy === u.agentId ? "Desanexando…" : "Desanexar"}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2.5 border-t border-line px-5 py-3.5">
          <select
            value={attachTo}
            onChange={(e) => setAttachTo(e.target.value)}
            disabled={pool.length === 0}
            className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg outline-none transition focus:border-line-strong disabled:opacity-60"
          >
            <option value="">
              {pool.length === 0
                ? "Todos os agentes já usam esta skill"
                : "Anexar a um agente…"}
            </option>
            {pool.map((a) => (
              <option key={a.id} value={a.id}>
                {a.slug} · {ROLE_LABEL[a.role]}
              </option>
            ))}
          </select>
          <button
            onClick={attach}
            disabled={!attachTo || busy === "attach"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-bg px-4 py-2 text-sm font-medium text-accent-fg transition hover:bg-black active:scale-[0.98] disabled:opacity-40"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Anexar
          </button>
        </div>

        {msg && <p className="px-5 pb-3.5 text-xs text-fg">{msg}</p>}
      </div>

      {skill.source === "custom" ? (
        <VersionsSection
          slug={slug}
          skillId={skill.skillId}
          onChanged={onChanged}
        />
      ) : (
        <div className="rounded-card border border-dashed border-black/[0.15] px-5 py-4 text-sm text-fg-muted">
          Skill prebuilt da Anthropic — versionada pela Anthropic, sem edição
          aqui.
        </div>
      )}
    </div>
  );
}

function VersionsSection({
  slug,
  skillId,
  onChanged,
}: {
  slug: string;
  skillId: string;
  onChanged: () => Promise<void> | void;
}) {
  const api = useApi();
  const [versions, setVersions] = useState<SkillVersionView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [markdown, setMarkdown] = useState(SKILL_TEMPLATE);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setVersions(await api.listSkillVersions(slug, skillId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [api, slug, skillId]);

  useEffect(() => {
    setVersions(null);
    void load();
  }, [load]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.createSkillVersion(slug, skillId, markdown);
      setEditing(false);
      setMarkdown(SKILL_TEMPLATE);
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-line bg-surface shadow-card">
      <div className="flex items-center gap-2.5 border-b border-line bg-elev px-5 py-3">
        <History className="h-4 w-4 text-fg-muted" strokeWidth={1.5} />
        <span className="text-sm font-medium text-fg">Versões</span>
        {versions && (
          <span className="ml-auto text-[11px] text-fg-faint">
            {versions.length} versã{versions.length === 1 ? "o" : "es"}
          </span>
        )}
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-fg transition hover:bg-elev ${versions ? "ml-3" : "ml-auto"}`}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Nova versão
          </button>
        )}
      </div>

      {editing && (
        <div className="border-b border-line px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
              Conteúdo do SKILL.md
            </span>
            <button
              onClick={() => setEditing(false)}
              className="text-fg-faint transition hover:text-fg"
              aria-label="Cancelar"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            rows={14}
            className="w-full resize-y rounded-xl border border-line bg-surface px-4 py-3 font-mono text-[12px] leading-relaxed text-fg outline-none transition focus:border-line-strong"
          />
          <div className="mt-3 flex items-center justify-end gap-2.5">
            <button
              onClick={() => setEditing(false)}
              disabled={busy}
              className="rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-medium text-fg transition hover:bg-elev disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={busy || !markdown.trim()}
              className="rounded-full bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:bg-black active:scale-[0.98] disabled:opacity-40"
            >
              {busy ? "Publicando…" : "Publicar versão"}
            </button>
          </div>
        </div>
      )}

      {err && <p className="px-5 py-3 text-sm text-fg">{err}</p>}

      {versions === null ? (
        <p className="px-5 py-4 text-sm text-fg-muted">Carregando…</p>
      ) : versions.length === 0 ? (
        <p className="px-5 py-4 text-sm text-fg-muted">Sem versões ainda.</p>
      ) : (
        <ul className="divide-y divide-line">
          {versions.map((v) => (
            <li key={v.version} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium text-fg">
                  {v.name}
                </span>
                <span className="font-mono text-[11px] text-fg-faint">
                  {v.version}
                </span>
                <span className="ml-auto text-[11px] text-fg-muted">
                  {formatDate(v.createdAt)}
                </span>
              </div>
              {v.description && (
                <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">
                  {v.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
