import { useUser } from "@clerk/react";

export default function HomePage() {
  const { user } = useUser();
  const name = user?.firstName ?? user?.username ?? "operador";

  return (
    <div className="p-8">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-neutral-950">
        Bem-vindo, {name}
      </h1>
      <p className="text-sm text-neutral-600">
        Esta é a shell inicial do SMA. Funcionalidade entra nos próximos
        tickets — começando pela conexão com workspaces da Anthropic em SMA-7.
      </p>

      <div className="mt-8 grid max-w-3xl gap-4 md:grid-cols-2">
        <Card
          title="Status da infra"
          body="Login Clerk · Healthcheck backend · Conexão Neon"
        />
        <Card
          title="Próximo ticket"
          body="SMA-7 — Workspace model + Anthropic SDK + switcher URL-scoped"
        />
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
