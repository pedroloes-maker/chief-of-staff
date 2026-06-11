# PRD — Chief-of-Staff (SMA)

**Status:** v1.1 · 2026-06-11 · decisões #38–41 incorporadas (tunnel MCP, jobs best-effort, AES-GCM, WhatsApp)
**Folder:** `sma/` (sibling to the reference app `cma/`)
**Audience:** Engineering team (internal); later, separate end-user app
**Language:** Portuguese-only UI for now; multi-language deferred

---

## 1. Vision

**Chief-of-Staff** é a plataforma interna que nosso time usa pra configurar, testar e operar agentes de IA que atuam como *chief of staff* pra executivos. Cada executivo tem um workspace dedicado na Anthropic com agentes curados (briefing, triagem de email/calendário, deep-dive research, automações), com memória própria, skills, conexões e jobs proativos.

Os agentes rodam em **Anthropic Managed Agents** (sessões hospedadas, containers gerenciados, configurações versionadas). SMA é o **control plane** em cima: UI multi-workspace, mirror DB, evento de custos, agente orquestrador com sub-agente builder, MCP server próprio com tools SMA, jobs/cron pro agente entrar em contato ativamente com o executivo, hooks, e gestão de vaults estendida.

Duas fases de usuários:

| Fase   | Usuários                              | App                                              |
| ------ | ------------------------------------- | ------------------------------------------------ |
| Fase 1 | Time SmartTalks (Pedro + colegas)     | `sma/` (este PRD) — roda local na máquina de cada um |
| Fase 2 | Executivos (clientes)                 | `chief/` — canvas de voz com UI generativa (o agente cria os widgets que precisa: input de texto, botões, auth, upload, stream de áudio) + sistema de créditos |

**SMA e chief são complementares.** SMA é onde nosso time inspeciona, testa e configura os agentes (control plane); `chief/` é onde o executivo conversa com o chief-of-staff dele por voz/texto e a UI é gerada pelo próprio agente. Os dois compartilham a mesma família visual monocromática (§16.3). Além do `chief/`, o executivo também fala com o agente via **WhatsApp** (§13.2).

Este PRD cobre apenas a Fase 1. Fase 2 será desenhada depois que Fase 1 estiver no ar com sinal real.

---

## 2. Fora de escopo (Fase 1)

- App pra executivos (Fase 2)
- Sistema de créditos / billing (Fase 2)
- Hospedagem cloud (Fase 2 — Fase 1 roda local)
- Mobile / TTS pra resposta em voz / multi-idioma
- Mecanismo automático de reconciliação Anthropic↔Neon (decisão sua: tratamos quando tiver drift de fato)
- Builder como página separada (decisão sua: builder é sub-agente do orquestrador, não uma UI)
- Redes / firewall granular nos environments (usaremos `cloud` + `unrestricted` em Fase 1)
- Reimplementar o que Anthropic Managed Agents já oferece nativo (versionamento de agent/memory, OAuth refresh em MCP credentials, sandboxing, multi-agent coordination)

---

## 3. Usuários, acesso e modelo de organização

### 3.1 Quem entra

- Autenticação via **Clerk** com **Google Auth**
- **Domínio restrito (Fase 2 — hospedagem):** quando hospedarmos, somente `@smarttalks.ai` no Clerk. **Em Fase 1 (local-only por operador), sem restrição** — quem tem o repositório já tem acesso, então a restrição não agrega segurança real e só adiciona fricção pra membros novos
- Uma única Clerk organization = nosso time
- Roles: **admin** (gerenciar membros, conectar workspaces Anthropic, redact memória), **operator** (tudo o resto)

### 3.2 Modelo de organização

**Simples e direto:**

- **1 Clerk org** = nosso time (Pedro + colegas em `@smarttalks.ai`)
- **1 Anthropic organization** (única — a nossa)
- **N Anthropic Workspaces** dentro dessa org — **um por executivo (cliente)**
- **Todos os membros do nosso time têm acesso a todos os workspaces.** Não há RBAC granular por workspace em Fase 1; qualquer operator pode entrar em qualquer workspace e mexer.

Não existe entidade `Account` separada no schema. O modelo é só `User` + `Workspace`.

### 3.3 Workspace switcher

- O switcher fica no **avatar menu** (canto superior direito)
- Clicar em outro workspace **muda a URL pra `/w/:workspaceSlug/...`** — toda navegação é workspace-scoped, deep links são sem ambiguidade
- A UI inteira (agentes, memória, sessões, jobs, vault, conexões, custos) reflete o workspace ativo

### 3.4 RBAC mínima (Fase 1)

| Ação                                       | Admin | Operator |
| ------------------------------------------ | ----- | -------- |
| Adicionar/remover membro do time           | ✅    | ❌       |
| Conectar Anthropic workspace novo          | ✅    | ❌       |
| Conectar Google pra um executivo           | ✅    | ✅       |
| Criar / editar / arquivar agentes          | ✅    | ✅       |
| Criar memórias, skills, tools, hooks, jobs | ✅    | ✅       |
| Abrir chat / iniciar sessão                | ✅    | ✅       |
| Ver conteúdo de memória                    | ✅    | ✅       |
| Redact versão de memória (compliance)      | ✅    | ❌       |
| Ver página de custos                       | ✅    | ✅       |

---

## 4. Arquitetura

```
┌────────────────────────────────────────────────────────────────────────┐
│ SMA (local, por membro do time)                                        │
│                                                                        │
│  ┌──────────────┐   HTTPS    ┌─────────────────────────────────────┐   │
│  │  app/        │ ◀────────▶ │  server/  (Bun.serve)               │   │
│  │  React+Vite  │            │   - routes (REST + SSE proxy)       │   │
│  │  Tailwind 4  │            │   - Drizzle → Neon (mirror DB)      │   │
│  │  Clerk SDK   │            │   - Anthropic SDK (workspace-keyed) │   │
│  │  (Google)    │            │   - JWT verification (Clerk)        │   │
│  └──────────────┘            │   - /api/mcp/sma  (our MCP server)  │   │
│                              │   - /api/mcp/gmail|drive|calendar   │   │
│                              │   - /api/jobs/* (Postgres queue)    │   │
│                              │   - /api/webhooks/anthropic         │   │
│                              │   - /api/audio/* (upload + STT)     │   │
│                              │   - /api/files/* (upload to R2)     │   │
│                              └─────────┬───────────────────────────┘   │
│                                        │                               │
│            ┌───────────────────────────┴──────────────────┐            │
│            │                                              │            │
│            ▼                                              ▼            │
│    ┌───────────────────┐                          ┌────────────────┐   │
│    │ Cloudflare R2     │                          │ STT provider   │   │
│    │  (audio + files)  │                          │ (Whisper API)  │   │
│    └───────────────────┘                          └────────────────┘   │
└────────────────────────────────────────────────────┬───────────────────┘
                                                     │
                          ┌──────────────────────────┼──────────────────┐
                          │  Anthropic Platform                         │
                          │   - Managed Agents API (source of truth)    │
                          │   - Multiagent: orchestrator + sub-agents   │
                          │   - Sessions / Containers / Memory Stores   │
                          │   - Vaults (MCP creds, auto-refresh)        │
                          │   - Webhooks → our /api/webhooks            │
                          │   - Dreaming (Fase 2+ via request access)   │
                          └─────────────────────────────────────────────┘
```

### Princípios

1. **Anthropic é source of truth** pra agentes, skills, memória, vaults MCP, environments, sessions. Neon é mirror pra query/UI/RBAC.
2. **Writes vão pra Anthropic primeiro.** Se Anthropic falhar, não escrevemos no Neon. (Sem 2PC — `list` endpoints permitem rebuild se houver drift.)
3. **Bun.serve stateless.** Worker de jobs em processo separado.
4. **Sem Claude Code CLI.** Tudo via Managed Agents (orchestrator + builder sub-agent fazem o papel que antes era do builder Claude Code).
5. **Monocromático preto/branco/cinza, sem cor saturada.** Hairlines, tipografia e espaço carregam a hierarquia; vidro fosco discreto só em chrome (§16.3).
6. **UI em português.**

### Stack

| Camada            | Escolha                                                                    | Por quê                                                                 |
| ----------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Frontend          | React 19 + Vite 6 + TypeScript + Tailwind 4 + Lucide                       | Mirror do CMA — componentes portam direto                              |
| Routing (cliente) | React Router 7                                                              | Mesmo do CMA                                                            |
| Auth              | **Clerk + Google OAuth** com domínio restrito `@smarttalks.ai`              | Decisão sua                                                             |
| Backend           | **Bun** + native `Bun.serve`                                                | Mesmo do CMA                                                            |
| DB                | **Neon Postgres** (projeto novo)                                            | Decisão sua                                                             |
| ORM               | Drizzle + `drizzle-kit`                                                     | Mesmo do CMA                                                            |
| Anthropic SDK     | `@anthropic-ai/sdk` (`managed-agents-2026-04-01` beta header)               | Para acessar Managed Agents + Memory Stores + Vaults + Multiagent       |
| Object storage    | **Cloudflare R2** (S3-compatible)                                           | Decisão sua — áudio + files não trafegam entre APIs                     |
| Speech-to-text    | **OpenAI Whisper API** (escolha defensável; barata, multilíngue, boa em PT) | Aberta a revisão                                                        |
| Jobs              | Postgres `Job`/`JobRun` + worker Bun com `setInterval(60_000)`              | Bun não tem queue native; Postgres é o caminho mais simples sem broker  |
| MCP transport     | Streamable HTTP via `Bun.serve` (porta do `cma/server/src/lib/mcp.ts`)      | Reuso direto                                                            |

---

## 5. Modelo de domínio

Vocabulário praticamente idêntico ao CMA, com deltas onde Managed Agents diverge da preview anterior. **Bold** = mirror only; *itálico* = SMA-native.

### 5.1 Lado SMA (Neon)

| Entidade               | Propósito                                                                                  | Equivalente Anthropic               |
| ---------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------- |
| `User`                 | Clerk user espelhado (id, email, name, role, allowed_domain_check)                          | None                                |
| `OrgConfig`            | Singleton: anthropic_org_id, allowed_email_domain (= `smarttalks.ai`)                       | None                                |
| `Workspace`            | Mirror de Anthropic workspace (slug pra URL, anthropic_workspace_id, api_key_encrypted, executive_name, default_environment_id, status) | **Workspace** (Console)             |
| `Agent`                | Mirror de `/v1/agents` (orchestrators e sub-agents)                                          | **Agent**                           |
| `AgentVersion`         | Snapshot por versão                                                                         | **Agent version**                   |
| `MultiagentRoster`     | Relação orchestrator → sub-agents (parte do agent config)                                   | (campo `multiagent.agents`)         |
| `Skill`                | Mirror de `/v1/skills` (Anthropic prebuilt + custom)                                         | **Skill** + **Skill version**       |
| `ToolDef`              | Definição de custom tool (JSON Schema + handler kind: webhook|sma-mcp|builder-control)      | (declarado por agent)               |
| `MemoryStore`          | Mirror de `/v1/memory_stores` (vários por workspace)                                         | **Memory Store**                    |
| `Memory`               | Mirror leve dos arquivos da store (path + size + sha256)                                     | **Memory**                          |
| `MemoryVersion`        | Mirror leve do histórico (não materializamos `content`; só metadata + on-demand fetch)       | **Memory Version**                  |
| `AgentMemoryStore`     | Link table: agent ↔ memory store + access (read_only/read_write) + tier (short/long)        | (resource attached at session)      |
| `Environment`          | Mirror de `/v1/environments`                                                                 | **Environment**                     |
| `Vault`                | Mirror estendido de `/v1/vaults` + cofre nosso pra non-MCP secrets (per-workspace)          | **Vault** (estendido)               |
| `Credential`           | Mirror de credenciais MCP (auto-refresh é da Anthropic)                                      | **Credential**                      |
| *`SecretEntry`*        | Cofre SMA-side pra non-MCP secrets (API key OpenAI, STT, Stripe etc.) — encriptado AES-256-GCM (`crypto.subtle`) | None                                |
| `Connection`           | Registro operator-facing de uma integração OAuth (Google, etc.)                             | None                                |
| *`Channel`*            | Canal de conversa do executivo (whatsapp): provider (`baileys` \| `meta_cloud`), phone, auth state ref, status | None                                |
| `Session`              | Mirror de `/v1/sessions` + cost + executive + tags + source (`web` \| `whatsapp` \| `job`)   | **Session**                         |
| `SessionEvent`         | Subset de eventos persistidos pra UI replay (não duplicamos tudo)                            | **Event**                           |
| *`Hook`*               | Abstração SMA: trigger (pre_tool_use | session_idle | session_terminated | refresh_failed | custom_event) + action (custom_tool | webhook_relay | enqueue_job) | None |
| *`HookRun`*            | Histórico de execuções de hook                                                              | None                                |
| *`Job`*                | Cron expr | one-shot ISO | event-triggered + kickoff_event (user.message ou user.define_outcome) + agent_id | None |
| *`JobRun`*             | Histórico de execução, com session_id resultante                                            | None                                |
| *`Dreaming`*           | Placeholder pra integração futura — TBD aguardando Anthropic GA                              | **Dreaming** (research preview)     |
| *`File`*               | Upload do operator → R2 (key, mime, size, sha256) + opcionalmente anthropic_file_id          | **File**                            |
| *`AudioRecording`*     | Audio do chat (sessão executivo ou builder) — R2 key + duration + transcript_text + transcript_provider | None                                |
| *`CostEntry`*          | Custo por sessão (input_tokens, output_tokens, cache_*, model, USD estimate)                | None                                |

### 5.2 Lado Anthropic — só mirroramos metadados

**Não duplicamos:** conteúdo de Memory Versions (grande volume — fetch on-demand), event stream inteiro (cache só o subset renderizado na UI), blobs de file (só guardamos o `file_id` e o `r2_key`).

---

## 6. O padrão de espelhamento (write path)

```
ação do operator
       │
       ▼
┌─────────────┐  1. validate input         ┌─────────────────────┐
│ sma/server  │ ─────────────────────────▶ │ Anthropic API       │
│  /api/...   │                            │  /v1/...            │
└─────────────┘                            └─────────┬───────────┘
       ▲                                             │
       │                                             ▼
       │                                       devolve ID +
       │                                       canonical state
       │                                             │
       │ 2. mirror to Neon (insert/upsert)           │
       └─────────────────────────────────────────────┘

Se write Anthropic falha → 4xx/5xx pro cliente, nada escrito local.
Se mirror falha → log + alerta. Reconciliação manual (vir depois).
```

**Reconciliação:** sem mecanismo automático em Fase 1, por decisão sua. Vamos enxergar drift na prática e tratar com seu time. Se virar dor, criamos uma fila/scheduler.

**Reads:** Neon pra listagens (rápido); Anthropic direto pra detalhes vivos (conteúdo de memória, status de sessão, metadata de vault).

---

## 7. Memória

### 7.1 API que usamos

**Anthropic Memory Stores** (a API dedicada de memória — não o memory tool client-side `memory_20250818`). Recursos nativos:

- Workspace-scoped, persistente cross-session
- Montada no container em `/mnt/memory/<store-name>/`
- Versionamento automático (immutable snapshots por mutação)
- Audit trail (actor + timestamps + redact por compliance)
- Até **8 stores por sessão** — folgado pro nosso uso

### 7.2 Tiers e estratégia

Por executivo (= por workspace), criamos múltiplas memory stores. **Não há limite de uma por tier** — você pediu poder criar várias e associá-las ao workspace.

| Tier label   | Cobre                                                | Granularidade típica            | Cadência                                      |
| ------------ | ---------------------------------------------------- | ------------------------------- | --------------------------------------------- |
| `short`      | Dia / semana corrente                                 | Files day-stamped               | Escrita contínua durante chat / cron          |
| `long`       | Meses / quarters / anos                              | Files theme-stamped              | **Consolidação dominical** (cron — abaixo, configurável)  |
| `knowledge`  | Base de conhecimento somente-leitura (briefs, docs) | Files theme-stamped              | Curadoria manual                              |

Configuração na sessão:

```json
resources: [
  { "type": "memory_store", "memory_store_id": "memstore_<exec>_short",
    "access": "read_write",
    "instructions": "Curto prazo: o que o executivo está vivendo HOJE e nesta semana. Use arquivos com nome YYYY-MM-DD.md. Cheque antes de responder. Escreva continuamente." },
  { "type": "memory_store", "memory_store_id": "memstore_<exec>_long",
    "access": "read_write",
    "instructions": "Longo prazo: meses, quarters, anos. Identidade estável, temas recorrentes. Cheque pra contextualizar. Não escreva aqui no dia a dia — espere o consolidador." },
  { "type": "memory_store", "memory_store_id": "memstore_<exec>_knowledge",
    "access": "read_only",
    "instructions": "Base de conhecimento curada. Use como referência quando o executivo perguntar coisas factuais sobre projetos / pessoas / decisões anteriores." }
]
```

### 7.3 Consolidação — dois ciclos

**Curto prazo (diário, madrugada — default 03h).** Reorganiza a `short` do dia anterior antes do dia novo começar:

1. Cron `0 3 * * *` cria sessão targeting o **builder sub-agent** (§8, não o orchestrator)
2. Builder lê arquivos do dia anterior na `short`
3. Reestrutura/comprime: descarta ruído (saudações triviais, repetições), preserva eventos relevantes, decisões, follow-ups pendentes
4. Reescreve em `YYYY-MM-DD.md` enxuto

**Longo prazo (semanal — default domingo 23h).** Consolida a semana inteira:

1. Cron `0 23 * * 0` cria sessão targeting o builder
2. Builder inicia com `user.define_outcome`:
   > "Resuma os principais eventos da semana em um arquivo `YYYY-WW.md` na memória de longo prazo. Capture decisões, mudanças de status, novos compromissos, padrões emergentes."
3. Escreve no `long`
4. Opcional: arquiva arquivos antigos do `short` (>4 semanas)

**Configurabilidade.** Operator pode mudar cadências via chat com orchestrator → builder altera o `Job.schedule` correspondente. Quando o workspace é provisionado, jobs padrão são criados com os defaults acima.

**Consolidação mid-session.** Durante uma sessão com o executivo, se o agente detectar mudança significativa de contexto (decisão importante, evento marcante), pode chamar uma tool `consolidate_now(scope: "short"|"long", reason)` que dispara consolidação imediata sem esperar cron — útil pra capturar momentos com hot context.

Tudo via memory store API; versionamento e audit nativos da Anthropic.

### 7.4 Memory versioning na UI

Página `/w/:slug/memory`:
- Lista stores
- Drill: lista memories (paths)
- Drill: conteúdo + histórico de versions
- Admin pode **redact** uma versão antiga (compliance) — usa `client.beta.memory_stores.memory_versions.redact()`

---

## 8. Arquitetura de agentes — orchestrator + builder sub-agent

Esta é a mudança estrutural mais importante vs. v0 do PRD.

### 8.1 Modelo

Em vez de "agente principal" + "builder em página separada", usamos a feature **Multiagent (coordinator)** do Anthropic Managed Agents:

```
                      ┌───────────────────────────────────────┐
                      │ Orchestrator agent (the "brain")      │
                      │  - main system prompt: chief-of-staff │
                      │  - tools: agent_toolset, mcp_toolset  │
                      │  - mcp_servers: sma, gmail, drive, cal│
                      │  - skills: pdf, docx, xlsx, custom    │
                      │  - multiagent.agents: [builder,       │
                      │                        email_triage,  │
                      │                        ... outros]    │
                      └───────────┬───────────────────────────┘
                                  │ delegates
                ┌─────────────────┼─────────────────────┐
                ▼                 ▼                     ▼
       ┌─────────────────┐ ┌──────────────────┐ ┌──────────────────┐
       │ Builder         │ │ Email triage     │ │ ... outros sub-  │
       │ sub-agent       │ │ sub-agent        │ │ agentes criados  │
       │  - SMA control- │ │                  │ │ conforme demanda │
       │    plane tools  │ │  - gmail MCP     │ └──────────────────┘
       │    (CRU, no D)  │ │                  │
       │  - consolida    │ │                  │
       │    memória      │ │                  │
       └─────────────────┘ └──────────────────┘
```

### 8.2 Builder sub-agent — configura E mantém

**Por que "builder" e não "onboarding".** O builder atua no **ciclo de vida inteiro** do agente do executivo, não só no setup. Ele:

- Constrói do zero quando o workspace é criado
- Conserta bugs de configuração que aparecem com uso real
- Modifica system prompts conforme o executivo dá feedback
- Troca agendamentos de cron (*"muda esse timer pra 7h, não 8h"*)
- Edita jobs, automações, hooks
- Atualiza skills atribuídas, troca conexões, ajusta acesso a memory stores
- Consolida memória (curto/longo prazo)

Sempre que o executivo (ou o operator do SMA) disser *"muda isso"*, o builder é quem altera a configuração do agente que está atendendo o executivo. "Onboarding" sugeriria escopo restrito ao setup inicial — não é o caso.

O builder tem **duas capabilities** com tools e skills isoladas:

**(A) Configuração** (operator-driven). Você fala com o orchestrator via `/chat` algo como *"adiciona uma skill nova de PDF, conecta meu Gmail, e cria um job pra ler email todo dia às 8h"*. Orchestrator delega ao builder, que usa **custom tools de control-plane do SMA**:

| Tool (custom) no builder              | Operação                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `sma_create_agent`                    | Cria novo sub-agent no roster do orchestrator                                |
| `sma_update_agent`                    | Atualiza system, tools, skills, mcp_servers de um agent                      |
| `sma_list_agents` / `sma_get_agent`   | Read                                                                          |
| `sma_create_skill_version`            | Cria nova versão de skill custom                                              |
| `sma_attach_skill`                    | Liga skill a agent                                                            |
| `sma_create_memory_store`             | Cria novo memory store no workspace                                          |
| `sma_attach_memory`                   | Liga memory store a agent (com tier + access)                                 |
| `sma_create_connection_start_oauth`   | Inicia fluxo OAuth (retorna URL pro operator clicar — humano fora do loop)   |
| `sma_attach_vault_to_session_default` | Vincula vault default das próximas sessões                                    |
| `sma_create_hook`                     | Cria hook (vide §10)                                                          |
| `sma_create_job` / `sma_update_job`   | Agenda cron / one-shot, ajusta cadência                                       |
| `sma_get_cost_summary`                | Read pra responder "quanto tô gastando esse mês"                              |

**Sem delete.** Builder faz **CRU only**. Operações destrutivas exigem confirmação humana na UI normal.

**(B) Manutenção** (cron-driven). Mesmo agent, entry point diferente — sessões de consolidação de memória (§7.3) são criadas com o builder como agent target. Skills atribuídas pra isso:

| Skill (custom) no builder             | Propósito                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `skill_sma_config`                    | Como usar as control-plane tools acima sem quebrar coisa                     |
| `skill_sma_memory_consolidation`      | Como ler/comprimir `short`, quando descartar vs preservar, formato dos arquivos `YYYY-MM-DD.md` / `YYYY-WW.md` |

O builder tem `read_write` em todas as memory stores do workspace via standard file tools (`read`, `write`, `edit`, `glob`, `grep`) — não precisamos de custom tools dedicadas à memória; o skill ensina como fazer bem.

**Isolamento por princípio de menor privilégio:** o orchestrator e os sub-agents executivo-facing **não** têm as control-plane tools nem as skills de consolidação. Quem ajuda o executivo não configura nem reescreve memória; quem configura/mantém não ataca a inbox do executivo. Isolamento explícito via roster `multiagent.agents`.

### 8.3 Provisionamento — Fase 1 manual, templates Fase 2

**Fase 1 — manual.** Pro primeiro workspace (de validação, provavelmente o seu, Pedro), criamos manualmente via API com um script one-off: `bun run scripts/provision-workspace.ts --workspace=<slug>`. O script faz:

1. **Orchestrator agent** — system prompt em PT-BR, multiagent roster apontando pro builder + sub-agents iniciais (email/calendar triage opcionais), MCP servers (sma + gmail/drive/cal), skills built-in (pdf/docx/xlsx)
2. **Builder sub-agent** — system prompt focado em configuração + manutenção, custom tools de control-plane, skills `skill_sma_config` + `skill_sma_memory_consolidation`
3. **Memory stores defaults** — `memstore_<slug>_short`, `memstore_<slug>_long`, `memstore_<slug>_knowledge`
4. **Jobs defaults** — consolidação curto 03h, consolidação longo dom 23h

Iteramos os system prompts e configs direto no script enquanto validamos com você no `/chat`.

**Fase 2 — templates como feature.** Depois que a configuração ideal estiver provada num workspace real:
- Tabela `AgentTemplate` editável
- UI pra duplicar/forkar template
- Workflow "criar novo workspace" que clona o template ativo

Decisão sua: não inventar abstração de template antes de validar o conteúdo.

### 8.4 Sub-agentes criados sob demanda

Conforme o executivo precisar (email triage, calendar triage, deep research), o operator pede pelo orchestrator → builder cria via `sma_create_agent` e adiciona ao multiagent roster do orchestrator.

### 8.5 Por que isso é melhor que builder separado

- **Unificado:** o operator não muda de página pra configurar; conversa normal
- **Sem dependência de Claude Code subscription** (era um problema do v0)
- **Mesma feature multiagent funciona Fase 1 → Fase 2** (sem refactor pra usuário final)
- **Ciclo de vida completo:** o builder atende setup inicial, manutenção contínua, correções e evolução — não é só uma fase. O executivo nunca "termina o onboarding"; sempre vai pedir ajuste.
- **Diferencial do produto:** o system prompt + skills + tools do orchestrator/builder **são o coração do nosso IP** — onde mora a inteligência do chief-of-staff

---

## 9. Custom MCP Server (Fase 1)

Mantém a decisão da v0 (early Phase 1), com refinamento.

### 9.1 Servidor MCP do SMA

Hospedado em `/api/mcp/sma` no nosso backend Bun. Streamable HTTP transport — portado direto de `cma/server/src/lib/mcp.ts`.

### 9.2 Tools expostas — primeira versão = espelho do CMA

Você falou pra começar com **o que o CMA já tem**, sem builder Anthropic-side aqui no MCP. Tools iniciais:

| Tool                                | Propósito                                                              |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `executive_profile`                 | Lê profile do executivo (nome, papel, focos)                            |
| `recent_briefs`                     | Pull dos últimos N briefs                                               |
| `current_focus`                     | Top priorities do executivo                                             |
| `query_sma_db`                      | NL-to-SQL gated pra perguntas sobre dados do workspace                 |
| `note_for_long_term`                | Marca um trecho como candidato a longo prazo na consolidação semanal   |

(Não inclui o conjunto control-plane — esse vai no builder sub-agent como **custom tools** declaradas no próprio agent, não via MCP server. Razão: control-plane tools não fazem sentido pra outros workspaces; são específicas do operator runtime.)

### 9.3 MCP server hosting — auth

Vault per-workspace com um bearer token rotacionado por nós. Operator não vê o token; Anthropic injeta via proxy.

### 9.4 Conectores Google

Pra Fase 1, espelho 1:1 dos do CMA:
- `/api/mcp/gmail`
- `/api/mcp/drive`
- `/api/mcp/calendar`

Auth: OAuth Google → vault Anthropic com credential `mcp_oauth`. Anthropic auto-refresh.

### 9.5 Reachability em Fase 1 (local) — tunnel

Anthropic precisa **alcançar** nossos MCP servers em session time — localhost não serve. Padrão herdado do CMA (`cma/.env.example`, `cma/docs/11-mcp-conectores.md`):

- Tunnel (**cloudflared**/ngrok) expõe o `Bun.serve` local; as URLs `/api/mcp/*` registradas na Anthropic usam o hostname público do tunnel
- Preferência por **named tunnel** (hostname estável) pra não re-registrar URLs a cada restart
- O fluxo de credenciais não muda: operator autentica **uma vez**, refresh token vai pro vault Anthropic, auto-refresh cuida do resto — o tunnel é só transporte
- **MCP Tunnels da Anthropic** (research preview, cloudflared-based, até 10/org, token `org:manage_tunnels`): caminho preferido quando liberado pra nós — pareamento gerenciado direto no Console

---

## 10. Hooks no SMA

Anthropic Managed Agents **não tem primitivo literalmente chamado "hooks"**, mas oferece todos os building blocks. SMA expõe uma abstração `Hook` unificada na UI; backend traduz pros primitivos certos.

### 10.1 Mapa Anthropic → SMA Hook

| SMA Hook trigger              | Anthropic primitivo backing                                              |
| ----------------------------- | ------------------------------------------------------------------------ |
| `pre_tool_use(tool_name)`     | `permission_policy: always_ask` no tool + `user.tool_confirmation` event |
| `on_custom_tool_use(name)`    | Custom tool declarada no agent + nosso handler do `agent.custom_tool_use`|
| `on_session_idle`             | Webhook `session.status_idled`                                            |
| `on_session_terminated`       | Webhook `session.status_terminated`                                       |
| `on_vault_refresh_failed`     | Webhook `vault_credential.refresh_failed`                                 |
| `on_outcome_evaluated`        | Webhook `session.outcome_evaluation_ended`                                |
| `on_thread_created`           | Webhook `session.thread_created` (multiagent)                             |

### 10.2 SMA Hook action types

| Action          | O que faz                                                                          |
| --------------- | ---------------------------------------------------------------------------------- |
| `custom_tool`   | Quando o hook é gatilhado, executamos código do nosso lado (handler registrado)    |
| `enqueue_job`   | Enfileira um Job (cron-like) — útil pra consolidação pós-sessão                    |
| `webhook_relay` | Encaminha pro endpoint externo do operator (e.g. Slack notify)                     |
| `save_memory`   | Atalho: escreve algo numa memory store específica                                  |

### 10.3 Padrões da Anthropic = padrões do nosso lado

Você falou em **oferecer os padrões da Antropic**. Implementação:

- Quando o operator cria um Hook com trigger `pre_tool_use(bash)` action `webhook_relay`, nosso backend faz `agents.update()` no agent setando `permission_policy: always_ask` pra esse tool, registra o `webhook_relay`, e nosso handler de `agent.tool_use` event manda o payload pro webhook do operator antes de responder o `user.tool_confirmation`
- Se action for `custom_tool`, registramos uma custom tool de mesmo nome no agent e o handler do `agent.custom_tool_use` roda o código local
- Padrões prontos disponíveis na UI (templates de hook): "salvar decisão importante", "pedir confirmação antes de mandar email", "notificar Slack ao terminar sessão", etc.

---

## 11. Jobs (cron + proativo)

### 11.1 Modelo

```
Job
  id, workspace_id, agent_id (opcional), name,
  schedule (cron expr | one-shot ISO | event-triggered),
  kickoff_event (jsonb: tipicamente user.message ou user.define_outcome),
  outcome_rubric_ref (opcional),
  enabled, last_run_at, next_run_at,
  created_by, created_at

JobRun
  id, job_id, started_at, finished_at,
  session_id (Anthropic), status, summary, cost_estimate
```

### 11.2 Runtime — Bun + Postgres polling

Bun não tem queue/cron native. Worker é um processo separado:

```
bun run scripts/job-worker.ts
```

Lógica:
- `setInterval(60_000)`
- Cada tick: `SELECT * FROM jobs WHERE enabled AND next_run_at <= now()`
- Por job: cria session, manda `kickoff_event`, persiste `JobRun`, atualiza `next_run_at` pelo cron expr (lib `cron-parser`)
- Sessões longas: usamos webhook (`session.status_terminated`) pra fechar o JobRun async; enquanto não houver hostname público estável, polling de status fecha o JobRun

**Fase 1 (local-only) — best-effort, aceito:** o worker roda na máquina do operator; jobs disparam só com a máquina acordada. Próximo passo: **Mac mini always-on** dedicado rodando o worker (e o tunnel §9.5). Depois: deploy cloud (Fase 2).

### 11.3 Casos de uso iniciais (defaults — todos configuráveis via builder)

| Caso                                                                          | Schedule default              | Target agent     |
| ----------------------------------------------------------------------------- | ----------------------------- | ---------------- |
| **Heartbeat** — check rápido pra ver se tem algo novo                          | cada 30 min                   | orchestrator     |
| **Email check matinal** — lê inbox via Gmail MCP, separa relevante            | 8h diário (`0 8 * * *`)       | orchestrator     |
| **Brief matinal**                                                              | 6h diário (`0 6 * * *`)       | orchestrator     |
| **Consolidação curto prazo** (madrugada)                                      | 3h diário (`0 3 * * *`)        | **builder**      |
| **Consolidação longo prazo** (semanal)                                        | dom 23h (`0 23 * * 0`)        | **builder**      |
| **Automações configuradas pelo agente em runtime**                            | configurável                  | depende          |

Todas as schedules são editáveis via `sma_update_job` no builder. Quando o operator fala "muda a consolidação pra 4h da manhã", o builder altera o `Job.schedule` correspondente.

### 11.4 Auto-configuração pelo agente (OpenClaw-style)

Quando o operator (via chat) diz "lê meu email todo dia às 8h":

1. Orchestrator → builder
2. Builder chama `sma_create_job(name="email morning", agent_id=email_triage, schedule="0 8 * * *", kickoff_event={type: "user.message", content: "Triage inbox..."})`
3. Job ativo. Operator vê na página `/jobs`.

---

## 12. Vault — estendido pra non-MCP

### 12.1 Problema

Vaults da Anthropic guardam **só MCP credentials**. Pra qualquer outra coisa (API key OpenAI/Whisper, Stripe, AssemblyAI, chave pro nosso próprio MCP server) precisamos de um cofre nosso.

### 12.2 Modelo dual

```
Vault (por workspace)
  id, workspace_id, anthropic_vault_id (nullable)
  display_name, kind (mcp | secrets | mixed),
  status

Credential  (mirror Anthropic — MCP only, write-only)
  id, vault_id, anthropic_credential_id, mcp_server_url,
  display_name, status

SecretEntry  (SMA-only)
  id, vault_id, key (e.g. "openai_api_key"),
  encrypted_value, kdf_salt, last_rotated_at,
  created_by, audit_log_id
```

### 12.3 Criptografia dos SecretEntry

- Encryption at rest: **AES-256-GCM via `crypto.subtle`** (built-in do runtime, sem dependência nativa — validado desde SMA-7) com chave mestra em env var (`SMA_SECRETS_MASTER_KEY`)
- Por entrada: salt aleatório, ciphertext em coluna `bytea`
- Operator nunca vê o valor cru após criar; UI mostra `••••` + botão "rotacionar"
- Acesso programático: só de dentro do server (não exposto via API HTTP)

### 12.4 Per-workspace scoping

Cada vault pertence a um workspace. Credenciais e secrets ficam isolados — Pedro não acidentalmente vê a OpenAI key de outro executivo.

---

## 13. Conexões (Google em Fase 1)

Fluxo idêntico ao v0:

```
operator clica "Conectar Gmail" no workspace ativo
    │
    ▼
SMA /api/connections/google/start?workspace=<slug>
    │ (redirect Google consent)
    ▼
Google → /api/connections/google/callback?code=...&state=<workspace>
    │
    ▼
SMA troca code → access + refresh token
    │
    ▼
SMA cria Anthropic Vault + Credential (mcp_oauth)
    │
    ▼
Connection record no Neon: workspace_id, vault_id, kind=gmail, display_name, status
```

Anthropic auto-refresh do OAuth funciona sozinho.

### 13.2 Canal WhatsApp do executivo

O executivo também conversa com o chief-of-staff via **WhatsApp** (texto e áudio), além do app `chief/`. O canal entrega as mensagens na mesma session do orchestrator — memória e contexto são os mesmos independente de onde o executivo fala.

**Fase 1 — Baileys (não-oficial).** Lib open-source `baileys` (WhatsApp Web multi-device, sem aprovação Meta):

- Worker Bun separado (`scripts/whatsapp-worker.ts`) mantém um socket Baileys por workspace
- Pareamento via QR code exibido em `/w/:slug/connections` (operator escaneia com o número dedicado do executivo)
- Auth state do Baileys encriptado como `SecretEntry` no vault SMA do workspace
- Inbound: mensagem WhatsApp → (se áudio: R2 → Whisper STT) → `user.message` na session do orchestrator
- Outbound: resposta do agente → texto no WhatsApp (voice notes ficam pra quando tiver TTS, Fase 2)
- 1 número WhatsApp por workspace/executivo

**Fase 2 — Meta WhatsApp Business Cloud API.** Migramos quando hospedar: webhooks oficiais, templates aprovados, sem risco de ban, sem manter socket vivo. A entidade `Channel` abstrai o provider (`baileys | meta_cloud`) pra migração não vazar pro resto do app.

**Riscos do Baileys (aceitos pra Fase 1):** lib não-oficial, risco de ban do número, sessão pode cair e exigir re-pareamento. Mitigação: número dedicado por executivo, monitorar `connection.update`, alertar o operator quando desconectar.

---

## 14. Arquivos e áudio (Cloudflare R2)

### 14.1 Por que R2

Você apontou: **não queremos trafegar áudio/arquivo entre APIs**. R2 vira o storage canônico:

- Upload chega no SMA server → SMA escreve em R2 → SMA devolve `r2_key` pro cliente
- STT/agent consomem direto do R2 (assinando URL pre-assinado curto)
- Anthropic Files API só recebe `file_id` se precisarmos passar pro container — mas grande parte do tempo o arquivo nem entra na sessão; só metadata/preview

### 14.2 Buckets

- `sma-files-prod` — arquivos uploadados pelo operator (PDFs, planilhas, etc.)
- `sma-audio-prod` — áudios brutos
- Acesso via S3-compatible API; access keys vivem no `SecretEntry` per-workspace (ou um par central admin se preferir simplicidade pra Fase 1)

### 14.3 Fluxo de áudio

```
1. operator grava no /chat (MediaRecorder API) → MP3/WebM blob
2. POST /api/audio/upload (multipart) → server salva em R2 → AudioRecording{r2_key, ...}
3. POST /api/audio/transcribe?recording_id=… → server faz signed-URL → chama OpenAI Whisper → grava transcript
4. transcript vira user.message no Anthropic Session
5. resposta do agente é texto (Fase 1)
   - Fase 2: TTS opcional via OpenAI/ElevenLabs
```

### 14.4 Fluxo de file upload

Mesmo padrão:
- POST `/api/files/upload` → R2 → `File` row
- Pra usar dentro de sessão: opcionalmente upload pra Anthropic Files API e attach como `resource: file`
- Pra usar como knowledge base persistente: gravar em memory store via cron consolidator

---

## 15. Custos

Você pediu uma página de custos como tem no CMA. Tem.

### 15.1 Captura

- Cada `Session` recebe webhook `session.status_terminated` com `usage` final
- Persistimos `CostEntry`: `model`, `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `usd_estimate`
- Tabela `ModelPricing` (igual cma) com USD/1M tokens editável
- Sessões em andamento: pollamos periodicamente pra mostrar custo parcial vivo

**Fase 1 (local):** sem endpoint público estável pro webhook — capturamos custo por **polling** do usage da session (intervalo curto enquanto ativa + leitura final no idle/terminated). O webhook assume quando houver hostname público (tunnel no Mac mini / deploy).

### 15.2 Página `/w/:slug/costs`

Filtros: período, agente, executivo, modelo. Visualizações:
- Total por workspace no mês corrente
- Top 10 sessões mais caras
- Por agente
- Por dia (sparkline)
- Comparação mês corrente vs mês anterior

### 15.3 Visão consolidada cross-workspace

Página `/admin/costs` (admin only) — agrega todos os workspaces. Útil pra cá da Fase 2 quando virar precificação por créditos.

### 15.4 Custos não-Anthropic (também tracking)

- **R2 storage** (volume * preço) — captura periódica via API R2
- **STT (Whisper)** — log por chamada
- **OpenAI complement** se vier — log

Exibidos como linhas separadas na página de custos.

---

## 16. UI

### 16.1 Estrutura

Top bar + left rail + main area (mesmo padrão CMA).

**Avatar menu (canto superior direito):**
- Workspace switcher (lista de workspaces; clicar → muda URL)
- "Minha conta" → Clerk user profile
- Logout

**Left rail (workspace-scoped):**

| Path                         | Página                                          |
| ---------------------------- | ----------------------------------------------- |
| `/w/:slug`                   | Dashboard (overview + ações rápidas)            |
| `/w/:slug/chat`              | Chat com orchestrator (text + audio + file)     |
| `/w/:slug/agents`            | Lista de agentes (orchestrator + sub-agents)    |
| `/w/:slug/agents/:id`        | Detalhe + version history                       |
| `/w/:slug/memory`            | Browser de memory stores                        |
| `/w/:slug/skills`            | Skills (Anthropic prebuilt + custom)            |
| `/w/:slug/tools`             | Custom tool definitions                          |
| `/w/:slug/hooks`             | Hooks (vide §10)                                |
| `/w/:slug/jobs`              | Jobs (cron + history)                            |
| `/w/:slug/connections`       | Google + outras integrações                      |
| `/w/:slug/vault`             | Vault (MCP creds + secrets)                      |
| `/w/:slug/files`             | Files & audio uploaded                           |
| `/w/:slug/sessions`          | Lista de sessions + replay                       |
| `/w/:slug/sessions/:id`      | Detalhe da sessão (event timeline)               |
| `/w/:slug/costs`             | Custos do workspace                              |
| `/w/:slug/dreaming`          | Stub "em breve" (Fase 2+)                        |
| `/w/:slug/settings`          | Config: workspace name, env var, model default   |
| `/admin/...`                 | Admin pages (members, all-workspaces, all-costs) |

### 16.2 Página `/chat` (versão Fase 1)

- Header: nome do orchestrator do workspace ativo
- Stream de eventos: text, thinking (collapsed), tool-use cards (clicável → expandir input/output), tool-result, custom-tool-use cards
- Custom tool calls do builder renderizam **rich cards** ("Criei o agente Email Triage", com botão "Ver detalhe")
- Composer (bottom): textarea + botão de mic + botão de attach (file)
- Mic: MediaRecorder → R2 → Whisper → texto preenchido (operator revisa antes de enviar) OU manda direto (configurável)
- File attach: upload R2 + opcional anthropic.files.upload se sessão precisa

### 16.3 Linguagem visual — monocromático "polished platinum"

Mesma família material do app do executivo (`chief/`): preto, branco e tons de cinza — zero cor saturada, zero gradiente de cor. Onde o chief é uma lâmina escura de vidro polido, o SMA é a bancada de engenharia: chave clara, densa em informação, calma.

Tokens (placeholder até designer passar):

```
--color-base:        #F5F5F7   (fundo da app)
--color-surface:     #FFFFFF   (cards, tabelas, formulários)
--color-elev:        #FAFAFA   (theads, estados hover suaves)
--color-line:        rgb(0 0 0 / 0.08)   (hairline padrão)
--color-line-strong: rgb(0 0 0 / 0.18)   (hairline de foco/hover)
--color-fg:          #1D1D1F
--color-fg-muted:    #6E6E73
--color-fg-faint:    #AEAEB2
--color-accent-bg:   #1D1D1F   (botões primários)
--color-accent-fg:   #FFFFFF
--radius-card:       20px      (cards) · 12px (inputs) · pílula (botões)
--shadow-card:       sombras neutras de baixa opacidade (sem cor)
--ease-glide:        cubic-bezier(0.22, 1, 0.36, 1)
```

- **Hairlines** (1px a 8% de preto) no lugar de bordas pretas duras; hierarquia por peso tipográfico, espaço e elevação sutil
- **Cantos arredondados** em tudo: 20px cards, 12px inputs, botões em pílula (preto sobre branco)
- **Vidro fosco discreto** (`backdrop-blur` + branco translúcido) **só em chrome** — sidebar, top bar, modais. Nunca em conteúdo.
- Sem gradientes de cor, sem sombras coloridas; sombras neutras de baixa opacidade são permitidas pra elevação
- Tipografia system (-apple-system / SF Pro), tracking apertado em títulos
- Lucide stroke 1.5
- UI inteira em **PT-BR**

---

## 17. Dreaming (placeholder Fase 2+)

Feature da Anthropic anunciada em 6/maio/2026 (Code with Claude). Funcionamento:
- Roda em idle do agente
- Revisa sessões passadas + memory stores
- Extrai padrões, escreve notas em memory stores
- Não mexe nos pesos do modelo — tudo observável e auditável
- Harvey reportou 6× em task completion após implementar

**Status:** research preview, precisa request access em `https://claude.com/form/claude-managed-agents`.

**Decisão SMA:**
- Página `/w/:slug/dreaming` existe como stub com texto "em breve"
- Quando Anthropic liberar pro nosso workspace, plugamos:
  - Wrapper UI pra disparar/ativar
  - Listagem das notas escritas
  - Filtro por sessão de origem
- Não construímos placeholder elaborado — gastaríamos esforço refazendo quando a API estabilizar

**Não construímos Evals próprios.** Você decidiu trocar por dreaming.

---

## 18. Créditos / billing (Fase 2)

Fora de escopo Fase 1, mas registrando o modelo decidido pra ancorar a arquitetura:

- Fase 2 abre cadastro de usuário externo
- Inscrição mensal (ex.: $1000) → X créditos
- Consumo: cada turn de agente, cada STT, cada storage rebate em créditos
- Overage paga avulso
- Backend: Stripe + tabela `CreditLedger` (entry tipo `subscription_topup | consumption | overage_charge`)
- Tabela `Plan` configurável

Fase 1: nosso time absorve custos; rastreamos via `CostEntry` mas não cobra ninguém.

---

## 19. Phased plan (atualizado)

> **Numeração:** os IDs reais de ticket vivem no **Linear** (a numeração planejada na v1 desta seção divergiu da real). Esta seção lista só nomes, por fase. Criamos tickets no Linear no máximo **uma fase à frente**, conforme a anterior fecha. ✅ = entregue.

### Fase 1 — Infra

- Bootstrap `sma/` infra-only — Vite + Bun + Neon + Clerk, app shell, tokens B&W, PT-BR ✅

### Fase 2 — Mirror foundation + multi-agent

- Anthropic SDK wiring + Workspace model + workspace switcher na URL ✅
- Script de provisionamento manual: orchestrator + builder pro primeiro workspace ✅
- Redesign "polished platinum" + PRD WhatsApp/chief ✅
- **Sessions + chat page (text only) + event stream + cost capture** ← próximo (slice que valida o provisionamento)
- Agents list + create + multiagent roster UI
- Custom MCP server skeleton (`/api/mcp/sma`) + tool `executive_profile` + tunnel (§9.5)
- Vault dual model (Anthropic mirror + SecretEntry com AES-GCM)
- Conexão Gmail (OAuth → Anthropic vault) + Gmail MCP

### Fase 3 — Memory + hooks + jobs + R2

- Memory stores (criar, attach, browser UI, versions, redact)
- Skills + custom tools (CRUD + attach a agent)
- Hooks abstraction (UI + tradução para permission_policy/custom_tool/webhook)
- Jobs system (worker Postgres-backed + página + builder pode criar)
- Cloudflare R2 wiring + file upload pipeline
- Audio recording + Whisper STT pipeline

### Fase 4 — Páginas restantes + canais

- Drive + Calendar MCP connectors
- Página de custos (`/w/:slug/costs`) + admin `/admin/costs`
- Webhooks endpoint completo + lifecycle hooks atrelados (requer hostname público — §9.5)
- Consolidação cron (curto/madrugada 03h + longo/dom 23h via builder) + `skill_sma_memory_consolidation`
- Canal WhatsApp via Baileys: worker + QR pairing em `/connections` + roteamento inbound/outbound pra session do orchestrator (§13.2)

### Fase 5 — Hardening + abstrações (a discutir)

- Dreaming integration (quando Anthropic liberar pra nós)
- Agent templates como feature (tabela editável + UI fork/duplicar)
- Reconciliador admin (quando virar dor)
- RBAC granular per-workspace + audit log
- Observability (tracing, alertas)

---

## 20. Decisões travadas (consolidadas)

| #   | Decisão                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------- |
| 1   | Folder: `sma/` na raiz, sibling de `cma/`                                                            |
| 2   | Stack: React+Vite, Bun, Neon, Clerk, Drizzle, AES-GCM (`crypto.subtle`), Cloudflare R2, OpenAI Whisper, OpenAI |
| 3   | Auth: Clerk + Google OAuth. **Restrição de domínio `@smarttalks.ai` adiada pra Fase 2 (hospedagem)** — Fase 1 é local-only, qualquer Google account loga (acesso real é gated pelo repositório) |
| 4   | DB: Neon (projeto novo)                                                                              |
| 5   | Mirror direction: Anthropic-first, Neon-mirror                                                       |
| 6   | **Sem Claude Code CLI** — tudo via Managed Agents                                                    |
| 7   | **Builder = sub-agent do orchestrator** via Anthropic multiagent. Sem página `/builder`.            |
| 8   | Builder sub-agent faz **CRU only** (sem delete)                                                      |
| 9   | Workspace switching: URL-scoped (`/w/:slug/...`)                                                     |
| 10  | 1 Anthropic Workspace por executivo                                                                  |
| 11  | Time todo acessa todos os workspaces (RBAC granular fica pra depois)                                 |
| 12  | Primeiro ticket: infra-only                                                                          |
| 13  | MCP server próprio: Fase 1, espelhando padrão do CMA (sem builder tools no MCP)                      |
| 14  | Jobs: Postgres queue + worker Bun (`setInterval`) — Bun não tem queue native                         |
| 15  | Memória: múltiplas memory stores por workspace; tiers `short` / `long` / `knowledge`                 |
| 16  | Consolidação semanal short → long via cron                                                           |
| 17  | Memory versioning: usar nativo da Anthropic                                                          |
| 18  | Vault estendido: MCP credentials (Anthropic) + SecretEntry SMA-side (AES-256-GCM via `crypto.subtle`) per-workspace |
| 19  | Hooks: abstração SMA traduzida pros primitivos Anthropic (permission_policy + tool_confirmation + webhooks + custom_tools) |
| 20  | Cloudflare R2 pra files + audio (não trafegar entre APIs)                                            |
| 21  | STT: OpenAI Whisper (aberto a revisão)                                                                |
| 22  | Sem TTS em Fase 1                                                                                     |
| 23  | Sem reconciliador automático Fase 1                                                                  |
| 24  | Evals → trocados por **Dreaming** (Fase 2+, aguardando GA)                                            |
| 25  | Créditos/billing: Fase 2                                                                              |
| 26  | UI: preto/branco, sem gradientes, **PT-BR only**                                                     |
| 27  | Deploy: local-only Fase 1                                                                             |
| 28  | Página de custos: sim, capturando via webhook + R2/Whisper logs                                      |
| 29  | STT: OpenAI Whisper API (confirmado)                                                                  |
| 30  | R2 access keys: **globais Fase 1**, per-workspace Fase 2                                              |
| 31  | Anthropic API key: **per-workspace** (você conecta cada uma manualmente quando criar o workspace)    |
| 32  | Google OAuth: 1 OAuth client SMA-side; cada conexão grava refresh token em vault Anthropic (CMA-style) |
| 33  | Agent templates como feature: **Fase 2** (depois de validar 1 workspace manual)                       |
| 34  | Consolidação de memória: **curto** diário 03h, **longo** dom 23h, configurável via builder            |
| 35  | Builder sub-agent: 2 capabilities (configuração + manutenção/consolidação) com skills dedicadas       |
| 36  | Reachability MCP em Fase 1: **tunnel** (cloudflared/ngrok, hostname estável — padrão CMA, §9.5); MCP Tunnels da Anthropic quando liberados pra nós |
| 37  | TTS (resposta em voz): fora de escopo Fase 1 — só STT-in, text-out                                    |
| 38  | Canal WhatsApp do executivo: Fase 1 via **Baileys** (não-oficial, QR pairing), Fase 2 migra pra **Meta WhatsApp Business Cloud API**; entidade `Channel` abstrai o provider |
| 39  | Linguagem visual: monocromático "polished platinum" (§16.3) — hairlines, cantos arredondados (cards 20px, botões pílula), vidro fosco só em chrome; mesma família material do `chief/` |
| 40  | Jobs em Fase 1: **best-effort** na máquina do operator (roda só acordada — aceito); próximo passo **Mac mini always-on** rodando worker + tunnel; depois deploy cloud |
| 41  | Custos em Fase 1: **polling** de usage da session (webhook assume quando houver hostname público estável) |

---

## 21. Open questions — todas resolvidas

Todas as perguntas da v0/v1 estão respondidas (decisões 29-41 na §20).

**Processo de tickets:** criamos tickets no Linear no máximo uma fase à frente, conforme a fase anterior fecha. A numeração SMA-N real é a do Linear — a §19 lista só nomes.

**Revisitar conforme o produto evoluir** (não bloqueiam tickets):
- Deploy story Fase 2 (local-only até lá)
- Backup/export de memory stores (Anthropic não tem bulk export — pensamos quando virar dor real)
- Reconciliador automático (manual em Fase 1, conforme acordado)
- RBAC granular per-workspace (todos os operators acessam tudo até precisarmos restringir)
- Per-workspace R2 keys (globais até precisarmos isolar)
- TTS pra resposta em voz (depois de validar STT-in funcionando)

---

**Fim do v1.** Marca o que ainda está errado ou faltando. Se ok, abro os 5 tickets de Fase 2 (SMA-7 a SMA-11) já no formato pronto pra Linear e começamos pelo SMA-6.
