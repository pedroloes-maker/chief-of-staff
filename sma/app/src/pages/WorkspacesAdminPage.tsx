import { useState } from "react";
import { Archive, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useApi, useWorkspaces } from "../lib/api";

export default function WorkspacesAdminPage() {
  const { data, error, loading, refetch } = useWorkspaces();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="p-8">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        Admin
      </div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">
          Workspaces
        </h1>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 border border-neutral-900 bg-neutral-950 px-4 py-2 text-sm text-white hover:bg-neutral-800"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Conectar workspace
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-8">
          <ConnectWorkspaceForm
            onCancel={() => setShowForm(false)}
            onCreated={() => {
              setShowForm(false);
              void refetch();
            }}
          />
        </div>
      )}

      {loading && <p className="text-sm text-neutral-600">Carregando…</p>}

      {error && (
        <div className="border border-neutral-900 bg-white p-4 text-sm text-neutral-950">
          Erro ao carregar workspaces: {error.message}
        </div>
      )}

      {!loading && data && data.length === 0 && (
        <div className="border border-neutral-300 bg-neutral-50 p-6 text-sm text-neutral-700">
          Nenhum workspace conectado ainda. Clique em <em>Conectar workspace</em>
          {" "}pra adicionar o primeiro.
        </div>
      )}

      {data && data.length > 0 && (
        <div className="overflow-hidden border border-neutral-900 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-900 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Executivo</th>
                <th className="px-4 py-3 font-medium">Nome amigável</th>
                <th className="px-4 py-3 font-medium">Slug (URL)</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {data.map((w) => (
                <tr key={w.id} className="border-b border-neutral-200 last:border-b-0">
                  <td className="px-4 py-3 text-neutral-950">{w.executiveName}</td>
                  <td className="px-4 py-3 text-neutral-700">{w.displayName}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/w/${w.slug}`}
                      className="font-mono text-neutral-950 underline-offset-2 hover:underline"
                    >
                      {w.slug}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-neutral-700">
                    {w.status === "active" ? "Ativo" : "Arquivado"}
                  </td>
                  <td className="px-4 py-3 text-right">
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
      className="max-w-2xl border border-neutral-900 bg-white p-6"
    >
      <h2 className="mb-1 text-lg font-semibold tracking-tight text-neutral-950">
        Conectar Anthropic Workspace
      </h2>
      <p className="mb-4 text-sm text-neutral-600">
        A API key vai ser validada chamando o endpoint da Anthropic, depois
        encriptada at-rest com libsodium e persistida.
      </p>

      <Field label="Nome do executivo" hint="Ex: Pedro Loes. Usado pra gerar o slug da URL.">
        <input
          type="text"
          required
          value={executiveName}
          onChange={(e) => setExecutiveName(e.target.value)}
          className="w-full border border-neutral-900 bg-white px-3 py-2 text-sm text-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950"
          placeholder="Pedro Loes"
        />
      </Field>

      <Field label="Nome amigável (display)" hint="Como o workspace aparece na lista e no header.">
        <input
          type="text"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full border border-neutral-900 bg-white px-3 py-2 text-sm text-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950"
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
          className="w-full border border-neutral-900 bg-white px-3 py-2 font-mono text-sm text-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950"
          placeholder="sk-ant-api03-..."
        />
      </Field>

      {error && (
        <div className="mb-4 border border-neutral-900 bg-neutral-50 p-3 text-sm text-neutral-950">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="border border-neutral-900 bg-neutral-950 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Conectando…" : "Conectar"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:border-neutral-900 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

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
    <div className="mb-4">
      <label className="mb-1 block text-sm font-medium text-neutral-950">{label}</label>
      {hint && <p className="mb-2 text-xs text-neutral-600">{hint}</p>}
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
      className="inline-flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-950"
    >
      <Archive className="h-3.5 w-3.5" strokeWidth={1.5} />
      {busy ? "..." : "Arquivar"}
    </button>
  );
}
