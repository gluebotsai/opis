// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { listContactEmailsByIdsDao } from "./contact.js";
import { planEmailSendBatchesDao } from "./email-send-runner.js";
import {
  EMAIL_BATCH_QUEUED,
  MAX_EMAIL_SEND_ATTEMPTS,
} from "../helpers/email-send-constants.js";
import {
  canPlanLaunchBatches,
  readAudienceCdpLookupIds,
} from "../helpers/launch-send-plan.js";

/**
 * After a campaign is scheduled with an email channel, freeze recipients into
 * send batches (respecting caps). Safe to call repeatedly — skips if queued
 * batches already exist.
 *
 * Launch lifecycle:
 * - status stays scheduled until the worker starts sending
 * - failed recipients are retried up to MAX_EMAIL_SEND_ATTEMPTS
 * - when all are sent or permanently failed → completed (Past)
 */
export async function scheduleEmailCampaignBatchesDao(
  session: CampaignSessionUser,
  campaignId: string,
) {
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      organizationId: session.organizationId,
      branchId: session.branchId,
    },
    include: {
      channels: true,
      audience: { select: { contactId: true } },
    },
  });
  if (!campaign) throw new AppError("Campaign not found.", 404);

  const emailChannel = campaign.channels.find(
    (c) => c.channel.toLowerCase() === "email",
  );
  if (!emailChannel) {
    return { scheduled: false, reason: "no_email_channel" as const };
  }

  if (!canPlanLaunchBatches(campaign.status)) {
    return { scheduled: false, reason: "not_scheduled" as const };
  }

  const existing = await prisma.campaignSendBatch.count({
    where: {
      campaignId,
      organizationId: session.organizationId,
      channel: "email",
      status: { in: [EMAIL_BATCH_QUEUED, "sending", "sent"] },
    },
  });
  if (existing > 0) {
    return { scheduled: false, reason: "already_planned" as const, existing };
  }

  // Re-launch after suppression/plan failure: drop failed-only batches so a new
  // audience or recipient can be planned (nextCampaignSendSeq also clears queued/failed).
  await prisma.campaignSendBatch.deleteMany({
    where: {
      campaignId,
      organizationId: session.organizationId,
      channel: "email",
      status: "failed",
    },
  });

  const contactIds = campaign.audience.map((a) => a.contactId);
  const cdpLookupIds = readAudienceCdpLookupIds(campaign.launchPlan);
  const lookupIds = cdpLookupIds.length
    ? [...new Set([...cdpLookupIds, ...contactIds.map(String)])]
    : contactIds;
  const recipients = await listContactEmailsByIdsDao(session, lookupIds, {
    skipOpaqueFallback: cdpLookupIds.length > 0,
  });
  if (!recipients.length) {
    return {
      scheduled: false,
      reason: "no_destinations" as const,
      skipped: contactIds.length,
    };
  }

  const plan = await planEmailSendBatchesDao(
    session,
    campaignId,
    recipients.map((r) => ({ contactId: r.contactId, email: r.email })),
  );

  return {
    scheduled: true as const,
    plan,
    queued: recipients.length,
    skipped: Math.max(0, contactIds.length - recipients.length),
    max_send_attempts: MAX_EMAIL_SEND_ATTEMPTS,
  };
}
