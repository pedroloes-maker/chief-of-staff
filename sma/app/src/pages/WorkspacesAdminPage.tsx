import { useState } from "react";
import { Archive, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useApi, useWorkspaces } from "../lib/api";

export default function WorkspacesAdminPage() {
  const { data, error, loading, refetch } = useWorkspaces();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="mx-auto max-w-5xl px-10 py-12">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        Admin
      </p>
      <div className="mt-1 mb-8 flex items-center justify-between">
        <h1 className="text-[28px] font-semibold tracking-tight text-fg">
          Workspaces
        </h1>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-full bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent-fg shadow-card transition duration-150 hover:bg-black active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Conectar workspace
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-10">
          <ConnectWorkspaceForm
            onCancel={() => setShowForm(false)}
            onCreated={() => {
              setShowForm(false);
              void refetch();
            }}
          />
        </div>
      )}

      {loading && <p className="text-sm text-fg-muted">Carregando…</p>}

      {error && (
        <div className="rounded-card border border-line bg-surface p-6 text-sm text-fg shadow-card">
          Erro ao carregar workspaces: {error.message}
        </div>
      )}

      {!loading && data && data.length === 0 && (
        <div className="rounded-card border border-dashed border-black/[0.15] p-10 text-center text-sm text-fg-muted">
          Nenhum workspace conectado ainda. Clique em <em>Conectar workspace</em>{" "}
          pra adicionar o primeiro.
        </div>
      )}

      {data && data.length > 0 && (
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-elev text-[11px] uppercase tracking-[0.08em] text-fg-faint">
              <tr>
                <th className="px-5 py-3.5 font-semibold">Executivo</th>
                <th className="px-5 py-3.5 font-semibold">Nome amigável</th>
                <th className="px-5 py-3.5 font-semibold">Slug (URL)</th>
                <th className="px-5 py-3.5 font-semibold">Status</th>
                <th className="px-5 py-3.5 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {data.map((w) => (
                <tr
                  key={w.id}
                  className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-elev"
                >
                  <td className="px-5 py-3.5 font-medium text-fg">{w.executiveName}</td>
                  <td className="px-5 py-3.5 text-fg-muted">{w.displayName}</td>
                  <td className="px-5 py-3.5">
                    <Link
                      to={`/w/${w.slug}`}
                      className="font-mono text-fg underline-offset-4 hover:underline"
                    >
                      {w.slug}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusPill active={w.status === "active"} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {w.status === "active" && <ArchiveButton id={w.id} onArchived={refetch} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs text-fg-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-fg" : "bg-fg-faint"}`} />
      {active ? "Ativo" : "Arquivado"}
    </span>
  );
}

function ConnectWorkspaceForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const api = useApi();
  const [executiveName, setExecutiveName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.connectWorkspace({ executiveName, displayName, anthropicApiKey });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-2xl rounded-card border border-line bg-surface p-7 shadow-card"
    >
      <h2 className="text-lg font-semibold tracking-tight text-fg">
        Conectar Anthropic Workspace
      </h2>
      <p className="mt-1 mb-6 text-sm leading-relaxed text-fg-muted">
        A API key vai ser validada chamando o endpoint da Anthropic, depois
        encriptada at-rest (AES-256-GCM) e persistida.
      </p>

      <Field label="Nome do executivo" hint="Ex: Pedro Loes. Usado pra gerar o slug da URL.">
        <input
          type="text"
          required
          value={executiveName}
          onChange={(e) => setExecutiveName(e.target.value)}
          className={inputClass}
          placeholder="Pedro Loes"
        />
      </Field>

      <Field label="Nome amigável (display)" hint="Como o workspace aparece na lista e no header.">
        <input
          type="text"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className={inputClass}
          placeholder="Workspace do Pedro"
        />
      </Field>

      <Field
        label="Anthropic API key"
        hint="Console Anthropic → API Keys do workspace correspondente. Será encriptada at-rest."
      >
        <input
          type="password"
          required
          value={anthropicApiKey}
          onChange={(e) => setAnthropicApiKey(e.target.value)}
          className={`${inputClass} font-mono`}
          placeholder="sk-ant-api03-..."
        />
      </Field>

      {error && (
        <div className="mb-5 rounded-xl border border-line bg-elev p-3.5 text-sm text-fg">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent-fg shadow-card transition duration-150 hover:bg-black active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Conectando…" : "Conectar"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-full border border-black/[0.12] px-5 py-2.5 text-sm font-medium text-fg-muted transition-colors duration-150 hover:border-black/[0.3] hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded-xl border border-black/[0.12] bg-white px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-faint transition duration-150 focus:border-black/[0.3] focus:outline-none focus:ring-4 focus:ring-black/[0.05]";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <label className="mb-1 block text-sm font-medium text-fg">{label}</label>
      {hint && <p className="mb-2 text-xs leading-relaxed text-fg-muted">{hint}</p>}
      {children}
    </div>
  );
}

function ArchiveButton({ id, onArchived }: { id: string; onArchived: () => void }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);

  async function handleArchive() {
    if (!confirm("Arquivar este workspace? Operação irreversível na lista (mas a Anthropic mantém o workspace dela).")) {
      return;
    }
    setBusy(true);
    try {
      await api.archiveWorkspace(id);
      onArchived();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleArchive}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-fg-muted transition-colors duration-150 hover:bg-black/[0.05] hover:text-fg"
    >
      <Archive className="h-3.5 w-3.5" strokeWidth={1.5} />
      {busy ? "..." : "Arquivar"}
    </button>
  );
}
