import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MessageSquarePlus } from "lucide-react";
import { useApi, type SessionView } from "../lib/api";

const STATUS_LABEL: Record<SessionView["status"], string> = {
  running: "Rodando",
  idle: "Ociosa",
  terminated: "Encerrada",
  rescheduling: "Reagendando",
};

export default function SessionsPage() {
  const { slug } = useParams<{ slug: string }>();
  const api = useApi();
  const [data, setData] = useState<SessionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    void api
      .listSessions(slug)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return (
    <div className="mx-auto max-w-5xl px-10 py-12">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
        Workspace · {slug}
      </p>
      <div className="mt-1 mb-8 flex items-center justify-between">
        <h1 className="text-[28px] font-semibold tracking-tight text-fg">Sessões</h1>
        <Link
          to={`/w/${slug}/chat`}
          className="inline-flex items-center gap-2 rounded-full bg-accent-bg px-5 py-2.5 text-sm font-medium text-accent-fg shadow-card transition duration-150 hover:bg-black active:scale-[0.98]"
        >
          <MessageSquarePlus className="h-4 w-4" strokeWidth={1.5} />
          Nova sessão
        </Link>
      </div>

      {error && (
        <div className="rounded-card border border-line bg-surface p-6 text-sm text-fg shadow-card">
          Erro ao carregar sessões: {error}
        </div>
      )}

      {!error && data && data.length === 0 && (
        <div className="rounded-card border border-dashed border-black/[0.15] p-10 text-center text-sm text-fg-muted">
          Nenhuma sessão ainda. Clique em <em>Nova sessão</em> pra conversar com o
          orchestrator.
        </div>
      )}

      {data && data.length > 0 && (
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-elev text-[11px] uppercase tracking-[0.08em] text-fg-faint">
              <tr>
                <th className="px-5 py-3.5 font-semibold">Título</th>
                <th className="px-5 py-3.5 font-semibold">Status</th>
                <th className="px-5 py-3.5 font-semibold">Tokens</th>
                <th className="px-5 py-3.5 text-right font-semibold">Custo (USD)</th>
                <th className="px-5 py-3.5 font-semibold">Criada</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-elev"
                >
                  <td className="px-5 py-3.5">
                    <Link
                      to={`/w/${slug}/chat?session=${s.id}`}
                      className="font-medium text-fg underline-offset-4 hover:underline"
                    >
                      {s.title ?? "Sessão sem título"}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs text-fg-muted">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${s.status === "running" ? "bg-fg" : "bg-fg-faint"}`}
                      />
                      {STATUS_LABEL[s.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-fg-muted">
                    {(s.inputTokens + s.outputTokens).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-fg">
                    {s.usdEstimate.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "USD",
                      minimumFractionDigits: 4,
                    })}
                  </td>
                  <td className="px-5 py-3.5 text-fg-muted">
                    {new Date(s.createdAt).toLocaleString("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
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
