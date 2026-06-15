import { Show } from "@clerk/react";
import { Navigate, Routes, Route } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";
import { useWorkspaces } from "./lib/api";
import WorkspaceDashboardPage from "./pages/WorkspaceDashboardPage";
import WorkspacesAdminPage from "./pages/WorkspacesAdminPage";
import ChatPage from "./pages/ChatPage";
import AgentsPage from "./pages/AgentsPage";
import AgentDetailPage from "./pages/AgentDetailPage";
import ConnectionsPage from "./pages/ConnectionsPage";
import VaultPage from "./pages/VaultPage";
import MemoryPage from "./pages/MemoryPage";
import SkillsPage from "./pages/SkillsPage";
import JobsPage from "./pages/JobsPage";

export default function App() {
  return (
    <>
      <Show when="signed-out">
        <LoginPage />
      </Show>
      <Show when="signed-in">
        <AppShell>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/admin/workspaces" element={<WorkspacesAdminPage />} />
            <Route path="/w/:slug" element={<WorkspaceDashboardPage />} />
            <Route path="/w/:slug/chat" element={<ChatPage />} />
            <Route path="/w/:slug/agents" element={<AgentsPage />} />
            <Route path="/w/:slug/agents/:id" element={<AgentDetailPage />} />
            <Route path="/w/:slug/connections" element={<ConnectionsPage />} />
            <Route path="/w/:slug/memory" element={<MemoryPage />} />
            <Route path="/w/:slug/skills" element={<SkillsPage />} />
            <Route path="/w/:slug/jobs" element={<JobsPage />} />
            <Route path="/w/:slug/vault" element={<VaultPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AppShell>
      </Show>
    </>
  );
}

// Sem página Início: a raiz manda pro primeiro workspace disponível (o default
// ativo). Sem workspaces ainda, vai pra tela de gerenciamento pra conectar um.
function HomeRedirect() {
  const { data, loading } = useWorkspaces();
  if (loading || !data) return null;
  const first = data[0];
  return (
    <Navigate to={first ? `/w/${first.slug}` : "/admin/workspaces"} replace />
  );
}
