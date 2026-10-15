/**
 * Deterministic buyer-intent guard for nurture voice calls.
 */

import {
  extractSignals,
  type SignalActivity,
} from "@/service/ai/lead-lifecycle-signals";

const SCHEDULING_REPLY_RE =
  /\b(works for me|works for us|that time works|confirm(?:ing)? (?:the )?time|see you then)\b/i;
const TIME_REPLY_RE =
  /\d{1,2}[.:][0-5]\d\s*(am|pm)|\d{1,2}\s*(am|pm)\s*(today|tomorrow)?/i;

export type NurtureVoiceIntentBlock = {
  blocked: boolean;
  reason?: string;
};

function hasFutureMeeting(activities: SignalActivity[]): boolean {
  const now = Date.now();
  for (const activity of activities) {
    if (activity.type !== "meeting") continue;
    if (!activity.dueAt) continue;
    const when = new Date(activity.dueAt).getTime();
    if (Number.isFinite(when) && when > now) {
      return true;
    }
  }
  return false;
}

function hasSchedulingConfirmation(activities: SignalActivity[]): boolean {
  for (const activity of activities) {
    if (activity.type !== "email" || activity.emailDirection !== "inbound") {
      continue;
    }
    const blob = `${activity.subject ?? ""}\n${activity.body ?? ""}`;
    if (SCHEDULING_REPLY_RE.test(blob) || TIME_REPLY_RE.test(blob)) {
      return true;
    }
  }
  return false;
}

export function assessNurtureVoiceIntent(
  activities: SignalActivity[],
): NurtureVoiceIntentBlock {
  if (hasFutureMeeting(activities)) {
    return { blocked: true, reason: "future_meeting_scheduled" };
  }

  if (hasSchedulingConfirmation(activities)) {
    return { blocked: true, reason: "scheduling_confirmation" };
  }

  const signals = extractSignals(activities);
  if (signals.meetingBooked) {
    return { blocked: true, reason: "meeting_booked" };
  }
  if (signals.demoRequested) {
    return { blocked: true, reason: "demo_requested" };
  }
  if (signals.quoteRequested) {
    return { blocked: true, reason: "quote_requested" };
  }
  if (signals.meetingHeld) {
    return { blocked: true, reason: "meeting_held" };
  }
  if (signals.pricingInterest && signals.inboundReply) {
    return { blocked: true, reason: "pricing_interest" };
  }
  if (
    signals.inboundReply &&
    (signals.demoRequested ||
      signals.meetingBooked ||
      signals.quoteRequested ||
      signals.pricingInterest)
  ) {
    return { blocked: true, reason: "inbound_buying_intent" };
  }

  return { blocked: false };
}

export function toSignalActivities(
  activities: Array<{
    type: string;
    subject: string;
    body: string | null;
    createdAt: string;
    emailDirection?: string | null;
    dueAt?: string | null;
  }>,
): SignalActivity[] {
  return activities.map((a) => ({
    type: a.type,
    subject: a.subject,
    body: a.body,
    emailDirection: a.emailDirection ?? null,
    createdAt: a.createdAt,
    dueAt: a.dueAt ?? null,
  }));
}
