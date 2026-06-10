import { UserButton } from "@clerk/react";
import {
  Home,
  MessagesSquare,
  Bot,
  Brain,
  Wrench,
  Plug,
  Database,
  Settings,
  Briefcase,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useWorkspaces } from "../../lib/api";

const navItems = [
  { label: "Início", icon: Home, href: "/" },
  { label: "Chat", icon: MessagesSquare, href: "/chat" },
  { label: "Agentes", icon: Bot, href: "/agents" },
  { label: "Memória", icon: Brain, href: "/memory" },
  { label: "Skills", icon: Wrench, href: "/skills" },
  { label: "Conexões", icon: Plug, href: "/connections" },
  { label: "Cofre", icon: Database, href: "/vault" },
  { label: "Configurações", icon: Settings, href: "/settings" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-white text-neutral-950">
      <aside className="flex w-60 flex-col border-r border-neutral-900">
        <div className="flex h-14 items-center border-b border-neutral-900 px-4 text-sm font-semibold tracking-tight">
          SMA · Chief-of-Staff
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          {navItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="flex items-center gap-3 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950"
            >
              <item.icon className="h-4 w-4" strokeWidth={1.5} />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto bg-neutral-50">{children}</main>
      </div>
    </div>
  );
}

function TopBar() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <header className="flex h-14 items-center justify-between border-b border-neutral-900 px-6">
      <div className="text-sm text-neutral-600">
        {slug ? (
          <>
            Workspace ativo:{" "}
            <span className="font-mono text-neutral-950">{slug}</span>
          </>
        ) : (
          <>
            Nenhum workspace ativo —{" "}
            <Link
              to="/admin/workspaces"
              className="text-neutral-950 underline-offset-2 hover:underline"
            >
              gerenciar
            </Link>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <AvatarWithWorkspaces />
      </div>
    </header>
  );
}

function AvatarWithWorkspaces() {
  const navigate = useNavigate();
  const { data: workspaces } = useWorkspaces();

  return (
    <UserButton>
      <UserButton.MenuItems>
        {(workspaces ?? []).map((w) => (
          <UserButton.Action
            key={w.id}
            label={w.executiveName}
            labelIcon={<Briefcase className="h-4 w-4" strokeWidth={1.5} />}
            onClick={() => navigate(`/w/${w.slug}`)}
          />
        ))}
        <UserButton.Link
          label="Gerenciar workspaces"
          labelIcon={<Settings className="h-4 w-4" strokeWidth={1.5} />}
          href="/admin/workspaces"
        />
      </UserButton.MenuItems>
    </UserButton>
  );
}
