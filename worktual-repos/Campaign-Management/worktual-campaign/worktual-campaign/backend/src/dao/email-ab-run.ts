// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { EMAIL_BATCH_QUEUED } from "../helpers/email-send-constants.js";
import {
  pickAbWinner,
  rate,
  readEmailAbPlan,
  type AbLetter,
  type AbVariantStats,
} from "../helpers/email-ab.js";

export type EmailAbStats = {
  enabled: boolean;
  winner: AbLetter | null;
  auto: boolean;
  pctA: number;
  pctB: number;
  pctHoldout: number;
  decideAfterMinutes: number;
  remainderReleased: boolean;
  variants: AbVariantStats[];
  holdout: { held: number; sent: number };
};

function emptyStats(variant: AbLetter): AbVariantStats {
  return {
    variant,
    sent: 0,
    failed: 0,
    held: 0,
    opens: 0,
    clicks: 0,
    openRate: null,
    clickRate: null,
  };
}

export async function getEmailAbStatsDao(
  campaignId: string,
  organizationId: string,
  launchPlan: unknown,
): Promise<EmailAbStats | null> {
  const plan = readEmailAbPlan(launchPlan);
  if (!plan.enabled) return null;

  const rows = await prisma.campaignSendRecipient.findMany({
    where: { campaignId, organizationId },
    select: {
      status: true,
      abVariant: true,
      openedAt: true,
      clickedAt: true,
    },
  });

  const a = emptyStats("a");
  const b = emptyStats("b");
  let holdoutHeld = 0;
  let holdoutSent = 0;
  let winnerSent = 0;

  for (const row of rows) {
    const v = String(row.abVariant || "").toLowerCase();
    const sent = row.status === "sent";
    const failed = row.status === "failed";
    const held = row.status === "held";
    if (v === "holdout") {
      if (held) holdoutHeld += 1;
      if (sent) holdoutSent += 1;
      continue;
    }
    if (v === "winner") {
      if (sent) winnerSent += 1;
      continue;
    }
    const bucket = v === "b" ? b : v === "a" ? a : null;
    if (!bucket) continue;
    if (sent) bucket.sent += 1;
    if (failed) bucket.failed += 1;
    if (held) bucket.held += 1;
    if (row.openedAt) bucket.opens += 1;
    if (row.clickedAt) bucket.clicks += 1;
  }
  a.openRate = rate(a.opens, a.sent);
  a.clickRate = rate(a.clicks, a.sent);
  b.openRate = rate(b.opens, b.sent);
  b.clickRate = rate(b.clicks, b.sent);

  const p =
    launchPlan && typeof launchPlan === "object"
      ? (launchPlan as Record<string, unknown>)
      : {};

  return {
    enabled: true,
    winner: plan.winner,
    auto: plan.auto,
    pctA: plan.pctA,
    pctB: plan.pctB,
    pctHoldout: plan.pctHoldout,
    decideAfterMinutes: plan.decideAfterMinutes,
    remainderReleased: Boolean(p.ab_remainder_released) || winnerSent > 0,
    variants: [a, b],
    holdout: { held: holdoutHeld, sent: holdoutSent + winnerSent },
  };
}

export async function resolveEmailAbWinnerDao(
  session: CampaignSessionUser,
  campaignId: string,
  opts?: { winner?: AbLetter | null; force?: boolean },
) {
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      organizationId: session.organizationId,
      branchId: session.branchId,
    },
  });
  if (!campaign) throw new AppError("Campaign not found.", 404);

  const plan = readEmailAbPlan(campaign.launchPlan);
  if (!plan.enabled) {
    throw new AppError("This campaign has no email A/B test.", 400);
  }

  const prev =
    campaign.launchPlan && typeof campaign.launchPlan === "object"
      ? ({ ...(campaign.launchPlan as object) } as Record<string, unknown>)
      : {};

  if (prev.ab_remainder_released && !opts?.force) {
    return {
      ok: true,
      already: true,
      winner: plan.winner,
      message: "Remainder already sent.",
    };
  }

  const stats = await getEmailAbStatsDao(
    campaignId,
    session.organizationId,
    campaign.launchPlan,
  );
  const a = stats?.variants.find((v) => v.variant === "a") || emptyStats("a");
  const b = stats?.variants.find((v) => v.variant === "b") || emptyStats("b");

  const testDone =
    a.sent + a.failed >= Math.max(1, a.sent + a.failed + 0) &&
    a.sent + a.failed > 0 &&
    b.sent + b.failed > 0 &&
    (await prisma.campaignSendRecipient.count({
      where: {
        campaignId,
        organizationId: session.organizationId,
        abVariant: { in: ["a", "b"] },
        status: "pending",
      },
    })) === 0;

  if (!opts?.force && !testDone) {
    throw new AppError(
      "A/B test slice is still sending. Wait until A and B finish, or pick a winner now.",
      409,
    );
  }

  let winner: AbLetter = opts?.winner || plan.winner || pickAbWinner(a, b);
  if (opts?.winner) winner = opts.winner;

  const held = await prisma.campaignSendRecipient.updateMany({
    where: {
      campaignId,
      organizationId: session.organizationId,
      status: "held",
      abVariant: "holdout",
    },
    data: {
      status: "pending",
      abVariant: "winner",
    },
  });

  await prisma.campaignSendBatch.updateMany({
    where: {
      campaignId,
      organizationId: session.organizationId,
      channel: "email",
      status: { in: [EMAIL_BATCH_QUEUED, "sending", "sent"] },
    },
    data: { status: EMAIL_BATCH_QUEUED },
  });

  // Re-queue batches that still have pending (winner) recipients.
  const batches = await prisma.campaignSendBatch.findMany({
    where: { campaignId, organizationId: session.organizationId, channel: "email" },
    include: { recipients: { select: { status: true } } },
  });
  for (const batch of batches) {
    const pending = batch.recipients.some((r) => r.status === "pending");
    if (pending && (batch.status === "sent" || batch.status === "sending")) {
      await prisma.campaignSendBatch.update({
        where: { id: batch.id },
        data: { status: EMAIL_BATCH_QUEUED },
      });
    }
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      launchPlan: {
        ...prev,
        ab_winner: winner,
        ab_remainder_released: true,
        ab_winner_picked_at: new Date().toISOString(),
        ab_winner_reason:
          opts?.winner
            ? "manual_pick"
            : a.opens + b.opens + a.clicks + b.clicks > 0
              ? "open_click_rate"
              : "fallback_no_opens_yet",
      } as Prisma.InputJsonValue,
    },
  });

  return {
    ok: true,
    winner,
    remainder: held.count,
    stats: { a, b },
    message: `Winner ${winner.toUpperCase()}. Remainder (${held.count}) queued to send.`,
  };
}

/** Worker: auto-pick winner when test slice is done and decide window elapsed (or signal exists). */
export async function maybeAutoResolveEmailAbWinner(
  campaignId: string,
  organizationId: string,
  branchId: string,
) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
  });
  if (!campaign) return null;
  const plan = readEmailAbPlan(campaign.launchPlan);
  if (!plan.enabled || !plan.auto || plan.winner) return null;
  const prev =
    campaign.launchPlan && typeof campaign.launchPlan === "object"
      ? (campaign.launchPlan as Record<string, unknown>)
      : {};
  if (prev.ab_remainder_released) return null;

  const pendingTest = await prisma.campaignSendRecipient.count({
    where: {
      campaignId,
      organizationId,
      abVariant: { in: ["a", "b"] },
      status: "pending",
    },
  });
  if (pendingTest > 0) return null;

  const testSent = await prisma.campaignSendRecipient.findMany({
    where: {
      campaignId,
      organizationId,
      abVariant: { in: ["a", "b"] },
      status: { in: ["sent", "failed"] },
    },
    select: { updatedAt: true, openedAt: true, clickedAt: true },
  });
  if (!testSent.length) return null;

  const hasSignal = testSent.some((r) => r.openedAt || r.clickedAt);
  const last = testSent.reduce(
    (m, r) => (r.updatedAt > m ? r.updatedAt : m),
    testSent[0].updatedAt,
  );
  const elapsedMin = (Date.now() - last.getTime()) / 60_000;
  if (!hasSignal && elapsedMin < plan.decideAfterMinutes) return null;

  return resolveEmailAbWinnerDao(
    {
      id: "00000000-0000-4000-8000-000000000099",
      email: "worker@local",
      name: "Email worker",
      role: "system",
      initials: "EW",
      organizationId,
      branchId,
      orgName: "system",
    },
    campaignId,
    { force: true },
  );
}

/** Worker tick: auto-pick winners whose test slice + decide window are done. */
export async function scanPendingEmailAbWinners(log?: {
  warn: (obj: unknown, msg?: string) => void;
}) {
  const campaigns = await prisma.campaign.findMany({
    where: { status: { in: ["live", "scheduled"] } },
    select: { id: true, organizationId: true, branchId: true, launchPlan: true },
  });
  let resolved = 0;
  for (const row of campaigns) {
    const plan = readEmailAbPlan(row.launchPlan);
    if (!plan.enabled || !plan.auto || plan.winner) continue;
    const prev =
      row.launchPlan && typeof row.launchPlan === "object"
        ? (row.launchPlan as Record<string, unknown>)
        : {};
    if (prev.ab_remainder_released) continue;
    try {
      const result = await maybeAutoResolveEmailAbWinner(
        row.id,
        row.organizationId,
        row.branchId,
      );
      if (result) resolved += 1;
    } catch (err) {
      log?.warn?.(
        { err, campaignId: row.id },
        "Email A/B auto-winner scan skipped",
      );
    }
  }
  return resolved;
}
