/**
 * Google Calendar MCP server — /mcp/calendar.
 *
 * Tools:
 *   - list_calendars()                 → calendar ids and roles
 *   - list_events(calendar_id?, time_min?, time_max?, query?, max_results?)
 *   - create_event(calendar_id?, summary, start, end, …)
 *   - update_event(calendar_id?, event_id, …)
 *   - delete_event(calendar_id?, event_id)
 *
 * Default calendar id is "primary" if omitted. All datetimes are ISO 8601;
 * the API auto-detects all-day events when only a date is given.
 */

import { googleFetch, googleJson, jsonText } from "../lib/google-api";
import { serveMcp } from "../lib/mcp";

const CAL = "https://www.googleapis.com/calendar/v3";

interface CalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
}

interface CalendarListResponse {
  items?: CalendarListEntry[];
}

type DateTimeField = { dateTime?: string; date?: string; timeZone?: string };

interface CalendarEvent {
  id?: string;
  status?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: DateTimeField;
  end?: DateTimeField;
  attendees?: Array<{ email: string; responseStatus?: string }>;
  organizer?: { email?: string; displayName?: string };
}

interface EventListResponse {
  items?: CalendarEvent[];
  nextPageToken?: string;
}

/** "2026-06-04" → date-only; otherwise dateTime. Tiny convenience for the agent. */
function parseDateTime(value: string): DateTimeField {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { date: value }
    : { dateTime: value };
}

function calId(args: Record<string, unknown>): string {
  const id = (args.calendar_id as string | undefined) ?? "primary";
  return encodeURIComponent(id);
}

export async function calendarMcpHandler(req: Request): Promise<Response> {
  return serveMcp(req, {
    name: "sma-calendar",
    version: "0.1.0",
    tools: [
      {
        name: "list_calendars",
        description: "List the user's calendars (ids, names, access role).",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        handler: async (_args, { bearer }) => {
          const data = await googleJson<CalendarListResponse>(
            `${CAL}/users/me/calendarList`,
            bearer,
          );
          return jsonText({ calendars: data.items ?? [] });
        },
      },
      {
        name: "list_events",
        description:
          "List events on a calendar. Defaults to the primary calendar and the next 30 days from now.",
        inputSchema: {
          type: "object",
          properties: {
            calendar_id: { type: "string", default: "primary" },
            time_min: { type: "string", description: "ISO 8601. Defaults to now." },
            time_max: { type: "string", description: "ISO 8601. Defaults to now + 30d." },
            query: { type: "string", description: "Text search across event fields." },
            max_results: { type: "integer", minimum: 1, maximum: 100, default: 25 },
          },
          additionalProperties: false,
        },
        handler: async (args, { bearer }) => {
          const max = Math.min(Math.max(Number(args.max_results ?? 25), 1), 100);
          const params = new URLSearchParams({
            singleEvents: "true",
            orderBy: "startTime",
            maxResults: String(max),
            timeMin:
              (args.time_min as string | undefined) ?? new Date().toISOString(),
            timeMax:
              (args.time_max as string | undefined) ??
              new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          });
          const q = (args.query as string | undefined)?.trim();
          if (q) params.set("q", q);
          const data = await googleJson<EventListResponse>(
            `${CAL}/calendars/${calId(args)}/events?${params.toString()}`,
            bearer,
          );
          return jsonText({
            count: data.items?.length ?? 0,
            events: data.items ?? [],
          });
        },
      },
      {
        name: "create_event",
        description: "Create a new event. `start` / `end` accept ISO date or date-time strings.",
        inputSchema: {
          type: "object",
          properties: {
            calendar_id: { type: "string", default: "primary" },
            summary: { type: "string" },
            description: { type: "string" },
            location: { type: "string" },
            start: {
              type: "string",
              description:
                "ISO 8601. \"2026-06-10\" for all-day, \"2026-06-10T15:00:00-03:00\" for timed.",
            },
            end: { type: "string" },
            attendees: {
              type: "array",
              items: { type: "string", format: "email" },
              description: "Optional list of attendee emails.",
            },
            time_zone: {
              type: "string",
              description: "IANA tz (e.g. America/Sao_Paulo). Optional.",
            },
          },
          required: ["summary", "start", "end"],
          additionalProperties: false,
        },
        handler: async (args, { bearer }) => {
          const tz = args.time_zone as string | undefined;
          const start = parseDateTime(String(args.start));
          const end = parseDateTime(String(args.end));
          if (tz && start.dateTime) start.timeZone = tz;
          if (tz && end.dateTime) end.timeZone = tz;
          const body: CalendarEvent = {
            summary: String(args.summary),
            start,
            end,
          };
          if (args.description) body.description = String(args.description);
          if (args.location) body.location = String(args.location);
          if (Array.isArray(args.attendees)) {
            body.attendees = (args.attendees as string[]).map((email) => ({ email }));
          }
          const created = await googleJson<CalendarEvent>(
            `${CAL}/calendars/${calId(args)}/events`,
            bearer,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            },
          );
          return jsonText(created);
        },
      },
      {
        name: "update_event",
        description: "Patch fields on an existing event. Only included fields are changed.",
        inputSchema: {
          type: "object",
          properties: {
            calendar_id: { type: "string", default: "primary" },
            event_id: { type: "string" },
            summary: { type: "string" },
            description: { type: "string" },
            location: { type: "string" },
            start: { type: "string" },
            end: { type: "string" },
            time_zone: { type: "string" },
          },
          required: ["event_id"],
          additionalProperties: false,
        },
        handler: async (args, { bearer }) => {
          const tz = args.time_zone as string | undefined;
          const patch: CalendarEvent = {};
          if (args.summary) patch.summary = String(args.summary);
          if (args.description) patch.description = String(args.description);
          if (args.location) patch.location = String(args.location);
          if (args.start) {
            patch.start = parseDateTime(String(args.start));
            if (tz && patch.start.dateTime) patch.start.timeZone = tz;
          }
          if (args.end) {
            patch.end = parseDateTime(String(args.end));
            if (tz && patch.end.dateTime) patch.end.timeZone = tz;
          }
          const updated = await googleJson<CalendarEvent>(
            `${CAL}/calendars/${calId(args)}/events/${encodeURIComponent(String(args.event_id))}`,
            bearer,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(patch),
            },
          );
          return jsonText(updated);
        },
      },
      {
        name: "delete_event",
        description: "Delete an event by id. Irreversible.",
        inputSchema: {
          type: "object",
          properties: {
            calendar_id: { type: "string", default: "primary" },
            event_id: { type: "string" },
          },
          required: ["event_id"],
          additionalProperties: false,
        },
        handler: async (args, { bearer }) => {
          const res = await googleFetch(
            `${CAL}/calendars/${calId(args)}/events/${encodeURIComponent(String(args.event_id))}`,
            bearer,
            { method: "DELETE" },
          );
          if (!res.ok && res.status !== 204) {
            throw new Error(`delete failed: ${res.status} ${await res.text()}`);
          }
          return jsonText({ deleted: true, event_id: String(args.event_id) });
        },
      },
    ],
  });
}

export const calendarMcpRoutes = {
  "/mcp/calendar": {
    GET: (req: Request) => calendarMcpHandler(req),
    POST: (req: Request) => calendarMcpHandler(req),
  },
} as const;
