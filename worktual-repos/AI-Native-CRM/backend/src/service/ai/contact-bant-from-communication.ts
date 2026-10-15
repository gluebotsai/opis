/**
 * Persist Qualification (BANT) on the contact when the customer states
 * budget, authority, need, or timeline in any channel.
 *
 * Flags turn on from the transcript LLM. A later message that does not
 * mention a field leaves the existing value. A timeline that was stored from
 * a demo or meeting slot, with no customer phrase, is cleared when a full
 * read of the customer's own words does not state a project deadline.
 * Extraction is the transcript LLM; nothing is guessed when that call
 * returns nothing usable.
 */

import { prisma } from "@/dao/db/prisma";
import {
  getContactProfileByAccountId,
  patchContactProfile,
} from "@/dao/contacts/contact-profile-repository";
import {
  analyzeTranscript,
  isCustomerVoiceActivity,
  isInternalNoiseActivity,
  type SignalActivity,
} from "@/service/ai/lead-lifecycle-signals";
import { publishLeadSummaryEvent } from "@/service/ai/lead-summary-events";

const MIN_CHARS = 12;
const recent = new Map<string, number>();
const DEDUPE_MS = 10 * 60_000;
const CHANNEL_REFRESH_MS = 6 * 60 * 60_000;
const refreshedAt = new Map<string, number>();
const refreshing = new Set<string>();

async function queueBantEvidenceRefresh(input: {
  contactId: string;
  organizationId: string;
}): Promise<void> {
  publishLeadSummaryEvent({
    contactId: input.contactId,
    reason: "bant_updated",
  });
  try {
    const { scheduleLeadSummaryRefresh } = await import(
      "@/service/ai/lead-summary-refresh"
    );
    await scheduleLeadSummaryRefresh(input);
  } catch (err) {
    console.error("lead summary enqueue after BANT update failed", err);
  }
}

/** Calendar card we wrote for a demo or meeting. Not the customer's deadline. */
export function isCalendarInviteBody(body: string | null | undefined): boolean {
  const text = plain(body);
  if (!/\bwhen:\s+\S/i.test(text)) return false;
  return /\b(join:|provider:|meeting link:|calendar:|google event:|ics uid:)/i.test(
    text,
  );
}

export type BantInsights = {
  budget?: unknown;
  authority?: unknown;
  need?: unknown;
  timeline?: unknown;
  budgetDetail?: unknown;
  authorityDetail?: unknown;
  needDetail?: unknown;
  timelineDetail?: unknown;
};

function detailPhrase(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.toLowerCase() === "null") return null;
  return text.slice(0, 160);
}

/** True when the stored budget line is a figure, not a description of the chat. */
function phraseHasAmount(value: string | null | undefined): boolean {
  const text = value?.trim() ?? "";
  if (!text) return false;
  return (
    /\d/.test(text) ||
    /\b(thousand|lakh|million|crore|billion)\b/i.test(text)
  );
}

/** True when the stored timeline line is a date or period. */
function phraseHasTime(value: string | null | undefined): boolean {
  const text = value?.trim() ?? "";
  if (!text) return false;
  return (
    /\d/.test(text) ||
    /\b(q[1-4]|quarter|week|month|year|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(
      text,
    )
  );
}

function plain(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprint(contactId: string, text: string): string {
  return `${contactId}:${text.slice(0, 400).toLowerCase()}`;
}

function remember(key: string): boolean {
  const now = Date.now();
  for (const [k, at] of recent) {
    if (now - at > DEDUPE_MS) recent.delete(k);
  }
  if (recent.has(key)) return false;
  recent.set(key, now);
  return true;
}

/** Sticky-true write of LLM BANT flags onto crm.contact_profiles. */
export async function persistCustomerBantFlags(
  contactId: string,
  insights: BantInsights | null | undefined,
  options?: { clearUnstatedTimeline?: boolean; fillEmptyDetailsOnly?: boolean },
): Promise<boolean> {
  const id = contactId.trim();
  if (!id || !insights) return false;
  const phrases = {
    bantBudgetDetail: detailPhrase(insights.budgetDetail),
    bantAuthorityDetail: detailPhrase(insights.authorityDetail),
    bantNeedDetail: detailPhrase(insights.needDetail),
    bantTimelineDetail: detailPhrase(insights.timelineDetail),
  };
  if (phrases.bantBudgetDetail && !phraseHasAmount(phrases.bantBudgetDetail)) {
    phrases.bantBudgetDetail = null;
  }
  if (phrases.bantTimelineDetail && !phraseHasTime(phrases.bantTimelineDetail)) {
    phrases.bantTimelineDetail = null;
  }
  const next = {
    bantBudget:
      (insights.budget === true && Boolean(phrases.bantBudgetDetail)) ||
      Boolean(phrases.bantBudgetDetail),
    bantAuthority:
      insights.authority === true || Boolean(phrases.bantAuthorityDetail),
    bantNeed: insights.need === true || Boolean(phrases.bantNeedDetail),
    bantTimeline:
      (insights.timeline === true && Boolean(phrases.bantTimelineDetail)) ||
      Boolean(phrases.bantTimelineDetail),
  };
  const clearUnstatedTimeline =
    options?.clearUnstatedTimeline === true && !next.bantTimeline;
  if (
    !next.bantBudget &&
    !next.bantAuthority &&
    !next.bantNeed &&
    !next.bantTimeline &&
    !clearUnstatedTimeline
  ) {
    return false;
  }

  const existing = await getContactProfileByAccountId(id);
  if (!existing) return false;
  const patch: {
    bantBudget?: boolean;
    bantAuthority?: boolean;
    bantNeed?: boolean;
    bantTimeline?: boolean;
    bantBudgetDetail?: string;
    bantAuthorityDetail?: string;
    bantNeedDetail?: string;
    bantTimelineDetail?: string;
  } = {};
  if (next.bantBudget && existing.bantBudget !== true) patch.bantBudget = true;
  if (next.bantAuthority && existing.bantAuthority !== true) {
    patch.bantAuthority = true;
  }
  if (next.bantNeed && existing.bantNeed !== true) patch.bantNeed = true;
  if (next.bantTimeline && existing.bantTimeline !== true) {
    patch.bantTimeline = true;
  }
  const fillEmpty = options?.fillEmptyDetailsOnly === true;
  const budgetDetailMissing = !phraseHasAmount(existing.bantBudgetDetail);
  const timelineDetailMissing = !phraseHasTime(existing.bantTimelineDetail);
  if (
    phrases.bantBudgetDetail &&
    phrases.bantBudgetDetail !== existing.bantBudgetDetail &&
    (!fillEmpty || budgetDetailMissing)
  ) {
    patch.bantBudgetDetail = phrases.bantBudgetDetail;
  }
  if (
    phrases.bantAuthorityDetail &&
    phrases.bantAuthorityDetail !== existing.bantAuthorityDetail &&
    (!fillEmpty || !existing.bantAuthorityDetail?.trim())
  ) {
    patch.bantAuthorityDetail = phrases.bantAuthorityDetail;
  }
  if (
    phrases.bantNeedDetail &&
    phrases.bantNeedDetail !== existing.bantNeedDetail &&
    (!fillEmpty || !existing.bantNeedDetail?.trim())
  ) {
    patch.bantNeedDetail = phrases.bantNeedDetail;
  }
  if (
    phrases.bantTimelineDetail &&
    phrases.bantTimelineDetail !== existing.bantTimelineDetail &&
    (!fillEmpty || timelineDetailMissing)
  ) {
    patch.bantTimelineDetail = phrases.bantTimelineDetail;
  }
  if (
    clearUnstatedTimeline &&
    existing.bantTimeline === true &&
    !existing.bantTimelineDetail?.trim() &&
    !phrases.bantTimelineDetail
  ) {
    patch.bantTimeline = false;
  }
  if (Object.keys(patch).length === 0) return false;

  await patchContactProfile(id, patch);
  await queueBantEvidenceRefresh({
    contactId: id,
    organizationId: existing.organizationId,
  });
  return true;
}

export async function captureCustomerBantFromText(input: {
  contactId: string;
  text: string;
}): Promise<boolean> {
  const contactId = input.contactId.trim();
  const text = plain(input.text);
  if (!contactId || text.length < MIN_CHARS) return false;
  const key = fingerprint(contactId, text);
  if (!remember(key)) return false;

  const existing = await getContactProfileByAccountId(contactId);
  const filled = (flag: boolean | null | undefined, detail: string | null | undefined) =>
    flag === true && Boolean(detail?.trim());
  if (
    filled(existing?.bantBudget, existing?.bantBudgetDetail) &&
    filled(existing?.bantAuthority, existing?.bantAuthorityDetail) &&
    filled(existing?.bantNeed, existing?.bantNeedDetail) &&
    filled(existing?.bantTimeline, existing?.bantTimelineDetail)
  ) {
    return false;
  }

  const insights = await analyzeTranscript(text);
  return persistCustomerBantFlags(contactId, insights);
}

async function customerChannelLines(contactId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ body: string | null }>>`
    SELECT m.body
    FROM ccass.conversation_messages m
    INNER JOIN ccass.conversations c ON c.id = m.conversation_id
    WHERE c.contact_id = ${contactId}
      AND m.direction = 'inbound'
      AND lower(m.sender_type) = 'customer'
      AND m.body IS NOT NULL
    ORDER BY m.created_at DESC
    LIMIT 40
  `;
  const lines: string[] = [];
  for (const row of rows.reverse()) {
    const text = plain(row.body);
    if (text.length >= 8) lines.push(text);
  }
  return lines;
}

/**
 * Customer words from CRM activities and from chat, call, and social threads.
 * Calendar invite cards are left out so a demo slot is not read as a deadline.
 */
async function customerTouchpointText(contactId: string): Promise<string> {
  const activities = await prisma.contactActivity.findMany({
    where: { contactId, folder: { not: "trash" } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      type: true,
      subject: true,
      body: true,
      emailDirection: true,
      transcriptText: true,
    },
  });
  const chunks: string[] = [];
  for (const row of activities.reverse()) {
    const activity: SignalActivity = {
      type: row.type,
      subject: row.subject ?? "",
      body: row.body,
      emailDirection: row.emailDirection,
      createdAt: new Date().toISOString(),
      transcriptText: row.transcriptText,
    };
    if (row.type === "task") continue;
    if (isInternalNoiseActivity(activity)) continue;
    if (!isCustomerVoiceActivity(activity)) continue;
    const transcript = plain(row.transcriptText);
    const calendar = isCalendarInviteBody(row.body);
    if (row.type === "meeting" && calendar && !transcript) continue;
    let body = plain(row.body);
    if (row.type === "email") {
      const { latestInboundPlain } = await import(
        "@/service/ai/email-auto-reply-job"
      );
      body = plain(latestInboundPlain(row.body));
    }
    if (calendar) body = "";
    const text = [calendar ? "" : plain(row.subject), body, transcript]
      .filter(Boolean)
      .join("\n");
    if (text.length >= MIN_CHARS) chunks.push(text);
  }
  chunks.push(...(await customerChannelLines(contactId)));
  const joined = chunks.join("\n");
  return joined.length > 6000 ? joined.slice(-6000) : joined;
}

/**
 * Read every customer touchpoint once, then let the transcript LLM set BANT.
 * A timeline flag with no stored phrase is cleared when those words do not
 * state a project deadline.
 */
export async function refreshCustomerBantFromTouchpoints(
  contactId: string,
): Promise<boolean> {
  const id = contactId.trim();
  if (!id || refreshing.has(id)) return false;
  const at = refreshedAt.get(id);
  if (at && Date.now() - at < CHANNEL_REFRESH_MS) return false;
  refreshing.add(id);
  try {
    const existing = await getContactProfileByAccountId(id);
    if (!existing) return false;
    const timelineUnset = !phraseHasTime(existing.bantTimelineDetail);
    const budgetUnset = !phraseHasAmount(existing.bantBudgetDetail);
    const gap =
      existing.bantAuthority !== true ||
      existing.bantNeed !== true ||
      (existing.bantBudget === true && budgetUnset) ||
      (existing.bantTimeline === true && timelineUnset);
    if (!gap) {
      refreshedAt.set(id, Date.now());
      return false;
    }
    const text = await customerTouchpointText(id);
    if (text.length < MIN_CHARS) {
      if (existing.bantTimeline === true && !existing.bantTimelineDetail?.trim()) {
        await patchContactProfile(id, { bantTimeline: false });
        await queueBantEvidenceRefresh({
          contactId: id,
          organizationId: existing.organizationId,
        });
      }
      refreshedAt.set(id, Date.now());
      return true;
    }
    const insights = await analyzeTranscript(text);
    if (!insights) return false;
    const wrote = await persistCustomerBantFlags(id, insights, {
      clearUnstatedTimeline: true,
      fillEmptyDetailsOnly: true,
    });
    refreshedAt.set(id, Date.now());
    return wrote;
  } finally {
    refreshing.delete(id);
  }
}

export function scheduleCustomerChannelBantRefresh(contactId: string): void {
  void refreshCustomerBantFromTouchpoints(contactId).catch((err) => {
    console.error("customer BANT touchpoint refresh failed", contactId, err);
  });
}

/** Fire-and-forget. Customer voice only — outbound mail and internal notes skip. */
export function scheduleCustomerBantCapture(input: {
  contactId: string;
  type: string;
  subject?: string | null;
  body?: string | null;
  emailDirection?: string | null;
  transcriptText?: string | null;
}): void {
  const activity: SignalActivity = {
    type: input.type,
    subject: input.subject ?? "",
    body: input.body ?? null,
    emailDirection: input.emailDirection ?? null,
    createdAt: new Date().toISOString(),
    transcriptText: input.transcriptText ?? null,
  };
  if (input.type === "task") return;
  if (isInternalNoiseActivity(activity)) return;
  if (!isCustomerVoiceActivity(activity)) return;

  const transcript = plain(input.transcriptText);
  const calendarInvite =
    input.type === "meeting" && isCalendarInviteBody(input.body);
  if (calendarInvite && !transcript) {
    scheduleCustomerChannelBantRefresh(input.contactId);
    return;
  }

  void (async () => {
    let body = calendarInvite ? "" : plain(input.body);
    if (input.type === "email") {
      const { latestInboundPlain } = await import(
        "@/service/ai/email-auto-reply-job"
      );
      body = plain(latestInboundPlain(input.body));
    }
    const text = [
      calendarInvite ? "" : plain(input.subject),
      body,
      transcript,
    ]
      .filter(Boolean)
      .join("\n");
    if (text.length >= MIN_CHARS) {
      await captureCustomerBantFromText({
        contactId: input.contactId,
        text,
      });
    }
    scheduleCustomerChannelBantRefresh(input.contactId);
  })().catch((err) => {
    console.error("customer BANT capture failed", input.contactId, err);
  });
}
