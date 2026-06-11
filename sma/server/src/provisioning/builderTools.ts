// Declarações das 12 control-plane tools do builder (PRD §8.2).
// SMA-8 só REGISTRA as definições no agent — os handlers ficam pra
// SMA-9+. Quando o builder chamar uma dessas tools antes do handler
// existir, a sessão fica aguardando custom_tool_result; o operador
// resolve manualmente até o handler entrar.
//
// Schemas são JSON Schema com "type":"object" no topo (exigido pela API).

import type Anthropic from "@anthropic-ai/sdk";

type CustomToolParams =
  Anthropic.Beta.Agents.BetaManagedAgentsCustomToolParams;

export const BUILDER_CUSTOM_TOOLS: CustomToolParams[] = [
  {
    type: "custom",
    name: "sma_create_agent",
    description:
      "Cria um novo agent no workspace (sub-agent nominal, ex. email_triage). Use sma_list_agents antes pra checar se já existe.",
    input_schema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Identificador interno do agent (ex. 'email_triage').",
        },
        role: {
          type: "string",
          enum: ["sub_agent"],
          description: "Tipo do agent. Builder só cria sub_agent.",
        },
        system_prompt: {
          type: "string",
          description: "System prompt PT-BR do agent.",
        },
        model: {
          type: "string",
          description: "Model identifier Anthropic (ex. 'claude-sonnet-4-6').",
        },
        skills: {
          type: "array",
          items: { type: "string" },
          description: "Slugs de skills custom (workspace-scoped) a anexar.",
        },
      },
      required: ["slug", "role", "system_prompt", "model"],
    },
  },
  {
    type: "custom",
    name: "sma_update_agent",
    description:
      "Atualiza um agent existente. Gera nova versão Anthropic. Passe só os campos que mudam.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        system_prompt: { type: "string" },
        model: { type: "string" },
        skills: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["slug"],
    },
  },
  {
    type: "custom",
    name: "sma_list_agents",
    description:
      "Lista todos os agents ativos do workspace, com slug, role, version e timestamp da última atualização.",
    input_schema: {
      type: "object",
      properties: {
        include_archived: {
          type: "boolean",
          description: "Default false.",
        },
      },
    },
  },
  {
    type: "custom",
    name: "sma_get_agent",
    description:
      "Retorna a configuração completa de um agent específico, inclusive system prompt, tools e skills.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
      },
      required: ["slug"],
    },
  },
  {
    type: "custom",
    name: "sma_create_skill_version",
    description:
      "Cria uma nova versão de uma skill custom existente. Use pra atualizar o conteúdo de uma skill sem perder o histórico de versões anteriores.",
    input_schema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Slug da skill (ex. 'skill_sma_config').",
        },
        skill_markdown: {
          type: "string",
          description: "Conteúdo completo do SKILL.md da nova versão.",
        },
      },
      required: ["slug", "skill_markdown"],
    },
  },
  {
    type: "custom",
    name: "sma_attach_skill",
    description:
      "Anexa uma skill (custom ou built-in) a um agent existente, pinando uma versão específica.",
    input_schema: {
      type: "object",
      properties: {
        agent_slug: { type: "string" },
        skill_slug: { type: "string" },
        skill_type: {
          type: "string",
          enum: ["custom", "anthropic"],
        },
        version: {
          type: "string",
          description: "Versão a pinar. Omita pra usar latest.",
        },
      },
      required: ["agent_slug", "skill_slug", "skill_type"],
    },
  },
  {
    type: "custom",
    name: "sma_create_memory_store",
    description:
      "Cria um memory store novo no workspace. Use tier semântico (short/long/knowledge).",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        tier: {
          type: "string",
          enum: ["short", "long", "knowledge"],
        },
        description: {
          type: "string",
          description:
            "Vai pro system prompt quando o store é montado — escreva pra ser útil ao agent.",
        },
      },
      required: ["slug", "tier", "description"],
    },
  },
  {
    type: "custom",
    name: "sma_attach_memory",
    description:
      "Liga um memory store a um agent com ACL declarada (read_write ou read_only).",
    input_schema: {
      type: "object",
      properties: {
        agent_slug: { type: "string" },
        memory_store_slug: { type: "string" },
        access_level: {
          type: "string",
          enum: ["read_write", "read_only"],
        },
      },
      required: ["agent_slug", "memory_store_slug", "access_level"],
    },
  },
  {
    type: "custom",
    name: "sma_create_connection_start_oauth",
    description:
      "Inicia fluxo OAuth pra uma conexão externa (Google, etc.). Retorna URL que o executivo precisa abrir pra autorizar.",
    input_schema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["google_gmail", "google_drive", "google_calendar"],
        },
      },
      required: ["provider"],
    },
  },
  {
    type: "custom",
    name: "sma_attach_vault_to_session_default",
    description:
      "Define a credencial do vault Anthropic que será usada por default em sessões do agent indicado (ex. token Google de um provider).",
    input_schema: {
      type: "object",
      properties: {
        agent_slug: { type: "string" },
        vault_credential_id: { type: "string" },
      },
      required: ["agent_slug", "vault_credential_id"],
    },
  },
  {
    type: "custom",
    name: "sma_create_hook",
    description:
      "Cria um hook (guardrail) que intercepta uma classe de tool call e exige confirmação humana antes da execução.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        target_tool_pattern: {
          type: "string",
          description: "Glob match contra nome da tool (ex. 'gmail.send*').",
        },
        confirm_threshold: {
          type: "string",
          enum: ["always", "first_use_per_session"],
        },
      },
      required: ["name", "target_tool_pattern", "confirm_threshold"],
    },
  },
  {
    type: "custom",
    name: "sma_create_job",
    description:
      "Cria um cron job no workspace que dispara o agent alvo na frequência indicada com o prompt de kickoff dado.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        target_agent_slug: { type: "string" },
        cron_expr: {
          type: "string",
          description: "Cron syntax padrão de 5 campos.",
        },
        kickoff_prompt: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["slug", "target_agent_slug", "cron_expr", "kickoff_prompt"],
    },
  },
  {
    type: "custom",
    name: "sma_update_job",
    description:
      "Atualiza um job existente (cron, prompt, enabled). Passe só os campos que mudam.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        cron_expr: { type: "string" },
        kickoff_prompt: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["slug"],
    },
  },
  {
    type: "custom",
    name: "sma_get_cost_summary",
    description:
      "Retorna gasto acumulado no workspace (últimas 24h, 7d, 30d) em USD estimado, quebrado por agent.",
    input_schema: {
      type: "object",
      properties: {
        window: {
          type: "string",
          enum: ["24h", "7d", "30d"],
        },
      },
      required: ["window"],
    },
  },
];
