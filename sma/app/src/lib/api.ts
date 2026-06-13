import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useMemo, useState } from "react";

export type Workspace = {
  id: string;
  slug: string;
  executiveName: string;
  displayName: string;
  status: "active" | "archived";
  createdAt: string;
};

export type ConnectWorkspaceInput = {
  executiveName: string;
  displayName: string;
  anthropicApiKey: string;
};

export type SessionView = {
  id: string;
  anthropicSessionId: string;
  title: string | null;
  source: "web" | "whatsapp" | "job";
  status: "rescheduling" | "running" | "idle" | "terminated";
  model: string | null;
  usdEstimate: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentRole = "orchestrator" | "builder" | "sub_agent";

export type AgentSummary = {
  id: string;
  slug: string;
  role: AgentRole;
  anthropicAgentId: string;
  version: string | null;
  model: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type RosterMember = {
  anthropicAgentId: string;
  version: number;
  slug: string | null;
  role: AgentRole | null;
};

export type AgentDetail = AgentSummary & {
  name: string;
  description: string | null;
  system: string | null;
  liveModel: string | null;
  liveVersion: number;
  archivedAt: string | null;
  tools: Array<{ kind: string; label: string }>;
  skills: Array<{ type: string; skillId: string; version: string }>;
  mcpServers: Array<{ name: string; url: string }>;
  isCoordinator: boolean;
  roster: RosterMember[];
};

export type UpdateAgentInput = {
  system?: string | null;
  model?: string;
  roster?: string[];
};

export type PersistedEvent = { seq: number; type: string; payload: unknown };

/** Um evento SSE do stream de mensagem: `event:` + `data:` (JSON). */
export type StreamHandler = (event: string, data: unknown) => void;

function buildHeaders(token: string | null): HeadersInit {
  const headers: HeadersInit = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  return headers;
}

async function parseError(res: Response): Promise<never> {
  let message = res.statusText;
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    // ignore — keep statusText
  }
  throw new Error(message);
}

export function useApi() {
  const { getToken } = useAuth();

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = await getToken();
      const res = await fetch(path, {
        ...init,
        headers: { ...buildHeaders(token), ...(init.headers ?? {}) },
      });
      if (!res.ok) await parseError(res);
      return res.json() as Promise<T>;
    },
    [getToken],
  );

  // Manda uma mensagem e consome o stream SSE da resposta. EventSource não
  // deixa setar Authorization, então usamos fetch + reader e parseamos os
  // frames `event:`/`data:` na mão. Resolve quando o stream fecha.
  const streamMessage = useCallback(
    async (
      sessionId: string,
      text: string,
      onEvent: StreamHandler,
      signal?: AbortSignal,
    ): Promise<void> => {
      const token = await getToken();
      const res = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: buildHeaders(token),
        body: JSON.stringify({ text }),
        signal,
      });
      if (!res.ok || !res.body) await parseError(res);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          let event = "message";
          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (data) onEvent(event, JSON.parse(data));
        }
      }
    },
    [getToken],
  );

  // Memoizado por (request, streamMessage) — ambos estáveis — pra que o objeto
  // retornado tenha identidade estável e não dispare loops em efeitos que
  // dependem dele (ex. useWorkspaces.refetch).
  return useMemo(
    () => ({
      listWorkspaces: () => request<Workspace[]>("/api/workspaces"),
      connectWorkspace: (input: ConnectWorkspaceInput) =>
        request<Workspace>("/api/workspaces", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      archiveWorkspace: (id: string) =>
        request<{ ok: true }>(`/api/workspaces/${id}/archive`, {
          method: "POST",
        }),
      getWorkspaceBySlug: (slug: string) =>
        request<Workspace>(`/api/workspaces/by-slug/${slug}`),
      listSessions: (slug: string) =>
        request<SessionView[]>(`/api/workspaces/by-slug/${slug}/sessions`),
      getSession: (sessionId: string) =>
        request<SessionView>(`/api/sessions/${sessionId}`),
      createSession: (slug: string, title?: string) =>
        request<SessionView>(`/api/workspaces/by-slug/${slug}/sessions`, {
          method: "POST",
          body: JSON.stringify({ title }),
        }),
      getSessionEvents: (sessionId: string) =>
        request<PersistedEvent[]>(`/api/sessions/${sessionId}/events`),
      streamMessage,
      listAgents: (slug: string) =>
        request<AgentSummary[]>(`/api/workspaces/by-slug/${slug}/agents`),
      createSubAgent: (
        slug: string,
        input: { name: string; system?: string; model?: string },
      ) =>
        request<AgentSummary>(`/api/workspaces/by-slug/${slug}/agents`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      syncAgents: (slug: string) =>
        request<{ synced: number; created: number }>(
          `/api/workspaces/by-slug/${slug}/agents/sync`,
          { method: "POST" },
        ),
      getAgent: (id: string) => request<AgentDetail>(`/api/agents/${id}`),
      updateAgent: (id: string, input: UpdateAgentInput) =>
        request<AgentDetail>(`/api/agents/${id}`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      archiveAgent: (id: string) =>
        request<{ ok: true }>(`/api/agents/${id}/archive`, { method: "POST" }),
    }),
    [request, streamMessage],
  );
}

/** Hook simples pra listar workspaces ativos com refetch. */
export function useWorkspaces() {
  const api = useApi();
  const [data, setData] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.listWorkspaces());
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, error, loading, refetch };
}
