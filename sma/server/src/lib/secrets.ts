// Segredos por workspace na tabela secret_entries — encriptados at-rest com
// AES-GCM (lib/crypto). Reutilizável: bearer do MCP `sma`, futuramente estado
// do Baileys (WhatsApp), tokens OAuth, etc.

import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { secretEntries } from "../db/schema";
import { decryptSecret, encryptSecret } from "./crypto";

/** Upsert de um segredo (encripta o valor). expiresAt opcional. */
export async function setSecret(
  workspaceId: string,
  key: string,
  plaintext: string,
  expiresAt: Date | null = null,
): Promise<void> {
  const valueEncrypted = await encryptSecret(plaintext);
  await db
    .insert(secretEntries)
    .values({ workspaceId, key, valueEncrypted, expiresAt })
    .onConflictDoUpdate({
      target: [secretEntries.workspaceId, secretEntries.key],
      set: { valueEncrypted, expiresAt, updatedAt: new Date() },
    });
}

/** Lê e decripta um segredo. Null se ausente. (Não checa expiresAt.) */
export async function getSecret(
  workspaceId: string,
  key: string,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(secretEntries)
    .where(
      and(
        eq(secretEntries.workspaceId, workspaceId),
        eq(secretEntries.key, key),
      ),
    );
  if (!row) return null;
  return decryptSecret(row.valueEncrypted);
}

export async function deleteSecret(
  workspaceId: string,
  key: string,
): Promise<void> {
  await db
    .delete(secretEntries)
    .where(
      and(
        eq(secretEntries.workspaceId, workspaceId),
        eq(secretEntries.key, key),
      ),
    );
}

export const MCP_BEARER_KEY = "sma_mcp_bearer";
export const MCP_BEARER_PREV_KEY = "sma_mcp_bearer_prev";
export const MCP_VAULT_ID_KEY = "sma_mcp_vault_id";

/**
 * Bearers válidos pra autenticar chamadas do MCP `sma` deste workspace: o atual
 * + o anterior se ainda dentro da janela de graça (expiresAt no futuro). Os
 * valores vêm decriptados pra comparação timing-safe no handler.
 */
export async function validMcpBearers(workspaceId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(secretEntries)
    .where(eq(secretEntries.workspaceId, workspaceId));
  const now = Date.now();
  const out: string[] = [];
  for (const r of rows) {
    if (r.key !== MCP_BEARER_KEY && r.key !== MCP_BEARER_PREV_KEY) continue;
    if (r.expiresAt && r.expiresAt.getTime() < now) continue;
    out.push(await decryptSecret(r.valueEncrypted));
  }
  return out;
}
