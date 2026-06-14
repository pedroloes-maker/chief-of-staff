import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  EyeOff,
  FileText,
  History,
} from "lucide-react";
import {
  useApi,
  type MemoryActorView,
  type MemoryContentView,
  type MemoryItemView,
  type MemoryStoreView,
  type MemoryVersionContentView,
  type MemoryVersionView,
} from "../lib/api";

const OPERATION_LABEL: Record<MemoryVersionView["operation"], string> = {
  created: "Criada",
  modified: "Modificada",
  deleted: "Removida",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function actorLabel(a: MemoryActorView): string {
  switch (a.type) {
    case "session":
      return `Sessão ${a.sessionId}`;
    case "api":
      return `API key ${a.apiKeyId}`;
    case "user":
      return `Usuário ${a.userId}`;
    default:
      return "—";
  }
}

export default function MemoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const api = useApi();
  const [stores, setStores] = useState<MemoryStoreView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [storeId, setStoreId] = useState<string | null>(null);
  const [memories, setMemories] = useState<MemoryItemView[] | null>(null);
  const [memErr, setMemErr] = useState<string | null>(null);

  const [memory, setMemory] = useState<MemoryItemView | null>(null);
  const [content, setContent] = useState<MemoryContentView | null>(null);
  const [versions, setVersions] = useState<MemoryVersionView[] | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<
    Record<string, MemoryVersionContentView | "loading">
  >({});
  const [busyRedact, setBusyRedact] = useState<string | null>(null);

  useEffect(() => {
    setStores(null);
    setError(null);
    setStoreId(null);
    setMemories(null);
    setMemory(null);
    if (!slug) return;
    api
      .listMemoryStores(slug)
      .then(setStores)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, slug]);

  const selectStore = useCallback(
    (id: string) => {
      if (!slug) return;
      setStoreId(id);
      setMemories(null);
      setMemErr(null);
      setMemory(null);
      setContent(null);
      setVersions(null);
      api
        .listMemories(slug, id)
        .then(setMemories)
        .catch((e) => setMemErr(e instanceof Error ? e.message : String(e)));
    },
    [api, slug],
  );

  const loadDetail = useCallback(
    (sId: string, m: MemoryItemView) => {
      if (!slug) return;
      setMemory(m);
      setContent(null);
      setVersions(null);
      setExpanded({});
      setDetailErr(null);
      Promise.all([
        api.getMemory(slug, sId, m.id),
        api.listMemoryVersions(slug, sId, m.id),
      ])
        .then(([c, v]) => {
          setContent(c);
          setVersions(v);
        })
        .catch((e) => setDetailErr(e instanceof Error ? e.message : String(e)));
    },
    [api, slug],
  );

  const toggleVersion = async (v: MemoryVersionView) => {
    if (!slug || !storeId) return;
    if (expanded[v.id]) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[v.id];
        return next;
      });
      return;
    }
    setExpanded((prev) => ({ ...prev, [v.id]: "loading" }));
    try {
      const full = await api.getMemoryVersion(slug, storeId, v.id);
      setExpanded((prev) => ({ ...prev, [v.id]: full }));
    } catch (e) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[v.id];
        return next;
      });
      setDetailErr(e instanceof Error ? e.message : String(e));
    }
  };

  const redact = async (v: MemoryVersionView) => {
    if (!slug || !storeId || !memory) return;
    if (
      !confirm(
        "Redigir esta versão? O conteúdo é apagado de forma irreversível, mantendo só os metadados de auditoria.",
      )
    ) {
      return;
    }
    setBusyRedact(v.id);
    try {
      await api.redactMemoryVersion(slug, storeId, v.id);
      loadDetail(storeId, memory);
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyRedact(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-10 py-12">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        Workspace · {slug}
      </p>
      <h1 className="mt-1 mb-2 text-[28px] font-semibold tracking-tight text-fg">
        Memória
      </h1>
      <p className="mb-8 max-w-2xl text-sm text-fg-muted">
        Memory stores deste workspace — o que o agente lembra. Selecione um store
        pra ver os arquivos, o conteúdo e o histórico de versões. Versões antigas
        podem ser redigidas por compliance.
      </p>

      {error && (
        <div className="mb-5 rounded-card border border-line bg-surface p-4 text-sm text-fg shadow-card">
          {error}
        </div>
      )}

      {!error && stores && stores.length === 0 && (
        <div className="rounded-card border border-dashed border-black/[0.15] p-10 text-center text-sm text-fg-muted">
          Nenhum memory store ainda. Rode o provision-workspace pra criar os
          stores de curto/longo prazo e conhecimento.
        </div>
      )}

      {stores && stores.length > 0 && (
        <div className="flex gap-6">
          {/* Coluna esquerda: stores + memories */}
          <aside className="w-80 shrink-0 space-y-3">
            {stores.map((s) => {
              const active = s.id === storeId;
              return (
                <div
                  key={s.id}
                  className="overflow-hidden rounded-card border border-line bg-surface shadow-card"
                >
                  <button
                    onClick={() => selectStore(s.id)}
                    className={`flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors ${
                      active ? "bg-elev" : "hover:bg-elev"
                    }`}
                  >
                    <Brain
                      className="h-4 w-4 shrink-0 text-fg-muted"
                      strokeWidth={1.5}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {s.tierLabel}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-fg-faint">
                        {s.slug}
                      </span>
                    </span>
                  </button>

                  {active && (
                    <div className="border-t border-line">
                      {memErr && (
                        <p className="px-4 py-3 text-xs text-fg">{memErr}</p>
                      )}
                      {!memErr && memories === null && (
                        <p className="px-4 py-3 text-xs text-fg-muted">
                          Carregando…
                        </p>
                      )}
                      {memories && memories.length === 0 && (
                        <p className="px-4 py-3 text-xs text-fg-muted">
                          Store vazio — nada gravado ainda.
                        </p>
                      )}
                      {memories && memories.length > 0 && (
                        <ul>
                          {memories.map((m) => {
                            const sel = memory?.id === m.id;
                            return (
                              <li key={m.id}>
                                <button
                                  onClick={() => loadDetail(s.id, m)}
                                  className={`flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left transition-colors first:border-t-0 ${
                                    sel
                                      ? "bg-accent-bg text-accent-fg"
                                      : "hover:bg-elev"
                                  }`}
                                >
                                  <FileText
                                    className={`h-3.5 w-3.5 shrink-0 ${sel ? "text-accent-fg" : "text-fg-faint"}`}
                                    strokeWidth={1.5}
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span
                                      className={`block truncate font-mono text-xs ${sel ? "text-accent-fg" : "text-fg"}`}
                                    >
                                      {m.path}
                                    </span>
                                    <span
                                      className={`block text-[10px] ${sel ? "text-accent-fg/70" : "text-fg-faint"}`}
                                    >
                                      {formatBytes(m.contentSizeBytes)} ·{" "}
                                      {formatDate(m.updatedAt)}
                                    </span>
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </aside>

          {/* Coluna direita: conteúdo + versões */}
          <main className="min-w-0 flex-1">
            {detailErr && (
              <div className="mb-4 rounded-card border border-line bg-surface p-4 text-sm text-fg shadow-card">
                {detailErr}
              </div>
            )}

            {!memory && !detailErr && (
              <div className="rounded-card border border-dashed border-black/[0.15] p-12 text-center text-sm text-fg-muted">
                {storeId
                  ? "Selecione um arquivo à esquerda pra ver o conteúdo."
                  : "Selecione um store à esquerda pra começar."}
              </div>
            )}

            {memory && (
              <div className="space-y-5">
                <div className="rounded-card border border-line bg-surface shadow-card">
                  <div className="flex items-center gap-2.5 border-b border-line bg-elev px-5 py-3">
                    <FileText
                      className="h-4 w-4 text-fg-muted"
                      strokeWidth={1.5}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium text-fg">
                      {memory.path}
                    </span>
                    {content && (
                      <span className="shrink-0 text-[11px] text-fg-faint">
                        {formatBytes(content.contentSizeBytes)}
                      </span>
                    )}
                  </div>
                  {content === null ? (
                    <p className="px-5 py-4 text-sm text-fg-muted">Carregando…</p>
                  ) : content.content ? (
                    <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap px-5 py-4 text-[13px] leading-relaxed text-fg">
                      {content.content}
                    </pre>
                  ) : (
                    <p className="px-5 py-4 text-sm text-fg-muted">
                      Sem conteúdo (vazio ou redigido).
                    </p>
                  )}
                </div>

                <div className="rounded-card border border-line bg-surface shadow-card">
                  <div className="flex items-center gap-2.5 border-b border-line bg-elev px-5 py-3">
                    <History className="h-4 w-4 text-fg-muted" strokeWidth={1.5} />
                    <span className="text-sm font-medium text-fg">
                      Histórico de versões
                    </span>
                    {versions && (
                      <span className="ml-auto text-[11px] text-fg-faint">
                        {versions.length} versã{versions.length === 1 ? "o" : "es"}
                      </span>
                    )}
                  </div>
                  {versions === null ? (
                    <p className="px-5 py-4 text-sm text-fg-muted">Carregando…</p>
                  ) : versions.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-fg-muted">
                      Sem versões.
                    </p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {versions.map((v) => {
                        const exp = expanded[v.id];
                        return (
                          <li key={v.id} className="px-5 py-3.5">
                            <div className="flex items-start gap-3">
                              <button
                                onClick={() => toggleVersion(v)}
                                className="mt-0.5 shrink-0 text-fg-faint transition-colors hover:text-fg"
                                aria-label="Expandir versão"
                              >
                                {exp ? (
                                  <ChevronDown
                                    className="h-4 w-4"
                                    strokeWidth={1.5}
                                  />
                                ) : (
                                  <ChevronRight
                                    className="h-4 w-4"
                                    strokeWidth={1.5}
                                  />
                                )}
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-muted">
                                    {OPERATION_LABEL[v.operation]}
                                  </span>
                                  {v.redacted && (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-faint">
                                      <EyeOff
                                        className="h-3 w-3"
                                        strokeWidth={1.5}
                                      />
                                      Redigida
                                    </span>
                                  )}
                                  <span className="text-[11px] text-fg-muted">
                                    {formatDate(v.createdAt)}
                                  </span>
                                  {v.contentSizeBytes != null && (
                                    <span className="text-[11px] text-fg-faint">
                                      {formatBytes(v.contentSizeBytes)}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 truncate font-mono text-[11px] text-fg-faint">
                                  {actorLabel(v.createdBy)}
                                </p>

                                {exp && (
                                  <div className="mt-2 rounded-xl border border-line bg-elev p-3">
                                    {exp === "loading" ? (
                                      <p className="text-xs text-fg-muted">
                                        Carregando…
                                      </p>
                                    ) : exp.content ? (
                                      <pre className="max-h-[30vh] overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-fg">
                                        {exp.content}
                                      </pre>
                                    ) : (
                                      <p className="text-xs text-fg-muted">
                                        Sem conteúdo (vazio ou redigido).
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>

                              {!v.redacted && (
                                <button
                                  onClick={() => redact(v)}
                                  disabled={busyRedact === v.id}
                                  className="shrink-0 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-fg transition hover:bg-elev disabled:opacity-50"
                                >
                                  {busyRedact === v.id ? "Redigindo…" : "Redigir"}
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
