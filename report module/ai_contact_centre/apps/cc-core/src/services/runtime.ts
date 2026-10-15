import type { DbClient } from "../lib/rls.js";
import { serializeEntityId, toDbId } from "../lib/id-schema.js";
import { asStringArray } from "./queues-helpers.js";

/**
 * Runtime routing reads operational data from ccass only.
 * Agent presence is read from PostgreSQL, the UMN-owned authority.
 */
export async function listRuntimeQueues(prisma: DbClient, organizationId: string) {
  const queues = await prisma.queues.findMany({
    where: { organization_id: toDbId(organizationId), status: "active" },
    orderBy: { name: "asc" },
    include: {
      queue_members: {
        include: {
          agents: {
            include: {
              agent_presence: true,
            },
          },
        },
      },
    },
  });

  return {
    queues: await Promise.all(
      queues.map(async (queue) => ({
        id: serializeEntityId(queue.id),
        setupQueueId: serializeEntityId(queue.setup_queue_id),
        name: queue.name,
        teamId: serializeEntityId(queue.team_id),
        businessHoursId: queue.business_hours_id
          ? serializeEntityId(queue.business_hours_id)
          : null,
        shiftTypes: asStringArray(queue.shift_types),
        skills: asStringArray(queue.skills),
        agents: await Promise.all(
          queue.queue_members.map(async (row) => ({
            agentId: serializeEntityId(row.agent_id),
            userId: serializeEntityId(row.setup_user_id),
            shiftType: row.shift_type,
            presence:
              row.agents.agent_presence?.presence_state ??
              row.agents.agent_presence?.status ??
              "offline",
            handlesCalls: row.handles_calls,
            handlesChat: row.handles_chat,
            handlesEmail: row.handles_email,
            handlesWhatsapp: row.handles_whatsapp,
            handlesInstagram: row.handles_instagram,
            handlesFacebook: row.handles_facebook,
            chatConcurrency: row.chat_concurrency,
            emailConcurrency: row.email_concurrency,
            whatsappConcurrency: row.whatsapp_concurrency,
            instagramConcurrency: row.instagram_concurrency,
            facebookConcurrency: row.facebook_concurrency,
            callType: row.call_type,
          })),
        ),
      })),
    ),
  };
}

export async function getRuntimeQueue(
  prisma: DbClient,
  organizationId: string,
  queueId: string,
) {
  const queueDbId = toDbId(queueId);
  const queue = await prisma.queues.findFirst({
    where: {
      organization_id: toDbId(organizationId),
      OR: [{ id: queueDbId }, { setup_queue_id: queueDbId }],
      status: "active",
    },
    include: {
      queue_members: {
        include: {
          agents: { include: { agent_presence: true } },
        },
      },
    },
  });

  if (!queue) {
    throw Object.assign(new Error("Queue not found in routing layer"), { status: 404 });
  }

  return {
    queue: {
      id: serializeEntityId(queue.id),
      setupQueueId: serializeEntityId(queue.setup_queue_id),
      name: queue.name,
      teamId: serializeEntityId(queue.team_id),
      businessHoursId: queue.business_hours_id
        ? serializeEntityId(queue.business_hours_id)
        : null,
      shiftTypes: asStringArray(queue.shift_types),
      skills: asStringArray(queue.skills),
      agents: await Promise.all(
        queue.queue_members.map(async (row) => ({
          agentId: serializeEntityId(row.agent_id),
          userId: serializeEntityId(row.setup_user_id),
          shiftType: row.shift_type,
          presence:
            row.agents.agent_presence?.presence_state ??
            row.agents.agent_presence?.status ??
            "offline",
          handlesCalls: row.handles_calls,
          handlesChat: row.handles_chat,
          handlesEmail: row.handles_email,
          handlesWhatsapp: row.handles_whatsapp,
          handlesInstagram: row.handles_instagram,
          handlesFacebook: row.handles_facebook,
          chatConcurrency: row.chat_concurrency,
          emailConcurrency: row.email_concurrency,
          whatsappConcurrency: row.whatsapp_concurrency,
          instagramConcurrency: row.instagram_concurrency,
          facebookConcurrency: row.facebook_concurrency,
          callType: row.call_type,
        })),
      ),
    },
  };
}

export async function syncSetupUserToRuntimeAgent(
  prisma: DbClient,
  organizationId: string,
  userId: string,
) {
  const user = await prisma.setup_users.findFirst({
    where: { id: toDbId(userId), organization_id: toDbId(organizationId) },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      work_email: true,
      status: true,
    },
  });
  if (!user) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }

  const displayName = `${user.first_name} ${user.last_name}`.trim() || user.work_email;
  const existing = await prisma.agents.findFirst({
    where: { organization_id: toDbId(organizationId), setup_user_id: user.id },
    select: { id: true },
  });

  if (existing) {
    const updated = await prisma.agents.update({
      where: { id: existing.id },
      data: {
        display_name: displayName,
        email: user.work_email,
        updated_at: new Date(),
      },
    });
    return { agent: updated };
  }

  const created = await prisma.agents.create({
    data: {
      organization_id: toDbId(organizationId),
      setup_user_id: user.id,
      display_name: displayName,
      email: user.work_email,
      status: "offline",
    },
  });

  return { agent: created };
}
