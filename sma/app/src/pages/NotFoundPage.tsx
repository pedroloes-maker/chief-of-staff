import { Link } from "react-router-dom";

export default function NotFoundPage({ message }: { message?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-md rounded-card border border-line bg-surface p-10 text-center shadow-card">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
          404
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
          Página não encontrada
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          {message ?? "O endereço acessado não existe ou foi arquivado."}
        </p>
        <Link
          to="/"
          className="mt-7 inline-flex items-center rounded-full border border-black/[0.12] px-5 py-2 text-sm font-medium text-fg transition-colors hover:border-black/[0.3] hover:bg-black/[0.03]"
        >
          Voltar pro início
        </Link>
      </div>
    </div>
  );
}
