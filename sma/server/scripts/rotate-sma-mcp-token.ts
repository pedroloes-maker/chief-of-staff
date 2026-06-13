// Rotaciona o bearer do MCP server `sma` de um workspace: gera token novo,
// mantém o anterior válido por 24h (janela de graça) e cria/atualiza a
// credential static_bearer na vault da Anthropic apontando pro endpoint.
//
// Uso:
//   bun run scripts/rotate-sma-mcp-token.ts --workspace=<slug>
//
// Em SMA_BASE_URL loopback, só rotaciona o token local (Anthropic não alcança
// o endpoint) — re-rode após expor publicamente (tunnel/deploy).

import "../src/env";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { workspaces } from "../src/db/schema";
import { decryptSecret } from "../src/lib/crypto";
import { rotateSmaMcpToken } from "../src/lib/smaMcp";

function parseSlug(): string {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--workspace="));
  const slug = arg?.slice("--workspace=".length).trim();
  if (!slug) {
    console.error(
      "Erro: --workspace=<slug> é obrigatório.\n  uso: bun run scripts/rotate-sma-mcp-token.ts --workspace=<slug>",
    );
    process.exit(1);
  }
  return slug;
}

async function main(): Promise<void> {
  const slug = parseSlug();
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.status, "active")));
  if (!ws) {
    console.error(`Erro: workspace '${slug}' não encontrado (ou arquivado).`);
    process.exit(1);
  }

  const apiKey = await decryptSecret(ws.anthropicApiKeyEncrypted);
  const client = new Anthropic({ apiKey });
  const baseUrl = process.env.SMA_BASE_URL ?? "http://localhost:3000";

  console.log(`\n→ Rotacionando bearer do MCP sma de '${slug}'\n`);
  const res = await rotateSmaMcpToken(client, ws.id, slug, baseUrl, (m) =>
    console.log("·", m),
  );

  if (res.loopback) {
    console.log("\n✓ Token rotacionado localmente (loopback — sem vault).\n");
  } else {
    console.log(`\n✓ Token rotacionado. vault=${res.vaultId} url=${res.url}\n`);
  }
}

main().catch((err) => {
  console.error("\n✗ Falha na rotação:");
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
