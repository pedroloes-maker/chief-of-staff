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
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { useWorkspaces } from "../../lib/api";
import BrandMark from "../ui/BrandMark";

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
    <div className="flex h-screen w-full bg-base text-fg">
      <aside className="glass z-10 flex w-64 flex-col border-r border-line">
        <div className="flex h-16 items-center gap-3 px-5">
          <BrandMark />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight">SMA</div>
            <div className="text-[11px] text-fg-muted">Chief-of-Staff</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.href === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
                  isActive
                    ? "bg-accent-bg text-accent-fg shadow-card"
                    : "text-fg-muted hover:bg-black/[0.05] hover:text-fg"
                }`
              }
            >
              <item.icon className="h-4 w-4" strokeWidth={1.5} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 text-[11px] text-fg-faint">Fase 1 · local</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function TopBar() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <header className="glass z-10 flex h-16 shrink-0 items-center justify-between border-b border-line px-8">
      {slug ? (
        <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs text-fg-muted shadow-card">
          <span className="h-1.5 w-1.5 rounded-full bg-fg" />
          Workspace ativo
          <span className="font-mono font-medium text-fg">{slug}</span>
        </div>
      ) : (
        <div className="text-xs text-fg-muted">
          Nenhum workspace ativo —{" "}
          <Link
            to="/admin/workspaces"
            className="font-medium text-fg underline-offset-4 hover:underline"
          >
            gerenciar
          </Link>
        </div>
      )}
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
