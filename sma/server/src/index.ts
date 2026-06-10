import "./env";
import { db } from "./db/client";
import { sql } from "drizzle-orm";

const PORT = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

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

    return new Response("not found", { status: 404 });
  },
});

console.log(`SMA server escutando em http://localhost:${server.port}`);
