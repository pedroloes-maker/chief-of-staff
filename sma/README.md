# SMA — Chief-of-Staff

Plataforma interna do time SmartTalks pra configurar, testar e operar agentes
de IA que atuam como *chief of staff* pra executivos. Roda local na máquina
de cada operador (Fase 1).

PRD completo: [`../PRD.md`](../PRD.md)

## Stack

- **app/** — React 19 + Vite 6 + TypeScript + Tailwind 4 + Lucide + React Router 7
- **server/** — Bun + Drizzle ORM + `@neondatabase/serverless`
- **Auth:** Clerk com Google OAuth
- **DB:** Neon Postgres
- **Idioma:** Português (PT-BR)

## Setup local

### 1. Pré-requisitos

- [Bun](https://bun.sh) ≥ 1.1
- Conta no [Clerk](https://clerk.com) com projeto "Chief of Staff" criado e Google OAuth habilitado
- Conta no [Neon](https://neon.tech) com projeto "Chief of Staff" criado

### 2. Variáveis de ambiente

Copie o template e preencha:

```bash
cp .env.example .env
# editar .env com suas credenciais
```

Onde achar cada valor:

- `VITE_CLERK_PUBLISHABLE_KEY` — Clerk Dashboard → **API keys** → React → Publishable Key
- `CLERK_SECRET_KEY` — Clerk Dashboard → **API keys** → Secret Keys
- `DATABASE_URL` — Neon Console → projeto → **Connection Details** → **Pooled connection** (formato `postgresql://...?sslmode=require`)

> **`.env` vs `.env.local`:** ambos são gitignorados e carregados pelo Vite e pelo server. Use o que preferir; este README assume `.env`.

### 3. Instalar dependências

Bun workspaces — uma instalação na raiz cobre app + server:

```bash
bun install
```

### 4. Aplicar migrations no Neon

```bash
bun run db:generate   # gera SQL a partir do schema Drizzle
bun run db:migrate    # aplica no Neon
```

### 5. Subir em dev

```bash
bun run dev
```

- App: http://localhost:5173
- Server: http://localhost:3000
- Healthcheck: http://localhost:3000/health → `{"status": "ok", "db": "connected", ...}`

O Vite faz proxy de `/api/*` pro server em `:3000`, então no front você chama `/api/...` direto.

## Estrutura

```
sma/
├── app/                # Frontend Vite + React
│   ├── src/
│   │   ├── components/layout/  # AppShell
│   │   ├── pages/              # LoginPage, HomePage
│   │   ├── App.tsx
│   │   ├── main.tsx            # ClerkProvider + BrowserRouter
│   │   └── index.css           # Tailwind 4 + tokens preto/branco
│   ├── index.html
│   ├── vite.config.ts          # envDir aponta pra "..", lê sma/.env
│   └── package.json
├── server/             # Backend Bun + Drizzle
│   ├── src/
│   │   ├── db/
│   │   │   ├── client.ts       # Drizzle + Neon HTTP driver
│   │   │   ├── schema.ts       # tabela `users` placeholder
│   │   │   └── migrate.ts      # aplica migrations
│   │   ├── env.ts              # carrega ../.env e ../.env.local
│   │   └── index.ts            # Bun.serve com rota /health
│   ├── drizzle/                # gerado por `db:generate`
│   ├── drizzle.config.ts
│   └── package.json
├── .env.example        # template das variáveis (commitado)
├── .env                # suas credenciais (gitignorado — não commitar)
├── README.md           # este arquivo
└── package.json        # workspaces + dev script
```

## Próximos passos

Ver [`../PRD.md`](../PRD.md) §19 pra o plano completo de fases. **SMA-7** entra
com o modelo de Workspace + wiring do Anthropic SDK; **SMA-8** provisiona o
primeiro orchestrator + builder de um workspace de validação.
