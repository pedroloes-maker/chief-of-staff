import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useApi, type Workspace } from "../lib/api";
import Card from "../components/ui/Card";
import NotFoundPage from "./NotFoundPage";

export default function WorkspaceDashboardPage() {
  const { slug } = useParams<{ slug: string }>();
  const api = useApi();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "not_found" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setStatus("not_found");
      return;
    }
    void api
      .getWorkspaceBySlug(slug)
      .then((w) => {
        setWorkspace(w);
        setStatus("ok");
      })
      .catch((e) => {
        if (e instanceof Error && /não encontrado/i.test(e.message)) {
          setStatus("not_found");
        } else {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("error");
        }
      });
  }, [slug, api]);

  if (status === "loading") {
    return (
      <div className="px-10 py-12 text-sm text-fg-muted">Carregando workspace…</div>
    );
  }
  if (status === "not_found") {
    return (
      <NotFoundPage
        message={`Workspace "${slug}" não foi encontrado. Ele pode ter sido arquivado ou nunca existiu.`}
      />
    );
  }
  if (status === "error") {
    return (
      <div className="px-10 py-12">
        <div className="rounded-card border border-line bg-surface p-6 text-sm text-fg shadow-card">
          Erro ao carregar workspace: {error}
        </div>
      </div>
    );
  }
  if (!workspace) return null;

  return (
    <div className="mx-auto max-w-5xl px-10 py-12">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        Workspace · {workspace.slug}
      </p>
      <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-fg">
        {workspace.displayName}
      </h1>
      <p className="mt-2 text-sm text-fg-muted">
        Executivo: <span className="font-medium text-fg">{workspace.executiveName}</span>
      </p>

      <div className="mt-10 grid max-w-3xl gap-4 md:grid-cols-2">
        <Card title="Status" body={workspace.status === "active" ? "Ativo" : "Arquivado"} />
        <Card title="Próximo ticket" body="SMA-8 — provisionar orchestrator + builder via script" />
      </div>

      <div className="mt-6 max-w-3xl rounded-card border border-dashed border-black/[0.15] p-6">
        <p className="text-sm leading-relaxed text-fg-muted">
          Dashboard placeholder. Features (agentes, sessões, memória, chat, jobs)
          entram nos próximos tickets.
        </p>
      </div>
    </div>
  );
}
