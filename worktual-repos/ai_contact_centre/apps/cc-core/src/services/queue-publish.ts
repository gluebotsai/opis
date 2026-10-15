import type { DbClient } from "../lib/rls.js";
import { serializeEntityId, toDbId } from "../lib/id-schema.js";

type SetupUserRow = {
  id: bigint;
  first_name: string;
  last_name: string;
  work_email: string;
  status: string;
};

async function ensureRuntimeAgent(
  prisma: DbClient,
  organizationId: string,
  user: SetupUserRow,
) {
  const displayName = `${user.first_name} ${user.last_name}`.trim() || user.work_email;
  const agentStatus = user.status === "active" ? "offline" : "offline";

  const existing = await prisma.agents.findFirst({
    where: { organization_id: toDbId(organizationId), setup_user_id: user.id },
    select: { id: true },
  });

  if (existing) {
    return prisma.agents.update({
      where: { id: existing.id },
      data: {
        display_name: displayName,
        email: user.work_email,
        updated_at: new Date(),
      },
      select: { id: true },
    });
  }

  return prisma.agents.create({
    data: {
      organization_id: toDbId(organizationId),
      setup_user_id: user.id,
      display_name: displayName,
      email: user.work_email,
      status: agentStatus,
    },
    select: { id: true },
  });
}

/**
 * Publish accounts setup queue config into ccass operational tables.
 * Setup writes stay in accounts; routing reads only from ccass.
 */
export async function publishQueueToRouting(
  prisma: DbClient,
  organizationId: string,
  setupQueueId: string,
): Promise<void> {
  const setup = await prisma.setup_ccaas_queues.findFirst({
    where: { id: toDbId(setupQueueId), organization_id: toDbId(organizationId) },
    include: {
      setup_ccaas_queue_agents: {
        include: {
          setup_users: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              work_email: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!setup) {
    await unpublishQueueFromRouting(prisma, setupQueueId);
    return;
  }

  if (setup.status !== "active") {
    await unpublishQueueFromRouting(prisma, setupQueueId);
    return;
  }

  const now = new Date();
  await prisma.queues.upsert({
    where: { setup_queue_id: setup.id },
    create: {
      id: setup.id,
      organization_id: toDbId(organizationId),
      setup_queue_id: setup.id,
      name: setup.name,
      team_id: setup.team_id,
      business_hours_id: setup.business_hours_id,
      shift_types: setup.shift_types ?? [],
      skills: setup.skills ?? [],
      status: setup.status,
      published_at: now,
      updated_at: now,
    },
    update: {
      name: setup.name,
      team_id: setup.team_id,
      business_hours_id: setup.business_hours_id,
      shift_types: setup.shift_types ?? [],
      skills: setup.skills ?? [],
      status: setup.status,
      updated_at: now,
    },
  });

  await prisma.$executeRaw`
    INSERT INTO ccass.queue_routing_profiles (
      organization_id, queue_id, description, supported_intents, example_phrases,
      language_codes, skill_mapping, classifier_version
    )
    SELECT
      ${organizationId}::bigint,
      ${setup.id}::bigint,
      COALESCE(profile.description, ${setup.description ?? setup.name}),
      COALESCE(profile.supported_intents, '[]'::jsonb),
      COALESCE(profile.example_phrases, '[]'::jsonb),
      COALESCE(profile.language_codes, '["en"]'::jsonb),
      COALESCE(profile.skill_mapping, '{}'::jsonb),
      COALESCE(profile.classifier_version, 'v1')
    FROM (SELECT 1) singleton
    LEFT JOIN accounts.setup_queue_routing_profiles profile
      ON profile.queue_id = ${setup.id}::bigint
      AND profile.organization_id = ${organizationId}::bigint
    ON CONFLICT (queue_id) DO UPDATE
    SET
      description = EXCLUDED.description,
      supported_intents = EXCLUDED.supported_intents,
      example_phrases = EXCLUDED.example_phrases,
      language_codes = EXCLUDED.language_codes,
      skill_mapping = EXCLUDED.skill_mapping,
      classifier_version = EXCLUDED.classifier_version,
      updated_at = NOW()
  `;

  await prisma.queue_members.deleteMany({ where: { queue_id: setup.id } });

  const runtimeAgentByUserId = new Map<string, { id: bigint }>();
  const memberRows: Array<{
    queue_id: bigint;
    agent_id: bigint;
    setup_user_id: bigint;
    shift_type: string;
    handles_calls: boolean;
    handles_email: boolean;
    handles_chat: boolean;
    handles_social: boolean;
    handles_whatsapp: boolean;
    handles_instagram: boolean;
    handles_facebook: boolean;
    chat_concurrency: number;
    email_concurrency: number;
    social_concurrency: number;
    whatsapp_concurrency: number;
    instagram_concurrency: number;
    facebook_concurrency: number;
    call_type: string;
  }> = [];

  for (const row of setup.setup_ccaas_queue_agents) {
    if (row.setup_users.status !== "active") continue;

    let runtimeAgent = runtimeAgentByUserId.get(serializeEntityId(row.user_id));
    if (!runtimeAgent) {
      runtimeAgent = await ensureRuntimeAgent(prisma, organizationId, row.setup_users);
      runtimeAgentByUserId.set(serializeEntityId(row.user_id), runtimeAgent);
    }

    memberRows.push({
      queue_id: setup.id,
      agent_id: runtimeAgent.id,
      setup_user_id: row.user_id,
      shift_type: row.shift_type,
      handles_calls: row.handles_calls,
      handles_email: row.handles_email,
      handles_chat: row.handles_chat,
      handles_social: row.handles_social,
      handles_whatsapp: row.handles_whatsapp,
      handles_instagram: row.handles_instagram,
      handles_facebook: row.handles_facebook,
      chat_concurrency: row.chat_concurrency,
      email_concurrency: row.email_concurrency,
      social_concurrency: row.social_concurrency,
      whatsapp_concurrency: row.whatsapp_concurrency,
      instagram_concurrency: row.instagram_concurrency,
      facebook_concurrency: row.facebook_concurrency,
      call_type: row.call_type,
    });
  }

  if (memberRows.length > 0) {
    await prisma.queue_members.createMany({ data: memberRows });
  }

  let missedCallbackGraceMinutes: number | null = null;
  try {
    const graceRows = await prisma.$queryRaw<Array<{ grace: number | null }>>`
      SELECT missed_callback_grace_minutes AS grace
      FROM accounts.setup_ccaas_queues
      WHERE id = ${setup.id}::bigint
      LIMIT 1
    `;
    missedCallbackGraceMinutes = graceRows[0]?.grace ?? null;
  } catch {
    missedCallbackGraceMinutes = null;
  }

  await prisma.$executeRaw`
    INSERT INTO ccass.routing_policies (
      organization_id,
      queue_id,
      strategy,
      offer_timeout_seconds,
      max_attempts,
      missed_callback_grace_minutes,
      updated_at
    )
    VALUES (
      ${organizationId}::bigint,
      ${setup.id}::bigint,
      'skill_round_robin',
      20,
      3,
      ${missedCallbackGraceMinutes},
      NOW()
    )
    ON CONFLICT (queue_id) DO UPDATE
    SET
      missed_callback_grace_minutes = EXCLUDED.missed_callback_grace_minutes,
      updated_at = NOW()
  `;

}

export async function unpublishQueueFromRouting(
  prisma: DbClient,
  setupQueueId: string,
): Promise<void> {
  const queueId = toDbId(setupQueueId);
  await prisma.queue_members.deleteMany({ where: { queue_id: queueId } });
  // Keep ccass.queues rows when transfers still reference them; routing ignores inactive queues.
  await prisma.queues.updateMany({
    where: { OR: [{ id: queueId }, { setup_queue_id: queueId }] },
    data: {
      status: "inactive",
      updated_at: new Date(),
    },
  });
}

export async function publishAllQueuesForOrg(
  prisma: DbClient,
  organizationId: string,
): Promise<void> {
  const queues = await prisma.setup_ccaas_queues.findMany({
    where: { organization_id: toDbId(organizationId), status: "active" },
    select: { id: true },
  });
  for (const queue of queues) {
    await publishQueueToRouting(prisma, organizationId, serializeEntityId(queue.id));
  }
}
