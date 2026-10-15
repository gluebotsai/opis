/**
 * Additive scheduling escalation layer (loyalty / engagement).
 *
 * Does not replace demo booking — only decides allow vs escalate before
 * applyDemoDecision runs. Loyal contacts auto-schedule; new/unverified
 * contacts escalate on first booking and after their first auto-reschedule.
 */

import { prisma } from "@/dao/db/prisma";

export type EngagementTier = "new" | "loyal";

export type ScheduleIntent = "schedule" | "reschedule";

export type ContactEngagement = {
  tier: EngagementTier;
  meetingCount: number;
  bookedDemoCount: number;
  /** Auto-approved reschedules already granted to this contact. */
  autoRescheduleCount: number;
  inboundEmailCount: number;
  outboundEmailCount: number;
  /** This thread (or contact) already completed a booked demo. */
  threadHadBookedDemo: boolean;
  /** Contact has an open meeting still in the future (reschedule target). */
  hasUpcomingMeeting: boolean;
};

export type ScheduleLoyaltyDecision = {
  action: "allow" | "escalate";
  reason: string;
  category: string;
};

const RESCHEDULE_RE =
  /\b(reschedule|re-schedule|re schedule|change (?:the )?(?:time|slot|meeting|demo|appointment|call)|move (?:the )?(?:meeting|demo|call|appointment)|different (?:time|slot|day|date)|another (?:time|slot|day)|push (?:it|the meeting|the demo|the call)\b)/i;

const SCHEDULE_RE =
  /\b(demo|product (?:demo|walkthrough|tour)|schedule (?:a )?(?:call|meeting|demo|appointment)|book (?:a )?(?:demo|call|meeting|appointment)|walk ?through|show me (?:the )?product)\b/i;

const INTEREST_ONLY_RE =
  /^\s*(?:yes[,.]?\s+)?(?:i(?:['’]?m| am)\s+)?interested\b|^\s*yes[,.]?\s+(?:please|i(?:['’]?m| am) interested)\b|^\s*count me in\b/i;

// CRM contactType is "contact" | "lead" | "prospect" | "customer" | "churned"
// (`@/service/account/types.ts`). "opportunity"/"qualified"/"proposal"/
// "negotiation" were never real values here — they only ever match leadStatus
// or deal-stage vocab, so this set silently never fired for a converted
// (but not yet won) contact. "prospect" = already converted to an open deal.
const LOYAL_LIFECYCLE = new Set(["customer", "prospect"]);

/** Detect schedule vs reschedule intent from free text + optional agent category. */
export function detectScheduleIntent(
  text: string,
  category?: string | null,
): ScheduleIntent | null {
  const t = (text || "").trim();
  if (
    INTEREST_ONLY_RE.test(t) &&
    !SCHEDULE_RE.test(t) &&
    !RESCHEDULE_RE.test(t)
  ) {
    return null;
  }
  const cat = (category || "").toLowerCase();
  if (cat.includes("reschedule") || RESCHEDULE_RE.test(text)) {
    return "reschedule";
  }
  if (
    cat.startsWith("demo_") ||
    cat === "demo_request" ||
    SCHEDULE_RE.test(text)
  ) {
    return "schedule";
  }
  return null;
}

/**
 * A new time on an open future meeting is a reschedule. After a completed
 * meeting, another "meet at 6" is a fresh schedule (follow-up demo).
 */
export function resolveScheduleIntentForThread(input: {
  text: string;
  category?: string | null;
  hasUpcomingMeeting?: boolean;
}): ScheduleIntent | null {
  const intent = detectScheduleIntent(input.text, input.category);
  if (intent === "schedule" && input.hasUpcomingMeeting) {
    return "reschedule";
  }
  return intent;
}

export function classifyEngagementTier(input: {
  meetingCount: number;
  bookedDemoCount: number;
  inboundEmailCount: number;
  outboundEmailCount: number;
  contactType?: string | null;
}): EngagementTier {
  const stage = (input.contactType || "").toLowerCase().trim();
  if (LOYAL_LIFECYCLE.has(stage)) return "loyal";
  if (input.bookedDemoCount >= 1) return "loyal";
  if (input.meetingCount >= 2) return "loyal";
  if (input.inboundEmailCount >= 5 && input.outboundEmailCount >= 2) {
    return "loyal";
  }
  return "new";
}

/**
 * Load engagement signals for a contact. Additive read-only queries — no
 * schema changes on shared DBs.
 */
export async function loadContactEngagement(input: {
  contactId: string;
  activityIds: string[];
  contactType?: string | null;
}): Promise<ContactEngagement> {
  const contactId = input.contactId;
  const activityIds =
    input.activityIds.length > 0 ? input.activityIds : ["__none__"];

  const [meetings, bookedDemos, autoReschedules, emailCounts, threadBooked, upcomingOpen] =
    await Promise.all([
      prisma.$queryRawUnsafe<Array<{ n: number | bigint }>>(
        `
        SELECT COUNT(*)::int AS n
        FROM contact_activities
        WHERE contact_id::text = $1::text
          AND type = 'meeting'
          AND folder <> 'trash'
        `,
        contactId,
      ),
      prisma.$queryRawUnsafe<Array<{ n: number | bigint }>>(
        `
        SELECT COUNT(*)::int AS n
        FROM email_auto_reply_jobs
        WHERE contact_id::text = $1::text
          AND status = 'replied'
          AND result_summary->>'phase' = 'booked'
        `,
        contactId,
      ),
      prisma.$queryRawUnsafe<Array<{ n: number | bigint }>>(
        `
        SELECT COUNT(*)::int AS n
        FROM email_auto_reply_jobs
        WHERE contact_id::text = $1::text
          AND (
            category = 'demo_reschedule'
            OR COALESCE(result_summary->>'autoReschedule', '') = 'true'
          )
        `,
        contactId,
      ),
      prisma.$queryRawUnsafe<
        Array<{ inbound: number | bigint; outbound: number | bigint }>
      >(
        `
        SELECT
          COUNT(*) FILTER (WHERE email_direction = 'inbound')::int AS inbound,
          COUNT(*) FILTER (WHERE email_direction = 'outbound')::int AS outbound
        FROM contact_activities
        WHERE contact_id::text = $1::text
          AND type = 'email'
          AND folder <> 'trash'
        `,
        contactId,
      ),
      prisma.$queryRawUnsafe<Array<{ n: number | bigint }>>(
        `
        SELECT COUNT(*)::int AS n
        FROM email_auto_reply_jobs
        WHERE inbound_activity_id = ANY($1::text[])
          AND status = 'replied'
          AND result_summary->>'phase' = 'booked'
        `,
        activityIds,
      ),
      prisma.$queryRawUnsafe<Array<{ n: number | bigint }>>(
        `
        SELECT COUNT(*)::int AS n
        FROM contact_activities
        WHERE contact_id::text = $1::text
          AND type = 'meeting'
          AND folder <> 'trash'
          AND completed_at IS NULL
          AND due_at > NOW()
        `,
        contactId,
      ),
    ]);

  const meetingCount = Number(meetings[0]?.n ?? 0);
  const bookedDemoCount = Number(bookedDemos[0]?.n ?? 0);
  const autoRescheduleCount = Number(autoReschedules[0]?.n ?? 0);
  const inboundEmailCount = Number(emailCounts[0]?.inbound ?? 0);
  const outboundEmailCount = Number(emailCounts[0]?.outbound ?? 0);
  const threadHadBookedDemo = Number(threadBooked[0]?.n ?? 0) > 0;
  const hasUpcomingMeeting = Number(upcomingOpen[0]?.n ?? 0) > 0;

  return {
    tier: classifyEngagementTier({
      meetingCount,
      bookedDemoCount,
      inboundEmailCount,
      outboundEmailCount,
      contactType: input.contactType,
    }),
    meetingCount,
    bookedDemoCount,
    autoRescheduleCount,
    inboundEmailCount,
    outboundEmailCount,
    threadHadBookedDemo,
    hasUpcomingMeeting,
  };
}

/**
 * Decision layer only — callers still run existing book/escalate paths.
 * Returns null when the message is not a schedule/reschedule intent.
 */
export function evaluateScheduleLoyaltyGate(input: {
  tier: EngagementTier;
  intent: ScheduleIntent | null;
  autoRescheduleCount: number;
  hasUpcomingMeeting?: boolean;
}): ScheduleLoyaltyDecision | null {
  if (!input.intent) return null;

  // No open future meeting to move — treat as a fresh booking.
  if (input.intent === "reschedule" && !input.hasUpcomingMeeting) {
    if (input.tier === "loyal") {
      return {
        action: "allow",
        reason: "loyal_auto_schedule",
        category: "demo_schedule",
      };
    }
    return {
      action: "allow",
      reason: "new_user_auto_schedule",
      category: "demo_schedule",
    };
  }

  if (input.tier === "loyal") {
    return {
      action: "allow",
      reason:
        input.intent === "reschedule"
          ? "loyal_auto_reschedule"
          : "loyal_auto_schedule",
      category:
        input.intent === "reschedule" ? "demo_reschedule" : "demo_schedule",
    };
  }

  // New / unverified — still auto-book when they pick a time. Escalate only
  // after they burn the one automatic reschedule.
  if (input.intent === "schedule") {
    return {
      action: "allow",
      reason: "new_user_auto_schedule",
      category: "demo_schedule",
    };
  }

  // Reschedule: one automatic approval, then escalate.
  if (input.autoRescheduleCount < 1) {
    return {
      action: "allow",
      reason: "new_user_first_reschedule",
      category: "demo_reschedule",
    };
  }

  return {
    action: "escalate",
    reason:
      "New/unverified contact requested another reschedule — escalate for human review.",
    category: "demo_loyalty_reschedule_limit",
  };
}
