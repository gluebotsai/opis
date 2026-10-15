/**
 * Context + persistence for the Automated Forecast & Pipeline Auditor agent.
 *
 * Judges whether an open deal's current stage and expected close date are
 * realistic given real activity evidence. Reuses `extractSignals(...)` from
 * the Lead Lifecycle Agent instead of re-deriving evidence from the timeline.
 *
 * HITL rule (hard constraint): this agent only ever writes the five
 * `forecast*` overlay fields on `Deal` (plus a notification) — it never
 * mutates `Deal.stage` or `Deal.expectedCloseDate`. Those stay a human edit.
 */

import type { DealStage, QuoteStatus } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { notifyOwnerOrAdmins } from "@/dao/notifications/notify-users";
import {
  extractSignals,
  type LifecycleSignals,
  type SignalActivity,
} from "@/service/ai/lead-lifecycle-signals";

const DAY_MS = 24 * 60 * 60_000;

export const FORECAST_CATEGORIES = [
  "commit",
  "best_case",
  "pipeline",
  "omitted",
] as const;
export type ForecastCategory = (typeof FORECAST_CATEGORIES)[number];

export function isForecastCategory(v: unknown): v is ForecastCategory {
  return typeof v === "string" && (FORECAST_CATEGORIES as readonly string[]).includes(v);
}

export type ForecastContext = {
  organizationId: string;
  dealId: string;
  title: string;
  stage: DealStage;
  amount: number | null;
  companyId: string;
  companyName: string | null;
  contactId: string | null;
  ownerUserId: string | null;
  createdAt: string;
  /** Proxy for "time in current stage" — Deal has no dedicated stage-change timestamp. */
  daysSinceUpdated: number;
  expectedCloseDate: string | null;
  daysToExpectedClose: number | null;
  quotes: Array<{
    id: string;
    number: string;
    status: QuoteStatus;
    total: number;
    sentAt: string | null;
  }>;
  activityCount: number;
  daysSinceLastActivity: number | null;
  signals: LifecycleSignals;
  forecastCategory: ForecastCategory | null;
  forecastConfidencePercent: number | null;
  forecastFlagged: boolean;
  forecastReason: string | null;
  forecastLastRunAt: string | null;
};

/** Open pipeline stages the forecast sweep/agent ever touches. */
export const OPEN_FORECAST_STAGES: DealStage[] = [
  "qualification",
  "discover",
  "propose",
  "negotiate",
];

export async function buildForecastContext(
  dealId: string,
  organizationId: string,
): Promise<ForecastContext | null> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
    select: {
      id: true,
      title: true,
      stage: true,
      amount: true,
      companyId: true,
      contactId: true,
      ownerUserId: true,
      createdAt: true,
      updatedAt: true,
      expectedCloseDate: true,
      forecastCategory: true,
      forecastConfidencePercent: true,
      forecastFlagged: true,
      forecastReason: true,
      forecastLastRunAt: true,
      company: { select: { name: true } },
    },
  });
  if (!deal) return null;

  const [quotes, activities] = await Promise.all([
    prisma.quote.findMany({
      where: { dealId },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, status: true, total: true, sentAt: true },
      take: 20,
    }),
    prisma.dealActivity.findMany({
      where: { dealId },
      orderBy: { createdAt: "desc" },
      select: { type: true, subject: true, body: true, createdAt: true, dueAt: true },
      take: 40,
    }),
  ]);

  const signalActivities: SignalActivity[] = activities.map((a) => ({
    type: a.type,
    subject: a.subject,
    body: a.body,
    emailDirection: null,
    createdAt: a.createdAt.toISOString(),
    dueAt: a.dueAt?.toISOString() ?? null,
  }));
  const signals = extractSignals(signalActivities);

  const last = activities[0];
  const daysSinceLastActivity = last
    ? Math.floor((Date.now() - last.createdAt.getTime()) / DAY_MS)
    : null;
  const daysSinceUpdated = Math.floor(
    (Date.now() - deal.updatedAt.getTime()) / DAY_MS,
  );
  const daysToExpectedClose = deal.expectedCloseDate
    ? Math.round((deal.expectedCloseDate.getTime() - Date.now()) / DAY_MS)
    : null;

  return {
    organizationId,
    dealId: deal.id,
    title: deal.title,
    stage: deal.stage,
    amount: deal.amount == null ? null : Number(deal.amount),
    companyId: deal.companyId,
    companyName: deal.company?.name ?? null,
    contactId: deal.contactId,
    ownerUserId: deal.ownerUserId ? String(deal.ownerUserId) : null,
    createdAt: deal.createdAt.toISOString(),
    daysSinceUpdated,
    expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
    daysToExpectedClose,
    quotes: quotes.map((q) => ({
      id: q.id,
      number: q.number,
      status: q.status,
      total: Number(q.total),
      sentAt: q.sentAt?.toISOString() ?? null,
    })),
    activityCount: activities.length,
    daysSinceLastActivity,
    signals,
    forecastCategory: isForecastCategory(deal.forecastCategory)
      ? deal.forecastCategory
      : null,
    forecastConfidencePercent: deal.forecastConfidencePercent ?? null,
    forecastFlagged: deal.forecastFlagged,
    forecastReason: deal.forecastReason,
    forecastLastRunAt: deal.forecastLastRunAt?.toISOString() ?? null,
  };
}

export type ForecastDecision = {
  category: ForecastCategory;
  confidencePercent: number;
  flagged: boolean;
  reason: string;
};

export async function persistForecastDecision(
  dealId: string,
  organizationId: string,
  decision: ForecastDecision,
): Promise<{ applied: boolean }> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
    select: { id: true, title: true, ownerUserId: true, stage: true },
  });
  if (!deal) return { applied: false };

  const confidencePercent = Math.max(
    0,
    Math.min(100, Math.round(decision.confidencePercent)),
  );

  await prisma.deal.update({
    where: { id: dealId },
    data: {
      forecastCategory: decision.category,
      forecastConfidencePercent: confidencePercent,
      forecastFlagged: decision.flagged,
      forecastReason: decision.reason.slice(0, 500),
      forecastLastRunAt: new Date(),
    },
  });

  if (decision.flagged && deal.ownerUserId) {
    await notifyOwnerOrAdmins({
      organizationId,
      ownerUserId: String(deal.ownerUserId),
      kind: "pipeline_forecast",
      title: "Forecast looks unrealistic",
      body: `"${deal.title}" (${deal.stage}) — ${decision.reason.slice(0, 240)}`,
      href: `/sales/${dealId}`,
      entityType: "deal",
      entityId: dealId,
      metadata: {
        seedTools: [
          {
            name: "navigate",
            args: {
              href: `/sales/${dealId}`,
              seedPrompt: "Review this deal's stage and expected close date",
            },
          },
        ],
        risk: "low",
      },
    }).catch(() => null);
  }

  return { applied: true };
}
