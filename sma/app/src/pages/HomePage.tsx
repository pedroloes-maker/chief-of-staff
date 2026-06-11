import { useUser } from "@clerk/react";
import Card from "../components/ui/Card";

export default function HomePage() {
  const { user } = useUser();
  const name = user?.firstName ?? user?.username ?? "operador";

  return (
    <div className="mx-auto max-w-5xl px-10 py-12">
      <p className="text-[13px] font-medium text-fg-muted">Bem-vindo de volta</p>
      <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-fg">
        {name}
      </h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-fg-muted">
        Esta é a shell inicial do SMA. Funcionalidade entra nos próximos
        tickets — começando pela conexão com workspaces da Anthropic em SMA-7.
      </p>

      <div className="mt-10 grid max-w-3xl gap-4 md:grid-cols-2">
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
