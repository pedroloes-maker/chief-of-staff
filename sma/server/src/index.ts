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
