// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { prisma } from "../plugins/prisma.js";
import {
  normalizeTimezone,
  utcFromLocalParts,
} from "../helpers/campaign-timezone.js";
import { isLaunchSendPlanningOpen } from "../helpers/launch-send-plan.js";
import { EMAIL_BATCH_QUEUED } from "../helpers/email-send-constants.js";
import { logCampaignId } from "../helpers/send-log-id.js";
import { touchDashboardMetrics } from "../helpers/dashboard-metrics-cache.js";

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

function lifecycleCtx(
  campaignId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    event: "campaign_lifecycle",
    campaignId: logCampaignId(campaignId),
    ...extra,
  };
}

export async function isCampaignCancelled(campaignId: string): Promise<boolean> {
  const row = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  });
  return String(row?.status || "").toLowerCase() === "cancelled";
}

/** If the campaign was stopped, cancel this batch and skip remaining pending recipients. */
export async function abortBatchIfCampaignStopped(
  batchId: string,
  campaignId: string,
  log: Logger,
): Promise<boolean> {
  if (!(await isCampaignCancelled(campaignId))) return false;
  await prisma.campaignSendBatch.update({
    where: { id: batchId },
    data: { status: "cancelled" },
  });
  await prisma.campaignSendRecipient.updateMany({
    where: { batchId, status: "pending" },
    data: { status: "skipped", skipFailReason: "campaign_stopped" },
  });
  log.info(
    lifecycleCtx(campaignId, { batchId }),
    "[campaign-lifecycle] abort batch — campaign cancelled",
  );
  return true;
}

function parseInstant(raw: unknown): Date | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const t = Date.parse(raw.trim());
  if (!Number.isNaN(t)) return new Date(t);
  return null;
}

/**
 * Resolve campaign launch instant (UTC) from startsAt, local fields,
 * launchPlan.scheduled_at, or earliest channel plannedLaunchAt.
 */
export function resolveCampaignLaunchAt(row: {
  startsAt: Date | null;
  timezone?: string | null;
  launchLocalDate?: string | null;
  launchLocalTime?: string | null;
  launchPlan?: unknown;
  channels?: Array<{ plannedLaunchAt?: string | Date | null }>;
}): Date | null {
  if (row.startsAt && !Number.isNaN(row.startsAt.getTime())) {
    return row.startsAt;
  }

  const date = row.launchLocalDate?.trim() || "";
  const time = (row.launchLocalTime?.trim() || "00:00").slice(0, 5);
  if (date) {
    const tz = normalizeTimezone(row.timezone);
    const fromLocal = utcFromLocalParts(
      date,
      time.length === 5 ? time : "00:00",
      tz,
    );
    if (fromLocal) return fromLocal;
  }

  if (row.launchPlan && typeof row.launchPlan === "object") {
    const plan = row.launchPlan as Record<string, unknown>;
    const fromPlan =
      parseInstant(plan.scheduled_at) ||
      parseInstant(plan.scheduledAt) ||
      parseInstant(plan.starts_at);
    if (fromPlan) return fromPlan;
  }

  let earliest: Date | null = null;
  for (const ch of row.channels || []) {
    const d = parseInstant(ch.plannedLaunchAt ?? null);
    if (!d) continue;
    if (!earliest || d.getTime() < earliest.getTime()) earliest = d;
  }
  return earliest;
}

/** First-batch send instant: future startsAt for schedule_mode=at, otherwise now. */
export function batchScheduledForBase(row: {
  startsAt?: Date | null;
  launchPlan?: unknown;
}): Date {
  const now = Date.now();
  const plan =
    row.launchPlan && typeof row.launchPlan === "object"
      ? (row.launchPlan as Record<string, unknown>)
      : {};
  const mode = String(plan.schedule_mode || "").toLowerCase();
  const starts =
    row.startsAt && !Number.isNaN(row.startsAt.getTime())
      ? row.startsAt.getTime()
      : null;
  if (mode === "at" && starts && starts > now) {
    return new Date(starts);
  }
  if (starts && starts > now + 5_000) {
    return new Date(starts);
  }
  return new Date(now);
}

async function loadSendCounts(campaignId: string) {
  const [
    sendingBatches,
    queuedBatches,
    pendingRecipients,
    processedRecipients,
    totalBatches,
  ] = await Promise.all([
    prisma.campaignSendBatch.count({
      where: { campaignId, status: "sending" },
    }),
    prisma.campaignSendBatch.count({
      where: { campaignId, status: { in: ["queued", EMAIL_BATCH_QUEUED] } },
    }),
    prisma.campaignSendRecipient.count({
      where: { campaignId, status: "pending" },
    }),
    prisma.campaignSendRecipient.count({
      where: {
        campaignId,
        status: { in: ["sent", "failed", "skipped"] },
      },
    }),
    prisma.campaignSendBatch.count({ where: { campaignId } }),
  ]);
  return {
    sendingBatches,
    queuedBatches,
    pendingRecipients,
    processedRecipients,
    totalBatches,
  };
}

type CampaignLifecycleRow = {
  id: string;
  status: string;
  endsAt: Date | null;
  startsAt: Date | null;
  createdAt?: Date | null;
  audienceCount?: number | null;
  timezone: string | null;
  launchLocalDate: string | null;
  launchLocalTime: string | null;
  launchPlan: unknown;
  channels: Array<{
    plannedLaunchAt?: string | Date | null;
    channel?: string | null;
  }>;
};

async function setStatus(
  campaignId: string,
  status: "scheduled" | "live" | "completed",
  extra: { startsAt?: Date; endsAt?: Date | null } = {},
  priorStatus?: string,
) {
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      status,
      ...(extra.startsAt ? { startsAt: extra.startsAt } : {}),
      ...(extra.endsAt !== undefined ? { endsAt: extra.endsAt } : {}),
    },
  });
  try {
    await syncLinkedDraftSessionStatus(campaignId, status);
  } catch {
    /* never block lifecycle on draft-tag sync */
  }
  try {
    const { notifyCampaignStatusChange } = await import(
      "./app-notifications.js"
    );
    await notifyCampaignStatusChange({
      campaignId,
      status,
      priorStatus,
    });
  } catch {
    /* never block lifecycle on notifications */
  }
}

/**
 * Keep Drafts list tags aligned with Campaign.status.
 * Session payload ui.status is set at launch and otherwise goes stale.
 */
export async function syncLinkedDraftSessionStatus(
  campaignId: string,
  status: "scheduled" | "live" | "completed",
): Promise<boolean> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { sessionId: true },
  });
  if (!campaign?.sessionId) return false;

  const row = await prisma.campaignAgentSession.findUnique({
    where: { id: campaign.sessionId },
    select: { id: true, payload: true, stage: true },
  });
  if (!row) return false;

  const payload =
    row.payload &&
    typeof row.payload === "object" &&
    !Array.isArray(row.payload)
      ? { ...(row.payload as Record<string, unknown>) }
      : {};
  const ui =
    payload.ui && typeof payload.ui === "object" && !Array.isArray(payload.ui)
      ? { ...(payload.ui as Record<string, unknown>) }
      : {};

  const uiStatus = String(ui.status || "").toLowerCase();
  const stage = String(row.stage || "").toLowerCase();
  if (uiStatus === status && stage === status) return false;

  ui.status = status;
  payload.ui = ui;
  await prisma.campaignAgentSession.update({
    where: { id: row.id },
    data: { payload, stage: status },
  });
  return true;
}

function scheduleModeOf(launchPlan: unknown): string {
  if (!launchPlan || typeof launchPlan !== "object") return "";
  return String(
    (launchPlan as Record<string, unknown>).schedule_mode || "",
  )
    .trim()
    .toLowerCase();
}

/** Launch-later path (or legacy mid-send Live that should stay Scheduled). */
function isFutureScheduleLaunch(launchPlan: unknown): boolean {
  const mode = scheduleModeOf(launchPlan);
  return mode === "at" || mode === "later" || mode === "schedule";
}

/**
 * Drafts / monitoring lifecycle (send-activity based):
 * - Launch now → starts Live; stays Live while launching / retrying bounces;
 *   becomes Completed when selected contacts + retries are done and launch time has passed.
 * - Launch later → starts Scheduled; stays Scheduled through the wait, the send,
 *   and retries; becomes Completed when selected contacts + retries are done and
 *   the scheduled time has passed (does not flip to Live mid-process).
 * - Empty launch (due, no batches/sends, non-email) → Completed.
 */
export async function reconcileCampaignSendLifecycle(
  campaignId: string,
  log: Logger,
) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      endsAt: true,
      startsAt: true,
      timezone: true,
      launchLocalDate: true,
      launchLocalTime: true,
      launchPlan: true,
      createdAt: true,
      audienceCount: true,
      channels: { select: { plannedLaunchAt: true, channel: true } },
    },
  });
  if (!campaign) return;
  if (String(campaign.status).toLowerCase() === "draft") return;
  if (String(campaign.status).toLowerCase() === "cancelled") return;

  await applyLifecycleTransition(campaign, log);
  await touchDashboardMetrics(campaign.organizationId).catch(() => undefined);
}

async function applyLifecycleTransition(
  campaign: CampaignLifecycleRow,
  log: Logger,
) {
  const campaignId = campaign.id;
  const status = String(campaign.status).toLowerCase();
  const counts = await loadSendCounts(campaignId);

  /** Still actively launching (includes contacts waiting for retry ≤ 3). */
  const activelySending =
    counts.sendingBatches > 0 ||
    counts.queuedBatches > 0 ||
    counts.pendingRecipients > 0;

  /** At least one contact reached a terminal send state. */
  const sendStarted =
    counts.processedRecipients > 0 || counts.totalBatches > 0;

  /** Launch complete: had send activity and nothing left to try. */
  const launchComplete = sendStarted && !activelySending;

  const launchAt = resolveCampaignLaunchAt(campaign);
  const now = Date.now();
  const launchFuture = launchAt != null && launchAt.getTime() > now;
  const launchDue = launchAt == null || launchAt.getTime() <= now;

  const startsPatch =
    !campaign.startsAt && launchAt ? { startsAt: launchAt } : {};

  /** Future-schedule path keeps Scheduled until Completed (never Live mid-send).
   *  Also repairs older rows wrongly flipped Scheduled → Live. */
  const keepScheduled =
    status === "scheduled" ||
    (status === "live" && isFutureScheduleLaunch(campaign.launchPlan));

  // 1) Waiting for scheduled datetime → Scheduled (even if batches exist for later)
  if (launchFuture) {
    if (status !== "scheduled") {
      await setStatus(
        campaignId,
        "scheduled",
        {
          ...startsPatch,
          endsAt: null,
        },
        status,
      );
      log.info(
        lifecycleCtx(campaignId, {
          launchAt: launchAt!.toISOString(),
          priorStatus: status,
        }),
        "[campaign-lifecycle] marked scheduled (waiting for launch datetime)",
      );
    } else {
      if (!campaign.startsAt && launchAt) {
        await prisma.campaign
          .update({ where: { id: campaignId }, data: { startsAt: launchAt } })
          .catch(() => undefined);
      }
      await syncLinkedDraftSessionStatus(campaignId, "scheduled").catch(
        () => undefined,
      );
    }
    return;
  }

  // 2) Actively sending / retrying
  //    - Live (launch now): stay Live
  //    - Scheduled (future launch): stay Scheduled until fully done
  if (activelySending) {
    if (keepScheduled) {
      if (status !== "scheduled") {
        await setStatus(campaignId, "scheduled", startsPatch, status);
        log.info(
          lifecycleCtx(campaignId, { ...counts, priorStatus: status }),
          "[campaign-lifecycle] repaired to scheduled (future-launch send/retries in progress)",
        );
      } else if (!campaign.startsAt && launchAt) {
        await prisma.campaign
          .update({ where: { id: campaignId }, data: { startsAt: launchAt } })
          .catch(() => undefined);
        await syncLinkedDraftSessionStatus(campaignId, "scheduled").catch(
          () => undefined,
        );
      } else {
        await syncLinkedDraftSessionStatus(campaignId, "scheduled").catch(
          () => undefined,
        );
      }
      log.info(
        lifecycleCtx(campaignId, { ...counts }),
        "[campaign-lifecycle] kept scheduled (sending/retries in progress)",
      );
      return;
    }
    if (status !== "live") {
      await setStatus(campaignId, "live", startsPatch, status);
      log.info(
        lifecycleCtx(campaignId, { ...counts, priorStatus: status }),
        "[campaign-lifecycle] marked live (actively sending; failed contacts retry up to 3×)",
      );
    } else {
      if (!campaign.startsAt && launchAt) {
        await prisma.campaign
          .update({ where: { id: campaignId }, data: { startsAt: launchAt } })
          .catch(() => undefined);
      }
      await syncLinkedDraftSessionStatus(campaignId, "live").catch(
        () => undefined,
      );
    }
    return;
  }

  const planningOpen = isLaunchSendPlanningOpen({
    createdAt: campaign.createdAt,
    launchPlan: campaign.launchPlan,
    channelKeys: (campaign.channels || []).map((c) =>
      String(c.channel || ""),
    ),
  });
  // 2b) Selected channels still being frozen into batches — keep current tag.
  //     Do not Complete just because email finished (or no batches exist yet).
  if (planningOpen && launchDue) {
    if (keepScheduled) {
      if (status !== "scheduled") {
        await setStatus(campaignId, "scheduled", startsPatch, status);
        log.info(
          lifecycleCtx(campaignId, { priorStatus: status }),
          "[campaign-lifecycle] repaired to scheduled (send planning still in progress)",
        );
      } else {
        await syncLinkedDraftSessionStatus(campaignId, "scheduled").catch(
          () => undefined,
        );
      }
      log.info(
        lifecycleCtx(campaignId),
        "[campaign-lifecycle] kept scheduled (send planning still in progress)",
      );
      return;
    }
    if (status !== "live") {
      await setStatus(campaignId, "live", startsPatch, status);
      log.info(
        lifecycleCtx(campaignId, { priorStatus: status }),
        "[campaign-lifecycle] kept live (send planning still in progress)",
      );
    } else {
      await syncLinkedDraftSessionStatus(campaignId, "live").catch(
        () => undefined,
      );
    }
    return;
  }

  // 3) All contacts finished (sent or failed after max retries) and launch time due → Completed
  if (launchComplete && launchDue) {
    if (status !== "completed") {
      await setStatus(
        campaignId,
        "completed",
        {
          ...startsPatch,
          endsAt: new Date(),
        },
        status,
      );
      log.info(
        lifecycleCtx(campaignId, {
          processedRecipients: counts.processedRecipients,
          priorStatus: status,
        }),
        "[campaign-lifecycle] marked completed (launch finished after sends/retries)",
      );
    } else {
      await syncLinkedDraftSessionStatus(campaignId, "completed").catch(
        () => undefined,
      );
    }
    return;
  }

  // 4) Launch time reached, planning done, nothing sent and nothing queued.
  //    Email campaigns with an audience must not flip to Completed with zero batches —
  //    that usually means planning failed; keep Live (or Scheduled) so ops/retry can recover.
  if (launchDue && !activelySending && !sendStarted) {
    const channelKeys = (campaign.channels || []).map((c) =>
      String(c.channel || "").toLowerCase(),
    );
    const expectsEmail =
      channelKeys.includes("email") && Number(campaign.audienceCount || 0) > 0;
    if (expectsEmail) {
      if (keepScheduled) {
        if (status !== "scheduled") {
          await setStatus(campaignId, "scheduled", startsPatch, status);
          log.info(
            lifecycleCtx(campaignId, {
              launchAt: launchAt?.toISOString() ?? null,
              priorStatus: status,
            }),
            "[campaign-lifecycle] repaired to scheduled (email audience present but no send batches yet)",
          );
        } else {
          await syncLinkedDraftSessionStatus(campaignId, "scheduled").catch(
            () => undefined,
          );
        }
        log.info(
          lifecycleCtx(campaignId, {
            launchAt: launchAt?.toISOString() ?? null,
          }),
          "[campaign-lifecycle] kept scheduled (email audience present but no send batches yet)",
        );
        return;
      }
      if (status !== "live") {
        await setStatus(campaignId, "live", startsPatch, status);
        log.info(
          lifecycleCtx(campaignId, {
            launchAt: launchAt?.toISOString() ?? null,
            priorStatus: status,
          }),
          "[campaign-lifecycle] kept live (email audience present but no send batches yet)",
        );
      } else {
        await syncLinkedDraftSessionStatus(campaignId, "live").catch(
          () => undefined,
        );
      }
      return;
    }
    if (status !== "completed") {
      await setStatus(
        campaignId,
        "completed",
        {
          ...startsPatch,
          endsAt: new Date(),
        },
        status,
      );
      log.info(
        lifecycleCtx(campaignId, {
          launchAt: launchAt?.toISOString() ?? null,
          priorStatus: status,
        }),
        "[campaign-lifecycle] marked completed (launch due with no send data)",
      );
    } else {
      await syncLinkedDraftSessionStatus(campaignId, "completed").catch(
        () => undefined,
      );
    }
    return;
  }

  // 5) Fallback: not started → Scheduled
  if (status !== "scheduled" && !sendStarted && !activelySending) {
    await setStatus(campaignId, "scheduled", startsPatch, status);
    log.info(
      lifecycleCtx(campaignId, { priorStatus: status }),
      "[campaign-lifecycle] marked scheduled (not started)",
    );
  } else if (status === "scheduled") {
    await syncLinkedDraftSessionStatus(campaignId, "scheduled").catch(
      () => undefined,
    );
  }
}

/**
 * Promote / complete from send activity; repair misclassified rows.
 * Scheduled stays Scheduled through send/retry; Live stays Live until done.
 */
export async function promoteDueCampaignLifecycles(log: Logger): Promise<number> {
  const now = new Date();
  const candidates = await prisma.campaign.findMany({
    where: {
      OR: [
        { status: { in: ["scheduled", "live"] } },
        // Waiting to launch but wrongly completed
        { status: "completed", startsAt: { gt: now } },
      ],
    },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      createdAt: true,
      timezone: true,
      launchLocalDate: true,
      launchLocalTime: true,
      launchPlan: true,
      channels: { select: { plannedLaunchAt: true, channel: true } },
      audienceCount: true,
    },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    take: 400,
  });

  let touched = 0;
  for (const row of candidates) {
    try {
      const before = row.status;
      await applyLifecycleTransition(row, log);
      const after = await prisma.campaign.findUnique({
        where: { id: row.id },
        select: { status: true },
      });
      if (after && after.status !== before) touched += 1;
    } catch (err) {
      log.warn({ err, campaignId: row.id }, "Campaign lifecycle promote failed");
    }
  }
  return touched;
}

/** Startup: reconcile + promote overdue / idle live campaigns + sync Draft tags. */
export async function backfillCampaignSendLifecycles(log: Logger) {
  const withBatches = await prisma.campaign.findMany({
    where: {
      status: { in: ["live", "scheduled"] },
      sendBatches: { some: {} },
    },
    select: { id: true },
    take: 500,
  });
  for (const row of withBatches) {
    try {
      await reconcileCampaignSendLifecycle(row.id, log);
    } catch (err) {
      log.warn({ err, campaignId: row.id }, "Lifecycle backfill failed");
    }
  }

  const promoted = await promoteDueCampaignLifecycles(log);

  // One-time / startup: align agent-session ui.status with Campaign.status for Drafts.
  const linked = await prisma.campaign.findMany({
    where: {
      sessionId: { not: null },
      status: { in: ["live", "scheduled", "completed"] },
    },
    select: { id: true, status: true },
    take: 500,
  });
  let draftTagsSynced = 0;
  for (const row of linked) {
    const status = String(row.status || "").toLowerCase();
    if (status !== "live" && status !== "scheduled" && status !== "completed") {
      continue;
    }
    try {
      const changed = await syncLinkedDraftSessionStatus(
        row.id,
        status as "live" | "scheduled" | "completed",
      );
      if (changed) draftTagsSynced += 1;
    } catch (err) {
      log.warn({ err, campaignId: row.id }, "Draft tag sync failed");
    }
  }

  log.info(
    { withBatches: withBatches.length, promoted, draftTagsSynced },
    "Campaign send lifecycle backfill finished",
  );
}
