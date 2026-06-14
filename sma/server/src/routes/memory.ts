// Memória — browser dos memory stores do workspace. Read-mostly: lista stores
// (mirror Neon), e busca memories (paths), conteúdo e histórico de versões ao
// vivo da Anthropic. Permite redigir (redact) uma versão por compliance (§7.4).
//
// Cada workspace tem sua própria chave Anthropic, então o client já é scoped ao
// workspace. Conteúdo de memories/versões é buscado on-demand — não
// materializamos no Neon (PRD §5.2). Os stores em si vêm do mirror (rápido pra
// listagem; o tier já está espelhado).

import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { memoryStores } from "../db/schema";
import {
  getAnthropicClientForWorkspace,
  getWorkspaceBySlug,
  ValidationError,
} from "./workspaces";

const TIER_LABEL: Record<string, string> = {
  short: "Curto prazo",
  long: "Longo prazo",
  knowledge: "Conhecimento",
};

export type MemoryStoreView = {
  id: string; // anthropic memstore_... id
  slug: string;
  tier: "short" | "long" | "knowledge";
  tierLabel: string;
  description: string | null;
};

export type MemoryItemView = {
  id: string; // mem_... id
  path: string;
  contentSizeBytes: number;
  memoryVersionId: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryContentView = MemoryItemView & { content: string | null };

export type MemoryActorView =
  | { type: "session"; sessionId: string }
  | { type: "api"; apiKeyId: string }
  | { type: "user"; userId: string }
  | { type: "unknown" };

export type MemoryVersionView = {
  id: string; // memver_... id
  memoryId: string;
  operation: "created" | "modified" | "deleted";
  createdAt: string;
  createdBy: MemoryActorView;
  contentSizeBytes: number | null;
  redactedAt: string | null;
  redacted: boolean;
};

export type MemoryVersionContentView = MemoryVersionView & {
  content: string | null;
};

function toActor(a: unknown): MemoryActorView {
  const actor = a as { type?: string; session_id?: string; api_key_id?: string; user_id?: string } | null | undefined;
  switch (actor?.type) {
    case "session_actor":
      return { type: "session", sessionId: actor.session_id ?? "" };
    case "api_actor":
      return { type: "api", apiKeyId: actor.api_key_id ?? "" };
    case "user_actor":
      return { type: "user", userId: actor.user_id ?? "" };
    default:
      return { type: "unknown" };
  }
}

function toVersionView(v: {
  id: string;
  memory_id: string;
  operation: "created" | "modified" | "deleted";
  created_at: string;
  created_by?: unknown;
  content_size_bytes?: number | null;
  redacted_at?: string | null;
}): MemoryVersionView {
  return {
    id: v.id,
    memoryId: v.memory_id,
    operation: v.operation,
    createdAt: v.created_at,
    createdBy: toActor(v.created_by),
    contentSizeBytes: v.content_size_bytes ?? null,
    redactedAt: v.redacted_at ?? null,
    redacted: !!v.redacted_at,
  };
}

// Garante que o store pertence a este workspace (mirror Neon) antes de endereçar
// a API da Anthropic, e devolve o client já scoped. Defesa em profundidade: a
// chave já é por-workspace, mas validamos o input contra o mirror.
async function clientForStore(slug: string, storeId: string): Promise<Anthropic> {
  const ws = await getWorkspaceBySlug(slug);
  if (!ws) throw new ValidationError("workspace não encontrado");
  const [row] = await db
    .select({ id: memoryStores.id })
    .from(memoryStores)
    .where(
      and(
        eq(memoryStores.workspaceId, ws.id),
        eq(memoryStores.anthropicMemoryStoreId, storeId),
      ),
    );
  if (!row) {
    throw new ValidationError("memory store não encontrado neste workspace");
  }
  const client = await getAnthropicClientForWorkspace(slug);
  if (!client) throw new ValidationError("workspace não encontrado");
  return client;
}

export async function listWorkspaceMemoryStores(
  slug: string,
): Promise<MemoryStoreView[]> {
  const ws = await getWorkspaceBySlug(slug);
  if (!ws) throw new ValidationError("workspace não encontrado");
  const rows = await db
    .select()
    .from(memoryStores)
    .where(eq(memoryStores.workspaceId, ws.id));
  return rows
    .map((r) => ({
      id: r.anthropicMemoryStoreId,
      slug: r.slug,
      tier: r.tier,
      tierLabel: TIER_LABEL[r.tier] ?? r.tier,
      description: r.description,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function listStoreMemories(
  slug: string,
  storeId: string,
): Promise<MemoryItemView[]> {
  const client = await clientForStore(slug, storeId);
  const out: MemoryItemView[] = [];
  for await (const item of client.beta.memoryStores.memories.list(storeId)) {
    // A list pode devolver "prefixes" (diretórios) além de memories. Em Fase 1
    // os stores são flat (arquivos YYYY-MM-DD.md / YYYY-WW.md na raiz), então
    // basta ignorar prefixes; recursão por diretório fica como follow-up.
    if (item.type !== "memory") continue;
    out.push({
      id: item.id,
      path: item.path,
      contentSizeBytes: item.content_size_bytes,
      memoryVersionId: item.memory_version_id,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function getMemory(
  slug: string,
  storeId: string,
  memoryId: string,
): Promise<MemoryContentView> {
  const client = await clientForStore(slug, storeId);
  const m = await client.beta.memoryStores.memories.retrieve(memoryId, {
    memory_store_id: storeId,
    view: "full",
  });
  return {
    id: m.id,
    path: m.path,
    contentSizeBytes: m.content_size_bytes,
    memoryVersionId: m.memory_version_id,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
    content: m.content ?? null,
  };
}

export async function listMemoryVersions(
  slug: string,
  storeId: string,
  memoryId: string,
): Promise<MemoryVersionView[]> {
  const client = await clientForStore(slug, storeId);
  const out: MemoryVersionView[] = [];
  for await (const v of client.beta.memoryStores.memoryVersions.list(storeId, {
    memory_id: memoryId,
  })) {
    out.push(toVersionView(v));
  }
  // Mais recente primeiro.
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getMemoryVersion(
  slug: string,
  storeId: string,
  versionId: string,
): Promise<MemoryVersionContentView> {
  const client = await clientForStore(slug, storeId);
  const v = await client.beta.memoryStores.memoryVersions.retrieve(versionId, {
    memory_store_id: storeId,
    view: "full",
  });
  return { ...toVersionView(v), content: v.content ?? null };
}

// Redige (redact) uma versão por compliance — operação destrutiva e
// irreversível: o conteúdo da versão é apagado, mantendo só os metadados de
// auditoria. PRD §3.4 quer isto restrito a admin; RBAC granular é Fase 5
// (decisão #11) — hoje toda mutação é gated só por sessão Clerk válida, igual a
// archiveVaultCredential/archiveAgent. A UI confirma antes de chamar.
export async function redactMemoryVersion(
  slug: string,
  storeId: string,
  versionId: string,
): Promise<MemoryVersionView> {
  const client = await clientForStore(slug, storeId);
  const v = await client.beta.memoryStores.memoryVersions.redact(versionId, {
    memory_store_id: storeId,
  });
  return toVersionView(v);
}
