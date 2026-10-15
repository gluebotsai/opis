/**
 * Latency-aware CRM + product context for live meeting Assist.
 * Cheap parallel reads only — never regenerates score/lifecycle/summary mid-call.
 */

import { getContact } from "@/dao/contacts/contact-service";
import { listContactActivities } from "@/dao/contacts/contact-activity-service";
import { findLeadSummary } from "@/dao/ai/lead-summary-store";
import { findLeadEnrichmentSnapshot } from "@/dao/ai/lead-enrichment-snapshot";
import { buildMeetingBriefContext } from "@/service/ai/meeting-brief";
import { getLeadScoreStatus } from "@/service/ai/lead-scoring-job";
import { effectiveContactType } from "@/lib/contact-lifecycle";
import { prisma } from "@/dao/db/prisma";

const PACK_MAX_CHARS = 2000;
const PRIOR_MEETING_TRANSCRIPT_MAX = 700;
const NOTES_MAX = 180;
const SUMMARY_MAX = 400;

export type AssistContextPack = {
  contactId: string;
  organizationId: string;
  contact?: {
    name: string;
    title?: string | null;
    lifecycle?: string | null;
    leadStatus?: string | null;
    bant?: {
      budget: boolean;
      authority: boolean;
      need: boolean;
      timeline: boolean;
    };
    notes?: string | null;
  };
  company?: {
    name?: string | null;
    industry?: string | null;
    domain?: string | null;
  };
  score?: {
    total?: number | null;
    band?: string | null;
    nextBestAction?: string | null;
  };
  primaryDeal?: {
    title?: string | null;
    stage?: string | null;
    amount?: string | null;
  };
  recentActivity?: Array<{ type: string; subject: string }>;
  leadSummary?: string | null;
  /** Snippet from the most recent prior meeting on this contact. */
  priorMeetingSnippet?: string | null;
  enrichmentHints?: string | null;
  products?: Array<{
    name: string;
    price?: string | null;
    currency?: string | null;
  }>;
  /** Compact prompt text (≤ ~2k chars). Empty fields omitted. */
  packText: string;
};

function clip(s: string | null | undefined, max: number): string | null {
  const t = (s || "").trim();
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function bantFlags(flags?: {
  budget: boolean;
  authority: boolean;
  need: boolean;
  timeline: boolean;
} | null): string | null {
  if (!flags) return null;
  const bits = [
    flags.budget ? "Budget" : null,
    flags.authority ? "Authority" : null,
    flags.need ? "Need" : null,
    flags.timeline ? "Timeline" : null,
  ].filter(Boolean);
  return bits.length ? bits.join(", ") : "none marked";
}

/** Pure formatter — safe for unit tests without DB. */
export function formatAssistContextPackText(
  pack: Omit<AssistContextPack, "packText">,
): string {
  const lines: string[] = [];

  if (pack.contact) {
    const c = pack.contact;
    lines.push(
      `Contact: ${c.name}${c.title ? ` (${c.title})` : ""}` +
        (c.lifecycle || c.leadStatus
          ? ` · ${[c.lifecycle, c.leadStatus].filter(Boolean).join(" / ")}`
          : ""),
    );
    const bant = bantFlags(c.bant);
    if (bant) lines.push(`BANT: ${bant}`);
    if (c.notes) lines.push(`Notes: ${c.notes}`);
  }

  if (pack.company?.name) {
    lines.push(
      `Company: ${pack.company.name}` +
        (pack.company.industry ? ` · ${pack.company.industry}` : "") +
        (pack.company.domain ? ` · ${pack.company.domain}` : ""),
    );
  }

  if (
    pack.score &&
    (pack.score.total != null ||
      pack.score.band ||
      pack.score.nextBestAction)
  ) {
    const scoreBits = [
      pack.score.total != null ? `score ${pack.score.total}` : null,
      pack.score.band ? `band ${pack.score.band}` : null,
      pack.score.nextBestAction
        ? `next: ${pack.score.nextBestAction}`
        : null,
    ].filter(Boolean);
    if (scoreBits.length) lines.push(`Score: ${scoreBits.join(" · ")}`);
  }

  if (pack.primaryDeal?.title || pack.primaryDeal?.stage) {
    lines.push(
      `Deal: ${pack.primaryDeal.title || "Open deal"}` +
        (pack.primaryDeal.stage ? ` — ${pack.primaryDeal.stage}` : "") +
        (pack.primaryDeal.amount ? ` (${pack.primaryDeal.amount})` : ""),
    );
  }

  if (pack.recentActivity?.length) {
    lines.push("Recent activity:");
    for (const a of pack.recentActivity.slice(0, 5)) {
      lines.push(`- ${a.type}: ${a.subject}`);
    }
  }

  if (pack.enrichmentHints) {
    lines.push(`Enrichment: ${pack.enrichmentHints}`);
  }

  if (pack.leadSummary) {
    lines.push(`Lead summary: ${pack.leadSummary}`);
  }

  if (pack.priorMeetingSnippet) {
    lines.push(`Prior meeting (for continuity): ${pack.priorMeetingSnippet}`);
  }

  // Products are passed separately as Product catalog — omit from CRM pack text.

  let text = lines.join("\n").trim();
  if (text.length > PACK_MAX_CHARS) {
    text = `${text.slice(0, PACK_MAX_CHARS - 1)}…`;
  }
  return text;
}

async function loadPriorMeetingSnippet(input: {
  contactId: string;
  activityId: string;
}): Promise<string | null> {
  const prior = await prisma.contactActivity.findFirst({
    where: {
      contactId: input.contactId,
      type: "meeting",
      id: { not: input.activityId },
      OR: [
        { transcriptText: { not: null } },
        { body: { not: null } },
      ],
    },
    orderBy: [{ dueAt: "desc" }, { updatedAt: "desc" }],
    select: {
      subject: true,
      dueAt: true,
      transcriptText: true,
      body: true,
    },
  });
  if (!prior) return null;
  const raw = (prior.transcriptText || prior.body || "").trim();
  if (!raw) return null;
  const when = prior.dueAt
    ? prior.dueAt.toISOString().slice(0, 10)
    : "prior";
  const subject = (prior.subject || "Meeting").trim();
  const snippet = clip(raw.replace(/\s+/g, " "), PRIOR_MEETING_TRANSCRIPT_MAX);
  return snippet ? `${when} · ${subject}: ${snippet}` : null;
}

async function loadTopProducts(
  organizationId: string,
  limit = 12,
): Promise<AssistContextPack["products"]> {
  try {
    const { listProducts } = await import("@/dao/products/product-crm-service");
    const page = await listProducts({
      page: 1,
      pageSize: Math.min(limit, 12),
      status: "active",
      organizationId,
    });
    return (page.items ?? [])
      .map((p) => ({
        name: String(p.name || "").trim(),
        price: p.price != null ? String(p.price) : null,
        currency: p.currency ?? null,
      }))
      .filter((p) => p.name)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Assemble mid-call CRM history + catalog. Soft-fails to a partial pack.
 */
export async function buildAssistContextPack(input: {
  organizationId: string;
  contactId: string;
  activityId: string;
}): Promise<AssistContextPack> {
  const base: Omit<AssistContextPack, "packText"> = {
    contactId: input.contactId,
    organizationId: input.organizationId,
  };

  try {
    const [brief, contact, activities, summary, enrichment, score, products, priorMeeting] =
      await Promise.all([
        buildMeetingBriefContext(
          input.activityId,
          input.organizationId,
        ).catch(() => null),
        getContact(input.contactId).catch(() => null),
        listContactActivities(input.contactId, 8).catch(() => []),
        findLeadSummary(input.organizationId, input.contactId).catch(
          () => null,
        ),
        findLeadEnrichmentSnapshot(
          input.organizationId,
          input.contactId,
        ).catch(() => null),
        getLeadScoreStatus(input.contactId).catch(() => null),
        loadTopProducts(input.organizationId, 12),
        loadPriorMeetingSnippet({
          contactId: input.contactId,
          activityId: input.activityId,
        }).catch(() => null),
      ]);

    const person = contact?.person;
    const name =
      brief?.contactName ||
      contact?.displayName ||
      [person?.firstName, person?.lastName].filter(Boolean).join(" ").trim() ||
      "Contact";

    base.contact = {
      name,
      title: brief?.contactTitle ?? person?.title ?? null,
      lifecycle: effectiveContactType(brief?.contactType ?? person?.contactType),
      leadStatus: brief?.leadStatus ?? person?.leadStatus ?? null,
      bant: {
        budget: Boolean(person?.bantBudget),
        authority: Boolean(
          brief?.bantAuthority ?? person?.bantAuthority,
        ),
        need: Boolean(person?.bantNeed),
        timeline: Boolean(person?.bantTimeline),
      },
      notes: clip(person?.notes ?? contact?.crm?.notes, NOTES_MAX),
    };

    if (brief?.companyName || person?.company?.name) {
      base.company = {
        name: brief?.companyName ?? person?.company?.name ?? null,
        industry: brief?.industry ?? person?.company?.industry ?? null,
        domain: brief?.domain ?? person?.company?.domain ?? null,
      };
    }

    if (score || brief?.leadScore != null) {
      base.score = {
        total: score?.score ?? brief?.leadScore ?? null,
        band: score?.band ?? brief?.leadGrade ?? null,
        nextBestAction: score?.nextBestAction ?? null,
      };
    }

    if (brief?.pipelineDealTitle || brief?.pipelineStage) {
      base.primaryDeal = {
        title: brief.pipelineDealTitle,
        stage: brief.pipelineStage,
        amount: brief.pipelineAmount,
      };
    }

    base.recentActivity = activities
      .filter((a) => a.type !== "meeting" || a.id !== input.activityId)
      .slice(0, 5)
      .map((a) => ({
        type: a.type,
        subject: clip(a.subject, 80) || a.type,
      }));

    base.leadSummary = clip(summary?.summary, SUMMARY_MAX);
    base.priorMeetingSnippet = priorMeeting;

    if (enrichment) {
      const hints = [
        enrichment.seniority_tier
          ? `seniority ${String(enrichment.seniority_tier)}`
          : null,
        enrichment.email_domain_type
          ? `domain ${String(enrichment.email_domain_type)}`
          : null,
        enrichment.revenue_band
          ? `revenue ${String(enrichment.revenue_band)}`
          : null,
        enrichment.products
          ? `interest ${clip(String(enrichment.products), 80)}`
          : null,
      ].filter(Boolean);
      if (hints.length) {
        base.enrichmentHints = hints.join("; ");
      }
    }

    if (products?.length) {
      base.products = products;
    }
  } catch {
    /* partial pack */
  }

  return {
    ...base,
    packText: formatAssistContextPackText(base),
  };
}
