import type { DbClient } from "../lib/rls.js";
import { Prisma } from "@ai-contact-center/db-cc";
import { isPresenceEligibleForChannel } from "./presence-cache.js";
import { resolveAgentPresenceState } from "./presence.js";
import { QUEUE_MEMBER_ACTIVE_SHIFT_SQL, queueMemberActiveShiftSql } from "./shift-routing.js";
import { DEFAULT_LIVE_OFFER_TIMEOUT_SECONDS } from "./offer-timeout-config.js";

export type RoutingFailureReason =
  | "no_queue_members"
  | "no_shift_coverage"
  | "no_matching_skill"
  | "all_at_capacity"
  | "no_ready_agents"
  | "routing_exhausted"
  | "outside_business_hours";

type RouteResult = {
  assigned: boolean;
  agentId: string | null;
  userId: string | null;
  routingAttemptId: string;
  /** Email conversations skip the offer/ringing step and land directly in the agent inbox. */
  autoAccepted?: boolean;
  /** Why routing failed when assigned=false. */
  failureReason?: RoutingFailureReason;
};

type CandidateRow = {
  agent_id: string;
  setup_user_id: string;
  channel_concurrency: number;
  active_count: number;
  reserved_count: number;
  max_concurrency: number;
  skill_score: number;
  presence_state: string | null;
};

export type RoutableChannel =
  | "chat"
  | "email"
  | "whatsapp"
  | "instagram"
  | "facebook";

export function toRoutableChannel(channel: string): RoutableChannel {
  if (channel === "email") return "email";
  if (channel === "whatsapp") return "whatsapp";
  if (channel === "instagram") return "instagram";
  if (channel === "facebook") return "facebook";
  return "chat";
}

export function isSocialRoutableChannel(
  channel: string,
): channel is Extract<RoutableChannel, "whatsapp" | "instagram" | "facebook"> {
  return channel === "whatsapp" || channel === "instagram" || channel === "facebook";
}

export type HandoffQueueCandidate = {
  id: string;
  name: string;
  description: string | null;
  skills: string[];
  intents: string[];
};

/** @deprecated Use HandoffQueueCandidate */
export type ChatQueueCandidate = HandoffQueueCandidate;

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string" && value.trim()) {
    try {
      return asStringList(JSON.parse(value) as unknown);
    } catch {
      return [value.trim()];
    }
  }
  return [];
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ");
}

/**
 * Golden queue picker: NLP selected key/name if it is in the live list,
 * otherwise the first active queue for the channel.
 */
export function pickHandoffQueue(
  queues: HandoffQueueCandidate[],
  options: {
    selectedQueueKey?: string | null;
  } = {},
): string | null {
  if (queues.length === 0) return null;

  const selected = options.selectedQueueKey?.trim();
  if (selected) {
    const selectedNorm = normalizeToken(selected);
    const exact = queues.find(
      (queue) =>
        String(queue.id) === selected ||
        normalizeToken(queue.name) === selectedNorm,
    );
    if (exact) return String(exact.id);
  }

  return String(queues[0]!.id);
}

/** @deprecated Use pickHandoffQueue */
export function pickWebchatQueue(
  queues: HandoffQueueCandidate[],
  options: {
    selectedQueueKey?: string | null;
    candidateSkills?: string[];
    intent?: string | null;
    message?: string | null;
  } = {},
): string | null {
  return pickHandoffQueue(queues, { selectedQueueKey: options.selectedQueueKey });
}

export async function listActiveQueuesForChannel(
  db: DbClient,
  organizationId: string,
  channel: RoutableChannel,
): Promise<HandoffQueueCandidate[]> {
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      name: string;
      description: string | null;
      skills: unknown;
      intents: unknown;
    }>
  >`
    SELECT
      q.id::text AS id,
      q.name,
      COALESCE(profile.description, q.name) AS description,
      COALESCE(q.skills, '[]'::jsonb) AS skills,
      COALESCE(profile.supported_intents, '[]'::jsonb) AS intents
    FROM ccass.queues q
    LEFT JOIN ccass.queue_routing_profiles profile
      ON profile.queue_id = q.id
    WHERE q.organization_id = ${organizationId}::bigint
      AND q.status = 'active'
      AND EXISTS (
        SELECT 1
        FROM ccass.queue_members qm
        WHERE qm.queue_id = q.id
          AND (
            (${channel} = 'chat' AND qm.handles_chat = TRUE)
            OR (${channel} = 'email' AND qm.handles_email = TRUE)
            OR (${channel} = 'whatsapp' AND qm.handles_whatsapp = TRUE)
            OR (${channel} = 'instagram' AND qm.handles_instagram = TRUE)
            OR (${channel} = 'facebook' AND qm.handles_facebook = TRUE)
          )
      )
    ORDER BY q.published_at ASC NULLS LAST, q.id ASC
  `;

  return rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    description: row.description ?? row.name,
    skills: asStringList(row.skills),
    intents: asStringList(row.intents),
  }));
}

export async function listActiveChatQueues(
  db: DbClient,
  organizationId: string,
): Promise<HandoffQueueCandidate[]> {
  return listActiveQueuesForChannel(db, organizationId, "chat");
}

export async function resolveHandoffQueue(
  db: DbClient,
  organizationId: string,
  channel: RoutableChannel,
  options: {
    selectedQueueKey?: string | null;
    allowedQueueIds?: string[];
  } = {},
): Promise<string | null> {
  let queues = await listActiveQueuesForChannel(db, organizationId, channel);
  const allowed = (options.allowedQueueIds ?? [])
    .map((id) => String(id).trim())
    .filter((id) => id.length > 0);
  if (allowed.length > 0) {
    const allowedSet = new Set(allowed);
    queues = queues.filter((queue) => allowedSet.has(String(queue.id)));
  }
  return pickHandoffQueue(queues, { selectedQueueKey: options.selectedQueueKey });
}

export async function resolveSocialQueue(
  db: DbClient,
  organizationId: string,
  channel: Extract<RoutableChannel, "whatsapp" | "instagram" | "facebook">,
): Promise<string | null> {
  return resolveHandoffQueue(db, organizationId, channel);
}

export async function resolveWebchatQueue(
  db: DbClient,
  organizationId: string,
  options: {
    selectedQueueKey?: string | null;
    candidateSkills?: string[];
    intent?: string | null;
    message?: string | null;
  } = {},
): Promise<string | null> {
  return resolveHandoffQueue(db, organizationId, "chat", {
    selectedQueueKey: options.selectedQueueKey,
  });
}

export type TransferTarget = {
  agentId: string;
  userId: string;
  name: string;
  email: string | null;
  employeeId: string | null;
  ext?: string | null;
  queueId: string;
  presence: string;
  activeCount: number;
  reservedCount: number;
  maxConcurrency: number;
};

type TransferTargetCandidateRow = CandidateRow & {
  display_name: string;
  email: string | null;
  employee_id: string | null;
  ext: string | null;
  eligible_count: bigint | number;
};

export async function listEligibleTransferTargets(
  db: DbClient,
  organizationId: string,
  options: {
    queueId: string;
    channel: RoutableChannel;
    excludeAgentId: string;
    search?: string;
    agentId?: string;
    offset?: number;
    limit?: number;
    requireVoice?: boolean;
  },
): Promise<{ targets: TransferTarget[]; total: number; offset: number; hasMore: boolean }> {
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));
  const search = options.search?.trim() || null;
  const candidates = await db.$queryRaw<TransferTargetCandidateRow[]>`
    SELECT
      qm.agent_id::text AS agent_id,
      COALESCE(a.setup_user_id, qm.setup_user_id)::text AS setup_user_id,
      a.display_name,
      a.email,
      su.employee_id,
      su.ext::text AS ext,
      CASE
        WHEN ${options.channel} = 'email' THEN qm.email_concurrency
        WHEN ${options.channel} = 'whatsapp' THEN qm.whatsapp_concurrency
        WHEN ${options.channel} = 'instagram' THEN qm.instagram_concurrency
        WHEN ${options.channel} = 'facebook' THEN qm.facebook_concurrency
        ELSE qm.chat_concurrency
      END AS channel_concurrency,
      COALESCE(ac.active_count, 0) AS active_count,
      COALESCE(ac.reserved_count, 0) AS reserved_count,
      LEAST(
        CASE
          WHEN ${options.channel} = 'email' THEN qm.email_concurrency
          WHEN ${options.channel} = 'whatsapp' THEN qm.whatsapp_concurrency
          WHEN ${options.channel} = 'instagram' THEN qm.instagram_concurrency
          WHEN ${options.channel} = 'facebook' THEN qm.facebook_concurrency
          ELSE qm.chat_concurrency
        END,
        COALESCE(ac.max_concurrency,
          CASE
            WHEN ${options.channel} = 'email' THEN qm.email_concurrency
            WHEN ${options.channel} = 'whatsapp' THEN qm.whatsapp_concurrency
            WHEN ${options.channel} = 'instagram' THEN qm.instagram_concurrency
            WHEN ${options.channel} = 'facebook' THEN qm.facebook_concurrency
            ELSE qm.chat_concurrency
          END)
      ) AS max_concurrency,
      0::int AS skill_score,
      COALESCE(ap.presence_state, ap.status) AS presence_state,
      COUNT(*) OVER() AS eligible_count
    FROM ccass.queue_members qm
    INNER JOIN ccass.agents a ON a.id = qm.agent_id
    INNER JOIN ccass.queues queue ON queue.id = qm.queue_id
    LEFT JOIN accounts.setup_users su
      ON su.id = COALESCE(a.setup_user_id, qm.setup_user_id)
    LEFT JOIN ccass.agent_capacity ac
      ON ac.agent_id = qm.agent_id AND ac.channel = ${options.channel}
    LEFT JOIN ccass.agent_presence ap ON ap.agent_id = qm.agent_id
    LEFT JOIN accounts.setup_business_hours hours ON hours.id = queue.business_hours_id
    WHERE qm.queue_id = ${options.queueId}::bigint
      AND a.organization_id = ${organizationId}::bigint
      -- Lifecycle only (not presence); exclude deactivated agents.
      AND LOWER(COALESCE(a.status, 'active')) NOT IN ('inactive', 'disabled', 'deleted')
      AND qm.agent_id <> ${options.excludeAgentId}::bigint
      AND (${options.agentId ?? null}::bigint IS NULL OR qm.agent_id = ${options.agentId ?? null}::bigint)
      AND (
        (${options.requireVoice ?? false} = TRUE
          AND LOWER(COALESCE(ap.presence_state, ap.status, 'offline')) = 'ready')
        OR (${options.requireVoice ?? false} = FALSE
          AND LOWER(COALESCE(ap.presence_state, ap.status, 'offline')) IN ('ready', 'available'))
      )
      AND (${search}::text IS NULL
        OR a.display_name ILIKE '%' || ${search} || '%'
        OR COALESCE(a.email, '') ILIKE '%' || ${search} || '%')
      AND (
        (${options.requireVoice ?? false} = TRUE AND su.ext IS NOT NULL)
        OR (
          ${options.requireVoice ?? false} = FALSE
          AND (
            (${options.channel} = 'chat' AND qm.handles_chat = TRUE)
            OR (${options.channel} = 'email' AND qm.handles_email = TRUE)
            OR (${options.channel} = 'whatsapp' AND qm.handles_whatsapp = TRUE)
            OR (${options.channel} = 'instagram' AND qm.handles_instagram = TRUE)
            OR (${options.channel} = 'facebook' AND qm.handles_facebook = TRUE)
          )
        )
      )
      -- One membership row: the shift active now. Two overlapping shifts still return one agent.
      AND (${Prisma.raw(QUEUE_MEMBER_ACTIVE_SHIFT_SQL)})
      AND qm.id = (
        SELECT pick.id
        FROM ccass.queue_members pick
        WHERE pick.queue_id = qm.queue_id
          AND pick.agent_id = qm.agent_id
          AND (${Prisma.raw(queueMemberActiveShiftSql("pick"))})
        ORDER BY pick.id
        LIMIT 1
      )
      -- Voice invite still skips business hours, skills, and free capacity.
      AND (
        ${options.requireVoice ?? false} = TRUE
        OR (
          queue.business_hours_id IS NULL
          OR (
            hours.status = 'active'
            AND hours.working_days ? trim(
              to_char(NOW() AT TIME ZONE COALESCE(hours.timezone, 'UTC'), 'Day')
            )
            AND CASE
              WHEN hours.open_time::time <= hours.close_time::time THEN
                (NOW() AT TIME ZONE COALESCE(hours.timezone, 'UTC'))::time
                  BETWEEN hours.open_time::time AND hours.close_time::time
              ELSE
                (NOW() AT TIME ZONE COALESCE(hours.timezone, 'UTC'))::time >= hours.open_time::time
                OR (NOW() AT TIME ZONE COALESCE(hours.timezone, 'UTC'))::time <= hours.close_time::time
            END
          )
        )
      )
      AND (
        ${options.requireVoice ?? false} = TRUE
        OR COALESCE(ac.active_count, 0) + COALESCE(ac.reserved_count, 0) <
          LEAST(
            CASE
              WHEN ${options.channel} = 'email' THEN qm.email_concurrency
              WHEN ${options.channel} = 'whatsapp' THEN qm.whatsapp_concurrency
              WHEN ${options.channel} = 'instagram' THEN qm.instagram_concurrency
              WHEN ${options.channel} = 'facebook' THEN qm.facebook_concurrency
              ELSE qm.chat_concurrency
            END,
            COALESCE(ac.max_concurrency,
              CASE
                WHEN ${options.channel} = 'email' THEN qm.email_concurrency
                WHEN ${options.channel} = 'whatsapp' THEN qm.whatsapp_concurrency
                WHEN ${options.channel} = 'instagram' THEN qm.instagram_concurrency
                WHEN ${options.channel} = 'facebook' THEN qm.facebook_concurrency
                ELSE qm.chat_concurrency
              END)
          )
      )
      AND (
        ${options.requireVoice ?? false} = TRUE
        OR NOT EXISTS (
        SELECT 1 FROM ccass.queue_skills queue_skill
        WHERE queue_skill.queue_id = qm.queue_id
          AND queue_skill.requirement_type = 'required'
          AND NOT EXISTS (
            SELECT 1 FROM ccass.agent_skills agent_skill
            WHERE agent_skill.agent_id = qm.agent_id
              AND agent_skill.skill_id = queue_skill.skill_id
              AND agent_skill.proficiency >= queue_skill.min_proficiency
              AND (agent_skill.expires_at IS NULL OR agent_skill.expires_at > NOW())
          )
      )
      )
    ORDER BY
      (
        LEAST(
          CASE
            WHEN ${options.channel} = 'email' THEN qm.email_concurrency
            WHEN ${options.channel} = 'whatsapp' THEN qm.whatsapp_concurrency
            WHEN ${options.channel} = 'instagram' THEN qm.instagram_concurrency
            WHEN ${options.channel} = 'facebook' THEN qm.facebook_concurrency
            ELSE qm.chat_concurrency
          END,
          COALESCE(ac.max_concurrency,
            CASE
              WHEN ${options.channel} = 'email' THEN qm.email_concurrency
              WHEN ${options.channel} = 'whatsapp' THEN qm.whatsapp_concurrency
              WHEN ${options.channel} = 'instagram' THEN qm.instagram_concurrency
              WHEN ${options.channel} = 'facebook' THEN qm.facebook_concurrency
              ELSE qm.chat_concurrency
            END)
        ) - COALESCE(ac.active_count, 0) - COALESCE(ac.reserved_count, 0)
      ) DESC,
      ap.updated_at ASC NULLS LAST,
      a.display_name ASC,
      qm.agent_id ASC
    OFFSET ${offset}
    LIMIT ${limit}
  `;

  const presenceByAgentId = new Map(
    await Promise.all(
      candidates.map(async (candidate) => {
        const presence = await resolveAgentPresenceState(db, organizationId, candidate.agent_id);
        return [String(candidate.agent_id), presence] as const;
      }),
    ),
  );
  const eligible: TransferTarget[] = [];
  for (const candidate of candidates) {
    const presence = presenceByAgentId.get(String(candidate.agent_id)) ?? null;
    const normalizedPresence = presence?.toLowerCase() ?? null;
    if (
      options.requireVoice
        ? normalizedPresence !== "ready"
        : !isPresenceEligibleForChannel(options.channel, presence)
    ) {
      continue;
    }
    eligible.push({
      agentId: String(candidate.agent_id),
      userId: String(candidate.setup_user_id),
      name: candidate.display_name,
      email: candidate.email,
      employeeId: candidate.employee_id,
      ext: candidate.ext ?? null,
      queueId: options.queueId,
      presence: String(presence ?? "offline"),
      activeCount: Number(candidate.active_count),
      reservedCount: Number(candidate.reserved_count),
      maxConcurrency: Number(candidate.max_concurrency),
    });
  }
  const total = Number(candidates[0]?.eligible_count ?? 0);
  return { targets: eligible, total, offset, hasMore: offset + candidates.length < total };
}

export async function routeConversationToAgent(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  queueId: string,
  options: {
    candidateSkills?: string[];
    reason?: string;
    excludeAgentIds?: string[];
    preferredAgentId?: string;
    channel?: RoutableChannel;
    /** Intentional transfers may target a Ready agent outside their shift window. */
    skipShiftGate?: boolean;
  } = {},
): Promise<RouteResult> {
  const channel = options.channel ?? "chat";
  const shiftGateSql = options.skipShiftGate
    ? Prisma.sql`TRUE`
    : Prisma.raw(QUEUE_MEMBER_ACTIVE_SHIFT_SQL);

  const stateRows = await db.$queryRaw<{ status: string; assigned_agent_id: string | null }[]>`
    SELECT status, assigned_agent_id
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${conversationId}::bigint
    LIMIT 1
  `;
  const state = stateRows[0];
  if (
    state &&
    (state.status === "assigned" || state.status === "active" || state.assigned_agent_id)
  ) {
    return {
      assigned: state.status === "active" || Boolean(state.assigned_agent_id),
      agentId: state.assigned_agent_id ? String(state.assigned_agent_id) : null,
      userId: null,
      routingAttemptId: "",
    };
  }

  const hoursRows = await db.$queryRaw<{ is_open: boolean }[]>`
    SELECT CASE
      WHEN queue.business_hours_id IS NULL OR hours.id IS NULL THEN TRUE
      WHEN hours.status <> 'active' THEN FALSE
      ELSE
        hours.working_days ? trim(
          to_char(NOW() AT TIME ZONE COALESCE(hours.timezone, 'UTC'), 'Day')
        )
        AND CASE
          WHEN hours.open_time::time <= hours.close_time::time THEN
            (NOW() AT TIME ZONE COALESCE(hours.timezone, 'UTC'))::time
              BETWEEN hours.open_time::time AND hours.close_time::time
          ELSE
            (NOW() AT TIME ZONE COALESCE(hours.timezone, 'UTC'))::time >= hours.open_time::time
            OR (NOW() AT TIME ZONE COALESCE(hours.timezone, 'UTC'))::time <= hours.close_time::time
        END
    END AS is_open
    FROM ccass.queues queue
    LEFT JOIN accounts.setup_business_hours hours ON hours.id = queue.business_hours_id
    WHERE queue.id = ${queueId}::bigint
      AND queue.organization_id = ${organizationId}::bigint
    LIMIT 1
  `;
  if (hoursRows[0]?.is_open === false) {
    const attemptRows = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO ccass.routing_attempts (
        organization_id, conversation_id, queue_id, attempt_number, outcome, completed_at
      ) VALUES (
        ${organizationId}::bigint,
        ${conversationId}::bigint,
        ${queueId}::bigint,
        (
          SELECT COALESCE(MAX(attempt_number), 0) + 1
          FROM ccass.routing_attempts
          WHERE organization_id = ${organizationId}::bigint
            AND conversation_id = ${conversationId}::bigint
        ),
        'outside_business_hours',
        NOW()
      )
      RETURNING id
    `;
    return {
      assigned: false,
      agentId: null,
      userId: null,
      routingAttemptId: attemptRows[0]?.id ? String(attemptRows[0].id) : "",
      failureReason: "outside_business_hours",
    };
  }

  const candidates = await db.$queryRaw<CandidateRow[]>`
    SELECT
      qm.agent_id::text AS agent_id,
      COALESCE(a.setup_user_id, qm.setup_user_id)::text AS setup_user_id,
      CASE
        WHEN ${channel} = 'email' THEN qm.email_concurrency
        WHEN ${channel} = 'whatsapp' THEN qm.whatsapp_concurrency
        WHEN ${channel} = 'instagram' THEN qm.instagram_concurrency
        WHEN ${channel} = 'facebook' THEN qm.facebook_concurrency
        ELSE qm.chat_concurrency
      END AS channel_concurrency,
      COALESCE(ac.active_count, 0) AS active_count,
      COALESCE(ac.reserved_count, 0) AS reserved_count,
      COALESCE(
        ac.max_concurrency,
        CASE
          WHEN ${channel} = 'email' THEN qm.email_concurrency
          WHEN ${channel} = 'whatsapp' THEN qm.whatsapp_concurrency
          WHEN ${channel} = 'instagram' THEN qm.instagram_concurrency
          WHEN ${channel} = 'facebook' THEN qm.facebook_concurrency
          ELSE qm.chat_concurrency
        END
      ) AS max_concurrency,
      (
        SELECT COUNT(*)::int
        FROM ccass.agent_skills agent_skill
        INNER JOIN ccass.skills skill ON skill.id = agent_skill.skill_id
        WHERE agent_skill.agent_id = qm.agent_id
          AND (agent_skill.expires_at IS NULL OR agent_skill.expires_at > NOW())
          AND skill.key IN (
            SELECT jsonb_array_elements_text(
              ${JSON.stringify(options.candidateSkills ?? [])}::jsonb
            )
          )
      ) AS skill_score,
      COALESCE(ap.presence_state, ap.status) AS presence_state
    FROM ccass.queue_members qm
    INNER JOIN ccass.agents a ON a.id = qm.agent_id
    INNER JOIN ccass.queues queue ON queue.id = qm.queue_id
    LEFT JOIN ccass.agent_capacity ac
      ON ac.agent_id = qm.agent_id AND ac.channel = ${channel}
    LEFT JOIN ccass.agent_presence ap ON ap.agent_id = qm.agent_id
    WHERE qm.queue_id = ${queueId}::bigint
      AND (
        (${channel} = 'chat' AND qm.handles_chat = TRUE)
        OR (${channel} = 'email' AND qm.handles_email = TRUE)
        OR (${channel} = 'whatsapp' AND qm.handles_whatsapp = TRUE)
        OR (${channel} = 'instagram' AND qm.handles_instagram = TRUE)
        OR (${channel} = 'facebook' AND qm.handles_facebook = TRUE)
      )
      AND a.organization_id = ${organizationId}::bigint
      AND ${shiftGateSql}
      AND COALESCE(ac.active_count, 0) + COALESCE(ac.reserved_count, 0)
        < LEAST(
          CASE
            WHEN ${channel} = 'email' THEN qm.email_concurrency
            WHEN ${channel} = 'whatsapp' THEN qm.whatsapp_concurrency
            WHEN ${channel} = 'instagram' THEN qm.instagram_concurrency
            WHEN ${channel} = 'facebook' THEN qm.facebook_concurrency
            ELSE qm.chat_concurrency
          END,
          COALESCE(
            ac.max_concurrency,
            CASE
              WHEN ${channel} = 'email' THEN qm.email_concurrency
              WHEN ${channel} = 'whatsapp' THEN qm.whatsapp_concurrency
              WHEN ${channel} = 'instagram' THEN qm.instagram_concurrency
              WHEN ${channel} = 'facebook' THEN qm.facebook_concurrency
              ELSE qm.chat_concurrency
            END
          )
        )
      AND NOT EXISTS (
        SELECT 1
        FROM ccass.queue_skills queue_skill
        WHERE queue_skill.queue_id = qm.queue_id
          AND queue_skill.requirement_type = 'required'
          AND NOT EXISTS (
            SELECT 1
            FROM ccass.agent_skills required_agent_skill
            WHERE required_agent_skill.agent_id = qm.agent_id
              AND required_agent_skill.skill_id = queue_skill.skill_id
              AND required_agent_skill.proficiency >= queue_skill.min_proficiency
              AND (
                required_agent_skill.expires_at IS NULL
                OR required_agent_skill.expires_at > NOW()
              )
          )
      )
    ORDER BY skill_score DESC, COALESCE(ac.active_count, 0) ASC, qm.agent_id ASC
  `;

  const eligible: CandidateRow[] = [];
  const excluded = new Set(options.excludeAgentIds ?? []);
  let excludedCount = 0;
  let presenceFilteredCount = 0;
  for (const candidate of candidates) {
    if (excluded.has(candidate.agent_id)) {
      excludedCount += 1;
      continue;
    }
    if (options.preferredAgentId && candidate.agent_id !== options.preferredAgentId) continue;

    // Presence authority is ccass.agent_presence. Capacity and skills are checked separately.
    const presenceState = await resolveAgentPresenceState(
      db,
      organizationId,
      candidate.agent_id,
    );

    if (isPresenceEligibleForChannel(channel, presenceState)) {
      eligible.push(candidate);
    } else {
      presenceFilteredCount += 1;
    }
  }

  const highestSkillScore =
    (options.candidateSkills?.length ?? 0) > 0
      ? Math.max(...eligible.map((candidate) => candidate.skill_score), 0)
      : null;
  const rankedEligible =
    highestSkillScore === null
      ? eligible
      : eligible.filter((candidate) => candidate.skill_score === highestSkillScore);

  if (rankedEligible.length === 0) {
    let failureReason: RoutingFailureReason;
    if (candidates.length > 0) {
      // Candidates passed queue/shift/skill/capacity SQL but were filtered in memory.
      failureReason =
        presenceFilteredCount > 0
          ? "no_ready_agents"
          : excludedCount > 0
            ? "routing_exhausted"
            : "no_ready_agents";
    } else {
      const diagRows = await db.$queryRaw<
        { member_count: number; shift_count: number; skill_count: number }[]
      >`
        SELECT
          COUNT(*)::int AS member_count,
          COUNT(*) FILTER (WHERE ${Prisma.raw(QUEUE_MEMBER_ACTIVE_SHIFT_SQL)})::int AS shift_count,
          COUNT(*) FILTER (
            WHERE ${Prisma.raw(QUEUE_MEMBER_ACTIVE_SHIFT_SQL)}
              AND NOT EXISTS (
                SELECT 1
                FROM ccass.queue_skills queue_skill
                WHERE queue_skill.queue_id = qm.queue_id
                  AND queue_skill.requirement_type = 'required'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM ccass.agent_skills required_agent_skill
                    WHERE required_agent_skill.agent_id = qm.agent_id
                      AND required_agent_skill.skill_id = queue_skill.skill_id
                      AND required_agent_skill.proficiency >= queue_skill.min_proficiency
                      AND (
                        required_agent_skill.expires_at IS NULL
                        OR required_agent_skill.expires_at > NOW()
                      )
                  )
              )
          )::int AS skill_count
        FROM ccass.queue_members qm
        INNER JOIN ccass.agents a ON a.id = qm.agent_id
        INNER JOIN ccass.queues queue
          ON queue.id = qm.queue_id
         AND queue.organization_id = a.organization_id
        WHERE qm.queue_id = ${queueId}::bigint
          AND a.organization_id = ${organizationId}::bigint
          AND (
            (${channel} = 'chat' AND qm.handles_chat = TRUE)
            OR (${channel} = 'email' AND qm.handles_email = TRUE)
            OR (${channel} = 'whatsapp' AND qm.handles_whatsapp = TRUE)
            OR (${channel} = 'instagram' AND qm.handles_instagram = TRUE)
            OR (${channel} = 'facebook' AND qm.handles_facebook = TRUE)
          )
      `;
      const diag = diagRows[0];
      if (!diag || Number(diag.member_count) === 0) {
        failureReason = "no_queue_members";
      } else if (Number(diag.shift_count) === 0) {
        failureReason = "no_shift_coverage";
      } else if (Number(diag.skill_count) === 0) {
        failureReason = "no_matching_skill";
      } else {
        failureReason = "all_at_capacity";
      }
    }

    const attemptRows = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO ccass.routing_attempts (
        organization_id, conversation_id, queue_id, attempt_number, outcome, skip_reasons, completed_at
      ) VALUES (
        ${organizationId}::bigint,
        ${conversationId}::bigint,
        ${queueId}::bigint,
        (
          SELECT COALESCE(MAX(attempt_number), 0) + 1
          FROM ccass.routing_attempts
          WHERE organization_id = ${organizationId}::bigint
            AND conversation_id = ${conversationId}::bigint
        ),
        ${failureReason},
        ${JSON.stringify({
          reason: failureReason,
          candidateCount: candidates.length,
          excludedCount,
          presenceFilteredCount,
        })}::jsonb,
        NOW()
      )
      RETURNING id
    `;
    return {
      assigned: false,
      agentId: null,
      userId: null,
      routingAttemptId: attemptRows[0]?.id ? String(attemptRows[0].id) : "",
      failureReason,
    };
  }

  const cursorRows = await db.$queryRaw<{ cursor_index: number }[]>`
    INSERT INTO ccass.routing_cursors (organization_id, queue_id, cursor_index)
    VALUES (${organizationId}::bigint, ${queueId}::bigint, 0)
    ON CONFLICT (queue_id) DO UPDATE
      SET updated_at = ccass.routing_cursors.updated_at
    RETURNING cursor_index
  `;

  const cursorIndex = cursorRows[0]?.cursor_index ?? 0;

  const selectedIndex = cursorIndex % rankedEligible.length;
  const selected = rankedEligible[selectedIndex]!;
  const nextCursor = (cursorIndex + 1) % rankedEligible.length;
  const directAssign = channel === "email";

  const capacityReserved = directAssign
    ? await db.$queryRaw<{ agent_id: string }[]>`
        INSERT INTO ccass.agent_capacity (
          organization_id, agent_id, channel, max_concurrency, reserved_count, active_count
        )
        VALUES (
          ${organizationId}::bigint,
          ${selected.agent_id}::bigint,
          ${channel},
          ${selected.channel_concurrency},
          0,
          1
        )
        ON CONFLICT (agent_id, channel) DO UPDATE
          SET
            active_count = ccass.agent_capacity.active_count + 1,
            max_concurrency = LEAST(
              ccass.agent_capacity.max_concurrency,
              EXCLUDED.max_concurrency
            ),
            updated_at = NOW()
          WHERE
            ccass.agent_capacity.active_count + ccass.agent_capacity.reserved_count
              < LEAST(ccass.agent_capacity.max_concurrency, EXCLUDED.max_concurrency)
        RETURNING agent_id
      `
    : await db.$queryRaw<{ agent_id: string }[]>`
        INSERT INTO ccass.agent_capacity (
          organization_id, agent_id, channel, max_concurrency, reserved_count, active_count
        )
        VALUES (
          ${organizationId}::bigint,
          ${selected.agent_id}::bigint,
          ${channel},
          ${selected.channel_concurrency},
          1,
          0
        )
        ON CONFLICT (agent_id, channel) DO UPDATE
          SET
            reserved_count = ccass.agent_capacity.reserved_count + 1,
            max_concurrency = LEAST(
              ccass.agent_capacity.max_concurrency,
              EXCLUDED.max_concurrency
            ),
            updated_at = NOW()
          WHERE
            ccass.agent_capacity.active_count + ccass.agent_capacity.reserved_count
              < LEAST(ccass.agent_capacity.max_concurrency, EXCLUDED.max_concurrency)
        RETURNING agent_id
      `;
  if (capacityReserved.length === 0) {
    return routeConversationToAgent(db, organizationId, conversationId, queueId, {
      ...options,
      excludeAgentIds: [...excluded, selected.agent_id],
    });
  }

  const routingOutcome = directAssign ? "accepted" : "offered";
  const assignmentState = directAssign ? "accepted" : "offered";
  const conversationStatus = directAssign ? "active" : "assigned";
  const lifecycleState = directAssign ? "connected" : "offered";
  const transferState = directAssign ? "accepted" : "offered";

  const routeRows = await db.$queryRaw<{ routing_attempt_id: string }[]>`
    WITH routing_attempt AS (
      INSERT INTO ccass.routing_attempts (
        organization_id, conversation_id, queue_id, agent_id,
        attempt_number, outcome, candidate_scores, completed_at
      ) VALUES (
        ${organizationId}::bigint,
        ${conversationId}::bigint,
        ${queueId}::bigint,
        ${selected.agent_id}::bigint,
        (
          SELECT COALESCE(MAX(attempt_number), 0) + 1
          FROM ccass.routing_attempts
          WHERE organization_id = ${organizationId}::bigint
            AND conversation_id = ${conversationId}::bigint
        ),
        ${routingOutcome},
        ${JSON.stringify(
          rankedEligible.map((candidate) => ({
            agentId: String(candidate.agent_id),
            activeCount: Number(candidate.active_count),
            reservedCount: Number(candidate.reserved_count),
            skillScore: Number(candidate.skill_score),
          })),
        )}::jsonb,
        NOW()
      )
      RETURNING id
    ),
    cursor_update AS (
      UPDATE ccass.routing_cursors
      SET
        cursor_index = ${nextCursor},
        last_agent_id = ${selected.agent_id}::bigint,
        updated_at = NOW()
      WHERE queue_id = ${queueId}::bigint
      RETURNING id
    ),
    assignment_insert AS (
      INSERT INTO ccass.conversation_assignments (
        organization_id, conversation_id, queue_id, agent_id,
        routing_attempt_id, state, reason, offered_at, accepted_at, expires_at
      )
      SELECT
        ${organizationId}::bigint,
        ${conversationId}::bigint,
        ${queueId}::bigint,
        ${selected.agent_id}::bigint,
        id,
        ${assignmentState},
        ${options.reason ?? "routing"},
        NOW(),
        ${directAssign ? new Date() : null},
        CASE
          WHEN ${directAssign} THEN NULL
          ELSE NOW() + (
            COALESCE(
              (
                SELECT CASE
                  WHEN ${channel} = 'email' THEN rp.email_offer_timeout_seconds
                  ELSE rp.offer_timeout_seconds
                END
                FROM ccass.routing_policies rp
                WHERE rp.queue_id = ${queueId}::bigint
                  AND rp.organization_id = ${organizationId}::bigint
                LIMIT 1
              ),
              CASE WHEN ${channel} = 'email' THEN 3600 ELSE ${DEFAULT_LIVE_OFFER_TIMEOUT_SECONDS} END
            ) || ' seconds'
          )::interval
        END
      FROM routing_attempt
      RETURNING id
    ),
    conversation_update AS (
      UPDATE ccass.conversations
      SET
        status = ${conversationStatus},
        lifecycle_state = ${lifecycleState},
        assigned_agent_id = ${selected.agent_id}::bigint,
        assigned_user_id = ${selected.setup_user_id}::bigint,
        assigned_at = NOW(),
        updated_at = NOW()
      WHERE id = ${conversationId}::bigint
        AND organization_id = ${organizationId}::bigint
      RETURNING id
    )
    SELECT routing_attempt.id AS routing_attempt_id
    FROM routing_attempt, cursor_update, assignment_insert, conversation_update
  `;
  const routingAttemptId = routeRows[0]?.routing_attempt_id
    ? String(routeRows[0].routing_attempt_id)
    : "";
  await db.$executeRaw`
    UPDATE ccass.conversation_transfers
    SET
      offered_agent_id = ${selected.agent_id}::bigint,
      routing_attempt_id = ${routingAttemptId || null}::bigint,
      state = ${transferState},
      offered_at = NOW(),
      accepted_at = ${directAssign ? new Date() : null},
      completed_at = ${directAssign ? new Date() : null},
      updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM ccass.conversation_transfers
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${conversationId}::bigint
        AND to_queue_id = ${queueId}::bigint
        AND state = 'queued'
      ORDER BY requested_at DESC
      LIMIT 1
    )
  `;

  return {
    assigned: true,
    agentId: String(selected.agent_id),
    userId: String(selected.setup_user_id),
    routingAttemptId,
    autoAccepted: directAssign,
  };
}

export async function preemptAndRouteEmail(
  db: DbClient,
  organizationId: string,
  conversationId: string,
  queueId: string,
  priority: number,
): Promise<RouteResult> {
  if (priority < 1) {
    return { assigned: false, agentId: null, userId: null, routingAttemptId: "" };
  }

  const victimRows = await db.$queryRaw<
    Array<{
      assignment_id: string;
      agent_id: string;
      bumped_conversation_id: string;
      assignment_state: string;
    }>
  >`
    SELECT
      assignment.id AS assignment_id,
      assignment.agent_id,
      assignment.conversation_id AS bumped_conversation_id,
      assignment.state AS assignment_state
    FROM ccass.conversation_assignments assignment
    INNER JOIN ccass.conversations conversation
      ON conversation.id = assignment.conversation_id
      AND conversation.organization_id = assignment.organization_id
    WHERE assignment.organization_id = ${organizationId}::bigint
      AND assignment.queue_id = ${queueId}::bigint
      AND assignment.state IN ('offered', 'accepted')
      AND conversation.channel = 'email'
      AND conversation.status IN ('assigned', 'active')
      AND conversation.priority < ${priority}
    ORDER BY conversation.priority ASC, assignment.offered_at ASC
    LIMIT 1
    FOR UPDATE OF assignment SKIP LOCKED
  `;
  const victim = victimRows[0];
  if (!victim) {
    return { assigned: false, agentId: null, userId: null, routingAttemptId: "" };
  }

  await db.$executeRaw`
    UPDATE ccass.conversation_assignments
    SET state = 'expired', expired_at = NOW()
    WHERE id = ${victim.assignment_id}::bigint
  `;

  if (victim.assignment_state === "accepted") {
    await db.$executeRaw`
      UPDATE ccass.agent_capacity
      SET active_count = GREATEST(active_count - 1, 0), updated_at = NOW()
      WHERE agent_id = ${victim.agent_id}::bigint AND channel = 'email'
    `;
  } else {
    await db.$executeRaw`
      UPDATE ccass.agent_capacity
      SET reserved_count = GREATEST(reserved_count - 1, 0), updated_at = NOW()
      WHERE agent_id = ${victim.agent_id}::bigint AND channel = 'email'
    `;
  }

  await db.$executeRaw`
    UPDATE ccass.conversation_transfers
    SET
      state = 'queued',
      offered_agent_id = NULL,
      offered_at = NULL,
      accepted_at = NULL,
      completed_at = NULL,
      updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM ccass.conversation_transfers
      WHERE organization_id = ${organizationId}::bigint
        AND conversation_id = ${victim.bumped_conversation_id}::bigint
        AND offered_agent_id = ${victim.agent_id}::bigint
        AND state IN ('offered', 'accepted')
      ORDER BY requested_at DESC
      LIMIT 1
    )
  `;

  await db.$executeRaw`
    UPDATE ccass.conversations
    SET
      status = 'queued',
      lifecycle_state = 'waiting',
      assigned_agent_id = NULL,
      assigned_user_id = NULL,
      queued_at = COALESCE(queued_at, NOW()),
      updated_at = NOW()
    WHERE id = ${victim.bumped_conversation_id}::bigint
      AND organization_id = ${organizationId}::bigint
      AND status IN ('assigned', 'active')
      AND assigned_agent_id = ${victim.agent_id}::bigint
  `;

  return routeConversationToAgent(db, organizationId, conversationId, queueId, {
    channel: "email",
    reason: "priority_preemption",
    preferredAgentId: victim.agent_id,
  });
}
