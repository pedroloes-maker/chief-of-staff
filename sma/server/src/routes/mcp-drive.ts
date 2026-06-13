/**
 * Google Drive MCP server — /mcp/drive.
 *
 * Tools:
 *   - list_files(query?, max_results?)        → name/id/mime/owners
 *   - get_file(id)                            → metadata
 *   - download_file(id, max_bytes?)           → text content (binary => base64)
 *   - create_text_file(name, content, parent?) → upload a plain-text file
 *
 * Scope behavior:
 *   - drive.readonly      list_files, get_file, download_file (visible files)
 *   - drive.file          + create_text_file, + read app-created files only
 *   - drive              full Drive read/write
 */

import { googleFetch, googleJson, jsonText } from "../lib/google-api";
import { serveMcp } from "../lib/mcp";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  webViewLink?: string;
  parents?: string[];
}

interface DriveListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

const FILE_FIELDS =
  "id,name,mimeType,modifiedTime,size,webViewLink,parents,owners(displayName,emailAddress)";

function isTextMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript"
  );
}

export async function driveMcpHandler(req: Request): Promise<Response> {
  return serveMcp(req, {
    name: "sma-drive",
    version: "0.1.0",
    tools: [
      {
        name: "list_files",
        description:
          "List files visible to the connected Google account. Optional Drive query (e.g. \"name contains 'invoice' and mimeType='application/pdf'\").",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Drive `q` parameter. Optional.",
            },
            max_results: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 25,
            },
          },
          additionalProperties: false,
        },
        handler: async (args, { bearer }) => {
          const q = (args.query as string | undefined)?.trim();
          const max = Math.min(Math.max(Number(args.max_results ?? 25), 1), 100);
          const params = new URLSearchParams({
            pageSize: String(max),
            fields: `files(${FILE_FIELDS}),nextPageToken`,
          });
          if (q) params.set("q", q);
          const data = await googleJson<DriveListResponse>(
            `${DRIVE}/files?${params.toString()}`,
            bearer,
          );
          return jsonText({
            count: data.files?.length ?? 0,
            files: data.files ?? [],
            next_page_token: data.nextPageToken ?? null,
          });
        },
      },
      {
        name: "get_file",
        description: "Fetch metadata for a single file by id.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
          additionalProperties: false,
        },
        handler: async (args, { bearer }) => {
          const id = String(args.id);
          const file = await googleJson<DriveFile>(
            `${DRIVE}/files/${id}?fields=${encodeURIComponent(FILE_FIELDS)}`,
            bearer,
          );
          return jsonText(file);
        },
      },
      {
        name: "download_file",
        description:
          "Download file contents. Text files are returned as a string; binary files are returned base64-encoded with a note.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string" },
            max_bytes: {
              type: "integer",
              minimum: 1,
              maximum: 524288,
              default: 65536,
              description: "Cap on bytes to return. Default 64 KiB.",
            },
          },
          required: ["id"],
          additionalProperties: false,
        },
        handler: async (args, { bearer }) => {
          const id = String(args.id);
          const cap = Math.min(Math.max(Number(args.max_bytes ?? 65536), 1), 524288);
          const meta = await googleJson<DriveFile>(
            `${DRIVE}/files/${id}?fields=id,name,mimeType,size`,
            bearer,
          );
          const res = await googleFetch(
            `${DRIVE}/files/${id}?alt=media`,
            bearer,
          );
          if (!res.ok) {
            throw new Error(
              `download failed: ${res.status} ${await res.text().then((s) => s.slice(0, 200))}`,
            );
          }
          const buf = new Uint8Array(await res.arrayBuffer());
          const truncated = buf.byteLength > cap;
          const slice = truncated ? buf.slice(0, cap) : buf;
          if (isTextMime(meta.mimeType)) {
            return jsonText({
              id: meta.id,
              name: meta.name,
              mime_type: meta.mimeType,
              size_bytes: buf.byteLength,
              truncated,
              encoding: "utf-8",
              content: new TextDecoder().decode(slice),
            });
          }
          let b64 = "";
          for (const b of slice) b64 += String.fromCharCode(b);
          return jsonText({
            id: meta.id,
            name: meta.name,
            mime_type: meta.mimeType,
            size_bytes: buf.byteLength,
            truncated,
            encoding: "base64",
            content: btoa(b64),
          });
        },
      },
      {
        name: "create_text_file",
        description:
          "Create a plain-text file in Drive. With the drive.file scope, only files the agent itself creates remain accessible.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            content: { type: "string" },
            parent_folder_id: {
              type: "string",
              description: "Optional Drive folder id to place the file in.",
            },
            mime_type: {
              type: "string",
              default: "text/plain",
              description: "Override the default text/plain mime type.",
            },
          },
          required: ["name", "content"],
          additionalProperties: false,
        },
        handler: async (args, { bearer }) => {
          const name = String(args.name);
          const content = String(args.content);
          const mimeType = (args.mime_type as string | undefined) ?? "text/plain";
          const parents = args.parent_folder_id
            ? [String(args.parent_folder_id)]
            : undefined;

          // Multipart upload: metadata JSON + content body, separated by a boundary.
          const boundary = `bnd_${crypto.randomUUID()}`;
          const metadata: Record<string, unknown> = { name, mimeType };
          if (parents) metadata.parents = parents;
          const body =
            `--${boundary}\r\n` +
            `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
            JSON.stringify(metadata) +
            `\r\n--${boundary}\r\n` +
            `Content-Type: ${mimeType}\r\n\r\n` +
            content +
            `\r\n--${boundary}--`;

          const created = await googleJson<DriveFile>(
            `${UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}`,
            bearer,
            {
              method: "POST",
              headers: { "content-type": `multipart/related; boundary=${boundary}` },
              body,
            },
          );
          return jsonText(created);
        },
      },
    ],
  });
}

export const driveMcpRoutes = {
  "/mcp/drive": {
    GET: (req: Request) => driveMcpHandler(req),
    POST: (req: Request) => driveMcpHandler(req),
  },
} as const;
