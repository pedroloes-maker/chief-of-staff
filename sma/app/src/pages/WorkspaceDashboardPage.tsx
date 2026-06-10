import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useApi, type Workspace } from "../lib/api";
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
    return <div className="p-8 text-sm text-neutral-600">Carregando workspace…</div>;
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
      <div className="p-8">
        <div className="border border-neutral-900 bg-white p-4 text-sm text-neutral-950">
          Erro ao carregar workspace: {error}
        </div>
      </div>
    );
  }
  if (!workspace) return null;

  return (
    <div className="p-8">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        Workspace · {workspace.slug}
      </div>
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-neutral-950">
        {workspace.displayName}
      </h1>
      <p className="text-sm text-neutral-600">
        Executivo: <strong>{workspace.executiveName}</strong>
      </p>

      <div className="mt-8 grid max-w-3xl gap-4 md:grid-cols-2">
        <Card title="Status" body={workspace.status === "active" ? "Ativo" : "Arquivado"} />
        <Card title="Próximo ticket" body="SMA-8 — provisionar orchestrator + builder via script" />
      </div>

      <div className="mt-8 max-w-3xl border border-neutral-300 bg-neutral-50 p-4">
        <p className="text-sm text-neutral-700">
          Dashboard placeholder. Features (agentes, sessões, memória, chat, jobs)
          entram nos próximos tickets.
        </p>
      </div>
    </div>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-neutral-900 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {title}
      </div>
      <div className="mt-2 text-sm text-neutral-950">{body}</div>
    </div>
  );
}
