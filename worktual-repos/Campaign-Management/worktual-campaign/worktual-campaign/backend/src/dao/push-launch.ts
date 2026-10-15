// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import {
  isPushAgentChannel,
  toAgentChannel,
  type AgentPushChannel,
} from "../helpers/channel-ids.js";
import { resolvePushDestinationsDao } from "./push-endpoints.js";
import { planPushSendBatchesDao } from "./push-send-runner.js";
import { MAX_PUSH_SEND_ATTEMPTS } from "../helpers/email-send-constants.js";
import { isStubPushDestination } from "../helpers/push-token.js";
import { uniquePushDestinations } from "../helpers/unique-push-destinations.js";
import { env } from "../config/env.js";
import { canPlanLaunchBatches } from "../helpers/launch-send-plan.js";

/**
 * After a campaign is scheduled with push/web channels, freeze destinations
 * into send batches. Safe to call repeatedly — skips if batches already exist.
 */
export async function schedulePushCampaignBatchesDao(
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

  if (!canPlanLaunchBatches(campaign.status)) {
    return { scheduled: false, reason: "not_scheduled" as const, plans: [] };
  }

  const pushChannels = campaign.channels
    .map((c) => toAgentChannel(c.channel))
    .filter((c): c is AgentPushChannel => isPushAgentChannel(c));

  const uniqueChannels = [...new Set(pushChannels)];
  if (!uniqueChannels.length) {
    return { scheduled: false, reason: "no_push_channel" as const, plans: [] };
  }

  const contactIds = campaign.audience.map((a) => a.contactId);
  const plans: unknown[] = [];
  const warnings: string[] = [];

  for (const channel of uniqueChannels) {
    const existingBatches = await prisma.campaignSendBatch.findMany({
      where: {
        campaignId,
        organizationId: session.organizationId,
        channel,
        status: { in: ["queued", "sending", "sent"] },
      },
      include: { recipients: { select: { destination: true } } },
    });
    const realPlanned = existingBatches.filter((b) =>
      b.recipients.some(
        (r) => r.destination && !isStubPushDestination(r.destination),
      ),
    );
    if (realPlanned.length > 0) {
      plans.push({
        scheduled: true,
        channel,
        reason: "already_planned",
        existing: realPlanned.length,
      });
      continue;
    }

    const destinations = uniquePushDestinations(
      await resolvePushDestinationsDao(
        session,
        channel,
        contactIds,
        { allowStubAudience: env.push.forceStub },
      ),
    );

    if (!destinations.length) {
      warnings.push(
        channel === "push"
          ? "No App Push device token for selected contacts. Register a token (Configuration → App push) or use Run test. Campaign launch does not invent stub destinations."
          : "No Web Push subscription for selected contacts. They need the same email or phone on the website with Allow notifications, or a browser subscription in Configuration → Web push.",
      );
      plans.push({
        scheduled: false,
        channel,
        reason: "no_destinations",
      });
      continue;
    }

    const covered = new Set(
      destinations.map((d) => String(d.contactId || "")).filter(Boolean),
    );
    const skipped = contactIds.filter((id) => !covered.has(String(id))).length;
    if (skipped > 0) {
      warnings.push(
        `${channel === "push" ? "App Push" : "Web Push"}: ${covered.size} of ${contactIds.length} contacts have a device token. Others skipped.`,
      );
    }

    try {
      const plan = await planPushSendBatchesDao(
        session,
        campaignId,
        channel,
        destinations,
      );
      plans.push({ scheduled: true, ...plan });
    } catch (err) {
      warnings.push(
        err instanceof Error ? err.message : `Failed to plan ${channel}`,
      );
      plans.push({
        scheduled: false,
        channel,
        reason: "plan_failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const anyScheduled = plans.some(
    (p) => p && typeof p === "object" && (p as { scheduled?: boolean }).scheduled,
  );

  return {
    scheduled: anyScheduled,
    max_send_attempts: MAX_PUSH_SEND_ATTEMPTS,
    plans,
    warnings,
  };
}
