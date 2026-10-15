/**
 * Org automation rules — deterministic if/then after ticket create/update.
 * Express owns this (DB writes). Python triage still runs first for skill assign.
 */
import { query } from "./db";
import { writeAuditEvent } from "./audit";
import { notifyUsers } from "./notifications";
import { resolveTicketingTeam } from "./ticketingTeams";
import { computeDueAt } from "./sla";
import {
  mayApplyAssignmentStatus,
  statusFromAssignment,
} from "./statuses";
import type { Priority } from "../types";
import { listAssignableAgents } from "./accountsSync";

export type AutomationEvent = "ticket.created" | "ticket.updated";

export type AutomationConditions = {
  channel?: string;
  subjectContains?: string;
  priority?: string;
  unassigned?: boolean;
};

export type AutomationActions = {
  setPriority?: string;
  setQueue?: string;
  assignUserId?: string;
  assignUserName?: string;
  assignResolverId?: string;
  assignResolverName?: string;
  notifyUserIds?: string[];
};

export type AutomationRule = {
  id: string;
  organizationId: string;
  name: string;
  event: AutomationEvent;
  enabled: boolean;
  priority: number;
  conditions: AutomationConditions;
  actions: AutomationActions;
  createdAt: string;
  updatedAt: string;
};

export async function ensureAutomationRulesTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.automation_rules (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      event            TEXT NOT NULL
                         CHECK (event IN ('ticket.created', 'ticket.updated')),
      enabled          BOOLEAN NOT NULL DEFAULT TRUE,
      priority         INTEGER NOT NULL DEFAULT 100,
      conditions       JSONB NOT NULL DEFAULT '{}'::jsonb,
      actions          JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by_id    BIGINT,
      created_by_name  TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_automation_rules_org_event
     ON ticketing.automation_rules(organization_id, event, enabled, priority)`
  );
}

function asObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

function mapRule(r: Record<string, unknown>): AutomationRule {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    name: String(r.name),
    event: String(r.event) as AutomationEvent,
    enabled: Boolean(r.enabled),
    priority: Number(r.priority ?? 100),
    conditions: asObject(r.conditions) as AutomationConditions,
    actions: asObject(r.actions) as AutomationActions,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function listAutomationRules(
  organizationId: string
): Promise<AutomationRule[]> {
  const { rows } = await query(
    `SELECT * FROM ticketing.automation_rules
     WHERE organization_id = $1
     ORDER BY priority ASC, created_at ASC`,
    [organizationId]
  );
  return rows.map((r) => mapRule(r as Record<string, unknown>));
}

export async function createAutomationRule(input: {
  organizationId: string;
  name: string;
  event: AutomationEvent;
  conditions?: AutomationConditions;
  actions?: AutomationActions;
  priority?: number;
  enabled?: boolean;
  createdById?: string | null;
  createdByName?: string | null;
}): Promise<AutomationRule> {
  const name = String(input.name || "").trim() || "Untitled rule";
  const event =
    input.event === "ticket.updated" ? "ticket.updated" : "ticket.created";
  const { rows } = await query(
    `INSERT INTO ticketing.automation_rules (
       organization_id, name, event, enabled, priority, conditions, actions,
       created_by_id, created_by_name
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)
     RETURNING *`,
    [
      input.organizationId,
      name,
      event,
      input.enabled !== false,
      Number.isFinite(input.priority) ? Number(input.priority) : 100,
      JSON.stringify(input.conditions || {}),
      JSON.stringify(input.actions || {}),
      input.createdById || null,
      input.createdByName || null,
    ]
  );
  return mapRule(rows[0] as Record<string, unknown>);
}

export async function updateAutomationRule(input: {
  organizationId: string;
  ruleId: string;
  name?: string;
  event?: AutomationEvent;
  conditions?: AutomationConditions;
  actions?: AutomationActions;
  priority?: number;
  enabled?: boolean;
}): Promise<AutomationRule | null> {
  const { rows: existing } = await query(
    `SELECT * FROM ticketing.automation_rules
     WHERE organization_id = $1 AND id = $2`,
    [input.organizationId, input.ruleId]
  );
  if (!existing[0]) return null;
  const cur = mapRule(existing[0] as Record<string, unknown>);
  const name =
    input.name !== undefined ? String(input.name).trim() || cur.name : cur.name;
  const event =
    input.event === "ticket.updated" || input.event === "ticket.created"
      ? input.event
      : cur.event;
  const enabled =
    input.enabled !== undefined ? Boolean(input.enabled) : cur.enabled;
  const priority =
    input.priority !== undefined && Number.isFinite(input.priority)
      ? Number(input.priority)
      : cur.priority;
  const conditions =
    input.conditions !== undefined ? input.conditions : cur.conditions;
  const actions = input.actions !== undefined ? input.actions : cur.actions;
  const { rows } = await query(
    `UPDATE ticketing.automation_rules SET
       name = $3,
       event = $4,
       enabled = $5,
       priority = $6,
       conditions = $7::jsonb,
       actions = $8::jsonb,
       updated_at = NOW()
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [
      input.organizationId,
      input.ruleId,
      name,
      event,
      enabled,
      priority,
      JSON.stringify(conditions || {}),
      JSON.stringify(actions || {}),
    ]
  );
  return rows[0] ? mapRule(rows[0] as Record<string, unknown>) : null;
}

export async function deleteAutomationRule(
  organizationId: string,
  ruleId: string
): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM ticketing.automation_rules
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, ruleId]
  );
  return (rowCount || 0) > 0;
}

function norm(s: unknown): string {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function channelMatches(want: string | undefined, have: string): boolean {
  if (!want) return true;
  const w = norm(want).replace(/-/g, "_");
  const h = norm(have);
  if (w === h) return true;
  // intake aliases ↔ DB channels
  if (w === "web_form" || w === "web" || w === "api") {
    return h === "web";
  }
  if (w === "email") return h === "email";
  if (w === "chat" || w === "webchat") return h === "chat" || h === "webchat";
  if (w === "whatsapp") return h === "whatsapp";
  if (w === "instagram") return h === "instagram";
  if (w === "facebook") return h === "facebook";
  if (w === "phone" || w === "call" || w === "ivr") return h === "phone";
  return false;
}

function ruleMatches(
  rule: AutomationRule,
  ticket: Record<string, unknown>
): boolean {
  const c = rule.conditions || {};
  if (!channelMatches(c.channel, String(ticket.channel || ""))) return false;
  if (c.subjectContains) {
    const needle = norm(c.subjectContains);
    const subject = norm(ticket.subject);
    if (!needle || !subject.includes(needle)) return false;
  }
  if (c.priority) {
    if (norm(c.priority) !== norm(ticket.priority)) return false;
  }
  if (c.unassigned === true) {
    const name = String(ticket.assignee_name || "");
    const id = ticket.assignee_id;
    const unassigned =
      !id && (!name || name === "Unassigned" || name.toLowerCase() === "unassigned");
    if (!unassigned) return false;
  }
  return true;
}

async function resolveAssignee(
  orgId: string,
  actions: AutomationActions
): Promise<{ id: string | null; name: string } | null> {
  const roster = await listAssignableAgents(orgId);
  if (actions.assignUserId) {
    const user = roster.find((candidate) => candidate.id === actions.assignUserId);
    if (user) {
      return { id: user.id, name: user.name };
    }
  }
  if (actions.assignUserName) {
    const want = String(actions.assignUserName).trim();
    if (!want || want.toLowerCase() === "unassigned") {
      return { id: null, name: "Unassigned" };
    }
    const user = roster.find(
      (candidate) => candidate.name.toLowerCase() === want.toLowerCase()
    );
    if (user) {
      return { id: user.id, name: user.name };
    }
  }
  return null;
}

async function resolveResolver(
  orgId: string,
  actions: AutomationActions
): Promise<{ id: string | null; name: string } | null> {
  const roster = (await listAssignableAgents(orgId)).filter(
    (candidate) => candidate.role === "resolver"
  );
  if (actions.assignResolverId) {
    const user = roster.find(
      (candidate) => candidate.id === actions.assignResolverId
    );
    if (user) {
      return { id: user.id, name: user.name };
    }
  }
  if (actions.assignResolverName) {
    const want = String(actions.assignResolverName).trim();
    if (!want || want.toLowerCase() === "unassigned") {
      return { id: null, name: "" };
    }
    const user = roster.find(
      (candidate) => candidate.name.toLowerCase() === want.toLowerCase()
    );
    if (user) {
      return { id: user.id, name: user.name };
    }
  }
  return null;
}

export type AutomationRunResult = {
  appliedRuleIds: string[];
  changes: string[];
};

/**
 * Run enabled rules for an event against a ticket row (DB shape).
 * Applies matching actions in priority order; later rules can override earlier ones.
 */
export async function runAutomations(input: {
  organizationId: string;
  event: AutomationEvent;
  ticketId: string;
  ticketNumber: string;
}): Promise<AutomationRunResult> {
  const orgId = input.organizationId;
  const { rows: ticketRows } = await query(
    `SELECT * FROM tickets WHERE organization_id = $1 AND id = $2`,
    [orgId, input.ticketId]
  );
  if (!ticketRows[0]) {
    return { appliedRuleIds: [], changes: [] };
  }

  const { rows: ruleRows } = await query(
    `SELECT * FROM ticketing.automation_rules
     WHERE organization_id = $1 AND event = $2 AND enabled = TRUE
     ORDER BY priority ASC, created_at ASC`,
    [orgId, input.event]
  );
  const rules = ruleRows.map((r) => mapRule(r as Record<string, unknown>));
  if (!rules.length) {
    return { appliedRuleIds: [], changes: [] };
  }

  let ticket = ticketRows[0] as Record<string, unknown>;
  const appliedRuleIds: string[] = [];
  const changes: string[] = [];

  for (const rule of rules) {
    if (!ruleMatches(rule, ticket)) continue;

    const actions = rule.actions || {};
    let nextPriority = ticket.priority;
    let nextAssigneeId = ticket.assignee_id;
    let nextAssigneeName = ticket.assignee_name;
    let nextResolverId = ticket.resolver_id;
    let nextResolverName = ticket.resolver_name;
    let nextQueueId = ticket.queue_id;
    let nextQueueName = ticket.queue_name;
    let nextDueAt = ticket.due_at;
    let touched = false;

    if (actions.setPriority) {
      const p = norm(actions.setPriority);
      if (["urgent", "high", "medium", "low"].includes(p)) {
        nextPriority = p;
        nextDueAt = await computeDueAt(orgId, p as Priority);
        touched = true;
        changes.push(`${rule.name}: priority→${p}`);
      }
    }

    if (actions.setQueue) {
      const qName = String(actions.setQueue).trim();
      if (qName) {
        const team = await resolveTicketingTeam(orgId, qName);
        if (team) {
          nextQueueId = team.id;
          nextQueueName = team.name;
          touched = true;
          changes.push(`${rule.name}: queue→${team.name}`);
        } else {
          const qRes = await query(
            `SELECT id, queue_name FROM agent_queues
             WHERE organization_id = $1 AND lower(queue_name) = lower($2)`,
            [orgId, qName]
          );
          if (qRes.rows[0]) {
            nextQueueId = qRes.rows[0].id;
            nextQueueName = String(qRes.rows[0].queue_name);
            touched = true;
            changes.push(`${rule.name}: queue→${nextQueueName}`);
          }
        }
      }
    }

    const assignee = await resolveAssignee(orgId, actions);
    if (assignee) {
      nextAssigneeId = assignee.id;
      nextAssigneeName = assignee.name;
      touched = true;
      changes.push(`${rule.name}: assignee→${assignee.name}`);
    }

    const resolver = await resolveResolver(orgId, actions);
    if (resolver) {
      nextResolverId = resolver.id;
      nextResolverName = resolver.name || null;
      touched = true;
      changes.push(
        `${rule.name}: resolver→${resolver.name || "Unassigned"}`
      );
    }

    if (touched) {
      const currentStatus = String(ticket.status || "Open");
      const nextStatus = mayApplyAssignmentStatus(currentStatus)
        ? statusFromAssignment({
            assigneeId: nextAssigneeId ? String(nextAssigneeId) : null,
            assigneeName: nextAssigneeName ? String(nextAssigneeName) : null,
            resolverId: nextResolverId ? String(nextResolverId) : null,
          })
        : null;
      const { rows: updated } = await query(
        `UPDATE tickets SET
           priority = $1,
           assignee_id = $2,
           assignee_name = $3,
           resolver_id = $4,
           resolver_name = $5,
           queue_id = $6,
           queue_name = $7,
           due_at = $8,
           status = COALESCE($10, status),
           first_response_at = CASE
             WHEN first_response_at IS NULL AND $10 IS NOT NULL AND $10::varchar <> 'Open'::varchar
             THEN NOW() ELSE first_response_at END,
           updated_at = NOW()
         WHERE id = $9
         RETURNING *`,
        [
          nextPriority,
          nextAssigneeId,
          nextAssigneeName,
          nextResolverId,
          nextResolverName,
          nextQueueId,
          nextQueueName,
          nextDueAt,
          input.ticketId,
          nextStatus,
        ]
      );
      if (updated[0]) ticket = updated[0] as Record<string, unknown>;
      appliedRuleIds.push(rule.id);
    }

    const notifyIds = Array.isArray(actions.notifyUserIds)
      ? actions.notifyUserIds.map(String).filter(Boolean)
      : [];
    if (notifyIds.length) {
      await notifyUsers({
        orgId,
        userIds: notifyIds,
        kind: "update",
        title: `Automation: ${rule.name}`,
        message: `Rule applied on ${input.ticketNumber} ("${ticket.subject}").`,
        ticketUuid: input.ticketId,
        customerName: ticket.customer_name
          ? String(ticket.customer_name)
          : null,
      });
      changes.push(`${rule.name}: notified ${notifyIds.length}`);
      if (!appliedRuleIds.includes(rule.id)) appliedRuleIds.push(rule.id);
    }
  }

  if (appliedRuleIds.length) {
    await writeAuditEvent({
      organizationId: orgId,
      actorName: "Automation",
      action: "ticket.updated",
      ticketId: input.ticketId,
      ticketNumber: input.ticketNumber,
      meta: {
        source: "automation",
        event: input.event,
        ruleIds: appliedRuleIds,
        changes,
      },
    }).catch(() => undefined);
  }

  return { appliedRuleIds, changes };
}
