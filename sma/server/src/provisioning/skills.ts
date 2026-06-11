// Markdown PT-BR mínimo viável das custom skills do SMA. Iteramos via
// /chat na Fase 1 — o objetivo aqui é só dar ao builder e ao orchestrator
// referências úteis e estáveis pra começar.
//
// Cada skill tem name, displayTitle (mostrado na UI Anthropic), e
// skillMarkdown (conteúdo do SKILL.md que vai pro upload). O slug do PRD
// vira o `name:` no frontmatter — é o identificador semântico que o
// script de provisão usa pra mirror no Neon.

export type SkillSpec = {
  slug: string;
  displayTitle: string;
  skillMarkdown: string;
};

export const SKILL_SMA_CONFIG: SkillSpec = {
  slug: "skill_sma_config",
  displayTitle: "SMA — Control-plane config",
  skillMarkdown: `---
name: skill_sma_config
description: Como o builder usa as control-plane tools do SMA pra configurar agents, skills, memory stores, conexões e jobs sem quebrar o workspace.
---

# Como configurar o SMA com segurança

Você é o **builder** do workspace. Estas são as regras que mantêm o
workspace consistente quando o operador pede mudanças.

## Princípios

- **Mude o mínimo.** Quando o operador pede "ajuste o brief das 6h",
  altere só o job ou o system prompt afetado. Não refaça o stack.
- **Confirme antes de destrutivo.** Você não tem tool de delete. Pra
  arquivar um agent, skill ou job, peça confirmação explícita em
  português ao operador antes de chamar a tool correspondente.
- **Trabalhe Anthropic-first.** Cria/atualiza primeiro na Anthropic, e
  só depois espelha no Neon via tool. Se a chamada Anthropic falhar,
  reporte o erro e pare — não tente compensar manualmente no Neon.
- **Versione sem medo.** Cada \`sma_update_agent\` cria uma nova versão.
  Versões são baratas. Quando o operador pede uma mudança experimental,
  faça e descreva pra ele como reverter (\`version\` anterior).
- **Idempotência.** Antes de criar qualquer recurso, use
  \`sma_list_agents\` / \`sma_get_agent\` (ou equivalente) pra checar se
  já existe. Reuse quando existir.

## Quando usar cada tool

- \`sma_create_agent\` / \`sma_update_agent\`: crie sub-agents nominais
  (\`email_triage\`, \`brief_writer\`, etc.) sob demanda. Nunca crie um
  agent sem skill ou sem memory store atrelado.
- \`sma_create_skill_version\`: pra atualizar o conteúdo de uma skill
  custom, gere uma nova versão e pinne na \`sma_attach_skill\` do agent
  afetado.
- \`sma_create_memory_store\` / \`sma_attach_memory\`: stores são por
  workspace. Use \`tier\` semântico (short/long/knowledge) pra
  documentar o papel.
- \`sma_create_connection_start_oauth\` /
  \`sma_attach_vault_to_session_default\`: conexões Google etc. passam
  pelo vault Anthropic. Você nunca vê a credencial em texto puro.
- \`sma_create_hook\`: hooks são guardrails — use pra confirmar ações
  fora do esperado (envio de email, gasto > X) antes do orchestrator
  executar.
- \`sma_create_job\` / \`sma_update_job\`: cron jobs vivem no Neon e são
  disparados pelo worker. Use cron syntax padrão de 5 campos.
- \`sma_get_cost_summary\`: cheque antes de propor mudanças que aumentem
  uso de tokens (ex. adicionar sub-agent novo).

## O que NUNCA fazer

- Não exponha API keys, OAuth refresh tokens ou conteúdo de memory
  stores em logs ou nas respostas pro operador.
- Não chame tools de outros workspaces. Você está escopado ao seu.
- Não invente nomes de tools — use só as 12 declaradas no agent.
`,
};

export const SKILL_SMA_MEMORY_CONSOLIDATION: SkillSpec = {
  slug: "skill_sma_memory_consolidation",
  displayTitle: "SMA — Memory consolidation",
  skillMarkdown: `---
name: skill_sma_memory_consolidation
description: Como ler, comprimir e arquivar memórias do store curto para o longo, preservando o que importa e descartando ruído.
---

# Consolidação de memória

Você roda em dois ritmos:

- **Curto → curto compacto**, todos os dias às 03h (cron \`0 3 * * *\`):
  leia tudo que foi gravado no \`memstore_<slug>_short\` nas últimas 24h
  e produza um único arquivo \`YYYY-MM-DD.md\` resumindo o dia.
- **Curto → longo**, todo domingo às 23h (cron \`0 23 * * 0\`): leia os
  arquivos \`YYYY-MM-DD.md\` da semana e produza um \`YYYY-WW.md\` no
  \`memstore_<slug>_long\` resumindo a semana.

## Formato dos arquivos consolidados

- \`YYYY-MM-DD.md\` (diário): seções **Decisões**, **Pessoas mencionadas**,
  **Pendências**, **Ruído descartado** (1 linha cada).
- \`YYYY-WW.md\` (semanal): seções **Temas dominantes**, **Decisões
  importantes**, **Acompanhar**, **Insights sobre o executivo**.

Use semana ISO (\`YYYY-WW\`, ex. \`2026-23\`).

## O que preservar

- Decisões com consequência futura ("escolhemos vendor X", "agendamos
  reunião com Y").
- Mudanças de estado de relacionamentos importantes (cliente, sócio,
  family, equipe).
- Padrões repetidos no comportamento do executivo (ex. "sempre cancela
  agenda das sextas à tarde").
- Pedidos explícitos de "lembre disso" do executivo.

## O que descartar

- Logs operacionais ("rodei o brief das 6h") — já têm registro em job_runs.
- Conteúdo de email lido pelo \`email_triage\` que já virou ação ou
  arquivamento.
- Sessões de chat sem decisão (small talk, exploração que não converge).
- Conteúdo redundante com o que já existe no \`memstore_<slug>_knowledge\`.

## Regras

- **Nunca delete sem consolidar.** Antes de remover qualquer entrada do
  \`short\`, garanta que o resumo do dia já está escrito.
- **Quando em dúvida, preserve.** O custo de storage é desprezível
  comparado ao custo de perder uma informação que o executivo precisava.
- **Não invente.** Se o curto tem 0 entradas no dia, escreva um
  \`YYYY-MM-DD.md\` com "Sem atividade registrada" e segue.
- **Não consolide em cima.** Sempre crie arquivo novo; nunca sobrescreva
  consolidações anteriores.
`,
};

export const SMA_CUSTOM_SKILLS: SkillSpec[] = [
  SKILL_SMA_CONFIG,
  SKILL_SMA_MEMORY_CONSOLIDATION,
];
