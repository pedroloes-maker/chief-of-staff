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
  ChevronDown,
} from "lucide-react";
import type { ReactNode } from "react";

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
            <a
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950"
            >
              <item.icon className="h-4 w-4" strokeWidth={1.5} />
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-neutral-900 px-6">
          <div className="text-sm text-neutral-600">
            Workspace switcher entra em SMA-7
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled
              className="flex cursor-not-allowed items-center gap-2 border border-neutral-300 px-3 py-1.5 text-sm text-neutral-400"
            >
              <span>Selecionar workspace</span>
              <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <UserButton />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-neutral-50">{children}</main>
      </div>
    </div>
  );
}
