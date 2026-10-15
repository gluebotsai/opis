import type { DbClient } from "../lib/rls.js";
import { Prisma } from "@ai-contact-center/db-cc";
import { serializeEntityId, serializeEntityIdOptional } from "../lib/id-schema.js";
import { asStringArray } from "./queues-helpers.js";
import { resolveAgentPresenceState } from "./presence.js";
import { isPresenceEligibleForChannel } from "./presence-cache.js";
import { createProactiveCallbackTask } from "./agent-tasks.js";
import {
  buildMissedContactOpenCallbackExistsSql,
  consolidateDuplicateOpenCallbacks,
} from "./callback-task-dedupe.js";
import {
  deterministicProactivePlan,
  requestProactiveCallbackPlan,
  type ProactivePlanRequest,
} from "./proactive-callback-plan-client.js";
import {
  insertProactiveAttemptPlanned,
  updateProactiveAttempt,
} from "./proactive-callback-attempts.js";
import { getContactReachableChannels, isCallbackOutreachChannel } from "./preferred-channel.js";
import { listContactCenterAdminUserIds } from "./callback-assignee.js";
import { emitMonitoringUpdated } from "./realtime.js";

type CandidateRow = {
  id: string | bigint;
  organization_id: string | bigint;
  conversation_id: string | bigint | null;
  contact_id: string | bigint | null;
  queue_id: string | bigint | null;
  channel: string;
  reason: string;
  customer_name: string | null;
  missed_at: Date;
  queue_name: string | null;
  queue_description: string | null;
  queue_skills: unknown;
  grace_minutes: number;
  close_time: string | null;
};

type EligibleAgentRow = {
  agent_id: string;
  setup_user_id: string;
  display_name: string;
  skills: unknown;
  open_callback_count: number;
  skill_score: number;
};

const PROACTIVE_CHANNELS = new Set(["webchat", "whatsapp", "instagram", "facebook", "email"]);

function routingChannel(channel: string): string {
  if (channel === "webchat") return "chat";
  return channel;
}

function isMissingGraceColumn(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /missed_callback_grace_minutes.*does not exist/i.test(error.message);
}

export async function listProactiveCallbackCandidates(
  db: DbClient,
  organizationId: string,
  limit = 20,
): Promise<CandidateRow[]> {
  try {
    return await db.$queryRaw<CandidateRow[]>`
      SELECT
        mc.id,
        mc.organization_id,
        mc.conversation_id,
        mc.contact_id,
        mc.queue_id,
        mc.channel,
        mc.reason,
        mc.customer_name,
        mc.missed_at,
        q.name AS queue_name,
        COALESCE(qrp.description, q.name) AS queue_description,
        q.skills AS queue_skills,
        rp.missed_callback_grace_minutes AS grace_minutes,
        bh.close_time::text AS close_time
      FROM ccass.agent_missed_contacts mc
      INNER JOIN ccass.routing_policies rp
        ON rp.queue_id = mc.queue_id
       AND rp.organization_id = mc.organization_id
      INNER JOIN ccass.queues q
        ON q.id = mc.queue_id
       AND q.organization_id = mc.organization_id
      LEFT JOIN ccass.queue_routing_profiles qrp
        ON qrp.queue_id = mc.queue_id
       AND qrp.organization_id = mc.organization_id
      LEFT JOIN accounts.setup_business_hours bh
        ON bh.id = q.business_hours_id
      LEFT JOIN ccass.proactive_callback_attempts pca
        ON pca.missed_contact_id = mc.id
      LEFT JOIN LATERAL (
        SELECT TRUE AS has_callback
        FROM ccass.agent_tasks t
        WHERE t.organization_id = mc.organization_id
          AND t.task_type = 'callback'
          AND t.status = 'open'
          AND (
            ${Prisma.raw(buildMissedContactOpenCallbackExistsSql("mc", "t"))}
          )
        LIMIT 1
      ) open_cb ON TRUE
      LEFT JOIN LATERAL (
        SELECT c.ended_at AS connected_at
        FROM ccass.conversations c
        WHERE c.organization_id = mc.organization_id
          AND c.status IN ('resolved', 'closed')
          AND c.assigned_agent_id IS NOT NULL
          AND c.ended_at IS NOT NULL
          AND c.ended_at >= mc.missed_at
          AND COALESCE(c.direction, 'inbound') = 'inbound'
          AND NOT EXISTS (
            SELECT 1
            FROM ccass.agent_tasks t
            WHERE t.organization_id = c.organization_id
              AND t.conversation_id = c.id
              AND t.task_type = 'callback'
          )
          AND (
            c.id = mc.conversation_id
            OR (
              mc.contact_id IS NOT NULL
              AND c.contact_id = mc.contact_id
              AND c.channel = mc.channel
            )
          )
        ORDER BY c.ended_at ASC
        LIMIT 1
      ) follow_up ON TRUE
      WHERE mc.organization_id = ${organizationId}::bigint
        AND mc.queue_id IS NOT NULL
        AND mc.missed_at >= NOW() - INTERVAL '7 days'
        AND rp.missed_callback_grace_minutes IS NOT NULL
        AND mc.missed_at + (rp.missed_callback_grace_minutes * INTERVAL '1 minute') <= NOW()
        AND open_cb.has_callback IS NULL
        AND follow_up.connected_at IS NULL
        AND (pca.id IS NULL OR pca.status IN ('failed'))
        AND mc.channel = ANY(ARRAY['webchat', 'whatsapp', 'instagram', 'facebook', 'email'])
      ORDER BY mc.missed_at ASC
      LIMIT ${limit}
    `;
  } catch (error) {
    if (isMissingGraceColumn(error)) return [];
    throw error;
  }
}

async function listEligibleAgentsForCandidate(
  db: DbClient,
  organizationId: string,
  candidate: CandidateRow,
): Promise<EligibleAgentRow[]> {
  const queueId = candidate.queue_id;
  if (queueId == null) return [];

  const channel = routingChannel(candidate.channel);
  const queueSkills = asStringArray(candidate.queue_skills);

  const rows = await db.$queryRaw<EligibleAgentRow[]>`
    SELECT
      qm.agent_id::text AS agent_id,
      qm.setup_user_id::text AS setup_user_id,
      COALESCE(a.display_name, u.work_email, 'Agent') AS display_name,
      COALESCE(u.skills, '[]'::jsonb) AS skills,
      (
        SELECT COUNT(*)::int
        FROM ccass.agent_tasks t
        WHERE t.organization_id = ${organizationId}::bigint
          AND t.assigned_user_id = qm.setup_user_id
          AND t.task_type = 'callback'
          AND t.status = 'open'
      ) AS open_callback_count,
      (
        SELECT COUNT(*)::int
        FROM ccass.agent_skills agent_skill
        INNER JOIN ccass.skills skill ON skill.id = agent_skill.skill_id
        WHERE agent_skill.agent_id = qm.agent_id
          AND (agent_skill.expires_at IS NULL OR agent_skill.expires_at > NOW())
          AND skill.key IN (
            SELECT jsonb_array_elements_text(${JSON.stringify(queueSkills)}::jsonb)
          )
      ) AS skill_score
    FROM ccass.queue_members qm
    INNER JOIN ccass.agents a ON a.id = qm.agent_id
    INNER JOIN accounts.setup_users u ON u.id = qm.setup_user_id
    LEFT JOIN ccass.agent_capacity ac
      ON ac.agent_id = qm.agent_id
     AND ac.channel = ${channel}
    WHERE qm.queue_id = ${queueId}::bigint
      AND a.organization_id = ${organizationId}::bigint
      AND (
        (${channel} = 'chat' AND qm.handles_chat = TRUE)
        OR (${channel} = 'email' AND qm.handles_email = TRUE)
        OR (${channel} = 'whatsapp' AND qm.handles_whatsapp = TRUE)
        OR (${channel} = 'instagram' AND qm.handles_instagram = TRUE)
        OR (${channel} = 'facebook' AND qm.handles_facebook = TRUE)
      )
      AND COALESCE(ac.active_count, 0) + COALESCE(ac.reserved_count, 0)
        < COALESCE(
          ac.max_concurrency,
          CASE
            WHEN ${channel} = 'email' THEN qm.email_concurrency
            WHEN ${channel} = 'whatsapp' THEN qm.whatsapp_concurrency
            WHEN ${channel} = 'instagram' THEN qm.instagram_concurrency
            WHEN ${channel} = 'facebook' THEN qm.facebook_concurrency
            ELSE qm.chat_concurrency
          END
        )
  `;

  const adminUserIds = await listContactCenterAdminUserIds(db, organizationId);
  const eligible: EligibleAgentRow[] = [];
  for (const row of rows) {
    if (adminUserIds.has(row.setup_user_id)) continue;
    const presenceState = await resolveAgentPresenceState(db, organizationId, row.agent_id);
    if (isPresenceEligibleForChannel(channel, presenceState)) {
      eligible.push(row);
    }
  }
  return eligible;
}

async function processCandidate(db: DbClient, candidate: CandidateRow): Promise<void> {
  const organizationId = serializeEntityId(candidate.organization_id);
  const missedContactId = serializeEntityId(candidate.id);

  if (!PROACTIVE_CHANNELS.has(candidate.channel)) return;

  const eligibleRows = await listEligibleAgentsForCandidate(db, organizationId, candidate);
  if (eligibleRows.length === 0) return;

  const attempt = await insertProactiveAttemptPlanned(db, {
    organizationId,
    missedContactId,
    queueId: serializeEntityIdOptional(candidate.queue_id),
    conversationId: serializeEntityIdOptional(candidate.conversation_id),
    contactId: serializeEntityIdOptional(candidate.contact_id),
  });
  if (!attempt) return;

  const contactId = serializeEntityIdOptional(candidate.contact_id);
  if (contactId) {
    const reachable = await getContactReachableChannels(db, organizationId, contactId);
    if (reachable.size === 0) {
      await updateProactiveAttempt(db, organizationId, attempt.id, {
        status: "skipped",
        planJson: {
          skip: true,
          reason:
            "No reachable callback channel (webchat-only or missing WhatsApp/email/social identity)",
        },
        errorMessage:
          "No reachable callback channel for this contact. Add WhatsApp, Instagram, Facebook, or email identity.",
      });
      return;
    }
  } else if (
    candidate.channel === "webchat" ||
    candidate.channel === "chat" ||
    !isCallbackOutreachChannel(candidate.channel)
  ) {
    await updateProactiveAttempt(db, organizationId, attempt.id, {
      status: "skipped",
      planJson: {
        skip: true,
        reason: "Webchat/voice misses without a contact cannot create callbacks",
      },
      errorMessage: "Callback requires a contact with a reachable outreach channel",
    });
    return;
  }

  const planRequest: ProactivePlanRequest = {
    organizationId,
    missedContactId,
    conversationId: serializeEntityIdOptional(candidate.conversation_id),
    contactId: serializeEntityIdOptional(candidate.contact_id),
    queueId: serializeEntityIdOptional(candidate.queue_id),
    channel: candidate.channel,
    reason: candidate.reason,
    missedAt: candidate.missed_at.toISOString(),
    customerName: candidate.customer_name,
    queueName: candidate.queue_name,
    queueDescription: candidate.queue_description,
    queueSkills: asStringArray(candidate.queue_skills),
    queueCloseTime: candidate.close_time,
    eligibleAgents: eligibleRows.map((row) => ({
      setupUserId: row.setup_user_id,
      agentId: row.agent_id,
      displayName: row.display_name,
      skills: asStringArray(row.skills),
      openCallbackCount: row.open_callback_count,
      skillScore: row.skill_score,
    })),
  };

  let plan;
  try {
    plan = await requestProactiveCallbackPlan(planRequest);
  } catch {
    plan = deterministicProactivePlan(planRequest);
  }

  if ("skip" in plan) {
    await updateProactiveAttempt(db, organizationId, attempt.id, {
      status: "skipped",
      planJson: plan,
      errorMessage: plan.reason,
    });
    return;
  }

  try {
    const assign = async (tx: DbClient) => {
      const task = await createProactiveCallbackTask(tx, organizationId, {
        assignedUserId: plan.assignedUserId,
        conversationId: serializeEntityIdOptional(candidate.conversation_id) ?? undefined,
        contactId: serializeEntityIdOptional(candidate.contact_id) ?? undefined,
        channel: plan.channel,
        title: plan.title,
        summary: plan.summary,
        notes: plan.notes,
        dueAt: plan.dueAt,
        priority: plan.priority,
      });

      await updateProactiveAttempt(tx, organizationId, attempt.id, {
        status: "assigned",
        taskId: task.id,
        planJson: plan as unknown as Record<string, unknown>,
      });
      return task;
    };

    if ("$transaction" in db && typeof db.$transaction === "function") {
      await db.$transaction((tx) => assign(tx), { timeout: 30_000, maxWait: 10_000 });
    } else {
      await assign(db);
    }
    emitMonitoringUpdated(organizationId, "proactive_callback.assigned");
  } catch (error) {
    await updateProactiveAttempt(db, organizationId, attempt.id, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Failed to create callback task",
    });
  }
}

export async function sweepProactiveCallbacks(db: DbClient): Promise<number> {
  let processed = 0;
  try {
    const orgRows = await db.$queryRaw<Array<{ organization_id: string | bigint }>>`
      SELECT DISTINCT organization_id
      FROM ccass.agent_missed_contacts
      WHERE missed_at >= NOW() - INTERVAL '7 days'
    `;
    for (const orgRow of orgRows) {
      const organizationId = serializeEntityId(orgRow.organization_id);
      await consolidateDuplicateOpenCallbacks(db, organizationId);
      const candidates = await listProactiveCallbackCandidates(db, organizationId, 10);
      for (const candidate of candidates) {
        await processCandidate(db, candidate);
        processed += 1;
      }
    }
  } catch (error) {
    if (isMissingGraceColumn(error)) return 0;
    throw error;
  }
  return processed;
}
