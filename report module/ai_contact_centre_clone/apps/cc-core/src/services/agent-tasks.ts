import { z } from "zod";

import type { DbClient } from "../lib/rls.js";
import {
  SQL_TASK_TO_CDP_CONTACT,
  SQL_TASK_TO_IDENTITY_CDP,
} from "../lib/sql-uuid.js";
import { entityIdSchema, serializeEntityIdOptional } from "../lib/id-schema.js";
import { cdpContactIdSchema } from "./cdp-id.js";
import { formatPersonDisplayName } from "../lib/person-display-name.js";
import { getConversation } from "./conversations.js";
import { acknowledgeMissedContactsForCallback } from "./agent-missed-contacts.js";
import { IDENTITY_KEY_TYPES } from "./cdp-customer-profile.js";
import {
  dismissDuplicateOpenCallbacks,
  findOpenCallbackTaskForContact,
  lockCallbackCreation,
} from "./callback-task-dedupe.js";
import { assertCallbackAssigneeIsAgent, unassignOpenAdminCallbacks } from "./callback-assignee.js";
import { resolveCanonicalContactId } from "./contact-merge.js";
import {
  isCallbackOutreachChannel,
  resolveCallbackOutreachChannel,
  type CallbackOutreachChannel,
} from "./preferred-channel.js";

export const AGENT_TASK_TYPES = ["follow_up", "callback", "escalation", "suggestion"] as const;
export const AGENT_TASK_STATUSES = ["open", "completed", "dismissed"] as const;
export const AGENT_TASK_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export const AGENT_TASK_SOURCES = ["self", "admin", "coworker", "system"] as const;

export type AgentTaskType = (typeof AGENT_TASK_TYPES)[number];
export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];
export type AgentTaskPriority = (typeof AGENT_TASK_PRIORITIES)[number];
export type AgentTaskSource = (typeof AGENT_TASK_SOURCES)[number];

export type AgentTaskRecord = {
  id: string;
  type: AgentTaskType;
  status: AgentTaskStatus;
  priority: AgentTaskPriority;
  source: AgentTaskSource;
  title: string;
  summary: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  channel: "voice" | "email" | "webchat" | "whatsapp" | "instagram" | "facebook" | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  assignedBy: string | null;
  conversationId: string | null;
  contactId: string | null;
  notes: string | null;
};

export type AgentTaskStats = {
  open: number;
  dueToday: number;
  overdue: number;
};

type TaskRow = {
  id: string;
  task_type: AgentTaskType;
  status: AgentTaskStatus;
  priority: AgentTaskPriority;
  source: AgentTaskSource;
  title: string;
  summary: string;
  notes: string | null;
  channel: string | null;
  due_at: Date | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  assigned_by_label: string | null;
  conversation_id: string | null;
  contact_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
};

const TASK_SELECT = `
  SELECT
    t.id,
    t.task_type,
    t.status,
    t.priority,
    t.source,
    t.title,
    t.summary,
    t.notes,
    t.channel,
    t.due_at,
    t.created_at,
    t.updated_at,
    t.completed_at,
    t.assigned_by_label,
    t.conversation_id,
    t.contact_id,
    cp.first_name,
    cp.last_name,
    email_ik.key_value AS email,
    phone_ik.key_value AS phone
  FROM ccass.agent_tasks t
  LEFT JOIN cdp.customer_profile cp
    ON ${SQL_TASK_TO_CDP_CONTACT}
   AND cp.organization_id = t.organization_id
  LEFT JOIN LATERAL (
    SELECT key_value
    FROM cdp.identity_keys
    WHERE ${SQL_TASK_TO_IDENTITY_CDP}
      AND organization_id = t.organization_id
      AND key_type IN ('${IDENTITY_KEY_TYPES.EMAIL}', '${IDENTITY_KEY_TYPES.EMAIL_SECONDARY}')
    LIMIT 1
  ) email_ik ON TRUE
  LEFT JOIN LATERAL (
    SELECT key_value
    FROM cdp.identity_keys
    WHERE ${SQL_TASK_TO_IDENTITY_CDP}
      AND organization_id = t.organization_id
      AND key_type IN (
        '${IDENTITY_KEY_TYPES.PHONE}',
        '${IDENTITY_KEY_TYPES.PHONE_SECONDARY}',
        '${IDENTITY_KEY_TYPES.WHATSAPP_PHONE}'
      )
    LIMIT 1
  ) phone_ik ON TRUE
`;

function contactDisplayName(row: Pick<TaskRow, "first_name" | "last_name">): string {
  return formatPersonDisplayName({
    firstName: row.first_name,
    lastName: row.last_name,
  });
}

function mapChannel(value: string | null): AgentTaskRecord["channel"] {
  if (
    value === "voice" ||
    value === "email" ||
    value === "webchat" ||
    value === "whatsapp" ||
    value === "instagram" ||
    value === "facebook"
  ) {
    return value;
  }
  return null;
}

function mapTask(row: TaskRow): AgentTaskRecord {
  return {
    id: serializeEntityIdOptional(row.id)!,
    type: row.task_type,
    status: row.status,
    priority: row.priority,
    source: row.source,
    title: row.title,
    summary: row.summary,
    customerName: contactDisplayName(row),
    customerEmail: row.email,
    customerPhone: row.phone,
    channel: mapChannel(row.channel),
    dueAt: row.due_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    assignedBy: row.assigned_by_label,
    conversationId: serializeEntityIdOptional(row.conversation_id),
    contactId: serializeEntityIdOptional(row.contact_id),
    notes: row.notes,
  };
}

export async function listAgentTasks(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<{ tasks: AgentTaskRecord[]; stats: AgentTaskStats }> {
  await unassignOpenAdminCallbacks(db, organizationId);
  const rows = await db.$queryRawUnsafe<TaskRow[]>(
    `
    ${TASK_SELECT}
    WHERE t.organization_id = $1::bigint
      AND t.assigned_user_id = $2::bigint
      AND t.status <> 'dismissed'
    ORDER BY
      CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END ASC,
      CASE
        WHEN t.status = 'open' AND t.due_at IS NOT NULL AND t.due_at < NOW() THEN 0
        ELSE 1
      END ASC,
      t.due_at ASC NULLS LAST,
      t.updated_at DESC
    `,
    organizationId,
    userId,
  );

  const tasks = rows.map(mapTask);
  const openTasks = tasks.filter((task) => task.status === "open");
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const stats: AgentTaskStats = {
    open: openTasks.length,
    dueToday: openTasks.filter((task) => {
      if (!task.dueAt) return false;
      const due = new Date(task.dueAt);
      return due >= startOfDay && due <= endOfDay;
    }).length,
    overdue: openTasks.filter((task) => task.dueAt && new Date(task.dueAt) < now).length,
  };

  return { tasks, stats };
}

export async function getAgentTask(
  db: DbClient,
  organizationId: string,
  userId: string,
  taskId: string,
): Promise<AgentTaskRecord | null> {
  const rows = await db.$queryRawUnsafe<TaskRow[]>(
    `
    ${TASK_SELECT}
    WHERE t.organization_id = $1::bigint
      AND t.assigned_user_id = $2::bigint
      AND t.id = $3::bigint
    LIMIT 1
    `,
    organizationId,
    userId,
    taskId,
  );
  const row = rows[0];
  return row ? mapTask(row) : null;
}

export const agentTaskUpdateSchema = z.object({
  action: z.enum(["complete", "dismiss", "accept_suggestion"]),
});

export async function updateAgentTask(
  db: DbClient,
  organizationId: string,
  userId: string,
  taskId: string,
  action: z.infer<typeof agentTaskUpdateSchema>["action"],
): Promise<AgentTaskRecord> {
  const existing = await getAgentTask(db, organizationId, userId, taskId);
  if (!existing) {
    throw Object.assign(new Error("Task not found"), { status: 404 });
  }

  if (action === "complete") {
    await db.$executeRaw`
      UPDATE ccass.agent_tasks
      SET status = 'completed',
          completed_at = NOW(),
          updated_at = NOW()
      WHERE organization_id = ${organizationId}::bigint
        AND assigned_user_id = ${userId}::bigint
        AND id = ${taskId}::bigint
    `;
  } else if (action === "dismiss") {
    await db.$executeRaw`
      UPDATE ccass.agent_tasks
      SET status = 'dismissed',
          dismissed_at = NOW(),
          updated_at = NOW()
      WHERE organization_id = ${organizationId}::bigint
        AND assigned_user_id = ${userId}::bigint
        AND id = ${taskId}::bigint
    `;
  } else if (action === "accept_suggestion") {
    await db.$executeRaw`
      UPDATE ccass.agent_tasks
      SET task_type = 'follow_up',
          source = 'coworker',
          title = 'Accepted co-worker follow-up',
          updated_at = NOW()
      WHERE organization_id = ${organizationId}::bigint
        AND assigned_user_id = ${userId}::bigint
        AND id = ${taskId}::bigint
    `;
  }

  const updated = await getAgentTask(db, organizationId, userId, taskId);
  if (!updated) {
    throw Object.assign(new Error("Task not found after update"), { status: 404 });
  }
  return updated;
}

export function isAgentTaskNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: number }).status === 404
  );
}

const CALLBACK_CHANNELS = ["whatsapp", "instagram", "facebook", "email"] as const;
type CallbackChannel = (typeof CALLBACK_CHANNELS)[number];

function asCallbackChannel(value: string | null): CallbackChannel | null {
  if (isCallbackOutreachChannel(value ?? "")) {
    return value as CallbackChannel;
  }
  return null;
}

const TASK_PRIORITY_RANK: Record<AgentTaskPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

function mergeTaskPriority(
  existing: AgentTaskPriority,
  requested?: AgentTaskPriority,
): AgentTaskPriority {
  if (!requested) return existing;
  return TASK_PRIORITY_RANK[requested] > TASK_PRIORITY_RANK[existing] ? requested : existing;
}

function appendCallbackNotes(existing: string | null, addition: string | null | undefined): string | null {
  const next = addition?.trim();
  if (!next) return existing;
  if (!existing?.trim()) return next;
  return `${existing.trim()}\n${next}`;
}

export const createCallbackTaskSchema = z.object({
  assignedUserId: entityIdSchema,
  conversationId: entityIdSchema.optional(),
  contactId: cdpContactIdSchema.optional(),
  channel: z.enum(CALLBACK_CHANNELS).optional(),
  title: z.string().min(1).max(200).optional(),
  summary: z.string().min(1).max(2000).optional(),
  notes: z.string().max(4000).optional(),
  dueAt: z.string().datetime().optional(),
  priority: z.enum(AGENT_TASK_PRIORITIES).optional(),
});

async function getAgentTaskById(
  db: DbClient,
  organizationId: string,
  taskId: string,
): Promise<AgentTaskRecord | null> {
  const rows = await db.$queryRawUnsafe<TaskRow[]>(
    `
    ${TASK_SELECT}
    WHERE t.organization_id = $1::bigint
      AND t.id = $2::bigint
    LIMIT 1
    `,
    organizationId,
    taskId,
  );
  const row = rows[0];
  return row ? mapTask(row) : null;
}

async function resolveAdminLabel(
  db: DbClient,
  organizationId: string,
  adminUserId: string,
): Promise<string> {
  const rows = await db.$queryRaw<
    Array<{ first_name: string | null; last_name: string | null; email: string | null }>
  >`
    SELECT first_name, last_name, work_email AS email
    FROM accounts.setup_users
    WHERE id = ${adminUserId}::bigint
      AND organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  const row = rows[0];
  const name = [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim();
  const fallback = row?.email?.split("@")[0] ?? "Supervisor";
  return `Supervisor · ${name || fallback}`;
}

export async function createAdminCallbackTask(
  db: DbClient,
  organizationId: string,
  adminUserId: string,
  input: z.infer<typeof createCallbackTaskSchema>,
): Promise<AgentTaskRecord> {
  const payload = createCallbackTaskSchema.parse(input);

  const assigneeRows = await db.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint
      AND setup_user_id = ${payload.assignedUserId}::bigint
    LIMIT 1
  `;
  if (!assigneeRows[0]) {
    throw Object.assign(new Error("Assigned agent not found"), { status: 404 });
  }
  await assertCallbackAssigneeIsAgent(db, organizationId, payload.assignedUserId);

  let conversationId = payload.conversationId ?? null;
  let contactId = payload.contactId ?? null;
  let hintChannel = asCallbackChannel(payload.channel ?? null);

  if (conversationId) {
    const conversation = await getConversation(db, organizationId, conversationId);
    if (!conversation) {
      throw Object.assign(new Error("Conversation not found"), { status: 404 });
    }
    contactId = contactId ?? conversation.contactId ?? null;
    hintChannel = hintChannel ?? asCallbackChannel(conversation.channel);
  }
  if (contactId) {
    contactId = await resolveCanonicalContactId(db, organizationId, contactId);
  }

  if (!contactId && !conversationId) {
    throw Object.assign(new Error("Contact or conversation is required"), { status: 400 });
  }

  let channel: CallbackOutreachChannel;
  if (contactId) {
    channel = await resolveCallbackOutreachChannel(db, organizationId, contactId, {
      requestedChannel: payload.channel ?? null,
      hintChannel,
    });
  } else {
    if (!hintChannel) {
      throw Object.assign(
        new Error("Channel is required for callback tasks without a linked contact"),
        { status: 400 },
      );
    }
    channel = hintChannel;
  }

  const adminLabel = await resolveAdminLabel(db, organizationId, adminUserId);
  const title =
    payload.title?.trim() ||
    `Callback · ${channel.charAt(0).toUpperCase()}${channel.slice(1)}`;
  const summary =
    payload.summary?.trim() ||
    `${adminLabel} assigned a callback for follow-up on ${channel}.`;
  const requestedPriority = payload.priority ?? "normal";

  let taskId: string | null = null;

  await lockCallbackCreation(db, organizationId, { contactId, conversationId });
  const existing = await findOpenCallbackTaskForContact(db, organizationId, {
    contactId,
    conversationId,
  });

  if (existing) {
    taskId = serializeEntityIdOptional(existing.id);
    const mergedNotes = appendCallbackNotes(
      existing.notes,
      payload.notes ??
        `${adminLabel} updated this open callback (${new Date().toISOString()}).`,
    );
    const mergedPriority = mergeTaskPriority(existing.priority, requestedPriority);

    await db.$executeRaw`
      UPDATE ccass.agent_tasks
      SET assigned_user_id = ${payload.assignedUserId}::bigint,
          conversation_id = COALESCE(${conversationId}::bigint, conversation_id),
          channel = ${channel},
          priority = ${mergedPriority},
          title = ${title},
          summary = ${summary},
          notes = ${mergedNotes},
          due_at = COALESCE(${payload.dueAt ? new Date(payload.dueAt) : null}, due_at),
          assigned_by_user_id = ${adminUserId}::bigint,
          assigned_by_label = ${adminLabel},
          source = 'admin',
          updated_at = NOW()
      WHERE organization_id = ${organizationId}::bigint
        AND id = ${existing.id}::bigint
    `;

    await dismissDuplicateOpenCallbacks(db, organizationId, existing.id, {
      contactId,
      conversationId,
    });
  }

  if (!taskId) {
    const inserted = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO ccass.agent_tasks (
        organization_id,
        assigned_user_id,
        created_by_user_id,
        contact_id,
        conversation_id,
        task_type,
        status,
        priority,
        source,
        title,
        summary,
        notes,
        channel,
        due_at,
        assigned_by_user_id,
        assigned_by_label
      )
      VALUES (
        ${organizationId}::bigint,
        ${payload.assignedUserId}::bigint,
        ${adminUserId}::bigint,
        ${contactId},
        ${conversationId}::bigint,
        'callback',
        'open',
        ${requestedPriority},
        'admin',
        ${title},
        ${summary},
        ${payload.notes ?? null},
        ${channel},
        ${payload.dueAt ? new Date(payload.dueAt) : null},
        ${adminUserId}::bigint,
        ${adminLabel}
      )
      RETURNING id
    `;
    taskId = serializeEntityIdOptional(inserted[0]?.id) ?? null;
    if (taskId) {
      await dismissDuplicateOpenCallbacks(db, organizationId, taskId, {
        contactId,
        conversationId,
      });
    }
  }

  if (!taskId) {
    throw Object.assign(new Error("Failed to create callback task"), { status: 500 });
  }

  await acknowledgeMissedContactsForCallback(db, organizationId, {
    conversationId,
    contactId,
    channel: contactId ? null : channel,
  });

  const task = await getAgentTaskById(db, organizationId, taskId);
  if (!task) {
    throw Object.assign(new Error("Failed to load callback task"), { status: 500 });
  }
  return task;
}

const COWORKER_ASSIGNED_LABEL = "Co-worker";

export async function createProactiveCallbackTask(
  db: DbClient,
  organizationId: string,
  input: z.infer<typeof createCallbackTaskSchema>,
): Promise<AgentTaskRecord> {
  const payload = createCallbackTaskSchema.parse(input);

  const assigneeRows = await db.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint
      AND setup_user_id = ${payload.assignedUserId}::bigint
    LIMIT 1
  `;
  if (!assigneeRows[0]) {
    throw Object.assign(new Error("Assigned agent not found"), { status: 404 });
  }
  await assertCallbackAssigneeIsAgent(db, organizationId, payload.assignedUserId);

  let conversationId = payload.conversationId ?? null;
  let contactId = payload.contactId ?? null;
  let hintChannel = asCallbackChannel(payload.channel ?? null);

  if (conversationId) {
    const conversation = await getConversation(db, organizationId, conversationId);
    if (!conversation) {
      throw Object.assign(new Error("Conversation not found"), { status: 404 });
    }
    contactId = contactId ?? conversation.contactId ?? null;
    hintChannel = hintChannel ?? asCallbackChannel(conversation.channel);
  }
  if (contactId) {
    contactId = await resolveCanonicalContactId(db, organizationId, contactId);
  }

  if (!contactId && !conversationId) {
    throw Object.assign(new Error("Contact or conversation is required"), { status: 400 });
  }

  let channel: CallbackOutreachChannel;
  if (contactId) {
    channel = await resolveCallbackOutreachChannel(db, organizationId, contactId, {
      requestedChannel: payload.channel ?? null,
      hintChannel,
    });
  } else {
    if (!hintChannel) {
      throw Object.assign(
        new Error("Channel is required for callback tasks without a linked contact"),
        { status: 400 },
      );
    }
    channel = hintChannel;
  }

  const title =
    payload.title?.trim() ||
    `Callback · ${channel.charAt(0).toUpperCase()}${channel.slice(1)}`;
  const summary =
    payload.summary?.trim() ||
    `${COWORKER_ASSIGNED_LABEL} assigned a callback for follow-up on ${channel}.`;
  const requestedPriority = payload.priority ?? "normal";

  let taskId: string | null = null;

  await lockCallbackCreation(db, organizationId, { contactId, conversationId });
  const existing = await findOpenCallbackTaskForContact(db, organizationId, {
    contactId,
    conversationId,
  });

  if (existing) {
    taskId = serializeEntityIdOptional(existing.id);
    const mergedNotes = appendCallbackNotes(existing.notes, payload.notes);
    const mergedPriority = mergeTaskPriority(existing.priority, requestedPriority);

    await db.$executeRaw`
      UPDATE ccass.agent_tasks
      SET assigned_user_id = CASE
            WHEN source = 'admin' THEN assigned_user_id
            ELSE ${payload.assignedUserId}::bigint
          END,
          conversation_id = COALESCE(${conversationId}::bigint, conversation_id),
          channel = CASE WHEN source = 'admin' THEN channel ELSE ${channel} END,
          priority = ${mergedPriority},
          title = CASE WHEN source = 'admin' THEN title ELSE ${title} END,
          summary = CASE WHEN source = 'admin' THEN summary ELSE ${summary} END,
          notes = ${mergedNotes},
          due_at = COALESCE(${payload.dueAt ? new Date(payload.dueAt) : null}, due_at),
          source = CASE WHEN source = 'admin' THEN source ELSE 'coworker' END,
          assigned_by_user_id = CASE
            WHEN source = 'admin' THEN assigned_by_user_id
            ELSE NULL
          END,
          assigned_by_label = CASE
            WHEN source = 'admin' THEN assigned_by_label
            ELSE ${COWORKER_ASSIGNED_LABEL}
          END,
          updated_at = NOW()
      WHERE organization_id = ${organizationId}::bigint
        AND id = ${existing.id}::bigint
    `;

    await dismissDuplicateOpenCallbacks(db, organizationId, existing.id, {
      contactId,
      conversationId,
    });
  }

  if (!taskId) {
    const inserted = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO ccass.agent_tasks (
        organization_id,
        assigned_user_id,
        created_by_user_id,
        contact_id,
        conversation_id,
        task_type,
        status,
        priority,
        source,
        title,
        summary,
        notes,
        channel,
        due_at,
        assigned_by_user_id,
        assigned_by_label
      )
      VALUES (
        ${organizationId}::bigint,
        ${payload.assignedUserId}::bigint,
        NULL,
        ${contactId},
        ${conversationId}::bigint,
        'callback',
        'open',
        ${requestedPriority},
        'coworker',
        ${title},
        ${summary},
        ${payload.notes ?? null},
        ${channel},
        ${payload.dueAt ? new Date(payload.dueAt) : null},
        NULL,
        ${COWORKER_ASSIGNED_LABEL}
      )
      RETURNING id
    `;
    taskId = serializeEntityIdOptional(inserted[0]?.id) ?? null;
    if (taskId) {
      await dismissDuplicateOpenCallbacks(db, organizationId, taskId, {
        contactId,
        conversationId,
      });
    }
  }

  if (!taskId) {
    throw Object.assign(new Error("Failed to create callback task"), { status: 500 });
  }

  await acknowledgeMissedContactsForCallback(db, organizationId, {
    conversationId,
    contactId,
    channel: contactId ? null : channel,
  });

  const task = await getAgentTaskById(db, organizationId, taskId);
  if (!task) {
    throw Object.assign(new Error("Failed to load callback task"), { status: 500 });
  }
  return task;
}

export const createCoworkerFollowUpSuggestionSchema = z.object({
  assignedUserId: entityIdSchema,
  conversationId: entityIdSchema,
  contactId: cdpContactIdSchema.optional(),
  channel: z
    .enum(["voice", "email", "webchat", "whatsapp", "instagram", "facebook"])
    .optional(),
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(2000),
  notes: z.string().max(4000).optional(),
  dueAt: z.string().datetime().optional(),
  priority: z.enum(AGENT_TASK_PRIORITIES).optional(),
});

const CONVERSATION_END_FOLLOW_UP_METADATA = {
  extractionKind: "conversation_end",
} as const;

export async function hasConversationEndFollowUpTask(
  db: DbClient,
  organizationId: string,
  conversationId: string,
): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM ccass.agent_tasks
    WHERE organization_id = ${organizationId}::bigint
      AND conversation_id = ${conversationId}::bigint
      AND source = 'coworker'
      AND metadata->>'extractionKind' = 'conversation_end'
    LIMIT 1
  `;
  return Boolean(rows[0]);
}

export async function createCoworkerFollowUpSuggestion(
  db: DbClient,
  organizationId: string,
  input: z.infer<typeof createCoworkerFollowUpSuggestionSchema>,
): Promise<AgentTaskRecord | null> {
  const payload = createCoworkerFollowUpSuggestionSchema.parse(input);

  const assigneeRows = await db.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM ccass.agents
    WHERE organization_id = ${organizationId}::bigint
      AND setup_user_id = ${payload.assignedUserId}::bigint
    LIMIT 1
  `;
  if (!assigneeRows[0]) {
    return null;
  }

  const alreadyCreated = await hasConversationEndFollowUpTask(
    db,
    organizationId,
    payload.conversationId,
  );
  if (alreadyCreated) {
    return null;
  }

  let contactId = payload.contactId ?? null;
  let channel: string | null = payload.channel ?? null;
  const conversation = await getConversation(db, organizationId, payload.conversationId);
  if (!conversation) {
    return null;
  }
  contactId = contactId ?? conversation.contactId ?? null;
  channel = channel ?? conversation.channel ?? null;
  if (contactId) {
    contactId = await resolveCanonicalContactId(db, organizationId, contactId);
  }

  const inserted = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO ccass.agent_tasks (
      organization_id,
      assigned_user_id,
      created_by_user_id,
      contact_id,
      conversation_id,
      task_type,
      status,
      priority,
      source,
      title,
      summary,
      notes,
      channel,
      due_at,
      assigned_by_user_id,
      assigned_by_label,
      metadata
    )
    VALUES (
      ${organizationId}::bigint,
      ${payload.assignedUserId}::bigint,
      NULL,
      ${contactId},
      ${payload.conversationId}::bigint,
      'suggestion',
      'open',
      ${payload.priority ?? "normal"},
      'coworker',
      ${payload.title},
      ${payload.summary},
      ${payload.notes ?? null},
      ${channel},
      ${payload.dueAt ? new Date(payload.dueAt) : null},
      NULL,
      ${COWORKER_ASSIGNED_LABEL},
      ${JSON.stringify(CONVERSATION_END_FOLLOW_UP_METADATA)}::jsonb
    )
    RETURNING id
  `;
  const taskId = serializeEntityIdOptional(inserted[0]?.id);
  if (!taskId) {
    return null;
  }

  return getAgentTaskById(db, organizationId, taskId);
}
