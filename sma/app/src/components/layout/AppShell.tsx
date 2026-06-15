import { UserButton } from "@clerk/react";
import {
  MessagesSquare,
  Brain,
  Wrench,
  Plug,
  Database,
  Lock,
  Settings,
  Briefcase,
  CalendarClock,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useWorkspaces, type Workspace } from "../../lib/api";
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
  { label: "Agentes", icon: Brain, path: "/agents", enabled: true },
  { label: "Memória", icon: Database, path: "/memory", enabled: true },
  { label: "Skills", icon: Wrench, path: "/skills", enabled: true },
  { label: "Agendamento", icon: CalendarClock, path: "/jobs", enabled: true },
  { label: "Conexões", icon: Plug, path: "/connections", enabled: true },
  { label: "Cofre", icon: Lock, path: "/vault", enabled: true },
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
  const { data: workspaces } = useWorkspaces();
  const list = workspaces ?? [];
  // Workspace ativo = o da URL; sem slug, cai no primeiro da lista (default).
  const activeWorkspace =
    (slug ? list.find((w) => w.slug === slug) : list[0]) ?? list[0] ?? null;

  return (
    <div className="flex h-screen w-full bg-base text-fg">
      <aside className="glass z-10 flex w-64 flex-col">
        <div className="flex h-16 items-center gap-3 px-5">
          <BrandMark />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-tight">
              Chief-of-Staff
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {scopedItems.map((item) => {
            const active = item.enabled && slug;
            if (!active) {
              return (
                <div
                  key={item.path}
                  title={item.enabled ? "Selecione um workspace" : "Em breve"}
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
        <WorkspaceFooter activeWorkspace={activeWorkspace} workspaces={list} />
      </aside>

      <div className="glass flex min-w-0 flex-1 flex-col p-3">
        <main className="flex-1 overflow-y-auto rounded-2xl border border-line bg-base shadow-card">
          {children}
        </main>
      </div>
    </div>
  );
}

// Rodapé da barra lateral: avatar (clicar → trocar de workspace) + nome do
// workspace ativo ao lado. Substitui o antigo TopBar.
function WorkspaceFooter({
  activeWorkspace,
  workspaces,
}: {
  activeWorkspace: Workspace | null;
  workspaces: Workspace[];
}) {
  return (
    <div className="p-3">
      <div className="flex items-center gap-3 rounded-xl px-2 py-1.5">
        <AvatarWithWorkspaces workspaces={workspaces} />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] font-medium text-fg">
            {activeWorkspace?.displayName ?? "Nenhum workspace"}
          </div>
          <div className="truncate text-[11px] text-fg-muted">
            {activeWorkspace ? "Workspace ativo" : "Conecte um workspace"}
          </div>
        </div>
      </div>
    </div>
  );
}

function AvatarWithWorkspaces({ workspaces }: { workspaces: Workspace[] }) {
  const navigate = useNavigate();

  return (
    <UserButton>
      <UserButton.MenuItems>
        {workspaces.map((w) => (
          <UserButton.Action
            key={w.id}
            label={w.displayName}
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
