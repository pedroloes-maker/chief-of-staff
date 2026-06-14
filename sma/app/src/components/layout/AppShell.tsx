import { UserButton } from "@clerk/react";
import {
  Home,
  MessagesSquare,
  History,
  Bot,
  Brain,
  Wrench,
  Plug,
  Database,
  Settings,
  Briefcase,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useWorkspaces } from "../../lib/api";
import BrandMark from "../ui/BrandMark";

// AppShell envolve <Routes>, então useParams aqui não enxerga :slug.
// Derivamos o workspace ativo do pathname (/w/:slug/...).
function useActiveSlug(): string | undefined {
  const { pathname } = useLocation();
  return pathname.match(/^\/w\/([^/]+)/)?.[1];
}

type NavItem = {
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  path: string;
  enabled: boolean;
};

// Itens workspace-scoped: o href vira /w/:slug<path>. enabled=false são
// próximos tickets — aparecem como "em breve" pra não cair em 404.
const scopedItems: NavItem[] = [
  { label: "Chat", icon: MessagesSquare, path: "/chat", enabled: true },
  { label: "Sessões", icon: History, path: "/sessions", enabled: true },
  { label: "Agentes", icon: Bot, path: "/agents", enabled: true },
  { label: "Memória", icon: Brain, path: "/memory", enabled: true },
  { label: "Skills", icon: Wrench, path: "/skills", enabled: false },
  { label: "Conexões", icon: Plug, path: "/connections", enabled: true },
  { label: "Cofre", icon: Database, path: "/vault", enabled: true },
  { label: "Configurações", icon: Settings, path: "/settings", enabled: false },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors duration-150 ${
    isActive
      ? "bg-accent-bg text-accent-fg shadow-card"
      : "text-fg-muted hover:bg-black/[0.05] hover:text-fg"
  }`;

export default function AppShell({ children }: { children: ReactNode }) {
  const slug = useActiveSlug();
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
          <NavLink to="/" end className={linkClass}>
            <Home className="h-4 w-4" strokeWidth={1.5} />
            Início
          </NavLink>
          {scopedItems.map((item) => {
            const active = item.enabled && slug;
            if (!active) {
              return (
                <div
                  key={item.path}
                  title={
                    item.enabled
                      ? "Selecione um workspace"
                      : "Em breve"
                  }
                  className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium text-fg-faint"
                >
                  <item.icon className="h-4 w-4" strokeWidth={1.5} />
                  {item.label}
                </div>
              );
            }
            return (
              <NavLink
                key={item.path}
                to={`/w/${slug}${item.path}`}
                className={linkClass}
              >
                <item.icon className="h-4 w-4" strokeWidth={1.5} />
                {item.label}
              </NavLink>
            );
          })}
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
  const slug = useActiveSlug();
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
