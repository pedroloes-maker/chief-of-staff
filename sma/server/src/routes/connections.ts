// Handlers HTTP das conexões Google (Gmail / Drive / Calendar), estilo SMA:
// funções async exportadas que retornam Response, lançam ValidationError pra
// input ruim (o catch do index.ts mapeia pra 400) e leem o workspace via
// query/state. A lógica não-route (state, troca de tokens, vault) vive em
// lib/google-connections.ts.
//
// Rotas pretendidas (registradas no index.ts num passo posterior):
//   GET  /api/connections/google/catalogue     → getCatalogue
//   GET  /api/connections/google?workspace=…    → getGoogleStatus
//   POST /api/connections/google/start          → startGoogleConnect
//   GET  /api/connections/google/callback       → handleGoogleCallback (público)
//   POST /api/connections/google/disconnect     → disconnectGoogle

import {
  BASE_SCOPES,
  SCOPES,
  SERVICE_TITLE,
  SERVICES,
  type Service,
  buildGoogleAuthUrl,
  emailFromDisplayName,
  ensureGoogleVault,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  findGoogleVault,
  googleOAuthEnv,
  inferLevel,
  listVaultCredentials,
  reconcileGoogleMcpOnOrchestrator,
  serviceMcpUrl,
  signState,
  upsertMcpOAuthCredential,
  archiveCredentialForUrl,
  verifyState,
} from "../lib/google-connections";
import {
  getAnthropicClientForWorkspace,
  getWorkspaceBySlug,
  ValidationError,
} from "./workspaces";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos

function isService(v: unknown): v is Service {
  return v === "gmail" || v === "drive" || v === "calendar";
}

// ─── GET /api/connections/google/catalogue ──────────────────────────────────
// Expõe os níveis de permissão legíveis pra UI não hardcodar nada.

export function getCatalogue(_req: Request): Response {
  return Response.json({
    services: [
      {
        service: "gmail",
        title: "Gmail",
        levels: [
          {
            id: "read",
            label: "Ler mensagens",
            description: "Lê e-mails e metadados. Não envia, não altera.",
            scopes: SCOPES.gmail.read,
          },
          {
            id: "drafts",
            label: "Ler + criar rascunhos",
            description:
              "Lê e-mails e prepara rascunhos de resposta. O agente não pode enviar.",
            scopes: SCOPES.gmail.drafts,
          },
          {
            id: "send",
            label: "Ler + enviar",
            description:
              "Lê e-mails e envia mensagens em seu nome. O agente não pode deletar nem mexer em labels.",
            scopes: SCOPES.gmail.send,
          },
          {
            id: "full",
            label: "Acesso total à caixa",
            description:
              "Ler, enviar, deletar e alterar labels. Use só se o agente precisar gerenciar a caixa de ponta a ponta.",
            scopes: SCOPES.gmail.full,
          },
        ],
      },
      {
        service: "drive",
        title: "Google Drive",
        levels: [
          {
            id: "read",
            label: "Ler arquivos",
            description: "Vê arquivos e pastas. Não edita, não faz upload.",
            scopes: SCOPES.drive.read,
          },
          {
            id: "app_files",
            label: "Ler + escrever arquivos do app",
            description:
              "Lê qualquer arquivo que o agente abrir e cria/edita arquivos que o próprio agente autora. Não toca em arquivos não relacionados.",
            scopes: SCOPES.drive.app_files,
          },
          {
            id: "full",
            label: "Acesso total ao Drive",
            description:
              "Leitura e escrita totais em todo o Drive. Use só se o agente precisar organizar pastas ou modificar arquivos arbitrários.",
            scopes: SCOPES.drive.full,
          },
        ],
      },
      {
        service: "calendar",
        title: "Google Calendar",
        levels: [
          {
            id: "read",
            label: "Ler eventos",
            description: "Vê agendas e eventos. Não altera.",
            scopes: SCOPES.calendar.read,
          },
          {
            id: "events",
            label: "Ler + gerenciar eventos",
            description:
              "Cria, atualiza e deleta eventos nas suas agendas. Não cria nem deleta agendas em si.",
            scopes: SCOPES.calendar.events,
          },
          {
            id: "full",
            label: "Acesso total à agenda",
            description:
              "Gerencia agendas e eventos de ponta a ponta. Use só se o agente precisar criar ou deletar agendas.",
            scopes: SCOPES.calendar.full,
          },
        ],
      },
    ],
  });
}

// ─── GET /api/connections/google?workspace=<slug> ───────────────────────────

interface ServiceStatus {
  service: Service;
  configured: boolean; // server-side: temos MCP URL pra esse serviço?
  mcpServerUrl: string | null;
  connected: boolean;
  email: string | null;
  level: string | null;
  credentialId: string | null;
  expiresAt: string | null;
}

export async function getGoogleStatus(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get("workspace");
  if (!slug) throw new ValidationError("query param `workspace` é obrigatório");

  const ws = await getWorkspaceBySlug(slug);
  if (!ws) throw new ValidationError("workspace não encontrado");

  const client = await getAnthropicClientForWorkspace(slug);
  if (!client) throw new ValidationError("workspace não encontrado");

  const vault = await findGoogleVault(ws.id, client);
  const credentials = vault
    ? await listVaultCredentials(vault.id, client)
    : [];

  const services: ServiceStatus[] = SERVICES.map((service) => {
    const mcpUrl = serviceMcpUrl(service);
    const cred = credentials.find(
      (c) =>
        !c.archived_at &&
        c.auth.type === "mcp_oauth" &&
        mcpUrl != null &&
        c.auth.mcp_server_url === mcpUrl,
    );
    const scope =
      cred && cred.auth.type === "mcp_oauth"
        ? cred.auth.refresh?.scope
        : null;
    const expiresAt =
      cred && cred.auth.type === "mcp_oauth"
        ? cred.auth.expires_at ?? null
        : null;
    return {
      service,
      configured: !!mcpUrl,
      mcpServerUrl: mcpUrl,
      connected: !!cred,
      email: emailFromDisplayName(cred?.display_name),
      level: cred ? inferLevel(service, scope) : null,
      credentialId: cred?.id ?? null,
      expiresAt,
    };
  });

  return Response.json({ vaultId: vault?.id ?? null, services });
}

// ─── POST /api/connections/google/start ─────────────────────────────────────
// Body: { workspace, service, level }. Constrói a auth URL do Google e devolve.

interface StartBody {
  workspace?: string;
  service?: string;
  level?: string;
}

export async function startGoogleConnect(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as StartBody;
  const slug = body.workspace;
  const service = body.service;
  const level = body.level;

  if (!slug) throw new ValidationError("`workspace` é obrigatório");
  if (!isService(service)) {
    throw new ValidationError("`service` deve ser gmail, drive ou calendar");
  }
  if (!level || !SCOPES[service][level]) {
    throw new ValidationError(
      `escolha um nível de permissão válido pra ${SERVICE_TITLE[service]}`,
    );
  }

  const ws = await getWorkspaceBySlug(slug);
  if (!ws) throw new ValidationError("workspace não encontrado");

  // valida env do OAuth cedo (lança Error → 500 no index)
  googleOAuthEnv();

  if (!serviceMcpUrl(service)) {
    throw new ValidationError(
      `${SERVICE_TITLE[service]} não está configurado — defina a MCP URL no .env`,
    );
  }

  const scopes = new Set<string>(BASE_SCOPES);
  for (const s of SCOPES[service][level]) scopes.add(s);

  const state = await signState({
    workspaceId: ws.id,
    workspaceSlug: ws.slug,
    services: [service],
    levels: { [service]: level },
    nonce: crypto.randomUUID(),
    exp: Date.now() + STATE_TTL_MS,
  });

  const authUrl = buildGoogleAuthUrl([...scopes], state);
  return Response.json({ authUrl });
}

// ─── GET /api/connections/google/callback?code=&state= ──────────────────────
// Público (server-to-browser redirect do Google). Verifica state → troca code
// → userinfo → garante vault → upsert credential. Devolve HTML que avisa o
// opener e fecha o popup.

export async function handleGoogleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");

  if (errParam) return renderResult({ ok: false, error: errParam });
  if (!code || !state) {
    return renderResult({ ok: false, error: "code ou state ausente" });
  }

  try {
    const payload = await verifyState(state);
    const { clientId, clientSecret } = googleOAuthEnv();

    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      return renderResult({
        ok: false,
        error:
          "O Google não devolveu refresh_token. Revogue o app em myaccount.google.com/permissions e tente de novo.",
      });
    }

    const userInfo = await fetchGoogleUserInfo(tokens.access_token);

    const client = await getAnthropicClientForWorkspace(payload.workspaceSlug);
    if (!client) {
      return renderResult({ ok: false, error: "workspace não encontrado" });
    }

    const vault = await ensureGoogleVault(
      payload.workspaceId,
      payload.workspaceSlug,
      client,
    );
    const existingCredentials = await listVaultCredentials(vault.id, client);

    for (const service of payload.services) {
      const mcpUrl = serviceMcpUrl(service);
      if (!mcpUrl) continue;
      await upsertMcpOAuthCredential(client, vault.id, {
        service,
        mcpServerUrl: mcpUrl,
        email: userInfo.email,
        tokens,
        clientId,
        clientSecret,
        existingCredentials,
      });
    }

    // Registra os MCP servers Google no orchestrator (always_allow) pra o
    // agente poder usar as tools. Best-effort: não derruba o connect se falhar.
    try {
      await reconcileGoogleMcpOnOrchestrator(payload.workspaceId);
    } catch (err) {
      console.warn(
        "[connections] reconcile do orchestrator falhou:",
        err instanceof Error ? err.message : err,
      );
    }

    return renderResult({
      ok: true,
      email: userInfo.email,
      services: payload.services,
    });
  } catch (err) {
    return renderResult({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── POST /api/connections/google/disconnect ────────────────────────────────
// Body: { workspace, service }. Arquiva a credential do mcp_server_url.

interface DisconnectBody {
  workspace?: string;
  service?: string;
}

export async function disconnectGoogle(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as DisconnectBody;
  const slug = body.workspace;
  const service = body.service;

  if (!slug) throw new ValidationError("`workspace` é obrigatório");
  if (!isService(service)) {
    throw new ValidationError("`service` deve ser gmail, drive ou calendar");
  }

  const mcpUrl = serviceMcpUrl(service);
  if (!mcpUrl) throw new ValidationError("serviço não está configurado");

  const ws = await getWorkspaceBySlug(slug);
  if (!ws) throw new ValidationError("workspace não encontrado");

  const client = await getAnthropicClientForWorkspace(slug);
  if (!client) throw new ValidationError("workspace não encontrado");

  const vault = await findGoogleVault(ws.id, client);
  if (!vault) return Response.json({ ok: true });

  const creds = await listVaultCredentials(vault.id, client);
  const archived = await archiveCredentialForUrl(
    client,
    vault.id,
    mcpUrl,
    creds,
  );

  // Remove o MCP server desse serviço do orchestrator (reconcile recalcula a
  // partir das credentials restantes). Best-effort.
  try {
    await reconcileGoogleMcpOnOrchestrator(ws.id);
  } catch (err) {
    console.warn(
      "[connections] reconcile do orchestrator falhou:",
      err instanceof Error ? err.message : err,
    );
  }

  return Response.json({ ok: true, archived });
}

// ─── HTML do callback ───────────────────────────────────────────────────────
// Página mínima que faz postMessage pro opener (a página de Conexões) pra ele
// atualizar o status, depois se fecha.

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderResult(result: Record<string, unknown>): Response {
  const messageJson = JSON.stringify({
    type: "connections:google:complete",
    ...result,
  });
  const ok = result.ok === true;
  const errorText = String(result.error ?? "Algo deu errado.");

  const body = ok
    ? `<p class="ok">Conectado como <strong>${escapeHtml(
        String(result.email ?? ""),
      )}</strong>. Você pode fechar esta aba.</p>`
    : `
        <p class="err"><strong>Falha na conexão.</strong></p>
        <p class="err small">Copie este erro pra gente depurar:</p>
        <textarea readonly class="errbox" onclick="this.select()">${escapeHtml(
          errorText,
        )}</textarea>
        <div class="actions">
          <button onclick="navigator.clipboard.writeText(${JSON.stringify(
            errorText,
          )}).then(()=>{this.textContent='Copiado'})">Copiar erro</button>
          <button onclick="window.close()">Fechar aba</button>
        </div>`;

  // Mandamos pra "*" porque em dev o pai (Vite) e o callback (backend) têm
  // origens diferentes. O payload não carrega segredo — só status + email + erro.
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Conexão Google</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fafafa; color: #1a1a1a; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; }
    .card { background: white; border: 1px solid #e5e5e5; border-radius: 16px; padding: 24px 28px; max-width: 560px; width: 100%; box-shadow: 0 8px 32px rgba(15,23,42,0.06); }
    .ok { color: #047857; margin: 0; }
    .err { color: #b91c1c; margin: 0 0 8px 0; }
    .err.small { font-size: 12px; color: #6b7280; margin-top: 4px; }
    .errbox { width: 100%; min-height: 120px; padding: 10px; border: 1px solid #fecaca; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #7f1d1d; background: #fef2f2; resize: vertical; margin: 8px 0 12px 0; box-sizing: border-box; }
    .actions { display: flex; gap: 8px; }
    button { background: #111827; color: white; border: none; border-radius: 999px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
    button:hover { background: #1f2937; }
    h1 { font-size: 16px; margin: 0 0 12px 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Conexão Google</h1>
    ${body}
  </div>
  <script>
    try { if (window.opener) window.opener.postMessage(${messageJson}, "*"); } catch (e) {}
    ${ok ? "setTimeout(() => { try { window.close(); } catch (e) {} }, 1500);" : ""}
  </script>
</body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
