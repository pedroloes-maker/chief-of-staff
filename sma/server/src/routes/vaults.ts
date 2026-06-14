// Cofre (Vault) — visibilidade/gestão das credenciais guardadas nas vaults
// Anthropic do workspace. Read-mostly: lista vaults + credentials (redatado, sem
// valores de token — a Anthropic nem os devolve) e arquiva uma credential.
//
// Cada workspace tem sua própria chave Anthropic, então client.beta.vaults.list()
// já é scoped ao workspace — não precisa filtrar por metadata.

import {
  getAnthropicClientForWorkspace,
  getWorkspaceBySlug,
  ValidationError,
} from "./workspaces";

export type VaultCredentialView = {
  id: string;
  type: "mcp_oauth" | "static_bearer" | "environment_variable" | string;
  displayName: string | null;
  mcpServerUrl: string | null;
  scope: string | null;
  expiresAt: string | null;
  archivedAt: string | null;
};

export type VaultView = {
  id: string;
  displayName: string | null;
  kind: string | null;
  archivedAt: string | null;
  credentials: VaultCredentialView[];
};

export async function listWorkspaceVaults(slug: string): Promise<VaultView[]> {
  const ws = await getWorkspaceBySlug(slug);
  if (!ws) throw new ValidationError("workspace não encontrado");
  const client = await getAnthropicClientForWorkspace(slug);
  if (!client) throw new ValidationError("workspace não encontrado");

  const out: VaultView[] = [];
  for await (const vault of client.beta.vaults.list()) {
    const credentials: VaultCredentialView[] = [];
    for await (const c of client.beta.vaults.credentials.list(vault.id, {
      include_archived: true,
    })) {
      const auth = c.auth;
      let mcpServerUrl: string | null = null;
      let scope: string | null = null;
      let expiresAt: string | null = null;
      if (auth.type === "static_bearer") {
        mcpServerUrl = auth.mcp_server_url;
      } else if (auth.type === "mcp_oauth") {
        mcpServerUrl = auth.mcp_server_url;
        scope = auth.refresh?.scope ?? null;
        expiresAt = auth.expires_at ?? null;
      }
      credentials.push({
        id: c.id,
        type: auth.type,
        displayName: c.display_name ?? null,
        mcpServerUrl,
        scope,
        expiresAt,
        archivedAt: c.archived_at,
      });
    }
    out.push({
      id: vault.id,
      displayName: vault.display_name ?? null,
      kind: (vault.metadata?.kind as string | undefined) ?? null,
      archivedAt: vault.archived_at,
      credentials,
    });
  }
  return out;
}

export async function archiveVaultCredential(
  slug: string,
  vaultId: string,
  credentialId: string,
): Promise<{ ok: true }> {
  const client = await getAnthropicClientForWorkspace(slug);
  if (!client) throw new ValidationError("workspace não encontrado");
  await client.beta.vaults.credentials.archive(credentialId, {
    vault_id: vaultId,
  });
  return { ok: true };
}
