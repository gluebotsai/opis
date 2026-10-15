// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { assertEmailSendPipelineReady } from "../helpers/email-send-pipeline-ready.js";
import type { Prisma } from "@prisma/client";
import {
  EMAIL_BATCH_QUEUED,
  MAX_EMAIL_SEND_ATTEMPTS,
} from "../helpers/email-send-constants.js";
import { nextCampaignSendSeq } from "../helpers/send-batch-seq.js";
import { batchScheduledForBase } from "../services/campaign-send-lifecycle.js";
import {
  readEmailAbPlan,
  splitAbCounts,
  type AbVariant,
} from "../helpers/email-ab.js";
import { listEmailUnsubscribedContactIds } from "./campaign-contact-engagement.js";
import { bypassEmailSuppressionForLaunch } from "../helpers/launch-send-plan.js";

type HealthStats = {
  sent: number;
  hardBounce: number;
  complaint: number;
  windowStart: string;
};

const HARD_BOUNCE_PAUSE = 0.05;
const COMPLAINT_PAUSE = 0.003;

function emptyStats(): HealthStats {
  return {
    sent: 0,
    hardBounce: 0,
    complaint: 0,
    windowStart: new Date().toISOString(),
  };
}

function readStats(raw: unknown): HealthStats {
  if (!raw || typeof raw !== "object") return emptyStats();
  const o = raw as Record<string, unknown>;
  return {
    sent: typeof o.sent === "number" ? o.sent : 0,
    hardBounce: typeof o.hardBounce === "number" ? o.hardBounce : 0,
    complaint: typeof o.complaint === "number" ? o.complaint : 0,
    windowStart:
      typeof o.windowStart === "string"
        ? o.windowStart
        : new Date().toISOString(),
  };
}

/**
 * Plan email send batches from a frozen recipient list using tenant caps.
 * Multi-day schedule when audience exceeds daily_cap.
 */
export async function planEmailSendBatchesDao(
  session: CampaignSessionUser,
  campaignId: string,
  recipients: Array<{ contactId?: string | null; email: string }>,
) {
  await assertEmailSendPipelineReady(session);

  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      organizationId: session.organizationId,
      branchId: session.branchId,
    },
  });
  if (!campaign) throw new AppError("Campaign not found.", 404);

  const [suppressed, unsubscribedContactIds] = await Promise.all([
    prisma.emailSuppression.findMany({
      where: { organizationId: session.organizationId },
      select: { email: true },
    }),
    listEmailUnsubscribedContactIds(session.organizationId),
  ]);
  const bypassSuppression = bypassEmailSuppressionForLaunch(campaign.launchPlan);
  const blocked = new Set(suppressed.map((s) => s.email.toLowerCase()));

  const eligible = recipients
    .map((r) => ({
      contactId: r.contactId || null,
      email: r.email.trim().toLowerCase(),
    }))
    .filter((r) => {
      if (!r.email) return false;
      if (bypassSuppression) return true;
      return (
        !blocked.has(r.email) &&
        !(r.contactId && unsubscribedContactIds.has(String(r.contactId)))
      );
    });

  const prevPlanPeek =
    campaign.launchPlan && typeof campaign.launchPlan === "object"
      ? (campaign.launchPlan as Record<string, unknown>)
      : {};
  const abPlan = readEmailAbPlan(prevPlanPeek);
  const counts = splitAbCounts(eligible.length, abPlan);
  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  const withVariant: Array<{
    contactId: string | null;
    email: string;
    abVariant: AbVariant | null;
    status: "pending" | "held";
  }> = shuffled.map((r, i) => {
    if (!abPlan.enabled || (counts.b === 0 && counts.holdout === 0)) {
      return { ...r, abVariant: null, status: "pending" as const };
    }
    if (i < counts.a) {
      return { ...r, abVariant: "a" as const, status: "pending" as const };
    }
    if (i < counts.a + counts.b) {
      return { ...r, abVariant: "b" as const, status: "pending" as const };
    }
    return { ...r, abVariant: "holdout" as const, status: "held" as const };
  });

  if (!eligible.length) {
    throw new AppError("No eligible recipients after suppression filter.");
  }

  let caps = await prisma.emailSendingCaps.findUnique({
    where: { organizationId: session.organizationId },
  });
  if (!caps) {
    caps = await prisma.emailSendingCaps.create({
      data: {
        organizationId: session.organizationId,
        batchSize: 200,
        hourlyCap: 500,
        dailyCap: 1000,
        warmupStage: 0,
        healthStatus: "healthy",
      },
    });
  }

  if (caps.healthStatus === "blocked_sending") {
    throw new AppError(
      "Sending is blocked for this domain’s health. Fix deliverability before launching.",
      400,
    );
  }

  const batchSize = Math.max(1, caps.batchSize);
  const hourlyCap = Math.max(batchSize, caps.hourlyCap);
  const dailyCap = Math.max(hourlyCap, caps.dailyCap);

  let seq = await nextCampaignSendSeq({
    campaignId,
    organizationId: session.organizationId,
    channel: "email",
  });

  const now = batchScheduledForBase(campaign).getTime();
  let cursor = 0;
  let daySent = 0;
  let hourSent = 0;
  let dayOffset = 0;
  let hourOffset = 0;
  const created: Array<{ id: string; seq: number; size: number; scheduled_for: string }> =
    [];

  while (cursor < withVariant.length) {
    if (daySent >= dailyCap) {
      dayOffset += 1;
      daySent = 0;
      hourOffset = 0;
      hourSent = 0;
    }
    if (hourSent >= hourlyCap) {
      hourOffset += 1;
      hourSent = 0;
    }

    const remainingDay = dailyCap - daySent;
    const remainingHour = hourlyCap - hourSent;
    const slice = Math.min(
      batchSize,
      remainingDay,
      remainingHour,
      withVariant.length - cursor,
    );
    const chunk = withVariant.slice(cursor, cursor + slice);
    const scheduledFor = new Date(
      now + dayOffset * 24 * 60 * 60 * 1000 + hourOffset * 60 * 60 * 1000,
    );

    const batch = await prisma.campaignSendBatch.create({
      data: {
        organizationId: session.organizationId,
        campaignId,
        channel: "email",
        seq,
        scheduledFor,
        status: EMAIL_BATCH_QUEUED,
        size: chunk.length,
        recipients: {
          create: chunk.map((r) => ({
            organizationId: session.organizationId,
            campaignId,
            contactId: r.contactId,
            email: r.email,
            destination: r.email,
            status: r.status,
            abVariant: r.abVariant,
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
    daySent += slice;
    hourSent += slice;
    seq += 1;
  }

  // Persist retry policy on the campaign launch plan (worker reads max_send_attempts).
  const prevPlan =
    campaign.launchPlan && typeof campaign.launchPlan === "object"
      ? ({ ...(campaign.launchPlan as object) } as Record<string, unknown>)
      : {};
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      launchPlan: {
        ...prevPlan,
        max_send_attempts: MAX_EMAIL_SEND_ATTEMPTS,
        email_send: {
          ...(typeof prevPlan.email_send === "object" && prevPlan.email_send
            ? (prevPlan.email_send as Record<string, unknown>)
            : {}),
          max_send_attempts: MAX_EMAIL_SEND_ATTEMPTS,
          recipient_count: eligible.length,
          batch_count: created.length,
          ab_test_size_a: abPlan.enabled ? counts.a : undefined,
          ab_test_size_b: abPlan.enabled ? counts.b : undefined,
          ab_holdout_count: abPlan.enabled ? counts.holdout : undefined,
        },
      } as Prisma.InputJsonValue,
    },
  });

  return {
    campaign_id: campaignId,
    recipient_count: eligible.length,
    batch_count: created.length,
    max_send_attempts: MAX_EMAIL_SEND_ATTEMPTS,
    caps: {
      batch_size: batchSize,
      hourly_cap: hourlyCap,
      daily_cap: dailyCap,
      warmup_stage: caps.warmupStage,
    },
    batches: created,
  };
}

/** Record delivery outcomes; auto-pause campaign when thresholds breach. */
export async function recordEmailHealthEventDao(
  session: CampaignSessionUser,
  input: {
    campaignId: string;
    kind: "sent" | "hard_bounce" | "complaint";
    email?: string;
    count?: number;
  },
) {
  const n = Math.max(1, input.count ?? 1);
  const caps = await prisma.emailSendingCaps.findUnique({
    where: { organizationId: session.organizationId },
  });
  if (!caps) return { paused: false, health_status: "healthy" as const };

  const stats = readStats(caps.healthStats);
  if (input.kind === "sent") stats.sent += n;
  if (input.kind === "hard_bounce") {
    stats.hardBounce += n;
    stats.sent += n;
    if (input.email) {
      await prisma.emailSuppression.upsert({
        where: {
          organizationId_email: {
            organizationId: session.organizationId,
            email: input.email.toLowerCase(),
          },
        },
        create: {
          organizationId: session.organizationId,
          email: input.email.toLowerCase(),
          reason: "hard_bounce",
        },
        update: { reason: "hard_bounce" },
      });
    }
  }
  if (input.kind === "complaint") {
    stats.complaint += n;
    stats.sent += n;
    if (input.email) {
      await prisma.emailSuppression.upsert({
        where: {
          organizationId_email: {
            organizationId: session.organizationId,
            email: input.email.toLowerCase(),
          },
        },
        create: {
          organizationId: session.organizationId,
          email: input.email.toLowerCase(),
          reason: "complaint",
        },
        update: { reason: "complaint" },
      });
    }
  }

  const bounceRate = stats.sent > 0 ? stats.hardBounce / stats.sent : 0;
  const complaintRate = stats.sent > 0 ? stats.complaint / stats.sent : 0;
  let healthStatus = caps.healthStatus;
  let paused = false;

  if (complaintRate >= COMPLAINT_PAUSE || bounceRate >= HARD_BOUNCE_PAUSE) {
    healthStatus = "blocked_sending";
    paused = true;
    await prisma.campaignSendBatch.updateMany({
      where: {
        campaignId: input.campaignId,
        organizationId: session.organizationId,
        channel: "email",
        status: EMAIL_BATCH_QUEUED,
      },
      data: { status: "cancelled" },
    });
    // Pause email channel run state via launch_plan if campaign exists
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: input.campaignId,
        organizationId: session.organizationId,
      },
    });
    if (campaign) {
      const plan =
        campaign.launchPlan && typeof campaign.launchPlan === "object"
          ? ({ ...(campaign.launchPlan as object) } as Record<string, unknown>)
          : {};
      const runMap =
        plan.channel_run && typeof plan.channel_run === "object"
          ? ({ ...(plan.channel_run as object) } as Record<string, unknown>)
          : {};
      const prev =
        runMap.email && typeof runMap.email === "object"
          ? (runMap.email as Record<string, unknown>)
          : {};
      runMap.email = {
        ...prev,
        paused: true,
        reason: `auto_health_breach:bounce=${(bounceRate * 100).toFixed(1)}%,complaint=${(complaintRate * 100).toFixed(2)}%`,
        paused_at: new Date().toISOString(),
        sent: typeof prev.sent === "number" ? prev.sent : 0,
        failed: typeof prev.failed === "number" ? prev.failed : 0,
      };
      plan.channel_run = runMap;
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { launchPlan: plan as Prisma.InputJsonValue },
      });
    }
  } else if (complaintRate >= 0.001 || bounceRate >= 0.02) {
    healthStatus = "watch";
  } else {
    healthStatus = "healthy";
  }

  await prisma.emailSendingCaps.update({
    where: { id: caps.id },
    data: {
      healthStatus,
      healthStats: stats as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    paused,
    health_status: healthStatus,
    rates: { hard_bounce: bounceRate, complaint: complaintRate },
    stats,
  };
}
