// Agents UI backend (SMA-9). Lista/detalhe/edição/arquivamento dos Managed
// Agents de um workspace, espelhando Anthropic-first → Neon.
//
// Filosofia mirror (igual sessions.ts): a Anthropic é a fonte da verdade. A
// lista vem do mirror Neon (rápido, workspace-scoped); o detalhe e toda edição
// batem na Anthropic ao vivo. Não mantemos histórico de versão local — a
// Anthropic versiona agents nativamente (campo `version` + sub-resource
// `versions`), então duplicar isso no Neon só geraria drift.

import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { agents, workspaces } from "../db/schema";
import { decryptSecret } from "../lib/crypto";
import { ValidationError } from "./workspaces";

type Role = "orchestrator" | "builder" | "sub_agent";

const ROLE_ORDER: Record<Role, number> = {
  orchestrator: 0,
  builder: 1,
  sub_agent: 2,
};

// Modelo default pra sub-agentes criados pela UI (mesmo das famílias usadas no
// provision-workspace). Editável no detalhe depois.
const DEFAULT_SUBAGENT_MODEL = "claude-opus-4-7";

export type AgentSummary = {
  id: string;
  slug: string;
  role: Role;
  anthropicAgentId: string;
  version: string | null;
  model: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

// Um membro do roster do coordinator, resolvido contra o mirror pra exibir
// slug/role (a Anthropic só devolve id + version).
export type RosterMember = {
  anthropicAgentId: string;
  version: number;
  slug: string | null;
  role: Role | null;
};

export type AgentDetail = AgentSummary & {
  name: string;
  description: string | null;
  system: string | null;
  liveModel: string | null;
  liveVersion: number;
  archivedAt: string | null;
  tools: Array<{ kind: string; label: string }>;
  skills: Array<{ type: string; skillId: string; version: string }>;
  mcpServers: Array<{ name: string; url: string }>;
  isCoordinator: boolean;
  roster: RosterMember[];
};

export type UpdateAgentInput = {
  // undefined = preservar; null/"" = limpar (system aceita null).
  system?: string | null;
  model?: string;
  // undefined = preservar o roster; array = substituir (vazio remove o
  // coordinator). Lista de anthropicAgentId.
  roster?: string[];
};

export type CreateAgentInput = {
  name: string;
  system?: string;
  model?: string;
};

function summaryOf(a: typeof agents.$inferSelect): AgentSummary {
  return {
    id: a.id,
    slug: a.slug,
    role: a.role,
    anthropicAgentId: a.anthropicAgentId,
    version: a.version,
    model: a.model,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function clientFor(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

async function loadWorkspaceBySlug(slug: string) {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.status, "active")));
  return row ?? null;
}

async function loadWorkspaceById(id: string) {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, id));
  return row ?? null;
}

async function loadAgentRow(id: string) {
  const [row] = await db.select().from(agents).where(eq(agents.id, id));
  return row ?? null;
}

async function clientForWorkspaceId(workspaceId: string): Promise<Anthropic> {
  const ws = await loadWorkspaceById(workspaceId);
  if (!ws) throw new ValidationError("workspace do agente não encontrado");
  return clientFor(await decryptSecret(ws.anthropicApiKeyEncrypted));
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "agent"
  );
}

async function uniqueAgentSlug(workspaceId: string, base: string): Promise<string> {
  let slug = base;
  let n = 2;
  while (true) {
    const taken = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.workspaceId, workspaceId), eq(agents.slug, slug)));
    if (taken.length === 0) return slug;
    slug = `${base}-${n++}`;
    if (n > 100) throw new Error("não consegui gerar slug único de agente");
  }
}

type LiveTool =
  Anthropic.Beta.Agents.BetaManagedAgentsAgent["tools"][number];

function toolLabel(t: LiveTool): { kind: string; label: string } {
  switch (t.type) {
    case "agent_toolset_20260401":
      return {
        kind: t.type,
        label: "Toolset de agente (read/write/edit/glob/grep/bash)",
      };
    case "mcp_toolset":
      return { kind: t.type, label: `MCP · ${t.mcp_server_name}` };
    case "custom":
      return { kind: "custom", label: t.name };
    default:
      return { kind: "tool", label: "ferramenta" };
  }
}

export async function listAgents(slug: string): Promise<AgentSummary[]> {
  const ws = await loadWorkspaceBySlug(slug);
  if (!ws) throw new ValidationError("workspace não encontrado");
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, ws.id));
  return rows
    .sort(
      (a, b) =>
        ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.slug.localeCompare(b.slug),
    )
    .map(summaryOf);
}

export async function getAgentDetail(id: string): Promise<AgentDetail | null> {
  const row = await loadAgentRow(id);
  if (!row) return null;
  const client = await clientForWorkspaceId(row.workspaceId);
  const live = await client.beta.agents.retrieve(row.anthropicAgentId);

  // Resolve o roster contra o mirror pra exibir slug/role.
  const roster: RosterMember[] = [];
  const isCoordinator = live.multiagent?.type === "coordinator";
  if (isCoordinator && live.multiagent) {
    const mirror = await db
      .select()
      .from(agents)
      .where(eq(agents.workspaceId, row.workspaceId));
    const byAid = new Map(mirror.map((r) => [r.anthropicAgentId, r]));
    for (const ref of live.multiagent.agents) {
      const m = byAid.get(ref.id);
      roster.push({
        anthropicAgentId: ref.id,
        version: ref.version,
        slug: m?.slug ?? null,
        role: m?.role ?? null,
      });
    }
  }

  // Mantém o mirror honesto a cada visita ao detalhe (versão/modelo/status).
  const liveModel = live.model?.id ?? null;
  const liveStatus = live.archived_at ? "archived" : "active";
  if (
    String(live.version) !== row.version ||
    liveModel !== row.model ||
    liveStatus !== row.status
  ) {
    await db
      .update(agents)
      .set({
        version: String(live.version),
        model: liveModel ?? row.model,
        status: liveStatus,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, row.id));
    row.version = String(live.version);
    row.model = liveModel ?? row.model;
    row.status = liveStatus;
  }

  return {
    ...summaryOf(row),
    name: live.name,
    description: live.description,
    system: live.system,
    liveModel,
    liveVersion: live.version,
    archivedAt: live.archived_at,
    tools: live.tools.map((t) => toolLabel(t)),
    skills: live.skills.map((s) => ({
      type: s.type,
      skillId: s.skill_id,
      version: s.version,
    })),
    mcpServers: live.mcp_servers.map((m) => ({ name: m.name, url: m.url })),
    isCoordinator,
    roster,
  };
}

// Valida um roster proposto contra o mirror: ids do mesmo workspace, ativos,
// não-coordinators, sem o próprio agente, sem duplicatas, máx 20 (limite da API).
async function validateRoster(
  self: typeof agents.$inferSelect,
  ids: string[],
): Promise<string[]> {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, self.workspaceId));
  const byAid = new Map(rows.map((r) => [r.anthropicAgentId, r]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const aid of ids) {
    if (aid === self.anthropicAgentId) {
      throw new ValidationError("um agente não pode estar no próprio roster");
    }
    const m = byAid.get(aid);
    if (!m) {
      throw new ValidationError(`agente ${aid} não pertence a este workspace`);
    }
    if (m.status !== "active") {
      throw new ValidationError(
        `agente ${m.slug} está arquivado e não pode entrar no roster`,
      );
    }
    if (m.role === "orchestrator") {
      throw new ValidationError(
        `um coordinator não pode ser sub-agente de outro (${m.slug})`,
      );
    }
    if (seen.has(aid)) continue;
    seen.add(aid);
    out.push(aid);
  }
  if (out.length > 20) {
    throw new ValidationError("o roster aceita no máximo 20 sub-agentes");
  }
  return out;
}

export async function updateAgent(
  id: string,
  input: UpdateAgentInput,
): Promise<AgentDetail> {
  const row = await loadAgentRow(id);
  if (!row) throw new ValidationError("agente não encontrado");
  if (row.status === "archived") {
    throw new ValidationError("agente arquivado é read-only (design da Anthropic)");
  }
  const client = await clientForWorkspaceId(row.workspaceId);

  // Anthropic-first. Pega a versão atual pro optimistic lock. Omitimos
  // tools/skills/mcp_servers de propósito: são full-replacement na API, então
  // não enviá-los preserva o que o provision configurou.
  const current = await client.beta.agents.retrieve(row.anthropicAgentId);
  const params: Anthropic.Beta.Agents.AgentUpdateParams = {
    version: current.version,
  };
  if (input.system !== undefined) params.system = input.system;
  if (input.model !== undefined && input.model.trim()) {
    params.model = input.model.trim();
  }
  if (input.roster !== undefined) {
    if (current.multiagent?.type !== "coordinator" && input.roster.length > 0) {
      throw new ValidationError(
        "só o orchestrator (coordinator) tem roster de sub-agentes",
      );
    }
    const valid = await validateRoster(row, input.roster);
    params.multiagent = valid.length
      ? { type: "coordinator", agents: valid }
      : null;
  }

  const updated = await client.beta.agents.update(row.anthropicAgentId, params);

  await db
    .update(agents)
    .set({
      version: String(updated.version),
      model: updated.model?.id ?? row.model,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, row.id));

  const detail = await getAgentDetail(id);
  if (!detail) throw new ValidationError("agente sumiu após update");
  return detail;
}

export async function createSubAgent(
  slug: string,
  input: CreateAgentInput,
): Promise<AgentSummary> {
  const ws = await loadWorkspaceBySlug(slug);
  if (!ws) throw new ValidationError("workspace não encontrado");
  if (!input.name?.trim()) throw new ValidationError("nome é obrigatório");
  const client = clientFor(await decryptSecret(ws.anthropicApiKeyEncrypted));
  const model = input.model?.trim() || DEFAULT_SUBAGENT_MODEL;

  // Anthropic-first. Sub-agente nasce com o agent_toolset (file tools) pra já
  // poder usar skills/bash; sem multiagent (depth limit 1).
  const created = await client.beta.agents.create({
    model,
    name: input.name.trim(),
    description: "sub-agente criado via SMA",
    system: input.system?.trim() || null,
    tools: [{ type: "agent_toolset_20260401" }],
  });

  const agentSlug = await uniqueAgentSlug(
    ws.id,
    `${ws.slug}_${slugify(input.name)}`,
  );
  const [inserted] = await db
    .insert(agents)
    .values({
      workspaceId: ws.id,
      slug: agentSlug,
      role: "sub_agent",
      anthropicAgentId: created.id,
      version: String(created.version),
      model,
    })
    .returning();

  return summaryOf(inserted);
}

// Remove o agente de qualquer roster de coordinator ativo do workspace antes de
// arquivar — a API rejeita roster apontando pra agente arquivado.
async function detachFromRosters(
  client: Anthropic,
  target: typeof agents.$inferSelect,
): Promise<void> {
  const coordinators = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.workspaceId, target.workspaceId),
        eq(agents.role, "orchestrator"),
        eq(agents.status, "active"),
      ),
    );
  for (const c of coordinators) {
    const live = await client.beta.agents.retrieve(c.anthropicAgentId);
    if (
      live.multiagent?.type === "coordinator" &&
      live.multiagent.agents.some((r) => r.id === target.anthropicAgentId)
    ) {
      const remaining = live.multiagent.agents
        .filter((r) => r.id !== target.anthropicAgentId)
        .map((r) => r.id);
      const updated = await client.beta.agents.update(c.anthropicAgentId, {
        version: live.version,
        multiagent: remaining.length
          ? { type: "coordinator", agents: remaining }
          : null,
      });
      await db
        .update(agents)
        .set({ version: String(updated.version), updatedAt: new Date() })
        .where(eq(agents.id, c.id));
    }
  }
}

export async function archiveAgent(id: string): Promise<{ ok: true }> {
  const row = await loadAgentRow(id);
  if (!row) throw new ValidationError("agente não encontrado");
  if (row.role === "orchestrator") {
    throw new ValidationError(
      "o orchestrator é o ponto de entrada do chat e não pode ser arquivado",
    );
  }
  if (row.status === "archived") return { ok: true };
  const client = await clientForWorkspaceId(row.workspaceId);

  await detachFromRosters(client, row);
  await client.beta.agents.archive(row.anthropicAgentId);
  await db
    .update(agents)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(agents.id, row.id));
  return { ok: true };
}

// Reconciliação manual: puxa agents.list() da Anthropic e faz upsert no mirror
// por anthropicAgentId. Resolve drift óbvio (versões, modelo, status, agentes
// criados fora da UI).
export async function syncAgents(
  slug: string,
): Promise<{ synced: number; created: number }> {
  const ws = await loadWorkspaceBySlug(slug);
  if (!ws) throw new ValidationError("workspace não encontrado");
  const client = clientFor(await decryptSecret(ws.anthropicApiKeyEncrypted));

  const existing = await db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, ws.id));
  const byAid = new Map(existing.map((r) => [r.anthropicAgentId, r]));

  let synced = 0;
  let created = 0;
  for await (const live of client.beta.agents.list({
    limit: 100,
    include_archived: true,
  })) {
    const status = live.archived_at ? "archived" : "active";
    const model = live.model?.id ?? null;
    const m = byAid.get(live.id);
    if (m) {
      // Coordinator vira orchestrator; resto preserva o role do mirror.
      const role: Role =
        live.multiagent?.type === "coordinator" ? "orchestrator" : m.role;
      await db
        .update(agents)
        .set({
          version: String(live.version),
          model: model ?? m.model,
          status,
          role,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, m.id));
      synced++;
    } else {
      const role: Role =
        live.multiagent?.type === "coordinator" ? "orchestrator" : "sub_agent";
      const agentSlug = await uniqueAgentSlug(
        ws.id,
        `${ws.slug}_${slugify(live.name)}`,
      );
      await db.insert(agents).values({
        workspaceId: ws.id,
        slug: agentSlug,
        role,
        anthropicAgentId: live.id,
        version: String(live.version),
        model,
        status,
      });
      created++;
    }
  }
  return { synced, created };
}
