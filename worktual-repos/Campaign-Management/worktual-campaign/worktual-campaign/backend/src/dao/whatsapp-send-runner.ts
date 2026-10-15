// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { MAX_WHATSAPP_SEND_ATTEMPTS } from "../helpers/email-send-constants.js";
import { nextCampaignSendSeq } from "../helpers/send-batch-seq.js";
import { batchScheduledForBase } from "../services/campaign-send-lifecycle.js";
import { phoneToWhatsAppTo } from "../helpers/whatsapp-template-map.js";

export type WhatsAppDest = {
  contactId: string;
  phone: string;
};

/**
 * Plan WhatsApp send batches (1 or N recipients). destination = digits-only phone.
 */
export async function planWhatsAppSendBatchesDao(
  session: CampaignSessionUser,
  campaignId: string,
  destinations: WhatsAppDest[],
) {
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      organizationId: session.organizationId,
      branchId: session.branchId,
    },
  });
  if (!campaign) throw new AppError("Campaign not found.", 404);

  const eligible = destinations
    .map((d) => ({
      contactId: d.contactId,
      destination: phoneToWhatsAppTo(d.phone),
    }))
    .filter(
      (d): d is { contactId: string; destination: string } =>
        Boolean(d.destination),
    );

  if (!eligible.length) {
    throw new AppError(
      "No eligible WhatsApp phone numbers in the selected audience.",
      400,
    );
  }

  let seq = await nextCampaignSendSeq({
    campaignId,
    organizationId: session.organizationId,
    channel: "whatsapp",
  });

  const batchSize = 100;
  const now = batchScheduledForBase(campaign).getTime();
  let cursor = 0;
  const created: Array<{
    id: string;
    seq: number;
    size: number;
    scheduled_for: string;
  }> = [];

  while (cursor < eligible.length) {
    const slice = Math.min(batchSize, eligible.length - cursor);
    const chunk = eligible.slice(cursor, cursor + slice);
    const scheduledFor = new Date(now);
    const batch = await prisma.campaignSendBatch.create({
      data: {
        organizationId: session.organizationId,
        campaignId,
        channel: "whatsapp",
        seq,
        scheduledFor,
        status: "queued",
        size: chunk.length,
        recipients: {
          create: chunk.map((r) => ({
            organizationId: session.organizationId,
            campaignId,
            contactId: r.contactId,
            email: null,
            destination: r.destination,
            platform: "whatsapp",
            status: "pending",
          })),
        },
      },
    });

    created.push({
      id: String(batch.id),
      seq,
      size: chunk.length,
      scheduled_for: scheduledFor.toISOString(),
    });
    cursor += slice;
    seq += 1;
  }

  const prevPlan =
    campaign.launchPlan && typeof campaign.launchPlan === "object"
      ? ({ ...(campaign.launchPlan as object) } as Record<string, unknown>)
      : {};

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      launchPlan: {
        ...prevPlan,
        max_send_attempts: MAX_WHATSAPP_SEND_ATTEMPTS,
        whatsapp_send: {
          max_send_attempts: MAX_WHATSAPP_SEND_ATTEMPTS,
          recipient_count: eligible.length,
          batch_count: created.length,
        },
      } as Prisma.InputJsonValue,
    },
  });

  return {
    campaign_id: campaignId,
    channel: "whatsapp" as const,
    recipient_count: eligible.length,
    batch_count: created.length,
    max_send_attempts: MAX_WHATSAPP_SEND_ATTEMPTS,
    batches: created,
  };
}
