/**
 * Read-only NL analytics over CRM DAOs (Phase 3).
 * Returns structured rows + a short summary — never writes.
 */

import { prisma } from "@/dao/db/prisma";
import { getCurrentOrganizationId } from "@/service/auth/require-role";

export type NlAnalyticsResult = {
  question: string;
  intent:
    | "stalled_deals"
    | "quiet_leads"
    | "pipeline_counts"
    | "propose_no_activity"
    | "unknown";
  summary: string;
  rows: Array<Record<string, unknown>>;
};

function daysFromQuestion(q: string, fallback: number): number {
  const m = q.match(/(\d+)\s*d/);
  if (m) return Math.min(90, Math.max(1, Number(m[1])));
  return fallback;
}

export async function runNlAnalyticsQuery(
  question: string,
): Promise<NlAnalyticsResult> {
  const organizationId = await getCurrentOrganizationId();
  const q = question.toLowerCase();

  if (
    /propose/.test(q) &&
    /(no activity|without activity|quiet|stale)/.test(q)
  ) {
    const days = daysFromQuestion(q, 14);
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const deals = await prisma.deal.findMany({
      where: {
        organizationId,
        stage: "propose",
        updatedAt: { lt: since },
      },
      take: 40,
      select: {
        id: true,
        title: true,
        stage: true,
        contactId: true,
        updatedAt: true,
        amount: true,
      },
      orderBy: { updatedAt: "asc" },
    });
    const withActivity = await Promise.all(
      deals.map(async (d) => {
        if (!d.contactId) return { ...d, recentActivity: false };
        const act = await prisma.contactActivity.findFirst({
          where: {
            contactId: d.contactId,
            createdAt: { gt: since },
          },
          select: { id: true },
        });
        return { ...d, recentActivity: Boolean(act) };
      }),
    );
    const rows = withActivity
      .filter((d) => !d.recentActivity)
      .map((d) => ({
        dealId: d.id,
        title: d.title,
        stage: d.stage,
        amount: d.amount,
        updatedAt: d.updatedAt.toISOString(),
        href: `/sales/${d.id}`,
      }));
    return {
      question,
      intent: "propose_no_activity",
      summary:
        rows.length === 0
          ? `No propose-stage deals older than ${days}d without activity.`
          : `${rows.length} deal(s) in propose >${days}d with no activity.`,
      rows,
    };
  }

  if (/stall|stuck|not moving/.test(q) && /deal/.test(q)) {
    const days = daysFromQuestion(q, 21);
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const deals = await prisma.deal.findMany({
      where: {
        organizationId,
        stage: { in: ["qualification", "discover", "propose", "negotiate"] },
        updatedAt: { lt: since },
      },
      take: 40,
      select: {
        id: true,
        title: true,
        stage: true,
        amount: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "asc" },
    });
    const rows = deals.map((d) => ({
      dealId: d.id,
      title: d.title,
      stage: d.stage,
      amount: d.amount,
      updatedAt: d.updatedAt.toISOString(),
      href: `/sales/${d.id}`,
    }));
    return {
      question,
      intent: "stalled_deals",
      summary:
        rows.length === 0
          ? `No open deals stuck >${days}d.`
          : `${rows.length} open deal(s) without stage movement for ${days}+ days.`,
      rows,
    };
  }

  if (/quiet|cold|no activity/.test(q) && /lead|contact/.test(q)) {
    const days = daysFromQuestion(q, 14);
    const rows = await prisma.$queryRawUnsafe<
      Array<{ contact_id: string; flag_reason: string | null }>
    >(
      `
      SELECT cp.account_contact_id::text AS contact_id, cp.flag_reason
      FROM contact_profiles cp
      WHERE cp.organization_id = $1::bigint
        AND cp.crm_status = 'active'
        AND cp.lead_status NOT IN ('converted', 'disqualified')
        AND NOT EXISTS (
          SELECT 1 FROM contact_activities a
          WHERE a.contact_id = cp.account_contact_id
            AND a.created_at > NOW() - ($2::text || ' days')::interval
        )
      LIMIT 40
      `,
      organizationId,
      String(days),
    );
    return {
      question,
      intent: "quiet_leads",
      summary:
        rows.length === 0
          ? `No quiet leads over ${days}d.`
          : `${rows.length} lead(s) with no activity in ${days}+ days.`,
      rows: rows.map((r) => ({
        contactId: r.contact_id,
        flagReason: r.flag_reason,
        href: `/contact/${r.contact_id}`,
      })),
    };
  }

  if (/pipeline|count|how many/.test(q) && /deal/.test(q)) {
    const grouped = await prisma.deal.groupBy({
      by: ["stage"],
      where: { organizationId },
      _count: { _all: true },
    });
    const rows = grouped.map((g) => ({
      stage: g.stage,
      count: g._count._all,
    }));
    const total = rows.reduce((n, r) => n + r.count, 0);
    return {
      question,
      intent: "pipeline_counts",
      summary: `${total} deal(s) across ${rows.length} stage(s).`,
      rows,
    };
  }

  return {
    question,
    intent: "unknown",
    summary:
      "Try: “deals in propose >14d with no activity”, “stalled deals”, “quiet leads”, or “pipeline counts”.",
    rows: [],
  };
}
