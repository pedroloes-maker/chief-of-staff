import { Link } from "react-router-dom";

export default function NotFoundPage({ message }: { message?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-md border border-neutral-900 bg-white p-8 text-center">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          404
        </div>
        <h1 className="mb-3 text-2xl font-semibold tracking-tight text-neutral-950">
          Página não encontrada
        </h1>
        <p className="mb-6 text-sm text-neutral-600">
          {message ?? "O endereço acessado não existe ou foi arquivado."}
        </p>
        <Link
          to="/"
          className="inline-flex items-center border border-neutral-900 px-4 py-2 text-sm text-neutral-950 hover:bg-neutral-50"
        >
          Voltar pro início
        </Link>
      </div>
    </div>
  );
}
