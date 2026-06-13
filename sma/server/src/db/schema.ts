import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Placeholder mínimo (SMA-6). Sync com Clerk vem quando precisarmos
// referenciar usuário de forma persistente (futuros tickets).
export const users = pgTable("users", {
  id: text("id").primaryKey(), // = clerk_user_id
  email: text("email").notNull().unique(),
  name: text("name"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// Singleton — uma linha só. Em Fase 1 o domain restriction é null (sem
// restrição). Em Fase 2 (hospedagem) populamos com "smarttalks.ai".
export const orgConfig = pgTable("org_config", {
  id: text("id").primaryKey().default("singleton"),
  anthropicOrgId: text("anthropic_org_id"),
  allowedEmailDomain: text("allowed_email_domain"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Espelho de Anthropic Workspace. Um por executivo (cliente).
// anthropic_api_key_encrypted: encriptado at-rest com libsodium secretbox
// usando SMA_SECRETS_MASTER_KEY (32 bytes hex). Nunca cacheamos a chave
// decriptada em memória; sempre decripta on-demand.
export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  anthropicWorkspaceId: text("anthropic_workspace_id"),
  anthropicApiKeyEncrypted: text("anthropic_api_key_encrypted").notNull(),
  executiveName: text("executive_name").notNull(),
  displayName: text("display_name").notNull(),
  defaultEnvironmentId: text("default_environment_id"),
  status: text("status").$type<"active" | "archived">().default("active").notNull(),
  createdBy: text("created_by").notNull(), // = clerk_user_id
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

// Espelho de Anthropic custom Skill. Um por (workspace, slug). O slug é o
// identificador semântico que o script de provisão usa pra idempotência
// (ex. `skill_sma_config`). Versões são gerenciadas pela Anthropic; salvamos
// só a latest pra debugging.
export const skills = pgTable(
  "skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    anthropicSkillId: text("anthropic_skill_id").notNull(),
    latestVersion: text("latest_version"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    workspaceSlugIdx: uniqueIndex("skills_workspace_slug_idx").on(
      t.workspaceId,
      t.slug,
    ),
  }),
);

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;

// Espelho de Anthropic Memory Store. tier descreve o papel semântico (curto,
// longo, conhecimento) e é usado pelo agent_memory_store pra decidir ACL.
export const memoryStores = pgTable(
  "memory_stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    anthropicMemoryStoreId: text("anthropic_memory_store_id").notNull(),
    tier: text("tier").$type<"short" | "long" | "knowledge">().notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    workspaceSlugIdx: uniqueIndex("memory_stores_workspace_slug_idx").on(
      t.workspaceId,
      t.slug,
    ),
  }),
);

export type MemoryStore = typeof memoryStores.$inferSelect;
export type NewMemoryStore = typeof memoryStores.$inferInsert;

// Espelho de Anthropic Managed Agent. role identifica o papel canônico
// (orchestrator, builder, sub-agente nominal). Múltiplos agents por workspace.
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    role: text("role")
      .$type<"orchestrator" | "builder" | "sub_agent">()
      .notNull(),
    anthropicAgentId: text("anthropic_agent_id").notNull(),
    version: text("version"),
    model: text("model"),
    status: text("status")
      .$type<"active" | "archived">()
      .default("active")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    workspaceSlugIdx: uniqueIndex("agents_workspace_slug_idx").on(
      t.workspaceId,
      t.slug,
    ),
  }),
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

// Liga agents a memory stores com ACL. accessLevel: read_write ou read_only.
// Anthropic atualmente não diferencia ACL no resource attach — o read_only
// fica como intenção declarativa (Phase 1) e o builder respeita via system
// prompt + custom tool gating quando isso for relevante.
export const agentMemoryStores = pgTable(
  "agent_memory_stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    memoryStoreId: uuid("memory_store_id")
      .notNull()
      .references(() => memoryStores.id, { onDelete: "cascade" }),
    accessLevel: text("access_level")
      .$type<"read_write" | "read_only">()
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    agentMemoryIdx: uniqueIndex("agent_memory_stores_pair_idx").on(
      t.agentId,
      t.memoryStoreId,
    ),
  }),
);

export type AgentMemoryStore = typeof agentMemoryStores.$inferSelect;
export type NewAgentMemoryStore = typeof agentMemoryStores.$inferInsert;

// Jobs cron-like. Fase 1: persistimos a definição; o worker que dispara
// (SMA-12+) lê esta tabela. cronExpr é syntax cron padrão (5 campos).
// kickoffPrompt é o texto que o worker manda como primeiro user.message
// quando cria a sessão.
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    targetAgentId: uuid("target_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    cronExpr: text("cron_expr").notNull(),
    kickoffPrompt: text("kickoff_prompt").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    workspaceSlugIdx: uniqueIndex("jobs_workspace_slug_idx").on(
      t.workspaceId,
      t.slug,
    ),
  }),
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

// Espelho de Anthropic Managed Agents Session. source identifica de onde a
// conversa veio (chat web, WhatsApp, job cron) — mesma session do orchestrator
// independente do canal. Os campos de usage são cumulativos da Anthropic
// (último polling); a CostEntry guarda o valor em USD pra página de custos.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    anthropicSessionId: text("anthropic_session_id").notNull(),
    // agent alvo da session (orchestrator em Fase 1). Nullable: se o mirror do
    // agent sumir, mantemos a session pra histórico/custo.
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    source: text("source")
      .$type<"web" | "whatsapp" | "job">()
      .default("web")
      .notNull(),
    status: text("status")
      .$type<"rescheduling" | "running" | "idle" | "terminated">()
      .default("running")
      .notNull(),
    title: text("title"),
    model: text("model"),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    cacheReadInputTokens: integer("cache_read_input_tokens").default(0).notNull(),
    cacheCreationInputTokens: integer("cache_creation_input_tokens")
      .default(0)
      .notNull(),
    usdEstimate: numeric("usd_estimate", { precision: 12, scale: 6 })
      .default("0")
      .notNull(),
    createdBy: text("created_by").notNull(), // = clerk_user_id
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    workspaceIdx: index("sessions_workspace_idx").on(t.workspaceId),
    anthropicIdx: uniqueIndex("sessions_anthropic_id_idx").on(
      t.anthropicSessionId,
    ),
  }),
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

// Subset renderável do event stream da Anthropic, persistido pra reload do
// chat (não duplicamos o stream inteiro — só o que a UI mostra). seq dá ordem
// estável de inserção. payload guarda o evento normalizado pro renderer.
export const sessionEvents = pgTable(
  "session_events",
  {
    seq: serial("seq").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    anthropicEventId: text("anthropic_event_id"),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    sessionIdx: index("session_events_session_idx").on(t.sessionId),
  }),
);

export type SessionEvent = typeof sessionEvents.$inferSelect;
export type NewSessionEvent = typeof sessionEvents.$inferInsert;

// Ledger de custo por session. Como a Anthropic devolve usage cumulativo,
// mantemos uma linha por session (upsert) refletindo o total corrente.
export const costEntries = pgTable(
  "cost_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    model: text("model"),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    cacheReadInputTokens: integer("cache_read_input_tokens").default(0).notNull(),
    cacheCreationInputTokens: integer("cache_creation_input_tokens")
      .default(0)
      .notNull(),
    usdEstimate: numeric("usd_estimate", { precision: 12, scale: 6 })
      .default("0")
      .notNull(),
    capturedAt: timestamp("captured_at").defaultNow().notNull(),
  },
  (t) => ({
    sessionIdx: uniqueIndex("cost_entries_session_idx").on(t.sessionId),
    workspaceIdx: index("cost_entries_workspace_idx").on(t.workspaceId),
  }),
);

export type CostEntry = typeof costEntries.$inferSelect;
export type NewCostEntry = typeof costEntries.$inferInsert;

// Preços por modelo em USD por 1M tokens. Editável (página de custos / admin).
// Seed idempotente com os modelos conhecidos em lib/pricing.ts.
export const modelPricing = pgTable("model_pricing", {
  model: text("model").primaryKey(),
  inputPerMtok: numeric("input_per_mtok", { precision: 12, scale: 4 })
    .default("0")
    .notNull(),
  outputPerMtok: numeric("output_per_mtok", { precision: 12, scale: 4 })
    .default("0")
    .notNull(),
  cacheReadPerMtok: numeric("cache_read_per_mtok", { precision: 12, scale: 4 })
    .default("0")
    .notNull(),
  cacheWritePerMtok: numeric("cache_write_per_mtok", { precision: 12, scale: 4 })
    .default("0")
    .notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ModelPricing = typeof modelPricing.$inferSelect;
export type NewModelPricing = typeof modelPricing.$inferInsert;
