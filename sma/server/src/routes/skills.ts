// Skills — browser das skills do workspace (SMA-32). Read-mostly + mutações.
//
// Filosofia mirror (igual memory.ts/agents.ts): a Anthropic é a fonte da
// verdade. As skills custom vêm do mirror Neon (rápido, workspace-scoped),
// enriquecidas ao vivo (display_title/latest_version) e reconciliadas; o
// histórico de versões e toda mutação batem na Anthropic. As skills prebuilt
// (xlsx/docx/pptx/pdf) são fixas — referenciadas por nome, sem versão nossa.
//
// "Quem usa cada skill" é computado a partir das defs de agente ao vivo (a
// Anthropic resolve o array `skills` por agente). O array de skills do agente é
// full-replacement na API, então attach/detach lê o estado atual, aplica o
// delta e reescreve tudo (mesma estratégia do roster em agents.ts).

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { agents, skills, workspaces } from "../db/schema";
import { decryptSecret } from "../lib/crypto";
import {
  getAnthropicClientForWorkspace,
  getWorkspaceBySlug,
  ValidationError,
} from "./workspaces";

type AgentRole = "orchestrator" | "builder" | "sub_agent";

// Skills prebuilt da Anthropic, referenciadas por nome no agente (sem versão
// nossa). Espelha o catálogo documentado da Skills API.
const PREBUILT: Array<{ id: string; title: string }> = [
  { id: "xlsx", title: "Excel (.xlsx)" },
  { id: "docx", title: "Word (.docx)" },
  { id: "pptx", title: "PowerPoint (.pptx)" },
  { id: "pdf", title: "PDF" },
];

export type SkillUsage = {
  agentId: string; // id do mirror (uuid) — pra desanexar pela UI
  agentSlug: string;
  agentRole: AgentRole;
  version: string; // versão pinada no agente
};

export type SkillView = {
  source: "custom" | "anthropic";
  // custom: o anthropic skill_id (skill_…). prebuilt: o nome (ex. "xlsx").
  skillId: string;
  // slug amigável: custom = slug do mirror; prebuilt = o próprio id.
  slug: string;
  title: string | null;
  latestVersion: string | null; // só custom; prebuilt = null
  usedBy: SkillUsage[];
};

export type SkillVersionView = {
  version: string;
  name: string;
  description: string;
  createdAt: string;
};

export type AttachSkillInput = {
  source: "custom" | "anthropic";
  skillId: string;
  version?: string | null;
};

async function workspaceOrThrow(slug: string) {
  const ws = await getWorkspaceBySlug(slug);
  if (!ws) throw new ValidationError("workspace não encontrado");
  return ws;
}

async function clientForSlug(slug: string): Promise<Anthropic> {
  const client = await getAnthropicClientForWorkspace(slug);
  if (!client) throw new ValidationError("workspace não encontrado");
  return client;
}

async function clientForWorkspaceId(workspaceId: string): Promise<Anthropic> {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!ws) throw new ValidationError("workspace do agente não encontrado");
  return new Anthropic({ apiKey: await decryptSecret(ws.anthropicApiKeyEncrypted) });
}

// Mapa skill_id → agentes que a usam, lido das defs de agente ao vivo. Custa um
// retrieve por agente ativo (poucos por workspace em Fase 1); falhas pontuais
// (agente sumiu/arquivado fora da UI) são ignoradas no mapa.
async function computeUsage(
  client: Anthropic,
  workspaceId: string,
): Promise<Map<string, SkillUsage[]>> {
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.status, "active")));
  const usage = new Map<string, SkillUsage[]>();
  await Promise.all(
    rows.map(async (a) => {
      let live;
      try {
        live = await client.beta.agents.retrieve(a.anthropicAgentId);
      } catch {
        return;
      }
      for (const s of live.skills) {
        const list = usage.get(s.skill_id) ?? [];
        list.push({
          agentId: a.id,
          agentSlug: a.slug,
          agentRole: a.role,
          version: s.version,
        });
        usage.set(s.skill_id, list);
      }
    }),
  );
  return usage;
}

export async function listWorkspaceSkills(slug: string): Promise<SkillView[]> {
  const ws = await workspaceOrThrow(slug);
  const client = await clientForSlug(slug);

  const rows = await db
    .select()
    .from(skills)
    .where(eq(skills.workspaceId, ws.id));
  const usage = await computeUsage(client, ws.id);

  // Custom: enriquece com display_title/latest_version ao vivo e mantém o mirror
  // honesto (igual getAgentDetail reconcilia version/model).
  const custom: SkillView[] = await Promise.all(
    rows.map(async (r) => {
      let title: string | null = r.slug;
      let latestVersion: string | null = r.latestVersion;
      try {
        const live = await client.beta.skills.retrieve(r.anthropicSkillId);
        title = live.display_title ?? r.slug;
        latestVersion = live.latest_version;
        if (latestVersion !== r.latestVersion) {
          await db
            .update(skills)
            .set({ latestVersion, updatedAt: new Date() })
            .where(eq(skills.id, r.id));
        }
      } catch {
        // skill sumiu na Anthropic — mostra o que há no mirror.
      }
      return {
        source: "custom" as const,
        skillId: r.anthropicSkillId,
        slug: r.slug,
        title,
        latestVersion,
        usedBy: usage.get(r.anthropicSkillId) ?? [],
      };
    }),
  );
  custom.sort((a, b) => a.slug.localeCompare(b.slug));

  const prebuilt: SkillView[] = PREBUILT.map((p) => ({
    source: "anthropic" as const,
    skillId: p.id,
    slug: p.id,
    title: p.title,
    latestVersion: null,
    usedBy: usage.get(p.id) ?? [],
  }));

  return [...custom, ...prebuilt];
}

// Garante que a skill custom pertence a este workspace antes de endereçar a API.
async function customSkillRow(slug: string, skillId: string) {
  const ws = await workspaceOrThrow(slug);
  const [row] = await db
    .select()
    .from(skills)
    .where(
      and(eq(skills.workspaceId, ws.id), eq(skills.anthropicSkillId, skillId)),
    );
  if (!row) throw new ValidationError("skill não encontrada neste workspace");
  return row;
}

export async function listSkillVersions(
  slug: string,
  skillId: string,
): Promise<SkillVersionView[]> {
  await customSkillRow(slug, skillId);
  const client = await clientForSlug(slug);
  const out: SkillVersionView[] = [];
  for await (const v of client.beta.skills.versions.list(skillId)) {
    out.push({
      version: v.version,
      name: v.name,
      description: v.description,
      createdAt: v.created_at,
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Nova versão de uma skill custom (espelha o builder tool sma_create_skill_version).
// A Anthropic espera uma pasta com SKILL.md no root; o nome da pasta = slug da
// skill (mesma convenção do provision-workspace). Reconcilia latest_version.
export async function createSkillVersion(
  slug: string,
  skillId: string,
  skillMarkdown: string,
): Promise<{ latestVersion: string | null; version: SkillVersionView }> {
  if (!skillMarkdown.trim()) {
    throw new ValidationError("o conteúdo do SKILL.md é obrigatório");
  }
  const row = await customSkillRow(slug, skillId);
  const client = await clientForSlug(slug);

  // Buffer (não Blob) porque o tsconfig do server não inclui a lib DOM; um
  // Uint8Array satisfaz o ArrayBufferView aceito por toFile. O nome carrega a
  // pasta (slug/SKILL.md) que a Skills API espera.
  const file = await toFile(
    Buffer.from(skillMarkdown, "utf8"),
    `${row.slug}/SKILL.md`,
    { type: "text/markdown" },
  );
  const created = await client.beta.skills.versions.create(skillId, {
    files: [file],
  });

  let latestVersion: string | null = created.version;
  try {
    const live = await client.beta.skills.retrieve(skillId);
    latestVersion = live.latest_version;
  } catch {
    // mantém created.version
  }
  await db
    .update(skills)
    .set({ latestVersion, updatedAt: new Date() })
    .where(eq(skills.id, row.id));

  return {
    latestVersion,
    version: {
      version: created.version,
      name: created.name,
      description: created.description,
      createdAt: created.created_at,
    },
  };
}

type SkillParam = Anthropic.Beta.Agents.BetaManagedAgentsSkillParams;

// Preserva o pin existente ao reescrever o array (full-replacement na API).
function toSkillParam(s: {
  type: "anthropic" | "custom";
  skill_id: string;
  version: string;
}): SkillParam {
  return { type: s.type, skill_id: s.skill_id, version: s.version };
}

async function agentRowOrThrow(agentId: string) {
  const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!row) throw new ValidationError("agente não encontrado");
  if (row.status === "archived") {
    throw new ValidationError(
      "agente arquivado é read-only (design da Anthropic)",
    );
  }
  return row;
}

// Anexa uma skill a um agente (espelha o builder tool sma_attach_skill).
// Idempotente: se já estiver anexada, no-op. Custom pina a latest_version do
// mirror quando o caller não especifica versão.
export async function attachSkillToAgent(
  agentId: string,
  input: AttachSkillInput,
): Promise<{ ok: true }> {
  if (!input.skillId?.trim()) throw new ValidationError("skillId é obrigatório");
  const row = await agentRowOrThrow(agentId);

  let version = input.version?.trim() || null;
  if (input.source === "custom") {
    const [s] = await db
      .select({ latestVersion: skills.latestVersion })
      .from(skills)
      .where(
        and(
          eq(skills.workspaceId, row.workspaceId),
          eq(skills.anthropicSkillId, input.skillId),
        ),
      );
    if (!s) {
      throw new ValidationError("skill custom não pertence a este workspace");
    }
    if (!version) version = s.latestVersion;
  }

  const client = await clientForWorkspaceId(row.workspaceId);
  const live = await client.beta.agents.retrieve(row.anthropicAgentId);
  if (live.skills.some((s) => s.skill_id === input.skillId)) {
    return { ok: true };
  }
  if (live.skills.length >= 20) {
    throw new ValidationError("um agente aceita no máximo 20 skills");
  }

  const next: SkillParam =
    input.source === "anthropic"
      ? { type: "anthropic", skill_id: input.skillId }
      : { type: "custom", skill_id: input.skillId, version };

  const updated = await client.beta.agents.update(row.anthropicAgentId, {
    version: live.version,
    skills: [...live.skills.map(toSkillParam), next],
  });
  await db
    .update(agents)
    .set({ version: String(updated.version), updatedAt: new Date() })
    .where(eq(agents.id, row.id));
  return { ok: true };
}

// Desanexa uma skill de um agente. Idempotente.
export async function detachSkillFromAgent(
  agentId: string,
  skillId: string,
): Promise<{ ok: true }> {
  const row = await agentRowOrThrow(agentId);
  const client = await clientForWorkspaceId(row.workspaceId);
  const live = await client.beta.agents.retrieve(row.anthropicAgentId);
  if (!live.skills.some((s) => s.skill_id === skillId)) {
    return { ok: true };
  }
  const next = live.skills
    .filter((s) => s.skill_id !== skillId)
    .map(toSkillParam);
  const updated = await client.beta.agents.update(row.anthropicAgentId, {
    version: live.version,
    skills: next,
  });
  await db
    .update(agents)
    .set({ version: String(updated.version), updatedAt: new Date() })
    .where(eq(agents.id, row.id));
  return { ok: true };
}
