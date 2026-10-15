// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { CampaignStatus, Prisma } from "@prisma/client";
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { contactIdForCampaign, toStableDbId } from "../helpers/id-schema.js";
import {
  DEFAULT_LAUNCH_TIMEZONE,
  ensureLaunchScheduleFields,
  normalizeTimezone,
  utcFromLocalParts,
} from "../helpers/campaign-timezone.js";
import { promoteDueCampaignLifecycles } from "../services/campaign-send-lifecycle.js";
import { toAgentChannel } from "../helpers/channel-ids.js";
import {
  isIsolatedLaunchPlan,
  onDemandLaunchPlanPrismaFilter,
  personalisedCrmLaunchPlanPrismaFilter,
} from "../helpers/launch-send-plan.js";
import {
  buildCampaignMetricTotals,
  engagementRatesForChannel,
  loadCampaignMetricsMap,
  loadLiveSendCountsByCampaign,
  type CampaignMetricTotals,
} from "./campaign-metrics.js";
import { getEmailAbStatsDao } from "./email-ab-run.js";
import { campaignTenantWhere } from "../helpers/campaign-visibility.js";

let lastListLifecyclePromoteAt = 0;
const LIST_LIFECYCLE_PROMOTE_MIN_MS = 5_000;

const silentLifecycleLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

async function maybePromoteDueOnList(bucket: MonitorBucket) {
  if (
    bucket !== "live" &&
    bucket !== "scheduled" &&
    bucket !== "past" &&
    bucket !== "calendar"
  ) {
    return;
  }
  const now = Date.now();
  if (now - lastListLifecyclePromoteAt < LIST_LIFECYCLE_PROMOTE_MIN_MS) {
    return;
  }
  lastListLifecyclePromoteAt = now;
  try {
    await promoteDueCampaignLifecycles(silentLifecycleLog);
  } catch {
    /* listing should not fail if promote fails */
  }
}

export type CampaignListItem = {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  launchLocalDate: string | null;
  launchLocalTime: string | null;
  sourceChannel: string;
  createdAt: string;
  goal: string | null;
  objective: string | null;
  audienceSummary: string | null;
  audienceCount: number;
  sent: number;
  failed: number;
  stubSent?: number;
  /** Delivered messages — denominator for engagement rates. */
  delivered: number;
  /** Unique openers / clickers. */
  opens: number;
  clicks: number;
  /** Open / click hits including repeats. */
  totalOpens: number;
  totalClicks: number;
  /** unique email opens / email delivered, or null when no email delivered */
  openRate: number | null;
  /** unique clicks / delivered on email + app push + web push */
  clickRate: number | null;
  /** unique email clicks / unique email opens, or null when nobody opened */
  ctor: number | null;
  /** PPC synthetic / live metrics (0 when no ads channel). */
  impressions: number;
  spend: number;
  conversions: number;
  currency: string | null;
  hasPpc: boolean;
  /** Channel ids launched on this campaign (email, sms, ppc, …). */
  channels: string[];
  /** Per-channel metrics (live sends when available, else channel_run). */
  channelMetrics: Array<{
    channel: string;
    selected: number;
    sent: number;
    failed: number;
    bounced: number;
    delivered: number;
    stubSent?: number;
    opens: number;
    clicks: number;
    totalOpens: number;
    totalClicks: number;
    impressions: number;
    spend: number;
    conversions: number;
    currency: string | null;
    openRate: number | null;
    clickRate: number | null;
    ctor: number | null;
    fromLiveSends: boolean;
  }>;
  /** Email-only engagement denominators for dashboard KPIs. */
  emailSent: number;
  emailOpens: number;
  emailClicks: number;
};

function channelMetricsFromTotals(totals: CampaignMetricTotals) {
  return totals.channels.map((ch) => ({
    channel: ch.channel,
    selected: ch.selected,
    sent: ch.sent,
    failed: ch.failed,
    bounced: ch.bounced,
    delivered: ch.delivered,
    stubSent: ch.stubSent,
    opens: ch.opens,
    clicks: ch.clicks,
    totalOpens: ch.totalOpens,
    totalClicks: ch.totalClicks,
    impressions: ch.impressions,
    spend: ch.spend,
    conversions: ch.conversions,
    currency: ch.currency,
    ...engagementRatesForChannel(ch.channel, {
      delivered: ch.delivered,
      opens: ch.opens,
      clicks: ch.clicks,
    }),
    fromLiveSends: ch.fromLiveSends,
  }));
}

function toItem(
  row: {
    id: string;
    name: string;
    description: string | null;
    status: CampaignStatus;
    startsAt: Date | null;
    endsAt: Date | null;
    timezone?: string | null;
    launchLocalDate?: string | null;
    launchLocalTime?: string | null;
    sourceChannel: string;
    createdAt: Date;
    audienceCount: number;
    launchPlan: unknown;
    channels?: Array<{ channel: string }>;
  },
  metrics?: CampaignMetricTotals | null,
): CampaignListItem {
  const totals =
    metrics ||
    buildCampaignMetricTotals(
      row.launchPlan,
      (row.channels || []).map((c) => c.channel),
    );
  const schedule = ensureLaunchScheduleFields({
    startsAt: row.startsAt,
    timezone: row.timezone ?? null,
    launchLocalDate: row.launchLocalDate ?? null,
    launchLocalTime: row.launchLocalTime ?? null,
  });
  const channelIds = (row.channels || [])
    .map((c) => toAgentChannel(String(c.channel || "")))
    .filter(Boolean);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    timezone: schedule.timezone,
    launchLocalDate: schedule.launchLocalDate,
    launchLocalTime: schedule.launchLocalTime,
    sourceChannel: row.sourceChannel,
    createdAt: row.createdAt.toISOString(),
    goal: row.goal ?? null,
    objective: row.objective ?? null,
    audienceSummary: row.audienceSummary ?? null,
    audienceCount: row.audienceCount,
    sent: totals.sent,
    failed: totals.failed,
    stubSent: totals.stubSent,
    delivered: totals.delivered,
    opens: totals.opens,
    clicks: totals.clicks,
    totalOpens: totals.totalOpens,
    totalClicks: totals.totalClicks,
    openRate: totals.openRate,
    clickRate: totals.clickRate,
    ctor: totals.ctor,
    impressions: totals.impressions,
    spend: totals.spend,
    conversions: totals.conversions,
    currency: totals.currency,
    hasPpc: totals.hasPpc,
    channels: channelIds,
    channelMetrics: channelMetricsFromTotals(totals),
    emailSent: totals.emailSent,
    emailOpens: totals.emailOpens,
    emailClicks: totals.emailClicks,
  };
}

export type CreateCampaignInput = {
  name: string;
  description?: string | null;
  goal?: string | null;
  objective?: string | null;
  status?: CampaignStatus;
  startsAt?: string | null;
  endsAt?: string | null;
};

export type SaveCampaignFromSessionChannel = {
  channel: string;
  template_id?: string | null;
  how_it_works?: string | null;
  planned_launch_at?: string | null;
  status?: string | null;
};

export type SaveCampaignFromSessionInput = {
  name: string;
  goal?: string | null;
  objective?: string | null;
  description?: string | null;
  audience_summary?: string | null;
  audience_filters?: Record<string, unknown> | null;
  audience_count?: number | null;
  channels: SaveCampaignFromSessionChannel[];
  /** Optional override; defaults to session audience refs. */
  contact_ids?: string[] | null;
  status?: CampaignStatus;
  launch_plan?: Record<string, unknown> | null;
  starts_at?: string | null;
  timezone?: string | null;
  launch_local_date?: string | null;
  launch_local_time?: string | null;
};

export async function createCampaignDao(
  session: CampaignSessionUser,
  input: CreateCampaignInput,
) {
  const name = input.name.trim();
  if (!name) throw new AppError("Campaign name is required.");

  const startsAt = input.startsAt ? new Date(input.startsAt) : null;
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (startsAt && Number.isNaN(startsAt.getTime())) {
    throw new AppError("Invalid start date.");
  }
  if (endsAt && Number.isNaN(endsAt.getTime())) {
    throw new AppError("Invalid end date.");
  }
  if (startsAt && endsAt && endsAt < startsAt) {
    throw new AppError("End date must be after start date.");
  }

  let status: CampaignStatus = input.status ?? "draft";
  if (!input.status) {
    const now = new Date();
    // Stay scheduled until the send worker starts (then live → completed).
    if (startsAt) status = "scheduled";
    else if (endsAt && endsAt < now) status = "completed";
  }

  const created = await prisma.campaign.create({
    data: {
      organizationId: session.organizationId,
      branchId: session.branchId,
      name,
      description: input.description?.trim() || null,
      goal: input.goal?.trim() || null,
      objective: input.objective?.trim() || null,
      status,
      startsAt,
      endsAt,
      sourceChannel: "standalone_campaign",
      createdByUserId: session.id,
    },
    select: { id: true },
  });

  return { id: created.id };
}

/**
 * Persist campaign + all channels + frozen audience when templates are saved.
 * Upserts by session_id so re-running CREATE_TEMPLATES updates the same campaign.
 */
export async function saveCampaignFromSessionDao(
  session: CampaignSessionUser,
  sessionId: string,
  input: SaveCampaignFromSessionInput,
) {
  const name = input.name.trim();
  if (!name) throw new AppError("Campaign name is required.");

  const agentSession = await prisma.campaignAgentSession.findFirst({
    where: {
      id: sessionId,
      organizationId: session.organizationId,
      createdByUserId: session.id,
    },
    include: { audienceRefs: { select: { contactId: true } } },
  });
  if (!agentSession) {
    throw new AppError("Campaign session not found.", 404);
  }

  const contactIds = [
    ...new Set(
      (input.contact_ids?.length
        ? input.contact_ids
        : agentSession.audienceRefs.map((r) => r.contactId)
      )
        .filter(Boolean)
        .map((id) => contactIdForCampaign(String(id))),
    ),
  ];

  const launching = ["live", "scheduled"].includes(
    String(input.status || "").toLowerCase(),
  );
  if (launching && !contactIds.length) {
    throw new AppError(
      "Cannot launch with an empty audience. Re-select contacts and try again.",
      400,
    );
  }

  const channels = (input.channels || [])
    .map((c) => ({
      channel: toAgentChannel(String(c.channel || "")),
      templateId: c.template_id?.trim()
        ? toStableDbId(c.template_id.trim())
        : null,
      howItWorks: c.how_it_works?.trim() || null,
      plannedLaunchAt: c.planned_launch_at?.trim() || null,
      status: c.status?.trim() || "ready",
    }))
    .filter((c) => c.channel);

  if (!channels.length) {
    throw new AppError("At least one channel is required.");
  }

  const audienceFilters =
    input.audience_filters === undefined
      ? undefined
      : input.audience_filters === null
        ? undefined
        : (input.audience_filters as Prisma.InputJsonValue);
  const launchPlan =
    input.launch_plan === undefined
      ? undefined
      : input.launch_plan === null
        ? undefined
        : (input.launch_plan as Prisma.InputJsonValue);
  const audienceSummary = input.audience_summary?.trim() || null;
  const audienceCount =
    contactIds.length > 0
      ? contactIds.length
      : typeof input.audience_count === "number" && input.audience_count >= 0
        ? input.audience_count
        : 0;
  const startsAt = input.starts_at ? new Date(input.starts_at) : undefined;
  const startsAtValid =
    startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt : undefined;

  const timezone = normalizeTimezone(
    input.timezone ||
      (typeof input.launch_plan?.timezone === "string"
        ? input.launch_plan.timezone
        : null),
  );
  let launchLocalDate =
    input.launch_local_date?.trim() ||
    (typeof input.launch_plan?.launch_local_date === "string"
      ? String(input.launch_plan.launch_local_date).trim()
      : "") ||
    null;
  let launchLocalTime =
    input.launch_local_time?.trim() ||
    (typeof input.launch_plan?.launch_local_time === "string"
      ? String(input.launch_plan.launch_local_time).trim()
      : "") ||
    null;

  let resolvedStartsAt = startsAtValid ?? null;
  if (!resolvedStartsAt && launchLocalDate && launchLocalTime) {
    resolvedStartsAt = utcFromLocalParts(
      launchLocalDate,
      launchLocalTime,
      timezone,
    );
  }
  if (resolvedStartsAt && (!launchLocalDate || !launchLocalTime)) {
    const filled = ensureLaunchScheduleFields({
      startsAt: resolvedStartsAt,
      timezone,
      launchLocalDate,
      launchLocalTime,
    });
    launchLocalDate = filled.launchLocalDate;
    launchLocalTime = filled.launchLocalTime;
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.campaign.findFirst({
      where: {
        sessionId,
        organizationId: session.organizationId,
      },
    });

    const scheduleData = {
      timezone,
      launchLocalDate,
      launchLocalTime,
      ...(resolvedStartsAt ? { startsAt: resolvedStartsAt } : {}),
    };

    const campaign = existing
      ? await tx.campaign.update({
          where: { id: existing.id },
          data: {
            name,
            description: input.description?.trim() || null,
            goal: input.goal?.trim() || null,
            objective: input.objective?.trim() || null,
            audienceSummary,
            ...(audienceFilters !== undefined ? { audienceFilters } : {}),
            ...(launchPlan !== undefined ? { launchPlan } : {}),
            ...scheduleData,
            audienceCount,
            status: input.status ?? existing.status,
          },
        })
      : await tx.campaign.create({
          data: {
            organizationId: session.organizationId,
            branchId: session.branchId,
            sessionId,
            name,
            description: input.description?.trim() || null,
            goal: input.goal?.trim() || null,
            objective: input.objective?.trim() || null,
            audienceSummary,
            audienceFilters,
            launchPlan,
            audienceCount,
            status: input.status ?? "draft",
            startsAt: resolvedStartsAt,
            timezone,
            launchLocalDate,
            launchLocalTime,
            sourceChannel: "standalone_campaign",
            createdByUserId: session.id,
          },
        });

    await tx.campaignChannel.deleteMany({ where: { campaignId: campaign.id } });
    if (channels.length) {
      await tx.campaignChannel.createMany({
        data: channels.map((c) => ({
          organizationId: session.organizationId,
          campaignId: campaign.id,
          channel: c.channel,
          templateId: c.templateId,
          howItWorks: c.howItWorks,
          plannedLaunchAt: c.plannedLaunchAt,
          status: c.status,
        })),
      });
    }

    await tx.campaignAudience.deleteMany({ where: { campaignId: campaign.id } });
    if (contactIds.length) {
      await tx.campaignAudience.createMany({
        data: contactIds.map((contactId) => ({
          campaignId: campaign.id,
          contactId,
        })),
        skipDuplicates: true,
      });
    }

    return {
      id: campaign.id,
      channel_count: channels.length,
      audience_count: contactIds.length,
    };
  });

  return result;
}

export type MonitorBucket =
  | "live"
  | "scheduled"
  | "past"
  | "draft"
  | "all"
  | "calendar";

export type ListCampaignsOptions = {
  bucket: MonitorBucket;
  /** Inclusive local date YYYY-MM-DD (interpreted in each campaign timezone / IST). */
  fromDate?: string | null;
  /** Inclusive local date YYYY-MM-DD. */
  toDate?: string | null;
  /** Preset relative windows in IST when from/to omitted. */
  relative?: "today" | "yesterday" | "last_7_days" | "last_month" | null;
  /** Skip send-metrics overlay (calendar / quick lists). */
  lite?: boolean;
};

function statusFilterForBucket(bucket: MonitorBucket): CampaignStatus[] | null {
  if (bucket === "live") return ["live"];
  if (bucket === "scheduled") return ["scheduled"];
  if (bucket === "calendar") return ["live", "scheduled", "completed"];
  if (bucket === "draft") return ["draft"];
  if (bucket === "past") return ["completed", "cancelled"];
  return null; // all — includes drafts (agent / totals); UI panels may filter
}

function localDateInZone(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return ensureLaunchScheduleFields({
    startsAt: d,
    timezone: timeZone,
    launchLocalDate: null,
    launchLocalTime: null,
  }).launchLocalDate;
}

function istTodayParts(): { today: string; monthStart: string } {
  const filled = ensureLaunchScheduleFields({
    startsAt: new Date(),
    timezone: DEFAULT_LAUNCH_TIMEZONE,
    launchLocalDate: null,
    launchLocalTime: null,
  });
  const today = filled.launchLocalDate || "";
  const [y, m] = today.split("-");
  return { today, monthStart: `${y}-${m}-01` };
}

function shiftLocalDate(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d + days);
  const dt = new Date(utc);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Milliseconds for monitoring list sort (local launch fields, else starts/ends, else created). */
function campaignSortMs(item: {
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  launchLocalDate?: string | null;
  launchLocalTime?: string | null;
}): number {
  const localDate = item.launchLocalDate?.trim() || "";
  if (localDate) {
    const time = (item.launchLocalTime?.trim() || "00:00").slice(0, 5);
    const isoLocal = `${localDate}T${time.length === 5 ? time : "00:00"}:00`;
    const fromLocal = Date.parse(isoLocal);
    if (!Number.isNaN(fromLocal)) return fromLocal;
  }
  for (const raw of [item.startsAt, item.endsAt, item.createdAt]) {
    if (!raw) continue;
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function sortCampaignItemsForBucket(
  items: ReturnType<typeof toItem>[],
  bucket: MonitorBucket,
): ReturnType<typeof toItem>[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    if (bucket === "scheduled") {
      // Soonest launch first
      const diff = campaignSortMs(a) - campaignSortMs(b);
      if (diff !== 0) return diff;
      return a.createdAt.localeCompare(b.createdAt);
    }
    if (bucket === "past") {
      // Most recently finished first
      const aEnd = a.endsAt ? Date.parse(a.endsAt) : campaignSortMs(a);
      const bEnd = b.endsAt ? Date.parse(b.endsAt) : campaignSortMs(b);
      const aMs = Number.isNaN(aEnd) ? campaignSortMs(a) : aEnd;
      const bMs = Number.isNaN(bEnd) ? campaignSortMs(b) : bEnd;
      const diff = bMs - aMs;
      if (diff !== 0) return diff;
      return b.createdAt.localeCompare(a.createdAt);
    }
    // live | draft | all — newest launch / activity first
    const diff = campaignSortMs(b) - campaignSortMs(a);
    if (diff !== 0) return diff;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return sorted;
}

function prismaOrderForBucket(
  bucket: MonitorBucket,
):
  | [{ startsAt: "asc" }, { createdAt: "asc" }]
  | [{ endsAt: "desc" }, { startsAt: "desc" }, { createdAt: "desc" }]
  | [{ startsAt: "desc" }, { createdAt: "desc" }] {
  if (bucket === "scheduled") {
    return [{ startsAt: "asc" }, { createdAt: "asc" }];
  }
  if (bucket === "past") {
    return [{ endsAt: "desc" }, { startsAt: "desc" }, { createdAt: "desc" }];
  }
  return [{ startsAt: "desc" }, { createdAt: "desc" }];
}

export async function listCampaignsByBucketDao(
  session: CampaignSessionUser,
  bucketOrOpts: MonitorBucket | ListCampaignsOptions,
) {
  const opts: ListCampaignsOptions =
    typeof bucketOrOpts === "string"
      ? { bucket: bucketOrOpts }
      : bucketOrOpts;

  await maybePromoteDueOnList(opts.bucket);

  const statusFilter = statusFilterForBucket(opts.bucket);
  const limit = opts.bucket === "calendar" ? 400 : 200;
  // Oversample so JS filter can drop on-demand rows without under-filling the page.
  // (Prisma NOT + JSON path treats missing keys as SQL NULL and empties the list.)
  const fetchTake = limit + 40;

  const fetched = await prisma.campaign.findMany({
    where: {
      ...campaignTenantWhere(session),
      ...(statusFilter ? { status: { in: statusFilter } } : {}),
    },
    include: { channels: { select: { channel: true } } },
    orderBy: prismaOrderForBucket(opts.bucket),
    take: fetchTake,
  });
  const rows = fetched
    .filter((r) => !isIsolatedLaunchPlan(r.launchPlan))
    .slice(0, limit);

  // Backfill missing timezone / local fields (IST) without blocking the response.
  const needingBackfill = rows.filter((r) => {
    const e = ensureLaunchScheduleFields({
      startsAt: r.startsAt,
      timezone: (r as { timezone?: string | null }).timezone ?? null,
      launchLocalDate:
        (r as { launchLocalDate?: string | null }).launchLocalDate ?? null,
      launchLocalTime:
        (r as { launchLocalTime?: string | null }).launchLocalTime ?? null,
    });
    return e.needsBackfill;
  });
  if (needingBackfill.length) {
    void Promise.all(
      needingBackfill.map(async (r) => {
        const e = ensureLaunchScheduleFields({
          startsAt: r.startsAt,
          timezone: (r as { timezone?: string | null }).timezone ?? null,
          launchLocalDate:
            (r as { launchLocalDate?: string | null }).launchLocalDate ?? null,
          launchLocalTime:
            (r as { launchLocalTime?: string | null }).launchLocalTime ?? null,
        });
        try {
          await prisma.campaign.update({
            where: { id: r.id },
            data: {
              timezone: e.timezone,
              launchLocalDate: e.launchLocalDate,
              launchLocalTime: e.launchLocalTime,
            },
          });
        } catch {
          /* ignore race / missing columns during migrate */
        }
      }),
    );
  }

  let items = rows.map((row) => toItem(row));

  if (!opts.lite) {
    // Overlay live send-recipient counts (batch) so list metrics match reality.
    try {
      const metricsMap = await loadCampaignMetricsMap(rows);
      items = rows.map((row) => toItem(row, metricsMap.get(row.id) || null));
    } catch {
      /* keep channel_run-only totals if send tables unreachable */
    }
  }

  let fromDate = opts.fromDate?.trim() || null;
  let toDate = opts.toDate?.trim() || null;
  if (opts.relative) {
    const { today, monthStart } = istTodayParts();
    if (opts.relative === "today") {
      fromDate = today;
      toDate = today;
    } else if (opts.relative === "yesterday") {
      const y = shiftLocalDate(today, -1);
      fromDate = y;
      toDate = y;
    } else if (opts.relative === "last_7_days") {
      fromDate = shiftLocalDate(today, -6);
      toDate = today;
    } else if (opts.relative === "last_month") {
      const [y, m] = today.split("-").map(Number);
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? y - 1 : y;
      const lastDay = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
      fromDate = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
      toDate = `${prevY}-${String(prevM).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    }
  }

  if (fromDate || toDate) {
    items = items.filter((item) => {
      const local =
        item.launchLocalDate ||
        localDateInZone(item.startsAt, item.timezone) ||
        localDateInZone(item.createdAt, item.timezone);
      if (!local) return false;
      if (fromDate && local < fromDate) return false;
      if (toDate && local > toDate) return false;
      return true;
    });
  }

  // Stable bucket sort using local date/time when startsAt is null/missing.
  return sortCampaignItemsForBucket(items, opts.bucket);
}

export async function getDashboardCountsDao(session: CampaignSessionUser) {
  const tenant = campaignTenantWhere(session);

  async function countExcludingIsolated(
    status: CampaignStatus | { in: CampaignStatus[] },
  ): Promise<number> {
    const whereBase = { ...tenant, status };
    const [all, onDemand, personalisedCrm] = await Promise.all([
      prisma.campaign.count({ where: whereBase }),
      prisma.campaign.count({
        where: { ...whereBase, ...onDemandLaunchPlanPrismaFilter },
      }),
      prisma.campaign.count({
        where: { ...whereBase, ...personalisedCrmLaunchPlanPrismaFilter },
      }),
    ]);
    return Math.max(0, all - onDemand - personalisedCrm);
  }

  const [live, scheduled, draft, past, onDemand, personalisedCrm] =
    await Promise.all([
      countExcludingIsolated("live"),
      countExcludingIsolated("scheduled"),
      countExcludingIsolated("draft"),
      countExcludingIsolated({ in: ["completed", "cancelled"] }),
      prisma.campaign.count({
        where: {
          ...tenant,
          ...onDemandLaunchPlanPrismaFilter,
        },
      }),
      prisma.campaign.count({
        where: {
          ...tenant,
          ...personalisedCrmLaunchPlanPrismaFilter,
        },
      }),
    ]);

  return { live, scheduled, draft, past, onDemand, personalisedCrm };
}

export type CampaignChannelRunState = {
  paused: boolean;
  reason: string | null;
  selected: number;
  sent: number;
  failed: number;
  bounced: number;
  opens: number;
  clicks: number;
  /** ISO time when channel was paused; used for alert retention. */
  pausedAt: string | null;
  /** PPC / ads outcomes (synthetic or live). */
  network: string | null;
  impressions: number;
  spend: number;
  currency: string | null;
  conversions: number;
  dailyBudget: number | null;
  planSummary: string | null;
};

export type CampaignDetail = {
  id: string;
  name: string;
  description: string | null;
  goal: string | null;
  objective: string | null;
  status: CampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  launchLocalDate: string | null;
  launchLocalTime: string | null;
  audienceCount: number;
  audienceSummary: string | null;
  stubSent?: number;
  launchPlan: Record<string, unknown> | null;
  sourceChannel: string;
  createdAt: string;
  channels: Array<{
    id: string;
    channel: string;
    howItWorks: string | null;
    plannedLaunchAt: string | null;
    status: string;
    templateId: string | null;
    totalToSend: number;
    selected: number;
    sent: number;
    failed: number;
    bounced: number;
    delivered: number;
    stubSent?: number;
    opens: number;
    clicks: number;
    totalOpens: number;
    totalClicks: number;
    openRate: number | null;
    clickRate: number | null;
    ctor: number | null;
    paused: boolean;
    pauseReason: string | null;
    pausedAt: string | null;
    network: string | null;
    impressions: number;
    spend: number;
    currency: string | null;
    conversions: number;
    dailyBudget: number | null;
    planSummary: string | null;
    ctr: number | null;
    cpc: number | null;
    cpa: number | null;
    fromLiveSends?: boolean;
  }>;
  sent?: number;
  failed?: number;
  delivered?: number;
  opens?: number;
  clicks?: number;
  totalOpens?: number;
  totalClicks?: number;
  openRate?: number | null;
  clickRate?: number | null;
  ctor?: number | null;
  emailSent?: number;
  emailOpens?: number;
  emailClicks?: number;
  emailAb?: unknown;
};

function readChannelRun(
  launchPlan: unknown,
  channel: string,
): CampaignChannelRunState {
  const plan =
    launchPlan && typeof launchPlan === "object"
      ? (launchPlan as Record<string, unknown>)
      : {};
  const run =
    plan.channel_run && typeof plan.channel_run === "object"
      ? (plan.channel_run as Record<string, unknown>)
      : {};
  const key = toAgentChannel(channel);
  const aliases = [key, channel.toLowerCase()];
  if (key === "push") aliases.push("app_push", "app-push");
  if (key === "web") aliases.push("web_push", "web-push");
  let row: Record<string, unknown> = {};
  for (const alias of aliases) {
    if (run[alias] && typeof run[alias] === "object") {
      row = run[alias] as Record<string, unknown>;
      break;
    }
  }
  return {
    paused: Boolean(row.paused),
    reason: typeof row.reason === "string" ? row.reason : null,
    selected:
      typeof row.selected === "number"
        ? row.selected
        : typeof row.recipient_count === "number"
          ? row.recipient_count
          : 0,
    sent: typeof row.sent === "number" ? row.sent : 0,
    failed: typeof row.failed === "number" ? row.failed : 0,
    bounced: typeof row.bounced === "number" ? row.bounced : 0,
    opens: typeof row.opens === "number" ? row.opens : 0,
    clicks: typeof row.clicks === "number" ? row.clicks : 0,
    pausedAt: typeof row.paused_at === "string" ? row.paused_at : null,
    network: typeof row.network === "string" ? row.network : null,
    impressions: typeof row.impressions === "number" ? row.impressions : 0,
    spend: typeof row.spend === "number" ? row.spend : 0,
    currency: typeof row.currency === "string" ? row.currency : null,
    conversions: typeof row.conversions === "number" ? row.conversions : 0,
    dailyBudget:
      typeof row.daily_budget === "number"
        ? row.daily_budget
        : typeof row.dailyBudget === "number"
          ? row.dailyBudget
          : null,
    planSummary:
      typeof row.plan_summary === "string"
        ? row.plan_summary
        : typeof row.planSummary === "string"
          ? row.planSummary
          : null,
  };
}

const CHANNEL_ORDER = ["email", "sms", "whatsapp", "push", "web", "ppc"];

export async function getCampaignByIdDao(
  session: CampaignSessionUser,
  campaignId: string,
): Promise<CampaignDetail> {
  const row = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      ...campaignTenantWhere(session),
    },
    include: { channels: true },
  });
  if (!row) throw new AppError("Campaign not found.", 404);

  const channelsSorted = [...row.channels].sort((a, b) => {
    const ai = CHANNEL_ORDER.indexOf(a.channel.toLowerCase());
    const bi = CHANNEL_ORDER.indexOf(b.channel.toLowerCase());
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  const totalToSend = row.audienceCount || 0;
  const schedule = ensureLaunchScheduleFields({
    startsAt: row.startsAt,
    timezone: (row as { timezone?: string | null }).timezone ?? null,
    launchLocalDate:
      (row as { launchLocalDate?: string | null }).launchLocalDate ?? null,
    launchLocalTime:
      (row as { launchLocalTime?: string | null }).launchLocalTime ?? null,
  });
  if (schedule.needsBackfill) {
    void prisma.campaign
      .update({
        where: { id: row.id },
        data: {
          timezone: schedule.timezone,
          launchLocalDate: schedule.launchLocalDate,
          launchLocalTime: schedule.launchLocalTime,
        },
      })
      .catch(() => undefined);
  }
  const liveMap = await loadLiveSendCountsByCampaign([row.id]).catch(
    () => new Map(),
  );
  const metrics = buildCampaignMetricTotals(
    row.launchPlan,
    channelsSorted.map((c) => c.channel),
    liveMap.get(row.id) || null,
    row.audienceCount || 0,
  );
  const metricByChannel = new Map(
    metrics.channels.map((c) => [c.channel, c]),
  );

  const channels = channelsSorted.map((c) => {
    const key = toAgentChannel(c.channel);
    const run = readChannelRun(row.launchPlan, key);
    const live = metricByChannel.get(key);
    const paused =
      run.paused || c.status.toLowerCase() === "paused";
    const isPpc = key === "ppc";
    const sent = live?.sent ?? run.sent;
    const failed = live?.failed ?? run.failed;
    const bounced = live?.bounced ?? run.bounced;
    const selected = live?.selected ?? run.selected ?? totalToSend;
    const opens = live?.opens ?? run.opens;
    const clicks = live?.clicks ?? run.clicks;
    const totalOpens = live?.totalOpens ?? opens;
    const totalClicks = live?.totalClicks ?? clicks;
    const impressions = live?.impressions ?? run.impressions;
    const spend = live?.spend ?? run.spend;
    const conversions = live?.conversions ?? run.conversions;
    const currency = live?.currency ?? run.currency;
    return {
      id: c.id,
      channel: key || c.channel,
      howItWorks: c.howItWorks,
      plannedLaunchAt: c.plannedLaunchAt,
      status: paused ? "paused" : c.status,
      templateId: c.templateId,
      totalToSend: isPpc ? impressions : totalToSend,
      selected: isPpc ? impressions : selected,
      sent,
      failed,
      bounced,
      delivered: live?.delivered ?? Math.max(0, sent),
      stubSent: live?.stubSent ?? 0,
      opens,
      clicks,
      totalOpens,
      totalClicks,
      ...engagementRatesForChannel(key || c.channel, {
        delivered: live?.delivered ?? Math.max(0, sent),
        opens,
        clicks,
      }),
      paused,
      pauseReason: run.reason,
      pausedAt: run.pausedAt,
      network: live?.network ?? run.network,
      impressions,
      spend,
      currency,
      conversions,
      dailyBudget: run.dailyBudget,
      planSummary: run.planSummary,
      ctr: impressions > 0 ? clicks / impressions : null,
      cpc: clicks > 0 ? spend / clicks : null,
      cpa: conversions > 0 ? spend / conversions : null,
      fromLiveSends: live?.fromLiveSends ?? false,
    };
  });

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    goal: row.goal,
    objective: row.objective,
    status: row.status,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    timezone: schedule.timezone,
    launchLocalDate: schedule.launchLocalDate,
    launchLocalTime: schedule.launchLocalTime,
    audienceCount: row.audienceCount,
    audienceSummary: row.audienceSummary,
    stubSent: metrics.stubSent,
    launchPlan:
      row.launchPlan && typeof row.launchPlan === "object"
        ? (row.launchPlan as Record<string, unknown>)
        : null,
    sourceChannel: row.sourceChannel,
    createdAt: row.createdAt.toISOString(),
    channels,
    sent: metrics.sent,
    failed: metrics.failed,
    delivered: metrics.delivered,
    opens: metrics.opens,
    clicks: metrics.clicks,
    totalOpens: metrics.totalOpens,
    totalClicks: metrics.totalClicks,
    openRate: metrics.openRate,
    clickRate: metrics.clickRate,
    ctor: metrics.ctor,
    emailSent: metrics.emailSent,
    emailOpens: metrics.emailOpens,
    emailClicks: metrics.emailClicks,
    emailAb: await getEmailAbStatsDao(
      row.id,
      session.organizationId,
      row.launchPlan,
    ).catch(() => null),
  };
}

export async function setCampaignChannelRunStateDao(
  session: CampaignSessionUser,
  campaignId: string,
  channel: string,
  input: { paused: boolean; reason?: string | null },
): Promise<CampaignDetail> {
  const ch = channel.trim().toLowerCase();
  if (!ch) throw new AppError("channel required");

  const row = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      ...campaignTenantWhere(session),
    },
    include: { channels: true },
  });
  if (!row) throw new AppError("Campaign not found.", 404);

  if (row.status === "completed" || row.status === "cancelled") {
    throw new AppError("Past campaigns cannot be resumed or stopped.", 400);
  }
  if (row.status !== "live" && row.status !== "scheduled") {
    throw new AppError("Stop/Resume is only available for live or scheduled campaigns.", 400);
  }

  const match = row.channels.find((c) => c.channel.toLowerCase() === ch);
  if (!match) throw new AppError(`Channel '${ch}' not on this campaign.`, 404);

  if (input.paused && !String(input.reason || "").trim()) {
    throw new AppError("A reason is required to stop a channel.", 400);
  }

  const plan =
    row.launchPlan && typeof row.launchPlan === "object"
      ? ({ ...(row.launchPlan as Record<string, unknown>) } as Record<
          string,
          unknown
        >)
      : {};
  const runMap =
    plan.channel_run && typeof plan.channel_run === "object"
      ? ({ ...(plan.channel_run as Record<string, unknown>) } as Record<
          string,
          unknown
        >)
      : {};
  const prev = readChannelRun(plan, ch);
  const nowIso = new Date().toISOString();
  runMap[ch] = {
    paused: Boolean(input.paused),
    reason: input.paused
      ? String(input.reason || "").trim()
      : null,
    sent: prev.sent,
    failed: prev.failed,
    opens: prev.opens,
    clicks: prev.clicks,
    paused_at: input.paused ? prev.pausedAt || nowIso : null,
    network: prev.network,
    impressions: prev.impressions,
    spend: prev.spend,
    currency: prev.currency,
    conversions: prev.conversions,
    daily_budget: prev.dailyBudget,
    plan_summary: prev.planSummary,
  };
  plan.channel_run = runMap;

  await prisma.$transaction([
    prisma.campaign.update({
      where: { id: row.id },
      data: { launchPlan: plan as Prisma.InputJsonValue },
    }),
    prisma.campaignChannel.update({
      where: { id: match.id },
      data: { status: input.paused ? "paused" : "ready" },
    }),
  ]);

  try {
    const { notifyCampaignChannelRunState } = await import(
      "../services/app-notifications.js"
    );
    await notifyCampaignChannelRunState({
      campaignId: row.id,
      campaignName: row.name || "Campaign",
      organizationId: session.organizationId,
      userId: session.id,
      channel: ch,
      paused: Boolean(input.paused),
      reason: input.reason,
    });
  } catch {
    /* never block pause/resume on notifications */
  }

  return getCampaignByIdDao(session, campaignId);
}

export type StopCampaignResult = {
  stopped: boolean;
  already_finished: boolean;
  needs_reason: boolean;
  not_launching: boolean;
  status: string;
  prior_status: string;
  name: string;
  selected: number;
  sent: number;
  stub_sent: number;
  failed: number;
  reason: string | null;
  message: string;
  campaign: CampaignDetail;
};

function stopResultBase(
  campaign: CampaignDetail,
  priorStatus: string,
): Omit<StopCampaignResult, "stopped" | "already_finished" | "needs_reason" | "not_launching" | "reason" | "message"> {
  return {
    status: campaign.status,
    prior_status: priorStatus,
    name: campaign.name,
    selected: campaign.audienceCount || 0,
    sent: campaign.sent || 0,
    stub_sent: campaign.stubSent || 0,
    failed: campaign.failed || 0,
    campaign,
  };
}

/**
 * Stop a whole campaign (monitoring chat).
 * Past/completed/cancelled → report already finished, no mutation.
 * Draft → not launching.
 * Live/scheduled without reason → return sent vs selected and ask for reason.
 * Live/scheduled with reason → cancel remaining sends.
 */
export async function stopCampaignDao(
  session: CampaignSessionUser,
  campaignId: string,
  input: { reason?: string | null },
): Promise<StopCampaignResult> {
  const row = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      ...campaignTenantWhere(session),
    },
    include: { channels: true },
  });
  if (!row) throw new AppError("Campaign not found.", 404);

  const priorStatus = String(row.status);
  const campaign = await getCampaignByIdDao(session, campaignId);
  const base = stopResultBase(campaign, priorStatus);
  const status = priorStatus.toLowerCase();

  if (status === "completed" || status === "cancelled") {
    return {
      ...base,
      stopped: false,
      already_finished: true,
      needs_reason: false,
      not_launching: false,
      reason: null,
      message:
        status === "cancelled"
          ? `"${campaign.name}" is already stopped.`
          : `"${campaign.name}" is already completed. It cannot be stopped.`,
    };
  }

  if (status === "draft") {
    return {
      ...base,
      stopped: false,
      already_finished: false,
      needs_reason: false,
      not_launching: true,
      reason: null,
      message: `"${campaign.name}" is still a draft — nothing is launching yet.`,
    };
  }

  if (status !== "live" && status !== "scheduled") {
    throw new AppError("Stop is only available for live or scheduled campaigns.", 400);
  }

  const reason = String(input.reason || "").trim();
  if (!reason) {
    const selected = base.selected;
    const sent = base.sent;
    const message =
      status === "scheduled"
        ? `"${campaign.name}" is scheduled and has not started (0 of ${selected} sent). Provide a reason to stop it before launch.`
        : `"${campaign.name}" is live: ${sent} of ${selected} selected contacts have already been sent. Provide a reason to stop remaining sends.`;
    return {
      ...base,
      stopped: false,
      already_finished: false,
      needs_reason: true,
      not_launching: false,
      reason: null,
      message,
    };
  }

  const plan =
    row.launchPlan && typeof row.launchPlan === "object"
      ? ({ ...(row.launchPlan as Record<string, unknown>) } as Record<
          string,
          unknown
        >)
      : {};
  const runMap =
    plan.channel_run && typeof plan.channel_run === "object"
      ? ({ ...(plan.channel_run as Record<string, unknown>) } as Record<
          string,
          unknown
        >)
      : {};
  const now = new Date();
  const nowIso = now.toISOString();
  for (const chRow of row.channels) {
    const ch = toAgentChannel(chRow.channel) || chRow.channel.toLowerCase();
    const prev = readChannelRun(plan, ch);
    runMap[ch] = {
      paused: true,
      reason,
      sent: prev.sent,
      failed: prev.failed,
      opens: prev.opens,
      clicks: prev.clicks,
      paused_at: prev.pausedAt || nowIso,
      network: prev.network,
      impressions: prev.impressions,
      spend: prev.spend,
      currency: prev.currency,
      conversions: prev.conversions,
      daily_budget: prev.dailyBudget,
      plan_summary: prev.planSummary,
    };
  }
  plan.channel_run = runMap;
  plan.stop_reason = reason;
  plan.stopped_at = nowIso;
  plan.stopped_by = session.id;

  await prisma.$transaction([
    prisma.campaign.update({
      where: { id: row.id },
      data: {
        status: "cancelled",
        endsAt: now,
        launchPlan: plan as Prisma.InputJsonValue,
      },
    }),
    ...row.channels.map((chRow) =>
      prisma.campaignChannel.update({
        where: { id: chRow.id },
        data: { status: "paused" },
      }),
    ),
    prisma.campaignSendBatch.updateMany({
      where: {
        campaignId: row.id,
        status: { in: ["queued", "queued_accounts", "sending"] },
      },
      data: { status: "cancelled" },
    }),
    prisma.campaignSendRecipient.updateMany({
      where: { campaignId: row.id, status: "pending" },
      data: { status: "skipped", skipFailReason: "campaign_stopped" },
    }),
  ]);

  try {
    const { notifyCampaignStopped } = await import(
      "../services/app-notifications.js"
    );
    await notifyCampaignStopped({
      campaignId: row.id,
      campaignName: row.name || "Campaign",
      organizationId: session.organizationId,
      userId: session.id,
      reason,
      sent: base.sent,
      selected: base.selected,
    });
  } catch {
    /* never block stop on notifications */
  }

  const updated = await getCampaignByIdDao(session, campaignId);
  const after = stopResultBase(updated, priorStatus);
  const remaining = Math.max(0, after.selected - after.sent - after.stub_sent);
  return {
    ...after,
    stopped: true,
    already_finished: false,
    needs_reason: false,
    not_launching: false,
    reason,
    message:
      priorStatus.toLowerCase() === "scheduled"
        ? `"${updated.name}" was stopped before launch. Reason: ${reason}`
        : `"${updated.name}" stopped. ${after.sent} of ${after.selected} already sent; remaining ${remaining} will not send. Reason: ${reason}`,
  };
}
