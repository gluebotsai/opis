import type { DbClient } from "../lib/rls.js";
import { z } from "zod";

import { entityIdSchema, serializeEntityId, toDbId, toDbIdOptional } from "../lib/id-schema.js";

export const channelQueueBindingSchema = z.object({
  routingQueueId: entityIdSchema.nullable(),
});

export async function listChannelQueueBindings(prisma: DbClient, organizationId: string) {
  const orgId = toDbId(organizationId);
  const webchats = await prisma.setup_webchat_configs.findMany({
    where: {
      setup_channel_configs: { organization_id: orgId },
    },
    select: {
      channel_config_id: true,
      webchat_id: true,
      title: true,
      routing_queue_id: true,
      setup_ccaas_queues: { select: { id: true, name: true } },
    },
  });

  const voiceDids = await prisma.setup_voice_dids.findMany({
    where: { organization_id: orgId },
    select: {
      id: true,
      phone_number: true,
      routing_queue_id: true,
      setup_ccaas_queues: { select: { id: true, name: true } },
    },
  });

  return {
    webchat: webchats.map((row) => ({
      channelConfigId: serializeEntityId(row.channel_config_id),
      webchatId: row.webchat_id,
      title: row.title,
      routingQueueId: row.routing_queue_id ? serializeEntityId(row.routing_queue_id) : null,
      queueName: row.setup_ccaas_queues?.name ?? null,
    })),
    voice: voiceDids.map((row) => ({
      id: serializeEntityId(row.id),
      didNumber: row.phone_number,
      routingQueueId: row.routing_queue_id ? serializeEntityId(row.routing_queue_id) : null,
      queueName: row.setup_ccaas_queues?.name ?? null,
    })),
  };
}

export async function updateWebchatQueueBinding(
  prisma: DbClient,
  organizationId: string,
  channelConfigId: string,
  routingQueueId: string | null,
) {
  const orgId = toDbId(organizationId);
  const configDbId = toDbId(channelConfigId);
  const config = await prisma.setup_webchat_configs.findFirst({
    where: {
      channel_config_id: configDbId,
      setup_channel_configs: { organization_id: orgId },
    },
    select: { channel_config_id: true },
  });
  if (!config) {
    throw Object.assign(new Error("Webchat channel not found"), { status: 404 });
  }

  const routingQueueDbId = toDbIdOptional(routingQueueId);
  if (routingQueueDbId != null) {
    const queue = await prisma.setup_ccaas_queues.findFirst({
      where: { id: routingQueueDbId, organization_id: orgId },
      select: { id: true },
    });
    if (!queue) {
      throw Object.assign(new Error("Queue not found"), { status: 400 });
    }
  }

  const updated = await prisma.setup_webchat_configs.update({
    where: { channel_config_id: configDbId },
    data: { routing_queue_id: routingQueueDbId ?? null, updated_at: new Date() },
    select: {
      channel_config_id: true,
      webchat_id: true,
      title: true,
      routing_queue_id: true,
    },
  });

  return {
    binding: {
      channel_config_id: serializeEntityId(updated.channel_config_id),
      webchat_id: updated.webchat_id,
      title: updated.title,
      routing_queue_id: updated.routing_queue_id
        ? serializeEntityId(updated.routing_queue_id)
        : null,
    },
  };
}

export async function updateVoiceQueueBinding(
  prisma: DbClient,
  organizationId: string,
  didId: string,
  routingQueueId: string | null,
) {
  const orgId = toDbId(organizationId);
  const didDbId = toDbId(didId);
  const did = await prisma.setup_voice_dids.findFirst({
    where: { id: didDbId, organization_id: orgId },
    select: { id: true },
  });
  if (!did) {
    throw Object.assign(new Error("Voice DID not found"), { status: 404 });
  }

  const routingQueueDbId = toDbIdOptional(routingQueueId);
  if (routingQueueDbId != null) {
    const queue = await prisma.setup_ccaas_queues.findFirst({
      where: { id: routingQueueDbId, organization_id: orgId },
      select: { id: true },
    });
    if (!queue) {
      throw Object.assign(new Error("Queue not found"), { status: 400 });
    }
  }

  const updated = await prisma.setup_voice_dids.update({
    where: { id: didDbId },
    data: { routing_queue_id: routingQueueDbId ?? null },
    select: { id: true, phone_number: true, routing_queue_id: true },
  });

  return {
    binding: {
      id: serializeEntityId(updated.id),
      phone_number: updated.phone_number,
      routing_queue_id: updated.routing_queue_id
        ? serializeEntityId(updated.routing_queue_id)
        : null,
    },
  };
}
