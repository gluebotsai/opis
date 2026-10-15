import type { LeadScoreResult } from "@/service/ai/lead-score";

export type NextAction = {
  label: string;
  reason: string;
  href?: string;
};

export function heuristicContactSummary(input: {
  name: string;
  title: string | null;
  company: string | null;
  lifecycle: string | null;
  leadStatus: string | null;
  notes: string | null;
  activityCount: number;
  orderCount: number;
}): string {
  const bits = [
    `${input.name}${input.title ? ` (${input.title})` : ""}${
      input.company ? ` at ${input.company}` : ""
    }.`,
    `Lifecycle: ${input.lifecycle ?? "—"} · Lead status: ${input.leadStatus ?? "—"}.`,
    input.activityCount
      ? `${input.activityCount} recent timeline activities.`
      : "No recent timeline activities.",
    input.orderCount
      ? `${input.orderCount} commerce order(s) on file.`
      : null,
    input.notes ? `Notes: ${input.notes.slice(0, 240)}` : null,
  ].filter(Boolean);
  return bits.join("\n");
}

export function heuristicDealSummary(input: {
  title: string;
  stage: string;
  amount: string | null;
  company: string;
  contactName: string | null;
  notes: string | null;
  activityCount: number;
}): string {
  const bits = [
    `Deal “${input.title}” with ${input.company}${
      input.contactName ? ` · ${input.contactName}` : ""
    }.`,
    `Stage: ${input.stage}${input.amount ? ` · Amount: ${input.amount}` : ""}.`,
    input.activityCount
      ? `${input.activityCount} deal activities logged.`
      : "No deal activities yet.",
    input.notes ? `Notes: ${input.notes.slice(0, 240)}` : null,
  ].filter(Boolean);
  return bits.join("\n");
}

export function heuristicContactNextActions(input: {
  contactId: string;
  leadStatus: string | null;
  lifecycle: string | null;
  hasEmail: boolean;
  score: LeadScoreResult;
}): NextAction[] {
  const actions: NextAction[] = [];
  if (input.hasEmail) {
    actions.push({
      label: "Reply in Inbox",
      reason: "Keep the conversation warm with a short follow-up.",
      href: `/inbox?contactId=${input.contactId}`,
    });
  }
  if (
    input.lifecycle === "lead" &&
    input.leadStatus !== "converted" &&
    input.leadStatus !== "disqualified"
  ) {
    actions.push({
      label: "Review convert path",
      reason:
        input.score.band === "hot"
          ? "Lead looks ready — convert when BANT is solid."
          : "Qualify further before converting.",
      href: `/contact/${input.contactId}`,
    });
  }
  actions.push({
    label: "Log a call or note",
    reason: "Capture the latest intent on the timeline.",
    href: `/contact/${input.contactId}`,
  });
  return actions.slice(0, 3);
}

export function heuristicDealNextActions(input: {
  dealId: string;
  stage: string;
  contactId: string | null;
}): NextAction[] {
  const actions: NextAction[] = [
    {
      label: "Log activity",
      reason: "Record the latest stakeholder conversation.",
      href: `/sales/${input.dealId}`,
    },
  ];
  if (input.stage === "propose" || input.stage === "negotiate") {
    actions.push({
      label: "Review quotes",
      reason: "Confirm pricing before advancing stage.",
      href: `/sales/${input.dealId}`,
    });
  }
  if (input.contactId) {
    actions.push({
      label: "Open contact",
      reason: "Check buyer context and timeline.",
      href: `/contact/${input.contactId}`,
    });
  }
  if (input.stage === "negotiate") {
    actions.push({
      label: "Prepare Closed Won checklist",
      reason: "Confirm contact, contract, and service handoff readiness.",
      href: `/sales/${input.dealId}`,
    });
  }
  return actions.slice(0, 3);
}

export function heuristicReplyDraft(input: {
  contactName: string;
  subject: string;
  inboundSnippet: string;
}): string {
  const snip = input.inboundSnippet.replace(/\s+/g, " ").trim().slice(0, 180);
  return [
    `Hi ${input.contactName.split(" ")[0] || "there"},`,
    "",
    `Thanks for your note${input.subject ? ` about “${input.subject.replace(/^re:\s*/i, "")}”` : ""}.`,
    snip
      ? `I reviewed what you shared and can help with next steps.`
      : `Happy to help with next steps.`,
    "",
    "Would you have 20 minutes this week for a quick sync?",
    "",
    "Best regards",
  ].join("\n");
}
