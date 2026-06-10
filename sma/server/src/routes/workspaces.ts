import Anthropic from "@anthropic-ai/sdk";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { workspaces } from "../db/schema";
import { encryptSecret, decryptSecret } from "../lib/crypto";
import type { AuthContext } from "../lib/auth";

export type WorkspaceView = {
  id: string;
  slug: string;
  executiveName: string;
  displayName: string;
  status: "active" | "archived";
  createdAt: string;
};

function toView(w: typeof workspaces.$inferSelect): WorkspaceView {
  return {
    id: w.id,
    slug: w.slug,
    executiveName: w.executiveName,
    displayName: w.displayName,
    status: w.status,
    createdAt: w.createdAt.toISOString(),
  };
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "workspace"
  );
}

export async function listActiveWorkspaces(): Promise<WorkspaceView[]> {
  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.status, "active"));
  return rows.map(toView);
}

export async function getWorkspaceBySlug(
  slug: string,
): Promise<WorkspaceView | null> {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.status, "active")));
  return row ? toView(row) : null;
}

export type ConnectWorkspaceInput = {
  executiveName: string;
  displayName: string;
  anthropicApiKey: string;
};

export async function connectWorkspace(
  input: ConnectWorkspaceInput,
  auth: AuthContext,
): Promise<WorkspaceView> {
  if (!input.executiveName?.trim() || !input.displayName?.trim() || !input.anthropicApiKey?.trim()) {
    throw new ValidationError(
      "executiveName, displayName e anthropicApiKey são obrigatórios",
    );
  }

  // 1. Valida a API key chamando environments.list() e captura/cria
  //    default_environment_id (cloud + unrestricted).
  const client = new Anthropic({ apiKey: input.anthropicApiKey });
  let defaultEnvironmentId: string | undefined;
  try {
    const page = await client.beta.environments.list({ limit: 5 });
    const existing = page.data.find((e) => !e.archived_at);
    if (existing) {
      defaultEnvironmentId = existing.id;
    } else {
      const env = await client.beta.environments.create({
        name: "sma-default",
        config: { type: "cloud", networking: { type: "unrestricted" } },
      });
      defaultEnvironmentId = env.id;
    }
  } catch (err) {
    throw new ValidationError(
      `API key inválida ou erro Anthropic: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Gera slug único.
  const base = slugify(input.executiveName);
  let slug = base;
  let suffix = 2;
  while (true) {
    const taken = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, slug));
    if (taken.length === 0) break;
    slug = `${base}-${suffix++}`;
    if (suffix > 100) throw new Error("não consegui gerar slug único");
  }

  // 3. Encripta a API key at-rest.
  const encrypted = await encryptSecret(input.anthropicApiKey);

  // 4. Persiste no Neon.
  const [created] = await db
    .insert(workspaces)
    .values({
      slug,
      anthropicApiKeyEncrypted: encrypted,
      executiveName: input.executiveName.trim(),
      displayName: input.displayName.trim(),
      defaultEnvironmentId,
      createdBy: auth.userId,
    })
    .returning();

  return toView(created);
}

export async function archiveWorkspace(id: string): Promise<void> {
  await db
    .update(workspaces)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(workspaces.id, id));
}

/**
 * Retorna um Anthropic client autenticado pra um workspace específico.
 * Usado por handlers que precisam fazer chamadas Anthropic no contexto
 * daquele workspace.
 */
export async function getAnthropicClientForWorkspace(
  slug: string,
): Promise<Anthropic | null> {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.status, "active")));
  if (!row) return null;
  const apiKey = await decryptSecret(row.anthropicApiKeyEncrypted);
  return new Anthropic({ apiKey });
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
