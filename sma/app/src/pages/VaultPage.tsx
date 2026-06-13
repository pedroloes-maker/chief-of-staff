import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Database, KeyRound, ShieldCheck } from "lucide-react";
import { useApi, type VaultView } from "../lib/api";

const TYPE_LABEL: Record<string, string> = {
  static_bearer: "Bearer estático",
  mcp_oauth: "OAuth (MCP)",
  environment_variable: "Variável de ambiente",
};

export default function VaultPage() {
  const { slug } = useParams<{ slug: string }>();
  const api = useApi();
  const [vaults, setVaults] = useState<VaultView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!slug) return;
    setError(null);
    api
      .listVaults(slug)
      .then(setVaults)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, slug]);

  useEffect(() => {
    setVaults(null);
    refetch();
  }, [refetch]);

  const archive = async (vaultId: string, credId: string) => {
    if (!slug) return;
    if (!confirm("Arquivar esta credencial? O agente perde o acesso até reconectar.")) {
      return;
    }
    setBusy(credId);
    try {
      await api.archiveCredential(slug, vaultId, credId);
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-10 py-12">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        Workspace · {slug}
      </p>
      <h1 className="mt-1 mb-2 text-[28px] font-semibold tracking-tight text-fg">
        Cofre
      </h1>
      <p className="mb-8 max-w-2xl text-sm text-fg-muted">
        Credenciais guardadas nas vaults Anthropic deste workspace (MCP `sma` e
        conectores Google). Os valores dos tokens nunca são expostos. As vaults
        são criadas automaticamente ao provisionar/conectar.
      </p>

      {error && (
        <div className="mb-5 rounded-card border border-line bg-surface p-4 text-sm text-fg shadow-card">
          {error}
        </div>
      )}

      {!error && vaults && vaults.length === 0 && (
        <div className="rounded-card border border-dashed border-black/[0.15] p-10 text-center text-sm text-fg-muted">
          Nenhuma vault ainda. Provisione o workspace ou conecte um serviço Google.
        </div>
      )}

      <div className="space-y-4">
        {(vaults ?? []).map((vault) => (
          <div
            key={vault.id}
            className="overflow-hidden rounded-card border border-line bg-surface shadow-card"
          >
            <div className="flex items-center gap-2.5 border-b border-line bg-elev px-5 py-3">
              <Database className="h-4 w-4 text-fg-muted" strokeWidth={1.5} />
              <span className="text-sm font-medium text-fg">
                {vault.displayName ?? "vault"}
              </span>
              {vault.kind && (
                <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-fg-muted">
                  {vault.kind}
                </span>
              )}
              <span className="ml-auto font-mono text-[11px] text-fg-faint">
                {vault.id}
              </span>
            </div>

            {vault.credentials.length === 0 ? (
              <p className="px-5 py-4 text-sm text-fg-muted">
                Sem credenciais nesta vault.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {vault.credentials.map((c) => {
                  const archived = !!c.archivedAt;
                  return (
                    <li
                      key={c.id}
                      className={`flex items-start gap-3 px-5 py-3.5 ${archived ? "opacity-55" : ""}`}
                    >
                      <div className="mt-0.5">
                        {c.type === "mcp_oauth" ? (
                          <KeyRound className="h-4 w-4 text-fg-muted" strokeWidth={1.5} />
                        ) : (
                          <ShieldCheck className="h-4 w-4 text-fg-muted" strokeWidth={1.5} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-fg">
                            {c.displayName ?? "credencial"}
                          </span>
                          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-muted">
                            {TYPE_LABEL[c.type] ?? c.type}
                          </span>
                          {archived && (
                            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-faint">
                              Arquivada
                            </span>
                          )}
                        </div>
                        {c.mcpServerUrl && (
                          <p className="mt-0.5 truncate font-mono text-[11px] text-fg-faint">
                            {c.mcpServerUrl}
                          </p>
                        )}
                        <p className="mt-0.5 text-[11px] text-fg-muted">
                          {c.scope && <>escopo: {c.scope}</>}
                          {c.expiresAt && (
                            <>
                              {c.scope ? " · " : ""}expira{" "}
                              {new Date(c.expiresAt).toLocaleString("pt-BR", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </>
                          )}
                        </p>
                      </div>
                      {!archived && (
                        <button
                          onClick={() => archive(vault.id, c.id)}
                          disabled={busy === c.id}
                          className="shrink-0 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-fg transition hover:bg-elev disabled:opacity-50"
                        >
                          {busy === c.id ? "Arquivando…" : "Arquivar"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
