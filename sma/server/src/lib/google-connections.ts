// Conexões Google Workspace (Gmail / Drive / Calendar) por workspace.
//
// Fluxo (espelhado do CMA, invertido pra SDK Anthropic-first):
//   1. O cliente inicia o connect → assinamos um `state` HMAC e devolvemos a
//      auth URL do Google. O browser abre num popup.
//   2. O Google redireciona pro callback com ?code&state.
//   3. Trocamos o code por tokens, buscamos o email do usuário, achamos/criamos
//      a vault "Google" do workspace (metadata kind=google_connections) e
//      gravamos uma credential `mcp_oauth` por serviço selecionado. A Anthropic
//      auto-refresca usando o bloco `refresh` armazenado.
//
// Status vem de ler as credentials da vault Google: `refresh.scope` diz qual
// nível o usuário escolheu; `display_name` carrega o email conectado.
//
// Diferença central vs CMA: aqui usamos o SDK `@anthropic-ai/sdk`
// (client.beta.vaults.*) por workspace, não raw fetch contra api.anthropic.com.

import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { workspaces } from "../db/schema";
import { decryptSecret } from "./crypto";

// ─── Catálogo de serviços ───────────────────────────────────────────────────
// Cada nível é um conjunto fixo de scopes OAuth do Google. A UI nunca mostra
// scope cru — mostra as chaves aqui ("read", "drafts", "send", "full") com a
// descrição humana do catálogo (getCatalogue).

export type Service = "gmail" | "drive" | "calendar";

export const SCOPES: Record<Service, Record<string, string[]>> = {
  gmail: {
    read: ["https://www.googleapis.com/auth/gmail.readonly"],
    drafts: ["https://www.googleapis.com/auth/gmail.compose"],
    send: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    full: ["https://www.googleapis.com/auth/gmail.modify"],
  },
  drive: {
    read: ["https://www.googleapis.com/auth/drive.readonly"],
    app_files: ["https://www.googleapis.com/auth/drive.file"],
    full: ["https://www.googleapis.com/auth/drive"],
  },
  calendar: {
    read: ["https://www.googleapis.com/auth/calendar.readonly"],
    events: ["https://www.googleapis.com/auth/calendar.events"],
    full: ["https://www.googleapis.com/auth/calendar"],
  },
};

export const BASE_SCOPES = ["openid", "email", "profile"];

export const SERVICE_TITLE: Record<Service, string> = {
  gmail: "Gmail",
  drive: "Google Drive",
  calendar: "Google Calendar",
};

export const SERVICES: Service[] = ["gmail", "drive", "calendar"];

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL =
  "https://www.googleapis.com/oauth2/v2/userinfo";

const VAULT_KIND = "google_connections";

/** URL do MCP server de cada serviço (lida do .env). Null se não configurada. */
export function serviceMcpUrl(service: Service): string | null {
  if (service === "gmail") return process.env.GMAIL_MCP_URL ?? null;
  if (service === "drive") return process.env.DRIVE_MCP_URL ?? null;
  return process.env.CALENDAR_MCP_URL ?? null;
}

// ─── State assinado com HMAC ────────────────────────────────────────────────
// Entregamos ao Google um state contendo o que o usuário está conectando; o
// callback verifica HMAC + expiração antes de confiar em qualquer campo.

export interface StatePayload {
  workspaceId: string;
  workspaceSlug: string;
  services: Service[];
  levels: Partial<Record<Service, string>>;
  nonce: string;
  exp: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64urlDecode(str: string): Uint8Array {
  const padded =
    str.replaceAll("-", "+").replaceAll("_", "/") +
    "===".slice((str.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return b64urlEncode(new Uint8Array(sig));
}

export async function signState(payload: StatePayload): Promise<string> {
  const secret = process.env.CONNECTIONS_STATE_SECRET;
  if (!secret) throw new Error("CONNECTIONS_STATE_SECRET não configurada");
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

export async function verifyState(state: string): Promise<StatePayload> {
  const secret = process.env.CONNECTIONS_STATE_SECRET;
  if (!secret) throw new Error("CONNECTIONS_STATE_SECRET não configurada");
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("state malformado");
  const expected = await hmac(secret, body);
  // comparação constant-time
  if (expected.length !== sig.length) throw new Error("assinatura de state inválida");
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (diff !== 0) throw new Error("assinatura de state inválida");
  const payload = JSON.parse(
    new TextDecoder().decode(b64urlDecode(body)),
  ) as StatePayload;
  if (payload.exp < Date.now()) throw new Error("state expirado");
  return payload;
}

// ─── Troca de tokens com o Google ───────────────────────────────────────────

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: "Bearer";
  id_token?: string;
}

export interface GoogleUserInfo {
  email: string;
  verified_email?: boolean;
}

/** Lê e valida o trio de env do OAuth Google. Lança se faltar algo. */
export function googleOAuthEnv(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET e GOOGLE_OAUTH_REDIRECT_URI devem estar configurados",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/** Troca o authorization code por tokens (access + refresh). */
export async function exchangeCodeForTokens(
  code: string,
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = googleOAuthEnv();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`falha na troca de tokens: ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/** Busca o email do usuário a partir do access token. */
export async function fetchGoogleUserInfo(
  accessToken: string,
): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`falha ao buscar userinfo: ${await res.text()}`);
  }
  return (await res.json()) as GoogleUserInfo;
}

/** Monta a auth URL do Google com os scopes pedidos + state assinado. */
export function buildGoogleAuthUrl(scopes: string[], state: string): string {
  const { clientId, redirectUri } = googleOAuthEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    // força consent pra garantir refresh_token mesmo em re-auth
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ─── Helpers de vault (SDK Anthropic, por workspace) ────────────────────────
// Cada chamada é vinculada a um workspace porque a API key É o binding do
// workspace no lado da Anthropic. O caller passa o client já autenticado.

/** Acha a vault Google do workspace (não-arquivada, metadata casando). */
export async function findGoogleVault(
  workspaceId: string,
  client: Anthropic,
): Promise<Anthropic.Beta.Vaults.BetaManagedAgentsVault | null> {
  for await (const v of client.beta.vaults.list()) {
    if (v.archived_at) continue;
    if (
      v.metadata?.kind === VAULT_KIND &&
      v.metadata?.workspace_id === workspaceId
    ) {
      return v;
    }
  }
  return null;
}

/** Acha-ou-cria a vault Google do workspace. */
export async function ensureGoogleVault(
  workspaceId: string,
  workspaceSlug: string,
  client: Anthropic,
): Promise<Anthropic.Beta.Vaults.BetaManagedAgentsVault> {
  const existing = await findGoogleVault(workspaceId, client);
  if (existing) return existing;
  return client.beta.vaults.create({
    display_name: `Google · ${workspaceSlug}`,
    metadata: {
      kind: VAULT_KIND,
      workspace_id: workspaceId,
      workspace_slug: workspaceSlug,
    },
  });
}

/** Lista as credentials não-arquivadas de uma vault. */
export async function listVaultCredentials(
  vaultId: string,
  client: Anthropic,
): Promise<Anthropic.Beta.Vaults.BetaManagedAgentsCredential[]> {
  const out: Anthropic.Beta.Vaults.BetaManagedAgentsCredential[] = [];
  for await (const c of client.beta.vaults.credentials.list(vaultId)) {
    out.push(c);
  }
  return out;
}

/**
 * Upsert de uma credential `mcp_oauth` pro mcp_server_url do serviço. A
 * Anthropic dá 409 em mcp_server_url duplicado dentro da vault, então
 * arquivamos a credential anterior (mesmo URL) antes de criar a nova.
 */
export async function upsertMcpOAuthCredential(
  client: Anthropic,
  vaultId: string,
  params: {
    service: Service;
    mcpServerUrl: string;
    email: string;
    tokens: GoogleTokenResponse;
    clientId: string;
    clientSecret: string;
    existingCredentials: Anthropic.Beta.Vaults.BetaManagedAgentsCredential[];
  },
): Promise<Anthropic.Beta.Vaults.BetaManagedAgentsCredential> {
  const {
    service,
    mcpServerUrl,
    email,
    tokens,
    clientId,
    clientSecret,
    existingCredentials,
  } = params;

  if (!tokens.refresh_token) {
    throw new Error(
      "O Google não devolveu refresh_token. Revogue o app em myaccount.google.com/permissions e tente de novo.",
    );
  }

  const old = existingCredentials.find(
    (c) =>
      !c.archived_at &&
      c.auth.type === "mcp_oauth" &&
      c.auth.mcp_server_url === mcpServerUrl,
  );
  if (old) {
    await client.beta.vaults.credentials.archive(old.id, { vault_id: vaultId });
  }

  const expiresAt = new Date(
    Date.now() + tokens.expires_in * 1000,
  ).toISOString();

  return client.beta.vaults.credentials.create(vaultId, {
    display_name: `${SERVICE_TITLE[service]} · ${email}`,
    auth: {
      type: "mcp_oauth",
      mcp_server_url: mcpServerUrl,
      access_token: tokens.access_token,
      expires_at: expiresAt,
      refresh: {
        token_endpoint: GOOGLE_TOKEN_URL,
        client_id: clientId,
        scope: tokens.scope,
        refresh_token: tokens.refresh_token,
        token_endpoint_auth: {
          type: "client_secret_post",
          client_secret: clientSecret,
        },
      },
    },
  });
}

/** Arquiva a credential de um mcp_server_url (disconnect). */
export async function archiveCredentialForUrl(
  client: Anthropic,
  vaultId: string,
  mcpServerUrl: string,
  credentials: Anthropic.Beta.Vaults.BetaManagedAgentsCredential[],
): Promise<boolean> {
  const cred = credentials.find(
    (c) =>
      !c.archived_at &&
      c.auth.type === "mcp_oauth" &&
      c.auth.mcp_server_url === mcpServerUrl,
  );
  if (!cred) return false;
  await client.beta.vaults.credentials.archive(cred.id, { vault_id: vaultId });
  return true;
}

// ─── Inferência de nível ────────────────────────────────────────────────────
// A Anthropic devolve refresh.scope como a string que mandamos na criação.
// Mapeamos de volta pro nível nomeado pra UI re-renderizar o radio certo.

export function inferLevel(
  service: Service,
  scopeStr: string | null | undefined,
): string | null {
  if (!scopeStr) return null;
  const have = new Set(scopeStr.split(/\s+/));
  let best: string | null = null;
  let bestLen = -1;
  for (const [level, required] of Object.entries(SCOPES[service])) {
    if (required.every((s) => have.has(s)) && required.length > bestLen) {
      best = level;
      bestLen = required.length;
    }
  }
  return best;
}

/** Extrai o email a partir do display_name "Serviço · email@...". */
export function emailFromDisplayName(
  displayName: string | null | undefined,
): string | null {
  if (!displayName) return null;
  if (displayName.includes("·")) {
    return displayName.split("·").slice(1).join("·").trim();
  }
  return displayName;
}

// ─── Client por workspace (a partir do id) ──────────────────────────────────
// Os helpers exportados pra fases futuras recebem workspaceId, não slug —
// então construímos o client decriptando a key do row, no estilo smaMcp.ts.

async function clientForWorkspaceId(
  workspaceId: string,
): Promise<Anthropic | null> {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(
      and(eq(workspaces.id, workspaceId), eq(workspaces.status, "active")),
    );
  if (!row) return null;
  const apiKey = await decryptSecret(row.anthropicApiKeyEncrypted);
  const { default: AnthropicSDK } = await import("@anthropic-ai/sdk");
  return new AnthropicSDK({ apiKey });
}

// ─── Exports pra fase futura (sessions.create) ──────────────────────────────

/**
 * Id da vault Google do workspace, se existir. O route de sessões anexa isso em
 * `sessions.create` via `vault_ids`, dizendo à Anthropic onde achar as
 * credentials OAuth do MCP em tempo de tool-use. Sem isso, a runtime emite
 * "missing bearer token from Anthropic vault" e a tool MCP é negada.
 */
export async function getWorkspaceGoogleVaultId(
  workspaceId: string,
): Promise<string | null> {
  try {
    const client = await clientForWorkspaceId(workspaceId);
    if (!client) return null;
    const vault = await findGoogleVault(workspaceId, client);
    return vault?.id ?? null;
  } catch (err) {
    console.warn(
      `[connections] falha ao resolver vault de ${workspaceId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export interface WorkspaceMcpServer {
  name: string;
  type: "url";
  url: string;
}

/**
 * Lista os MCP servers Google ativos do workspace: uma entrada por credential
 * não-arquivada cujo mcp_server_url casa com um serviço configurado. O route de
 * sessões usa isso pra popular `mcp_servers` no sessions.create.
 */
export async function listWorkspaceMcpServers(
  workspaceId: string,
): Promise<WorkspaceMcpServer[]> {
  try {
    const client = await clientForWorkspaceId(workspaceId);
    if (!client) return [];
    const vault = await findGoogleVault(workspaceId, client);
    if (!vault) return [];
    const creds = await listVaultCredentials(vault.id, client);

    const out: WorkspaceMcpServer[] = [];
    for (const service of SERVICES) {
      const mcpUrl = serviceMcpUrl(service);
      if (!mcpUrl) continue;
      const cred = creds.find(
        (c) =>
          !c.archived_at &&
          c.auth.type === "mcp_oauth" &&
          c.auth.mcp_server_url === mcpUrl,
      );
      if (!cred) continue;
      out.push({ name: service, type: "url", url: mcpUrl });
    }
    return out;
  } catch (err) {
    console.warn(
      `[connections] falha ao listar MCP servers de ${workspaceId}:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
