// Lifecycle do bearer + vault do MCP server `sma`.
//
// A Anthropic autentica no nosso endpoint MCP via uma credential `static_bearer`
// guardada numa vault: o agente referencia o MCP server por URL, a sessão
// anexa `vault_ids`, e a runtime encaminha `Authorization: Bearer <token>` pro
// `mcp_server_url` casado. Aqui geramos/rotacionamos esse token, guardamos
// encriptado (secret_entries) e espelhamos na vault da Anthropic.

import type Anthropic from "@anthropic-ai/sdk";
import {
  MCP_BEARER_KEY,
  MCP_BEARER_PREV_KEY,
  MCP_VAULT_ID_KEY,
  getSecret,
  setSecret,
} from "./secrets";

const GRACE_MS = 24 * 60 * 60 * 1000; // token antigo válido por 24h pós-rotação

export function buildSmaMcpUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/mcp/sma/${slug}`;
}

// Anthropic rejeita hostnames loopback — a runtime deles não acessa a máquina
// local. Nesse caso rotacionamos só o token local (sem vault).
export function isLoopback(baseUrl: string): boolean {
  return /^(https?:)?\/\/(localhost|127\.|\[::1\])/i.test(baseUrl);
}

function genToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sma_${hex}`;
}

export type RotateResult = {
  token: string;
  vaultId: string | null;
  url: string | null;
  loopback: boolean;
};

/**
 * Gera um bearer novo pro MCP `sma` do workspace, mantém o anterior válido por
 * 24h (janela de graça), e cria/atualiza a credential static_bearer na vault da
 * Anthropic apontando pro endpoint. Idempotente. Em loopback, só rotaciona o
 * token local.
 */
export async function rotateSmaMcpToken(
  client: Anthropic,
  workspaceId: string,
  slug: string,
  baseUrl: string,
  log: (msg: string) => void = () => {},
): Promise<RotateResult> {
  const url = buildSmaMcpUrl(baseUrl, slug);
  const token = genToken();

  // Move o atual pra prev com validade de 24h, depois grava o novo.
  const current = await getSecret(workspaceId, MCP_BEARER_KEY);
  if (current) {
    await setSecret(
      workspaceId,
      MCP_BEARER_PREV_KEY,
      current,
      new Date(Date.now() + GRACE_MS),
    );
  }
  await setSecret(workspaceId, MCP_BEARER_KEY, token);

  if (isLoopback(baseUrl)) {
    log(
      `SMA_BASE_URL é loopback — token rotacionado localmente, sem credential na vault (Anthropic não alcança ${url}). Re-rode após expor publicamente.`,
    );
    return { token, vaultId: null, url: null, loopback: true };
  }

  // Garante a vault.
  let vaultId = await getSecret(workspaceId, MCP_VAULT_ID_KEY);
  if (!vaultId) {
    const vault = await client.beta.vaults.create({
      display_name: `sma-mcp-${slug}`,
    });
    vaultId = vault.id;
    await setSecret(workspaceId, MCP_VAULT_ID_KEY, vaultId);
    log(`vault criada (${vaultId})`);
  }

  // Cria ou atualiza a credential static_bearer pro nosso URL.
  let credId: string | null = null;
  for await (const c of client.beta.vaults.credentials.list(vaultId)) {
    if (c.archived_at) continue;
    if (c.auth?.type === "static_bearer" && c.auth.mcp_server_url === url) {
      credId = c.id;
      break;
    }
  }
  if (credId) {
    await client.beta.vaults.credentials.update(credId, {
      vault_id: vaultId,
      auth: { type: "static_bearer", token },
    });
    log(`credential atualizada (${credId})`);
  } else {
    const created = await client.beta.vaults.credentials.create(vaultId, {
      display_name: "sma",
      auth: { type: "static_bearer", token, mcp_server_url: url },
    });
    log(`credential criada (${created.id})`);
  }

  return { token, vaultId, url, loopback: false };
}
