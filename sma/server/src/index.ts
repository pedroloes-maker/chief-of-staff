import "./env";
import { sql } from "drizzle-orm";
import { db } from "./db/client";
import { authenticate } from "./lib/auth";
import {
  archiveWorkspace,
  connectWorkspace,
  getWorkspaceBySlug,
  listActiveWorkspaces,
  ValidationError,
} from "./routes/workspaces";
import {
  createSession,
  getSession,
  listSessionEvents,
  listSessions,
  streamMessage,
} from "./routes/sessions";
import {
  archiveAgent,
  createSubAgent,
  getAgentDetail,
  listAgents,
  syncAgents,
  updateAgent,
} from "./routes/agents";
import { handleSmaMcp } from "./routes/mcp-sma";
import { gmailMcpHandler } from "./routes/mcp-gmail";
import { driveMcpHandler } from "./routes/mcp-drive";
import { calendarMcpHandler } from "./routes/mcp-calendar";
import {
  disconnectGoogle,
  getCatalogue,
  getGoogleStatus,
  handleGoogleCallback,
  startGoogleConnect,
} from "./routes/connections";
import { archiveVaultCredential, listWorkspaceVaults } from "./routes/vaults";
import {
  getMemory,
  getMemoryVersion,
  listMemoryVersions,
  listStoreMemories,
  listWorkspaceMemoryStores,
  redactMemoryVersion,
} from "./routes/memory";

const PORT = Number(process.env.PORT ?? 3000);

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // --- Público ---

  if (url.pathname === "/health") {
    try {
      await db.execute(sql`select 1 as ok`);
      return Response.json({
        status: "ok",
        db: "connected",
        ts: new Date().toISOString(),
      });
    } catch (err) {
      return Response.json(
        {
          status: "error",
          db: "unreachable",
          error: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }
  }

  // MCP server `sma` — PÚBLICO (server-to-server da Anthropic; auth = bearer
  // por workspace, validado no handler). Fica antes do gate Clerk de propósito.
  const smaMcp = url.pathname.match(/^\/api\/mcp\/sma\/([^/]+)$/);
  if (smaMcp) {
    return handleSmaMcp(req, smaMcp[1]);
  }

  // MCP servers Google (Gmail/Drive/Calendar) — também públicos. A Anthropic
  // encaminha o bearer OAuth (da vault) e o handler chama a REST do Google.
  if (url.pathname === "/mcp/gmail") return gmailMcpHandler(req);
  if (url.pathname === "/mcp/drive") return driveMcpHandler(req);
  if (url.pathname === "/mcp/calendar") return calendarMcpHandler(req);

  // Callback OAuth do Google — PÚBLICO (a Google redireciona pra cá; sem Clerk).
  // O workspace vem do state assinado. Devolve HTML que fecha o popup.
  if (
    url.pathname === "/api/connections/google/callback" &&
    req.method === "GET"
  ) {
    return handleGoogleCallback(req);
  }

  // --- Daqui pra baixo exige Clerk JWT ---
  const auth = await authenticate(req);
  if (!auth) {
    return Response.json({ error: "não autenticado" }, { status: 401 });
  }

  try {
    // GET /api/workspaces
    if (url.pathname === "/api/workspaces" && req.method === "GET") {
      return Response.json(await listActiveWorkspaces());
    }

    // POST /api/workspaces — conectar novo
    if (url.pathname === "/api/workspaces" && req.method === "POST") {
      const body = (await req.json()) as {
        executiveName?: string;
        displayName?: string;
        anthropicApiKey?: string;
      };
      const created = await connectWorkspace(
        {
          executiveName: body.executiveName ?? "",
          displayName: body.displayName ?? "",
          anthropicApiKey: body.anthropicApiKey ?? "",
        },
        auth,
      );
      return Response.json(created, { status: 201 });
    }

    // GET /api/workspaces/by-slug/:slug
    const bySlug = url.pathname.match(/^\/api\/workspaces\/by-slug\/([^/]+)$/);
    if (bySlug && req.method === "GET") {
      const w = await getWorkspaceBySlug(bySlug[1]);
      if (!w) {
        return Response.json(
          { error: "workspace não encontrado" },
          { status: 404 },
        );
      }
      return Response.json(w);
    }

    // POST /api/workspaces/:id/archive
    const archive = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/archive$/);
    if (archive && req.method === "POST") {
      await archiveWorkspace(archive[1]);
      return Response.json({ ok: true });
    }

    // GET/POST /api/workspaces/by-slug/:slug/sessions
    const wsSessions = url.pathname.match(
      /^\/api\/workspaces\/by-slug\/([^/]+)\/sessions$/,
    );
    if (wsSessions && req.method === "GET") {
      return Response.json(await listSessions(wsSessions[1]));
    }
    if (wsSessions && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        title?: string;
        agentId?: string;
      };
      const created = await createSession(wsSessions[1], body, auth);
      return Response.json(created, { status: 201 });
    }

    // GET /api/sessions/:id/events  (histórico renderável pra reload)
    const sessionEventsMatch = url.pathname.match(
      /^\/api\/sessions\/([^/]+)\/events$/,
    );
    if (sessionEventsMatch && req.method === "GET") {
      return Response.json(await listSessionEvents(sessionEventsMatch[1]));
    }

    // POST /api/sessions/:id/messages  (manda mensagem, devolve SSE stream)
    const sessionMessages = url.pathname.match(
      /^\/api\/sessions\/([^/]+)\/messages$/,
    );
    if (sessionMessages && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { text?: string };
      return streamMessage(sessionMessages[1], body.text ?? "", req.signal);
    }

    // GET /api/sessions/:id
    const sessionDetail = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionDetail && req.method === "GET") {
      const s = await getSession(sessionDetail[1]);
      if (!s) {
        return Response.json({ error: "session não encontrada" }, { status: 404 });
      }
      return Response.json(s);
    }

    // --- Conexões Google (Gmail/Drive/Calendar) — autenticadas ---
    if (
      url.pathname === "/api/connections/google/catalogue" &&
      req.method === "GET"
    ) {
      return getCatalogue(req);
    }
    if (url.pathname === "/api/connections/google" && req.method === "GET") {
      return getGoogleStatus(req);
    }
    if (
      url.pathname === "/api/connections/google/start" &&
      req.method === "POST"
    ) {
      return startGoogleConnect(req);
    }
    if (
      url.pathname === "/api/connections/google/disconnect" &&
      req.method === "POST"
    ) {
      return disconnectGoogle(req);
    }

    // GET /api/workspaces/by-slug/:slug/vaults  (cofre: vaults + credentials)
    const wsVaults = url.pathname.match(
      /^\/api\/workspaces\/by-slug\/([^/]+)\/vaults$/,
    );
    if (wsVaults && req.method === "GET") {
      return Response.json(await listWorkspaceVaults(wsVaults[1]));
    }

    // POST /api/workspaces/by-slug/:slug/vaults/:vid/credentials/:cid/archive
    const credArchive = url.pathname.match(
      /^\/api\/workspaces\/by-slug\/([^/]+)\/vaults\/([^/]+)\/credentials\/([^/]+)\/archive$/,
    );
    if (credArchive && req.method === "POST") {
      return Response.json(
        await archiveVaultCredential(credArchive[1], credArchive[2], credArchive[3]),
      );
    }

    // --- Memória (memory stores) — workspace-scoped ---

    // GET /api/workspaces/by-slug/:slug/memory-stores  (lista stores, mirror Neon)
    const memStores = url.pathname.match(
      /^\/api\/workspaces\/by-slug\/([^/]+)\/memory-stores$/,
    );
    if (memStores && req.method === "GET") {
      return Response.json(await listWorkspaceMemoryStores(memStores[1]));
    }

    // POST …/memory-stores/:storeId/versions/:versionId/redact  (redact, §7.4)
    const memRedact = url.pathname.match(
      /^\/api\/workspaces\/by-slug\/([^/]+)\/memory-stores\/([^/]+)\/versions\/([^/]+)\/redact$/,
    );
    if (memRedact && req.method === "POST") {
      return Response.json(
        await redactMemoryVersion(memRedact[1], memRedact[2], memRedact[3]),
      );
    }

    // GET …/memory-stores/:storeId/versions/:versionId  (conteúdo da versão)
    const memVersionDetail = url.pathname.match(
      /^\/api\/workspaces\/by-slug\/([^/]+)\/memory-stores\/([^/]+)\/versions\/([^/]+)$/,
    );
    if (memVersionDetail && req.method === "GET") {
      return Response.json(
        await getMemoryVersion(
          memVersionDetail[1],
          memVersionDetail[2],
          memVersionDetail[3],
        ),
      );
    }

    // GET …/memory-stores/:storeId/versions?memory_id=  (histórico da memory)
    const memVersions = url.pathname.match(
      /^\/api\/workspaces\/by-slug\/([^/]+)\/memory-stores\/([^/]+)\/versions$/,
    );
    if (memVersions && req.method === "GET") {
      const memoryId = url.searchParams.get("memory_id");
      if (!memoryId) {
        return Response.json(
          { error: "memory_id é obrigatório" },
          { status: 400 },
        );
      }
      return Response.json(
        await listMemoryVersions(memVersions[1], memVersions[2], memoryId),
      );
    }

    // GET …/memory-stores/:storeId/memories/:memoryId  (conteúdo da memory)
    const memDetail = url.pathname.match(
      /^\/api\/workspaces\/by-slug\/([^/]+)\/memory-stores\/([^/]+)\/memories\/([^/]+)$/,
    );
    if (memDetail && req.method === "GET") {
      return Response.json(
        await getMemory(memDetail[1], memDetail[2], memDetail[3]),
      );
    }

    // GET …/memory-stores/:storeId/memories  (lista paths, ao vivo da Anthropic)
    const memList = url.pathname.match(
      /^\/api\/workspaces\/by-slug\/([^/]+)\/memory-stores\/([^/]+)\/memories$/,
    );
    if (memList && req.method === "GET") {
      return Response.json(await listStoreMemories(memList[1], memList[2]));
    }

    // POST /api/workspaces/by-slug/:slug/agents/sync  (reconcilia com Anthropic)
    const agentsSync = url.pathname.match(
      /^\/api\/workspaces\/by-slug\/([^/]+)\/agents\/sync$/,
    );
    if (agentsSync && req.method === "POST") {
      return Response.json(await syncAgents(agentsSync[1]));
    }

    // GET/POST /api/workspaces/by-slug/:slug/agents
    const wsAgents = url.pathname.match(
      /^\/api\/workspaces\/by-slug\/([^/]+)\/agents$/,
    );
    if (wsAgents && req.method === "GET") {
      return Response.json(await listAgents(wsAgents[1]));
    }
    if (wsAgents && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        name?: string;
        system?: string;
        model?: string;
      };
      const created = await createSubAgent(wsAgents[1], {
        name: body.name ?? "",
        system: body.system,
        model: body.model,
      });
      return Response.json(created, { status: 201 });
    }

    // POST /api/agents/:id/archive
    const agentArchive = url.pathname.match(/^\/api\/agents\/([^/]+)\/archive$/);
    if (agentArchive && req.method === "POST") {
      return Response.json(await archiveAgent(agentArchive[1]));
    }

    // GET/POST /api/agents/:id  (detalhe ao vivo / edição Anthropic-first)
    const agentDetail = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
    if (agentDetail && req.method === "GET") {
      const a = await getAgentDetail(agentDetail[1]);
      if (!a) {
        return Response.json({ error: "agente não encontrado" }, { status: 404 });
      }
      return Response.json(a);
    }
    if (agentDetail && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        system?: string | null;
        model?: string;
        roster?: string[];
      };
      return Response.json(await updateAgent(agentDetail[1], body));
    }

    return new Response("not found", { status: 404 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[server] unhandled:", message);
    return Response.json({ error: "erro interno" }, { status: 500 });
  }
}

const server = Bun.serve({
  port: PORT,
  fetch: handle,
});

console.log(`SMA server escutando em http://localhost:${server.port}`);
