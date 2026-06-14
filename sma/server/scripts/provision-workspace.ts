// Provisiona o stack inicial de um workspace SMA:
//   - 2 custom skills (skill_sma_config, skill_sma_memory_consolidation)
//   - 3 memory stores (short, long, knowledge)
//   - 2 agents (builder + orchestrator)
//   - links agent ↔ memory store com ACL
//   - 2 jobs default (consolidação curto/longo → builder)
//
// Idempotente: tudo verifica o mirror Neon antes de criar na Anthropic.
// Re-rodar é seguro.
//
// Uso:
//   bun run scripts/provision-workspace.ts --workspace=<slug>

import "../src/env";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/client";
import {
  agentMemoryStores,
  agents,
  jobs,
  memoryStores,
  skills,
  workspaces,
} from "../src/db/schema";
import { decryptSecret } from "../src/lib/crypto";
import { getSecret, MCP_BEARER_KEY } from "../src/lib/secrets";
import { rotateSmaMcpToken } from "../src/lib/smaMcp";
import { BUILDER_CUSTOM_TOOLS } from "../src/provisioning/builderTools";
import {
  BUILDER_SYSTEM_PROMPT,
  CALENDAR_AGENT_SYSTEM_PROMPT,
  DRIVE_AGENT_SYSTEM_PROMPT,
  GMAIL_AGENT_SYSTEM_PROMPT,
  ORCHESTRATOR_SYSTEM_PROMPT,
} from "../src/provisioning/prompts";
import { SMA_CUSTOM_SKILLS, type SkillSpec } from "../src/provisioning/skills";
import { serviceMcpUrl, type Service } from "../src/lib/google-connections";

// Fase 1: Sonnet pra orchestrator+builder mantém custo viável (~5× mais barato
// que Opus) sem perder capacidade pro trabalho de raciocínio/config. Sub-agents
// nascem em Haiku (ver DEFAULT_SUBAGENT_MODEL em routes/agents.ts). Revisar pra
// Opus em produção se a qualidade exigir.
const BUILDER_MODEL = "claude-sonnet-4-6";
const ORCHESTRATOR_MODEL = "claude-sonnet-4-6";

// Sub-agents de domínio Google: tarefas-folha mecânicas (chamar a tool MCP e
// devolver), então nascem em Haiku (~15× mais barato que Opus, ~3× que Sonnet).
// Esse é o ganho de custo direto do split — o orchestrator (Sonnet) coordena, os
// sub-agents (Haiku) executam o trabalho de domínio em threads isoladas.
const SUBAGENT_MODEL = "claude-haiku-4-5";

// Os 3 sub-agents de domínio Google, cada um com seu prompt. Só são criados se a
// MCP URL do serviço estiver no .env (serviceMcpUrl). O `name` do MCP server e a
// referência do mcp_toolset usam o próprio nome do serviço.
const DOMAIN_SUBAGENTS: { service: Service; system: string }[] = [
  { service: "gmail", system: GMAIL_AGENT_SYSTEM_PROMPT },
  { service: "drive", system: DRIVE_AGENT_SYSTEM_PROMPT },
  { service: "calendar", system: CALENDAR_AGENT_SYSTEM_PROMPT },
];

// Toolset enxuto de um sub-agent de domínio: o mcp_toolset do seu serviço
// (always_allow, senão trava sem UI de confirmação na Fase 1) + só o file tool
// `read`, que a runtime exige pra abrir outputs MCP grandes (>100K tokens são
// offloaded pra arquivo). Sem bash/write/web — o sub-agent só relaia a tool.
function domainSubagentTools(
  service: Service,
): Anthropic.Beta.Agents.AgentCreateParams["tools"] {
  return [
    {
      type: "agent_toolset_20260401",
      default_config: { enabled: false },
      configs: [{ name: "read", enabled: true }],
    },
    {
      type: "mcp_toolset",
      mcp_server_name: service,
      default_config: {
        enabled: true,
        permission_policy: { type: "always_allow" },
      },
    },
  ];
}

const BUILTIN_SKILLS_ORCHESTRATOR: { skill_id: "pdf" | "docx" | "xlsx" }[] = [
  { skill_id: "pdf" },
  { skill_id: "docx" },
  { skill_id: "xlsx" },
];

type Log = (action: "created" | "reused" | "info", what: string) => void;

function makeLogger(): Log {
  return (action, what) => {
    const tag =
      action === "created" ? "✚" : action === "reused" ? "·" : "•";
    console.log(`${tag} ${action.padEnd(7)} ${what}`);
  };
}

function parseArgs(): { workspaceSlug: string; reconcile: boolean } {
  const args = process.argv.slice(2);
  const arg = args.find((a) => a.startsWith("--workspace="));
  if (!arg) {
    console.error(
      "Erro: --workspace=<slug> é obrigatório.\n  uso: bun run scripts/provision-workspace.ts --workspace=<slug> [--reconcile]",
    );
    process.exit(1);
  }
  const slug = arg.slice("--workspace=".length).trim();
  if (!slug) {
    console.error("Erro: --workspace=<slug> não pode ser vazio.");
    process.exit(1);
  }
  // --reconcile atualiza a config de agents que já existem (tools, skills,
  // system, etc.) via agents.update, em vez de só pular. Use quando a config
  // do agent mudou (ex. adicionar o agent_toolset).
  return { workspaceSlug: slug, reconcile: args.includes("--reconcile") };
}

async function loadWorkspace(slug: string) {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.status, "active")));
  if (!row) {
    console.error(`Erro: workspace '${slug}' não encontrado (ou arquivado).`);
    process.exit(1);
  }
  return row;
}

async function ensureSkill(
  client: Anthropic,
  workspaceId: string,
  spec: SkillSpec,
  log: Log,
): Promise<{ anthropicSkillId: string; latestVersion: string | null }> {
  const [existing] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.workspaceId, workspaceId), eq(skills.slug, spec.slug)));

  if (existing) {
    log("reused", `skill ${spec.slug} (${existing.anthropicSkillId})`);
    return {
      anthropicSkillId: existing.anthropicSkillId,
      latestVersion: existing.latestVersion,
    };
  }

  // Anthropic Skills API espera upload de uma pasta com SKILL.md no root.
  // O SDK aceita Array<Uploadable>; cada File precisa ter webkitRelativePath
  // ou name com pasta — passamos via `name` no toFile().
  const skillFile = await toFile(
    new Blob([spec.skillMarkdown], { type: "text/markdown" }),
    `${spec.slug}/SKILL.md`,
  );

  const created = await client.beta.skills.create({
    display_title: spec.displayTitle,
    files: [skillFile],
  });

  await db.insert(skills).values({
    workspaceId,
    slug: spec.slug,
    anthropicSkillId: created.id,
    latestVersion: created.latest_version,
  });

  log("created", `skill ${spec.slug} (${created.id})`);
  return {
    anthropicSkillId: created.id,
    latestVersion: created.latest_version,
  };
}

async function ensureMemoryStore(
  client: Anthropic,
  workspaceId: string,
  workspaceSlug: string,
  tier: "short" | "long" | "knowledge",
  description: string,
  log: Log,
): Promise<{ rowId: string; anthropicId: string; slug: string }> {
  const slug = `memstore_${workspaceSlug}_${tier}`;
  const [existing] = await db
    .select()
    .from(memoryStores)
    .where(
      and(
        eq(memoryStores.workspaceId, workspaceId),
        eq(memoryStores.slug, slug),
      ),
    );

  if (existing) {
    log("reused", `memory_store ${slug} (${existing.anthropicMemoryStoreId})`);
    return {
      rowId: existing.id,
      anthropicId: existing.anthropicMemoryStoreId,
      slug,
    };
  }

  const created = await client.beta.memoryStores.create({
    name: slug,
    description,
  });

  const [inserted] = await db
    .insert(memoryStores)
    .values({
      workspaceId,
      slug,
      anthropicMemoryStoreId: created.id,
      tier,
      description,
    })
    .returning();

  log("created", `memory_store ${slug} (${created.id})`);
  return { rowId: inserted.id, anthropicId: created.id, slug };
}

type AgentCreateInput = {
  slug: string;
  role: "orchestrator" | "builder" | "sub_agent";
  model: string;
  system: string;
  tools?: Anthropic.Beta.Agents.AgentCreateParams["tools"];
  mcpServers?: Anthropic.Beta.Agents.AgentCreateParams["mcp_servers"];
  skills?: Anthropic.Beta.Agents.AgentCreateParams["skills"];
  multiagent?: Anthropic.Beta.Agents.AgentCreateParams["multiagent"];
};

async function ensureAgent(
  client: Anthropic,
  workspaceId: string,
  input: AgentCreateInput,
  log: Log,
  reconcile: boolean,
): Promise<{ rowId: string; anthropicId: string; version: number }> {
  const [existing] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.slug, input.slug)));

  if (existing) {
    if (!reconcile) {
      // Por padrão não atualizamos — iteração de prompt/tools acontece via
      // /chat na Fase 1 (builder sub-agent o faz). Provisão garante presença.
      log("reused", `agent ${input.slug} (${existing.anthropicAgentId})`);
      return {
        rowId: existing.id,
        anthropicId: existing.anthropicAgentId,
        version: existing.version ? Number(existing.version) : 1,
      };
    }
    // --reconcile: traz a config do agent existente pro estado desejado.
    // Pega a versão atual da Anthropic pra evitar conflito de concorrência.
    const current = await client.beta.agents.retrieve(existing.anthropicAgentId);
    const updated = await client.beta.agents.update(existing.anthropicAgentId, {
      version: current.version,
      model: input.model,
      system: input.system,
      tools: input.tools,
      mcp_servers: input.mcpServers,
      skills: input.skills,
      multiagent: input.multiagent,
    });
    await db
      .update(agents)
      .set({
        version: String(updated.version),
        model: input.model,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, existing.id));
    log("created", `agent ${input.slug} reconciliado → v${updated.version}`);
    return {
      rowId: existing.id,
      anthropicId: existing.anthropicAgentId,
      version: updated.version,
    };
  }

  const created = await client.beta.agents.create({
    model: input.model,
    name: input.slug,
    description: `${input.role} agent para o workspace`,
    system: input.system,
    tools: input.tools,
    mcp_servers: input.mcpServers,
    skills: input.skills,
    multiagent: input.multiagent,
  });

  const [inserted] = await db
    .insert(agents)
    .values({
      workspaceId,
      slug: input.slug,
      role: input.role,
      anthropicAgentId: created.id,
      version: String(created.version),
      model: input.model,
    })
    .returning();

  log("created", `agent ${input.slug} (${created.id} v${created.version})`);
  return { rowId: inserted.id, anthropicId: created.id, version: created.version };
}

async function ensureAgentMemoryLink(
  agentRowId: string,
  memoryStoreRowId: string,
  accessLevel: "read_write" | "read_only",
  label: string,
  log: Log,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(agentMemoryStores)
    .where(
      and(
        eq(agentMemoryStores.agentId, agentRowId),
        eq(agentMemoryStores.memoryStoreId, memoryStoreRowId),
      ),
    );

  if (existing) {
    log("reused", `link ${label} (${existing.accessLevel})`);
    return;
  }

  await db.insert(agentMemoryStores).values({
    agentId: agentRowId,
    memoryStoreId: memoryStoreRowId,
    accessLevel,
  });

  log("created", `link ${label} (${accessLevel})`);
}

async function ensureJob(
  workspaceId: string,
  slug: string,
  targetAgentRowId: string,
  cronExpr: string,
  kickoffPrompt: string,
  log: Log,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.slug, slug)));

  if (existing) {
    log("reused", `job ${slug} (cron: ${existing.cronExpr})`);
    return;
  }

  await db.insert(jobs).values({
    workspaceId,
    slug,
    targetAgentId: targetAgentRowId,
    cronExpr,
    kickoffPrompt,
    enabled: true,
  });

  log("created", `job ${slug} (cron: ${cronExpr})`);
}

// Toolset padrão (read/write/edit/glob/grep/bash). Skills — built-in ou custom
// — exigem o `read` tool habilitado neste toolset, senão a criação da session
// é rejeitada pela Anthropic. Tanto orchestrator quanto builder precisam dele.
const AGENT_TOOLSET: Anthropic.Beta.Agents.AgentCreateParams["tools"] = [
  { type: "agent_toolset_20260401" },
];

async function main(): Promise<void> {
  const { workspaceSlug, reconcile } = parseArgs();
  const log = makeLogger();
  if (reconcile) log("info", "modo --reconcile: agents existentes serão atualizados");

  console.log(`\n→ Provisionando workspace '${workspaceSlug}'\n`);

  const ws = await loadWorkspace(workspaceSlug);
  log("info", `workspace ${ws.slug} (${ws.id})`);

  const apiKey = await decryptSecret(ws.anthropicApiKeyEncrypted);
  const client = new Anthropic({ apiKey });

  // 1. Skills custom (PT-BR markdown mínimo viável).
  const skillConfig = await ensureSkill(
    client,
    ws.id,
    SMA_CUSTOM_SKILLS[0],
    log,
  );
  const skillMemory = await ensureSkill(
    client,
    ws.id,
    SMA_CUSTOM_SKILLS[1],
    log,
  );

  // 2. Memory stores (short / long / knowledge).
  const memShort = await ensureMemoryStore(
    client,
    ws.id,
    ws.slug,
    "short",
    `Curto prazo do workspace ${ws.slug}: tudo registrado nas últimas 24h. Consolidado diariamente.`,
    log,
  );
  const memLong = await ensureMemoryStore(
    client,
    ws.id,
    ws.slug,
    "long",
    `Longo prazo do workspace ${ws.slug}: resumos semanais (YYYY-WW.md) e padrões de longo prazo do executivo.`,
    log,
  );
  const memKnowledge = await ensureMemoryStore(
    client,
    ws.id,
    ws.slug,
    "knowledge",
    `Base de conhecimento curada do workspace ${ws.slug}: preferências declaradas, contatos importantes, documentos de referência.`,
    log,
  );

  // 3. Builder agent (control-plane tools + 2 custom skills).
  const builder = await ensureAgent(
    client,
    ws.id,
    {
      slug: `${ws.slug}_builder`,
      role: "builder",
      model: BUILDER_MODEL,
      system: BUILDER_SYSTEM_PROMPT,
      // agent_toolset (file tools que as skills exigem, §8.2 do PRD) +
      // custom control-plane tools.
      tools: [...(AGENT_TOOLSET ?? []), ...(BUILDER_CUSTOM_TOOLS ?? [])],
      skills: [
        {
          type: "custom",
          skill_id: skillConfig.anthropicSkillId,
          version: skillConfig.latestVersion,
        },
        {
          type: "custom",
          skill_id: skillMemory.anthropicSkillId,
          version: skillMemory.latestVersion,
        },
      ],
    },
    log,
    reconcile,
  );

  // 3c. Sub-agents de domínio Google (gmail/drive/calendar). Cada um carrega só
  // o seu MCP server + o file tool `read`, em Haiku. O orchestrator (coordinator)
  // delega pra eles em vez de carregar todos os MCPs. A credencial OAuth vive na
  // vault Google do workspace (casa por URL), então o sub-agent funciona assim
  // que o serviço é conectado em Conexões — não precisa re-provisionar. Só são
  // criados os serviços com MCP URL no .env.
  const domainSubAgentIds: string[] = [];
  for (const { service, system } of DOMAIN_SUBAGENTS) {
    const mcpUrl = serviceMcpUrl(service);
    if (!mcpUrl) {
      log(
        "info",
        `${service}: sem MCP URL no .env — sub-agent de domínio não criado`,
      );
      continue;
    }
    const sub = await ensureAgent(
      client,
      ws.id,
      {
        slug: `${ws.slug}_${service}_agent`,
        role: "sub_agent",
        model: SUBAGENT_MODEL,
        system,
        mcpServers: [{ name: service, type: "url", url: mcpUrl }],
        tools: domainSubagentTools(service),
      },
      log,
      reconcile,
    );
    domainSubAgentIds.push(sub.anthropicId);
  }

  // 4. Orchestrator agent (coordinator: builder + sub-agents de domínio; MCP:
  //    sma; built-in skills).
  // SMA_BASE_URL fornece o host do MCP server `sma` (skeleton em SMA-10).
  // Anthropic rejeita URLs com hostname loopback (localhost/127.0.0.1) —
  // a runtime deles não acessa a máquina local. Em dev a gente registra o
  // agent SEM MCP server e re-roda a provisão quando o SMA-10 estiver
  // exposto publicamente (tunnel / deploy).
  const smaBaseUrl = process.env.SMA_BASE_URL ?? "http://localhost:3009";
  const isLoopback = /^(https?:)?\/\/(localhost|127\.|\[::1\])/i.test(smaBaseUrl);
  const smaMcpUrl = isLoopback
    ? null
    : `${smaBaseUrl.replace(/\/+$/, "")}/api/mcp/sma/${ws.slug}`;
  if (isLoopback) {
    log(
      "info",
      `SMA_BASE_URL='${smaBaseUrl}' é loopback — orchestrator será criado sem MCP server. Re-rode após expor SMA-10 publicamente.`,
    );
  }

  const orchestrator = await ensureAgent(
    client,
    ws.id,
    {
      slug: `${ws.slug}_orchestrator`,
      role: "orchestrator",
      model: ORCHESTRATOR_MODEL,
      system: ORCHESTRATOR_SYSTEM_PROMPT,
      // Explicitamente `[]` (não undefined) quando sem sma: em --reconcile isso
      // garante que MCP servers Google legados (deixados pelo SMA-18, antes do
      // split) sejam removidos do orchestrator — eles agora vivem nos
      // sub-agents de domínio.
      mcpServers: smaMcpUrl
        ? [{ name: "sma", type: "url", url: smaMcpUrl }]
        : [],
      // agent_toolset (read/write/etc. que as built-in skills exigem) + o
      // mcp_toolset do `sma` quando exposto publicamente.
      tools: [
        ...(AGENT_TOOLSET ?? []),
        ...(smaMcpUrl
          ? [
              {
                type: "mcp_toolset" as const,
                mcp_server_name: "sma",
                // always_allow: o default do mcp_toolset é always_ask, que sem
                // UI de confirmação (Fase 1) trava a tool. Liberamos pra o
                // orchestrator usar a tool direto.
                default_config: {
                  enabled: true,
                  permission_policy: { type: "always_allow" as const },
                },
              },
            ]
          : []),
      ],
      skills: BUILTIN_SKILLS_ORCHESTRATOR.map((s) => ({
        type: "anthropic",
        skill_id: s.skill_id,
      })),
      multiagent: {
        type: "coordinator",
        agents: [builder.anthropicId, ...domainSubAgentIds],
      },
    },
    log,
    reconcile,
  );

  // 4b. Bearer + vault do MCP `sma`. Idempotente: só gera se ainda não existe
  // (use o script rotate-sma-mcp-token pra rotacionar). Em loopback gera só o
  // token local; com SMA_BASE_URL público, espelha a credential na vault.
  const existingBearer = await getSecret(ws.id, MCP_BEARER_KEY);
  if (existingBearer) {
    log("reused", "bearer do MCP sma");
  } else {
    await rotateSmaMcpToken(client, ws.id, ws.slug, smaBaseUrl, (m) =>
      log("info", m),
    );
    log("created", "bearer do MCP sma");
  }

  // 5. Links memory ↔ agent (builder = RW em todas; orchestrator = RW em
  // short, RO em long e knowledge — declarativo no Neon; runtime usa).
  await ensureAgentMemoryLink(
    builder.rowId,
    memShort.rowId,
    "read_write",
    `builder ↔ ${memShort.slug}`,
    log,
  );
  await ensureAgentMemoryLink(
    builder.rowId,
    memLong.rowId,
    "read_write",
    `builder ↔ ${memLong.slug}`,
    log,
  );
  await ensureAgentMemoryLink(
    builder.rowId,
    memKnowledge.rowId,
    "read_write",
    `builder ↔ ${memKnowledge.slug}`,
    log,
  );
  await ensureAgentMemoryLink(
    orchestrator.rowId,
    memShort.rowId,
    "read_write",
    `orchestrator ↔ ${memShort.slug}`,
    log,
  );
  await ensureAgentMemoryLink(
    orchestrator.rowId,
    memLong.rowId,
    "read_only",
    `orchestrator ↔ ${memLong.slug}`,
    log,
  );
  await ensureAgentMemoryLink(
    orchestrator.rowId,
    memKnowledge.rowId,
    "read_only",
    `orchestrator ↔ ${memKnowledge.slug}`,
    log,
  );

  // 6. Jobs default (consolidação curto + longo → builder).
  await ensureJob(
    ws.id,
    "consolidate_short",
    builder.rowId,
    "0 3 * * *",
    "Rode a skill skill_sma_memory_consolidation pro fluxo de consolidação diária do memstore_short. Produza o arquivo YYYY-MM-DD.md cobrindo as últimas 24h.",
    log,
  );
  await ensureJob(
    ws.id,
    "consolidate_long",
    builder.rowId,
    "0 23 * * 0",
    "Rode a skill skill_sma_memory_consolidation pro fluxo de consolidação semanal do memstore_long. Produza o arquivo YYYY-WW.md cobrindo a semana ISO recém-encerrada.",
    log,
  );

  console.log(`\n✓ Workspace '${workspaceSlug}' provisionado.\n`);
}

main().catch((err) => {
  console.error("\n✗ Falha na provisão:");
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
