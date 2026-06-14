import { describe, expect, test } from "bun:test";
import { sessionErrorInfo } from "./session-errors";

describe("sessionErrorInfo", () => {
  test("erro transitório (retrying) → retry=retrying, não terminal", () => {
    const r = sessionErrorInfo({
      type: "unknown_error",
      message: "An internal service error occurred.",
      retry_status: { type: "retrying" },
    });
    expect(r.retry).toBe("retrying");
    expect(r.kind).toBe("unknown_error");
    expect(r.message).toContain("Erro interno da Anthropic");
  });

  test("mcp_connection_failed → mensagem cita o serviço + Conexões", () => {
    const r = sessionErrorInfo({
      type: "mcp_connection_failed_error",
      mcp_server_name: "calendar",
      message: "connection refused",
      retry_status: { type: "exhausted" },
    });
    expect(r.retry).toBe("exhausted");
    expect(r.message).toContain("calendar");
    expect(r.message).toContain("Conexões");
  });

  test("mcp_authentication_failed → pede reconectar", () => {
    const r = sessionErrorInfo({
      type: "mcp_authentication_failed_error",
      mcp_server_name: "gmail",
      message: "token expired",
      retry_status: { type: "terminal" },
    });
    expect(r.retry).toBe("terminal");
    expect(r.message).toContain("gmail");
    expect(r.message).toContain("Reconecte");
  });

  test("credential_host_unreachable → cita tunnel/servidor", () => {
    const r = sessionErrorInfo({
      type: "credential_host_unreachable_error",
      message: "host down",
      retry_status: { type: "terminal" },
    });
    expect(r.message).toContain("tunnel");
  });

  test("model_overloaded → indisponível temporariamente", () => {
    const r = sessionErrorInfo({
      type: "model_overloaded_error",
      message: "overloaded",
      retry_status: { type: "retrying" },
    });
    expect(r.retry).toBe("retrying");
    expect(r.message).toContain("indisponível");
  });

  test("billing_error → cita cobrança", () => {
    const r = sessionErrorInfo({
      type: "billing_error",
      message: "no credits",
      retry_status: { type: "terminal" },
    });
    expect(r.message).toContain("cobrança");
  });

  test("retry_status ausente/desconhecido → terminal (não trava esperando)", () => {
    const r = sessionErrorInfo({ type: "unknown_error", message: "x" });
    expect(r.retry).toBe("terminal");
  });

  test("error nulo/sem campos → defaults seguros", () => {
    const r = sessionErrorInfo(undefined);
    expect(r.kind).toBe("unknown_error");
    expect(r.retry).toBe("terminal");
    expect(r.message).toContain("Erro interno");
  });

  test("mcp sem nome de servidor → rótulo 'externo'", () => {
    const r = sessionErrorInfo({
      type: "mcp_connection_failed_error",
      message: "boom",
      retry_status: { type: "retrying" },
    });
    expect(r.message).toContain("externo");
  });
});
