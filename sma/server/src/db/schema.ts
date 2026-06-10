import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
