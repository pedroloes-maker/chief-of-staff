import { Show } from "@clerk/react";
import { Routes, Route } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import NotFoundPage from "./pages/NotFoundPage";
import WorkspaceDashboardPage from "./pages/WorkspaceDashboardPage";
import WorkspacesAdminPage from "./pages/WorkspacesAdminPage";
import ChatPage from "./pages/ChatPage";
import SessionsPage from "./pages/SessionsPage";
import AgentsPage from "./pages/AgentsPage";
import AgentDetailPage from "./pages/AgentDetailPage";

export default function App() {
  return (
    <>
      <Show when="signed-out">
        <LoginPage />
      </Show>
      <Show when="signed-in">
        <AppShell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/admin/workspaces" element={<WorkspacesAdminPage />} />
            <Route path="/w/:slug" element={<WorkspaceDashboardPage />} />
            <Route path="/w/:slug/chat" element={<ChatPage />} />
            <Route path="/w/:slug/sessions" element={<SessionsPage />} />
            <Route path="/w/:slug/agents" element={<AgentsPage />} />
            <Route path="/w/:slug/agents/:id" element={<AgentDetailPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AppShell>
      </Show>
    </>
  );
}
