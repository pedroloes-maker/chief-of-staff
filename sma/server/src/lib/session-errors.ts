// Tradução dos erros tipados de `session.error` (Managed Agents) numa view
// PT-BR + o `retry_status`. Pura e sem dependências — testável isolada.

export type SessionErrorView = {
  /** Mensagem PT-BR pronta pra UI (específica por tipo de erro). */
  message: string;
  /** O `type` cru do erro (telemetria/depuração). */
  kind: string;
  /** O que o cliente deve fazer: `retrying` = aguardar; senão, desistir. */
  retry: "retrying" | "exhausted" | "terminal";
};

/**
 * Traduz o payload de `session.error` numa view PT-BR + o `retry_status`.
 * `retrying` = transitório (a sessão retenta sozinha, não abortar);
 * `exhausted`/`terminal` = encerrar e mostrar a mensagem. Erros de MCP/credencial
 * incluem o serviço e a dica de reconectar.
 */
export function sessionErrorInfo(error: unknown): SessionErrorView {
  const e = (error ?? {}) as Record<string, unknown>;
  const kind = String(e.type ?? "unknown_error");
  const base = e.message ? String(e.message) : "erro interno";
  const server = typeof e.mcp_server_name === "string" ? e.mcp_server_name : null;
  const rawRetry = (e.retry_status as { type?: string } | undefined)?.type;
  const retry: SessionErrorView["retry"] =
    rawRetry === "retrying" || rawRetry === "exhausted" ? rawRetry : "terminal";

  let message: string;
  switch (kind) {
    case "mcp_connection_failed_error":
      message = `Não consegui conectar ao serviço ${server ?? "externo"} (${base}). Verifique a conexão em Conexões.`;
      break;
    case "mcp_authentication_failed_error":
      message = `Autenticação falhou no serviço ${server ?? "externo"} (${base}). Reconecte em Conexões.`;
      break;
    case "credential_host_unreachable_error":
      message = `Host de credencial inacessível (${base}). Verifique o servidor/tunnel do MCP.`;
      break;
    case "billing_error":
      message = `Erro de cobrança na Anthropic: ${base}.`;
      break;
    case "model_overloaded_error":
    case "model_rate_limited_error":
    case "model_request_failed_error":
      message = `Modelo temporariamente indisponível (${base}).`;
      break;
    default:
      message = `Erro interno da Anthropic: ${base}.`;
  }
  return { message, kind, retry };
}
