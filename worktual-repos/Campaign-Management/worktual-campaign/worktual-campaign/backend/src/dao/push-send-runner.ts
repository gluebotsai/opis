// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import type { AgentPushChannel } from "../helpers/channel-ids.js";
import { MAX_PUSH_SEND_ATTEMPTS } from "../helpers/email-send-constants.js";
import { normalizeAppPushPlatform } from "../helpers/push-token.js";
import { uniquePushDestinations } from "../helpers/unique-push-destinations.js";
import { nextCampaignSendSeq } from "../helpers/send-batch-seq.js";
import { batchScheduledForBase } from "../services/campaign-send-lifecycle.js";
import type { Prisma } from "@prisma/client";

type PushDest = {
  contactId?: string | null;
  destination: string;
  platform?: string | null;
};

/**
 * Plan push/web send batches from frozen destinations.
 */
export async function planPushSendBatchesDao(
  session: CampaignSessionUser,
  campaignId: string,
  channel: AgentPushChannel,
  destinations: PushDest[],
) {
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      organizationId: session.organizationId,
      branchId: session.branchId,
    },
  });
  if (!campaign) throw new AppError("Campaign not found.", 404);

  const eligible = uniquePushDestinations(
    destinations.map((d) => {
      const destination = String(d.destination || "").trim();
      return {
        contactId: d.contactId || null,
        destination,
        platform: normalizeAppPushPlatform(d.platform, destination),
      };
    }),
  ).filter((d) => d.destination);

  if (!eligible.length) {
    throw new AppError(
      `No eligible ${channel === "push" ? "app push" : "web push"} destinations.`,
    );
  }

  let seq = await nextCampaignSendSeq({
    campaignId,
    organizationId: session.organizationId,
    channel,
  });

  const batchSize = 200;
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
        channel,
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
            platform: r.platform,
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
  const runKey = channel === "push" ? "push" : "web";
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      launchPlan: {
        ...prevPlan,
        max_send_attempts: MAX_PUSH_SEND_ATTEMPTS,
        [`${runKey}_send`]: {
          max_send_attempts: MAX_PUSH_SEND_ATTEMPTS,
          recipient_count: eligible.length,
          batch_count: created.length,
        },
      } as Prisma.InputJsonValue,
    },
  });

  return {
    campaign_id: campaignId,
    channel,
    recipient_count: eligible.length,
    batch_count: created.length,
    max_send_attempts: MAX_PUSH_SEND_ATTEMPTS,
    batches: created,
  };
}
