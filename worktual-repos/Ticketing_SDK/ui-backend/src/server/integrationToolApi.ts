/**
 * External org-API-key routes for staff tool actions.
 * Auth is wt_live_ only. Each call forwards to the existing staff route
 * with the coworker service actor (same Active agent as GET /api/mcp/session).
 * Staff route handlers, MCP /invoke, and intake/webchat routes are not modified.
 */
import type { Express, Request, Response } from "express";
import { listAssignableAgents } from "./accountsSync";
import {
  authenticateOrgApiKey,
  extractApiKeyFromRequest,
} from "./orgApiKeys";

export type StaffCall = {
  method: "POST" | "PATCH" | "PUT";
  path: string;
  body: Record<string, unknown>;
  /** Status-only update for any ticket in the API key's organization. */
  orgScope?: boolean;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const next = text(value);
    if (next) return next;
  }
  return "";
}

/** Map an external JSON body onto the existing staff route. */
export function buildStaffCall(
  kind: string,
  params: Record<string, string>,
  raw: Record<string, unknown>
): { ok: true; call: StaffCall } | { ok: false; error: string } {
  if (kind === "escalate_ticket") {
    const ticketNumber = firstText(params.ticketNumber, raw.ticket_number, raw.ticketNumber);
    if (!ticketNumber) return { ok: false, error: "ticket number is required" };
    const assignee = firstText(raw.assignee);
    const body: Record<string, unknown> = {};
    const assigneeId = firstText(raw.assigneeId, raw.assignee_id);
    if (assigneeId) body.assigneeId = assigneeId;
    if (assignee) {
      body.assignee = assignee;
      body.assigneeName = firstText(raw.assigneeName, raw.assignee_name, assignee);
    }
    const agentId = firstText(raw.agentId, raw.agent_id);
    if (agentId) body.agentId = agentId;
    const agentName = firstText(raw.agentName, raw.agent_name, raw.agent);
    if (agentName) body.agentName = agentName;
    const rationale = firstText(raw.rationale);
    if (rationale) body.rationale = rationale;
    return {
      ok: true,
      call: {
        method: "POST",
        path: `/api/tickets/${encodeURIComponent(ticketNumber)}/escalate`,
        body,
      },
    };
  }

  if (kind === "update_ticket_status") {
    const ticketNumber = firstText(params.ticketNumber, raw.ticket_number, raw.ticketNumber);
    const status = firstText(raw.status);
    if (!ticketNumber) return { ok: false, error: "ticket number is required" };
    if (!status) return { ok: false, error: "status is required" };
    return {
      ok: true,
      call: {
        method: "PUT",
        path: `/api/tickets/${encodeURIComponent(ticketNumber)}`,
        body: { status },
        orgScope: true,
      },
    };
  }

  if (kind === "add_ticket_note") {
    const ticketNumber = firstText(params.ticketNumber, raw.ticket_number, raw.ticketNumber);
    const note = firstText(raw.text, raw.note, raw.body);
    if (!ticketNumber) return { ok: false, error: "ticket number is required" };
    if (!note) return { ok: false, error: "Note text is required." };
    return {
      ok: true,
      call: {
        method: "POST",
        path: `/api/tickets/${encodeURIComponent(ticketNumber)}/notes`,
        body: { text: note },
      },
    };
  }

  if (kind === "create_queue") {
    const name = firstText(raw.queueName, raw.name);
    if (!name) return { ok: false, error: "queue name is required" };
    const body: Record<string, unknown> = {
      queueName: name,
      description: text(raw.description),
    };
    const members = stringList(raw.members);
    const memberIds = stringList(raw.memberIds ?? raw.member_ids);
    if (members) body.members = members;
    if (memberIds) body.memberIds = memberIds;
    return { ok: true, call: { method: "POST", path: "/api/queues", body } };
  }

  if (kind === "update_queue") {
    const queueId = firstText(params.queueId, raw.queue_id, raw.queueId);
    if (!queueId) return { ok: false, error: "queue id is required" };
    const body: Record<string, unknown> = {};
    if (raw.queueName !== undefined || raw.name !== undefined) {
      body.queueName = firstText(raw.queueName, raw.name);
    }
    if (raw.description !== undefined) body.description = text(raw.description);
    const members = stringList(raw.members);
    const memberIds = stringList(raw.memberIds ?? raw.member_ids);
    if (members) body.members = members;
    if (memberIds) body.memberIds = memberIds;
    if (raw.addMembers === true || raw.add_members === true) body.addMembers = true;
    return {
      ok: true,
      call: {
        method: "PATCH",
        path: `/api/queues/${encodeURIComponent(queueId)}`,
        body,
      },
    };
  }

  if (kind === "create_kb_article" || kind === "draft_kb_article") {
    const title = firstText(raw.title);
    const content = firstText(raw.content);
    const category = firstText(raw.category);
    if (!title || !content || !category) {
      return { ok: false, error: "Title, Content, and Category are required." };
    }
    const body: Record<string, unknown> = {
      title,
      content,
      category,
      status: kind === "draft_kb_article" ? "Draft" : "Published",
    };
    const author = firstText(raw.author);
    if (author) body.author = author;
    return { ok: true, call: { method: "POST", path: "/api/kb", body } };
  }

  if (kind === "update_kb_article" || kind === "publish_kb_article") {
    const articleId = firstText(params.articleId, raw.article_id, raw.articleId);
    if (!articleId) return { ok: false, error: "article id is required" };
    const body: Record<string, unknown> =
      kind === "publish_kb_article" ? { status: "Published" } : {};
    if (kind === "update_kb_article") {
      if (raw.title !== undefined) body.title = text(raw.title);
      if (raw.content !== undefined) body.content = text(raw.content);
      if (raw.category !== undefined) body.category = text(raw.category);
      if (raw.status !== undefined) body.status = text(raw.status);
    }
    return {
      ok: true,
      call: {
        method: "PATCH",
        path: `/api/kb/${encodeURIComponent(articleId)}`,
        body,
      },
    };
  }

  if (kind === "create_priority") {
    const displayName = firstText(raw.displayName, raw.display_name, raw.label);
    const hoursRaw = raw.resolutionHours ?? raw.resolution_hours ?? raw.hours;
    if (!displayName) return { ok: false, error: "display name is required" };
    if (hoursRaw === undefined || hoursRaw === null || text(hoursRaw) === "") {
      return { ok: false, error: "resolution hours are required" };
    }
    return {
      ok: true,
      call: {
        method: "POST",
        path: "/api/priorities",
        body: { displayName, resolutionHours: Number(hoursRaw) },
      },
    };
  }

  if (kind === "update_priority") {
    const priorityId = firstText(params.priorityId, raw.priority_id, raw.priorityId);
    if (!priorityId) return { ok: false, error: "priority id is required" };
    const body: Record<string, unknown> = {};
    if (raw.displayName !== undefined || raw.display_name !== undefined || raw.label !== undefined) {
      body.displayName = firstText(raw.displayName, raw.display_name, raw.label);
    }
    if (
      raw.resolutionHours !== undefined ||
      raw.resolution_hours !== undefined ||
      raw.hours !== undefined
    ) {
      body.resolutionHours = Number(raw.resolutionHours ?? raw.resolution_hours ?? raw.hours);
    }
    if (raw.active !== undefined) body.active = Boolean(raw.active);
    return {
      ok: true,
      call: {
        method: "PATCH",
        path: `/api/priorities/${encodeURIComponent(priorityId)}`,
        body,
      },
    };
  }

  if (kind === "create_status") {
    const displayName = firstText(raw.displayName, raw.display_name, raw.label);
    if (!displayName) return { ok: false, error: "display name is required" };
    return {
      ok: true,
      call: {
        method: "POST",
        path: "/api/statuses",
        body: { displayName },
      },
    };
  }

  if (kind === "update_status") {
    const statusId = firstText(params.statusId, raw.status_id, raw.statusId);
    if (!statusId) return { ok: false, error: "status id is required" };
    const body: Record<string, unknown> = {};
    if (raw.displayName !== undefined || raw.display_name !== undefined || raw.label !== undefined) {
      body.displayName = firstText(raw.displayName, raw.display_name, raw.label);
    }
    if (raw.active !== undefined) body.active = Boolean(raw.active);
    return {
      ok: true,
      call: {
        method: "PATCH",
        path: `/api/statuses/${encodeURIComponent(statusId)}`,
        body,
      },
    };
  }

  return { ok: false, error: "Unknown integration tool" };
}

type Actor = {
  id: string;
  name: string;
  role: string;
  organizationId: string;
};

async function resolveAgentActor(organizationId: string): Promise<Actor | null> {
  const actor = (await listAssignableAgents(organizationId)).find(
    (user) => String(user.role || "").toLowerCase() === "agent"
  );
  if (!actor) return null;
  return {
    id: String(actor.id),
    name: String(actor.name || ""),
    role: String(actor.role || "agent"),
    organizationId,
  };
}

export async function forwardStaffCall(input: {
  baseUrl: string;
  tasksSecret: string;
  actor: Actor;
  call: StaffCall;
  fetchImpl?: typeof fetch;
}): Promise<{ status: number; body: unknown }> {
  const fetchImpl = input.fetchImpl || fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Coworker-Tasks-Key": input.tasksSecret,
    "X-Coworker-Actor-Id": input.actor.id,
    "X-Coworker-Org-Id": input.actor.organizationId,
    "X-Coworker-Actor-Role": input.actor.role,
    "X-Coworker-Actor-Name": input.actor.name,
  };
  if (input.call.orgScope) headers["X-Integration-Org-Scope"] = "1";
  const response = await fetchImpl(`${input.baseUrl}${input.call.path}`, {
    method: input.call.method,
    headers,
    body: JSON.stringify(input.call.body),
  });
  const body = await response.json().catch(() => ({ error: "Upstream response was not JSON" }));
  return { status: response.status, body };
}

function bodyRecord(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
}

export function registerIntegrationToolRoutes(
  app: Express,
  opts: { port: number; tasksSecret: string }
): void {
  const mount = (method: "post" | "patch" | "put", path: string, kind: string) => {
    app[method](path, async (req: Request, res: Response) => {
      try {
        const rawKey = extractApiKeyFromRequest(req);
        if (!rawKey) {
          return res.status(401).json({
            error:
              "Missing API key. Use Authorization: Bearer wt_live_… or X-Api-Key.",
          });
        }
        const apiKey = await authenticateOrgApiKey(rawKey);
        if (!apiKey) {
          return res.status(401).json({ error: "Invalid or revoked API key" });
        }
        const raw = bodyRecord(req);
        const bodyOrg = text(raw.organizationId || raw.organization_id);
        if (bodyOrg && bodyOrg !== apiKey.organizationId) {
          return res.status(403).json({
            error: "organizationId does not match API key tenant",
          });
        }
        const built = buildStaffCall(kind, req.params as Record<string, string>, raw);
        if (!built.ok) {
          return res.status(400).json({ error: built.error });
        }
        const actor = await resolveAgentActor(apiKey.organizationId);
        if (!actor) {
          return res.status(403).json({
            error:
              "No active agent user available for API-key sessions. " +
              "Create an Active agent in the org (API keys do not run as admin).",
          });
        }
        const upstream = await forwardStaffCall({
          baseUrl: `http://127.0.0.1:${opts.port}`,
          tasksSecret: opts.tasksSecret,
          actor,
          call: built.call,
        });
        return res.status(upstream.status).json(upstream.body);
      } catch (err) {
        console.error(err);
        return res.status(502).json({ error: "Failed to reach staff API" });
      }
    });
  };

  mount("put", "/api/integration/tickets/:ticketNumber", "update_ticket_status");
  mount("post", "/api/integration/tickets/:ticketNumber/escalate", "escalate_ticket");
  mount("post", "/api/integration/tickets/:ticketNumber/notes", "add_ticket_note");
  mount("post", "/api/integration/queues", "create_queue");
  mount("patch", "/api/integration/queues/:queueId", "update_queue");
  mount("post", "/api/integration/kb", "create_kb_article");
  mount("post", "/api/integration/kb/draft", "draft_kb_article");
  mount("patch", "/api/integration/kb/:articleId", "update_kb_article");
  mount("patch", "/api/integration/kb/:articleId/publish", "publish_kb_article");
  mount("post", "/api/integration/priorities", "create_priority");
  mount("patch", "/api/integration/priorities/:priorityId", "update_priority");
  mount("post", "/api/integration/statuses", "create_status");
  mount("patch", "/api/integration/statuses/:statusId", "update_status");
}
