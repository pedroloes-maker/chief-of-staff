// Agendamento — Scheduled Deployments do workspace (SMA-33). Crons que disparam
// o agente (brief matinal, email check, consolidação, heartbeat) rodam como
// Anthropic Scheduled Deployments nativos: server-side, always-on, sem depender
// da nossa máquina (PRD §11.2). Cada disparo cria uma sessão autônoma e vira um
// DeploymentRun pra auditoria.
//
// Decisão (desvio consciente do PRD §5.1): `deployments.list()` é por-API-key,
// ou seja já workspace-scoped (cada workspace tem sua chave Anthropic). Então
// NÃO mantemos mirror no Neon — listamos/gerenciamos Deployments e Runs ao vivo
// (como buscamos versões de memória/skill), resolvendo o slug do agente pelo
// mirror de `agents`. O mirror Deployment/DeploymentRun fica como follow-up se
// precisarmos de rollup de custo cross-workspace (§15.3). O escopo por-workspace
// é garantido pela própria chave: a Anthropic só enxerga os deployments do
// workspace daquela key, então um id de outro workspace cai em 404.

import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { agents, workspaces } from "../db/schema";
import { decryptSecret } from "../lib/crypto";
import { ValidationError } from "./workspaces";

type AgentRole = "orchestrator" | "builder" | "sub_agent";

export type DeploymentScheduleView = {
  expression: string;
  timezone: string;
  lastRunAt: string | null;
  upcomingRunsAt: string[];
} | null;

export type DeploymentView = {
  id: string; // depl_…
  name: string;
  description: string | null;
  status: "active" | "paused" | "archived";
  pausedReason: string | null; // "manual" ou o error.type que auto-pausou
  agentId: string; // anthropic agent id
  agentSlug: string | null;
  agentRole: AgentRole | null;
  agentVersion: number;
  kickoff: string | null; // texto do primeiro user.message
  schedule: DeploymentScheduleView;
  createdAt: string;
};

export type DeploymentRunView = {
  id: string; // drun_…
  status: "success" | "error";
  sessionId: string | null;
  errorType: string | null;
  errorMessage: string | null;
  trigger: "schedule" | "manual";
  scheduledAt: string | null;
  createdAt: string;
};

export type CreateDeploymentInput = {
  agentId: string; // id do mirror (uuid)
  name: string;
  cronExpression: string;
  timezone: string;
  kickoff: string;
  description?: string | null;
};

type AgentMeta = { slug: string; role: AgentRole };

async function loadWorkspace(slug: string) {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.status, "active")));
  if (!ws) throw new ValidationError("workspace não encontrado");
  return ws;
}

async function ctx(slug: string): Promise<{
  ws: typeof workspaces.$inferSelect;
  client: Anthropic;
  byAid: Map<string, AgentMeta>;
}> {
  const ws = await loadWorkspace(slug);
  const client = new Anthropic({
    apiKey: await decryptSecret(ws.anthropicApiKeyEncrypted),
  });
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, ws.id));
  const byAid = new Map<string, AgentMeta>(
    rows.map((r) => [r.anthropicAgentId, { slug: r.slug, role: r.role }]),
  );
  return { ws, client, byAid };
}

type LiveDeployment = Anthropic.Beta.BetaManagedAgentsDeployment;
type LiveRun = Anthropic.Beta.BetaManagedAgentsDeploymentRun;

function scheduleView(s: LiveDeployment["schedule"]): DeploymentScheduleView {
  if (!s) return null;
  return {
    expression: s.expression,
    timezone: s.timezone,
    lastRunAt: s.last_run_at ?? null,
    upcomingRunsAt: s.upcoming_runs_at ?? [],
  };
}

function kickoffText(events: LiveDeployment["initial_events"]): string | null {
  for (const e of events) {
    if (e.type === "user.message") {
      const block = e.content.find((c) => c.type === "text");
      if (block && "text" in block) return block.text;
    }
  }
  return null;
}

function pausedReasonLabel(pr: LiveDeployment["paused_reason"]): string | null {
  if (!pr) return null;
  return pr.type === "manual" ? "manual" : (pr.error?.type ?? "error");
}

function deploymentView(
  d: LiveDeployment,
  byAid: Map<string, AgentMeta>,
): DeploymentView {
  const m = byAid.get(d.agent.id);
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    status: d.archived_at ? "archived" : d.status,
    pausedReason: pausedReasonLabel(d.paused_reason),
    agentId: d.agent.id,
    agentSlug: m?.slug ?? null,
    agentRole: m?.role ?? null,
    agentVersion: d.agent.version,
    kickoff: kickoffText(d.initial_events),
    schedule: scheduleView(d.schedule),
    createdAt: d.created_at,
  };
}

function runView(r: LiveRun): DeploymentRunView {
  return {
    id: r.id,
    status: r.session_id ? "success" : "error",
    sessionId: r.session_id ?? null,
    errorType: r.error?.type ?? null,
    errorMessage: r.error?.message ?? null,
    trigger: r.trigger_context.type,
    scheduledAt:
      r.trigger_context.type === "schedule"
        ? r.trigger_context.scheduled_at
        : null,
    createdAt: r.created_at,
  };
}

const STATUS_ORDER: Record<DeploymentView["status"], number> = {
  active: 0,
  paused: 1,
  archived: 2,
};

export async function listDeployments(slug: string): Promise<DeploymentView[]> {
  const { client, byAid } = await ctx(slug);
  const out: DeploymentView[] = [];
  for await (const d of client.beta.deployments.list({ limit: 100 })) {
    out.push(deploymentView(d, byAid));
  }
  return out.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.name.localeCompare(b.name),
  );
}

export async function listDeploymentRuns(
  slug: string,
  deploymentId: string,
): Promise<DeploymentRunView[]> {
  const ws = await loadWorkspace(slug);
  const client = new Anthropic({
    apiKey: await decryptSecret(ws.anthropicApiKeyEncrypted),
  });
  const out: DeploymentRunView[] = [];
  for await (const r of client.beta.deploymentRuns.list({
    deployment_id: deploymentId,
    limit: 50,
  })) {
    out.push(runView(r));
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createDeployment(
  slug: string,
  input: CreateDeploymentInput,
): Promise<DeploymentView> {
  if (!input.name?.trim()) throw new ValidationError("nome é obrigatório");
  if (!input.cronExpression?.trim()) {
    throw new ValidationError("expressão cron é obrigatória");
  }
  if (!input.timezone?.trim()) throw new ValidationError("timezone é obrigatória");
  if (!input.kickoff?.trim()) {
    throw new ValidationError("mensagem de kickoff é obrigatória");
  }

  const { ws, client, byAid } = await ctx(slug);
  if (!ws.defaultEnvironmentId) {
    throw new ValidationError("workspace sem environment default");
  }

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, input.agentId));
  if (!agent || agent.workspaceId !== ws.id) {
    throw new ValidationError("agente não pertence a este workspace");
  }
  if (agent.status === "archived") {
    throw new ValidationError("agente arquivado não pode ser alvo de deployment");
  }

  const created = await client.beta.deployments.create({
    name: input.name.trim(),
    agent: agent.anthropicAgentId, // string → versão mais recente
    environment_id: ws.defaultEnvironmentId,
    description: input.description?.trim() || null,
    initial_events: [
      { type: "user.message", content: [{ type: "text", text: input.kickoff.trim() }] },
    ],
    schedule: {
      type: "cron",
      expression: input.cronExpression.trim(),
      timezone: input.timezone.trim(),
    },
  });
  // O mapa pode não ter o agente se ele foi criado fora da UI; garante o slug.
  if (!byAid.has(agent.anthropicAgentId)) {
    byAid.set(agent.anthropicAgentId, { slug: agent.slug, role: agent.role });
  }
  return deploymentView(created, byAid);
}

export async function pauseDeployment(
  slug: string,
  id: string,
): Promise<DeploymentView> {
  const { client, byAid } = await ctx(slug);
  return deploymentView(await client.beta.deployments.pause(id), byAid);
}

export async function unpauseDeployment(
  slug: string,
  id: string,
): Promise<DeploymentView> {
  const { client, byAid } = await ctx(slug);
  return deploymentView(await client.beta.deployments.unpause(id), byAid);
}

// Dispara manualmente agora (trigger_context.type = "manual"), funciona até
// pausado — usado pra testar antes de confiar no cron.
export async function runDeployment(
  slug: string,
  id: string,
): Promise<DeploymentRunView> {
  const ws = await loadWorkspace(slug);
  const client = new Anthropic({
    apiKey: await decryptSecret(ws.anthropicApiKeyEncrypted),
  });
  return runView(await client.beta.deployments.run(id));
}

// Arquivar é terminal: o schedule para e o deployment fica imutável (a Anthropic
// não permite desarquivar). A UI confirma antes.
export async function archiveDeployment(
  slug: string,
  id: string,
): Promise<DeploymentView> {
  const { client, byAid } = await ctx(slug);
  return deploymentView(await client.beta.deployments.archive(id), byAid);
}
