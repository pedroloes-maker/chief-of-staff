/**
 * Gmail MCP server — /mcp/gmail.
 *
 * Anthropic POSTs JSON-RPC here at session time, forwarding the OAuth bearer
 * we stored in the vault. We translate each tool call into a Gmail REST call.
 *
 * Tools exposed:
 *   - list_messages(query?, max_results?)  → message ids and snippets
 *   - get_message(id)                      → full message + decoded body
 *   - send_message(to, subject, body, …)   → send mail on the user's behalf
 *   - create_draft(to, subject, body, …)   → save a draft, no send
 *
 * Scopes required at the vault credential depend on the tools used:
 *   - readonly        list_messages, get_message
 *   - compose         + create_draft
 *   - send + readonly + send_message
 *   - modify          all of the above
 */

import { serveMcp } from "../lib/mcp";
import { buildRfc822, googleJson, jsonText } from "../lib/google-api";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailMessageListItem {
  id: string;
  threadId: string;
}

interface GmailMessageList {
  messages?: GmailMessageListItem[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailMessagePart;
  internalDate?: string;
}

function decodeBase64Url(s: string): string {
  const padded = s.replaceAll("-", "+").replaceAll("_", "/") +
    "===".slice((s.length + 3) % 4);
  return new TextDecoder().decode(
    Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)),
  );
}

/** Walk the MIME tree and pull the first text/plain body we can find. */
function extractPlainText(part: GmailMessagePart | undefined): string | null {
  if (!part) return null;
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const sub of part.parts ?? []) {
    const t = extractPlainText(sub);
    if (t) return t;
  }
  return null;
}

export async function gmailMcpHandler(req: Request): Promise<Response> {
  return serveMcp(req, {
    name: "sma-gmail",
    version: "0.1.0",
    tools: [
      {
        name: "list_messages",
        description:
          "List recent messages, optionally filtered by a Gmail search query (e.g. \"from:alice newer_than:7d\").",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Gmail search syntax. Optional.",
            },
            max_results: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 20,
            },
          },
          additionalProperties: false,
        },
        handler: async (args, { bearer }) => {
          const q = (args.query as string | undefined)?.trim();
          const max = Math.min(Math.max(Number(args.max_results ?? 20), 1), 100);
          const params = new URLSearchParams({ maxResults: String(max) });
          if (q) params.set("q", q);
          const data = await googleJson<GmailMessageList>(
            `${GMAIL}/messages?${params.toString()}`,
            bearer,
          );
          // Fetch snippets in parallel so the agent doesn't have to call back.
          const ids = (data.messages ?? []).map((m) => m.id);
          const snippets = await Promise.all(
            ids.slice(0, max).map((id) =>
              googleJson<GmailMessage>(
                `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
                bearer,
              ),
            ),
          );
          const rows = snippets.map((m) => {
            const headers = m.payload?.headers ?? [];
            const h = (n: string) => headers.find((x) => x.name === n)?.value;
            return {
              id: m.id,
              thread_id: m.threadId,
              from: h("From"),
              subject: h("Subject"),
              date: h("Date"),
              snippet: m.snippet,
            };
          });
          return jsonText({ count: rows.length, messages: rows });
        },
      },
      {
        name: "get_message",
        description: "Fetch a full Gmail message, including the decoded text body.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string", description: "Gmail message id." } },
          required: ["id"],
          additionalProperties: false,
        },
        handler: async (args, { bearer }) => {
          const id = String(args.id);
          const msg = await googleJson<GmailMessage>(
            `${GMAIL}/messages/${id}?format=full`,
            bearer,
          );
          const headers = msg.payload?.headers ?? [];
          const h = (n: string) => headers.find((x) => x.name === n)?.value;
          return jsonText({
            id: msg.id,
            thread_id: msg.threadId,
            labels: msg.labelIds,
            from: h("From"),
            to: h("To"),
            cc: h("Cc"),
            subject: h("Subject"),
            date: h("Date"),
            body: extractPlainText(msg.payload),
            snippet: msg.snippet,
          });
        },
      },
      {
        name: "send_message",
        description:
          "Send an email on the user's behalf. Requires send scope.",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string" },
            subject: { type: "string" },
            body: { type: "string", description: "Plain-text body." },
            cc: { type: "string" },
            bcc: { type: "string" },
          },
          required: ["to", "subject", "body"],
          additionalProperties: false,
        },
        handler: async (args, { bearer }) => {
          const raw = buildRfc822({
            to: String(args.to),
            subject: String(args.subject),
            body: String(args.body),
            cc: args.cc ? String(args.cc) : undefined,
            bcc: args.bcc ? String(args.bcc) : undefined,
          });
          const sent = await googleJson<{ id: string; threadId: string }>(
            `${GMAIL}/messages/send`,
            bearer,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ raw }),
            },
          );
          return jsonText({ sent: true, id: sent.id, thread_id: sent.threadId });
        },
      },
      {
        name: "create_draft",
        description: "Save a draft. The agent cannot send drafts.",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string" },
            subject: { type: "string" },
            body: { type: "string" },
            cc: { type: "string" },
            bcc: { type: "string" },
          },
          required: ["to", "subject", "body"],
          additionalProperties: false,
        },
        handler: async (args, { bearer }) => {
          const raw = buildRfc822({
            to: String(args.to),
            subject: String(args.subject),
            body: String(args.body),
            cc: args.cc ? String(args.cc) : undefined,
            bcc: args.bcc ? String(args.bcc) : undefined,
          });
          const draft = await googleJson<{ id: string; message: { id: string } }>(
            `${GMAIL}/drafts`,
            bearer,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ message: { raw } }),
            },
          );
          return jsonText({
            draft_id: draft.id,
            message_id: draft.message?.id,
          });
        },
      },
    ],
  });
}

export const gmailMcpRoutes = {
  "/mcp/gmail": {
    GET: (req: Request) => gmailMcpHandler(req),
    POST: (req: Request) => gmailMcpHandler(req),
  },
} as const;
