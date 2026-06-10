import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useState } from "react";

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

  return {
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
  };
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
