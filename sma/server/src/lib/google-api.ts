/**
 * Thin Google REST helpers used by the MCP server routes.
 *
 * The bearer token comes from Anthropic on every MCP request (extracted by
 * the MCP helper). We just forward it on outbound calls to Google.
 */

export async function googleFetch(
  url: string,
  bearer: string | null,
  init: RequestInit = {},
): Promise<Response> {
  if (!bearer) throw new Error("missing bearer token from Anthropic vault");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${bearer}`);
  return fetch(url, { ...init, headers });
}

export async function googleJson<T>(
  url: string,
  bearer: string | null,
  init: RequestInit = {},
): Promise<T> {
  const res = await googleFetch(url, bearer, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`google ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/** base64url encode without padding — used by Gmail `raw` parameter. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function buildRfc822({
  to,
  subject,
  body,
  cc,
  bcc,
}: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}): string {
  const lines = [`To: ${to}`];
  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);
  lines.push(
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `MIME-Version: 1.0`,
    ``,
    body,
  );
  return base64UrlEncode(new TextEncoder().encode(lines.join("\r\n")));
}

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
