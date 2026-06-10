import { Show } from "@clerk/react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";

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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </Show>
    </>
  );
}
