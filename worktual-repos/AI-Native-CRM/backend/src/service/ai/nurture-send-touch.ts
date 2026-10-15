/**
 * Orchestrates one nurture outbound touch: voice (cc-core) primary, Campaign email fallback.
 */

import type { NurtureJobRow } from "@/dao/ai/lead-nurture-store";
import { findScoringJobByOrgContact } from "@/dao/ai/lead-scoring-store";
import { SALES_READY_SCORE } from "@/service/ai/lead-score";
import type { OrgNurtureSettingsView } from "@/dao/ai/org-nurture-settings";
import {
  recordNurtureOutboundSent,
  resolveNurtureEmail,
  resolveNurturePhone,
  sendNurtureOutbound,
  type NurtureOutboundCopy,
  type NurtureOutboundResult,
  type NurtureSendContext,
} from "@/service/ai/nurture-outbound";
import {
  assessNurtureVoiceIntent,
  toSignalActivities,
} from "@/service/ai/nurture-voice-intent";
import {
  isCcCoreVoiceConfigured,
  triggerAutoBotCall,
} from "@/service/integrations/cc-core-voice";
import { isCampaignApiConfigured } from "@/service/integrations/marketing-ms";
import {
  conversationGateRationale,
  conversationGateSummaryPatch,
  evaluateConversationNurtureGate,
} from "@/service/ai/nurture-conversation-gate";

export type NurtureTouchActivity = {
  type: string;
  subject: string;
  body: string | null;
  createdAt: string;
  emailDirection?: string | null;
  dueAt?: string | null;
};

export type NurtureTouchContext = NurtureSendContext & {
  secondaryPhones?: string[];
  lastName?: string | null;
  region?: string | null;
  language?: string | null;
  leadSummary?: string | null;
  leadIntent?: string | null;
  leadSource?: string | null;
  city?: string | null;
  country?: string | null;
  /** Commerce / channel fields from CDP custom_fields (Shopify, etc.). */
  voiceBotData?: Record<string, unknown> | null;
  activitiesForIntent: NurtureTouchActivity[];
};

const VOICE_BOT_DATA_KEYS = [
  "preferred_channel",
  "lifecycle_event",
  "payment_reference",
  "product",
] as const;

/** Pull cc-core `data` extras from CDP custom_fields when present. */
export function voiceBotDataFromCustomFields(
  customFields: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const cf = customFields && typeof customFields === "object" ? customFields : {};
  const out: Record<string, unknown> = {};
  for (const key of VOICE_BOT_DATA_KEYS) {
    const value = cf[key];
    if (value != null && value !== "") {
      out[key] = value;
    }
  }
  const lang = cf.language;
  if (typeof lang === "string" && lang.trim()) {
    out.language = lang.trim();
  }
  return out;
}

export function buildAutoBotCallPayload(
  ctx: NurtureTouchContext,
  copy: NurtureOutboundCopy,
): { data: Record<string, unknown>; instruction: string } {
  const phone = resolveNurturePhone(ctx.phone, ctx.secondaryPhones);
  const email = resolveNurtureEmail(ctx.email, ctx.secondaryEmails);

  const dedicatedVoiceInstruction = copy.voiceInstruction?.trim();
  const instructionParts = dedicatedVoiceInstruction
    ? [dedicatedVoiceInstruction]
    : [
        copy.brief?.trim(),
        copy.goal?.trim() ? `Goal: ${copy.goal.trim()}` : null,
      ].filter((part): part is string => Boolean(part));
  const instruction = instructionParts.join("\n\n").slice(0, 8000);

  const language =
    (typeof ctx.voiceBotData?.language === "string"
      ? ctx.voiceBotData.language.trim()
      : null) ||
    ctx.language?.trim() ||
    "English";

  const data: Record<string, unknown> = {
    cdp_id: ctx.contactId,
    customer_name: ctx.displayName,
    first_name: ctx.firstName,
    ...(ctx.lastName?.trim() ? { last_name: ctx.lastName.trim() } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(ctx.city?.trim() ? { city: ctx.city.trim() } : {}),
    ...(ctx.region?.trim() ? { region: ctx.region.trim() } : {}),
    ...(ctx.country?.trim() ? { country: ctx.country.trim() } : {}),
    source: ctx.leadSource?.trim() || "crm_nurture",
    language,
  };

  const extras = ctx.voiceBotData ?? {};
  for (const key of VOICE_BOT_DATA_KEYS) {
    const value = extras[key];
    if (value != null && value !== "") {
      data[key] = value;
    }
  }

  return { data, instruction };
}

function parseResultSummary(
  raw: NurtureJobRow["resultSummary"],
): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

/** Recheck a placed nurture call before treating a silent session as sent. */
export const VOICE_OUTCOME_POLL_MS = 3 * 60_000;
/** No customer speech by this age means the call was not answered. */
export const VOICE_NO_ANSWER_MS = 10 * 60_000;
/** Ask the nurture model again instead of parking a low-score lead for a day. */
export const MODEL_RETRY_MS = 15 * 60_000;

export function lowScoreOverridesModelWait(input: {
  decision: string;
  rationale: string;
  lowScoreMustNurture: boolean;
}): boolean {
  return (
    input.lowScoreMustNurture &&
    input.decision === "wait" &&
    !/recent activity/i.test(input.rationale)
  );
}

export function nurtureSummaryHasVoiceOutcome(
  summary: Record<string, unknown> | null | undefined,
): boolean {
  const pending = summary?.voiceOutcomePending;
  return Boolean(pending && typeof pending === "object" && !Array.isArray(pending));
}

/** Job is waiting for the org-configured delay before cc-core auto-bot-call. */
export function nurtureSummaryHasVoiceDelay(
  summary: Record<string, unknown> | null | undefined,
): boolean {
  return typeof summary?.callTouchEligibleAt === "string" &&
    summary.callTouchEligibleAt.trim().length > 0;
}

export function voiceCallDueAtMs(
  summary: Record<string, unknown>,
  delayMinutes: number,
): number | null {
  const eligibleAt = summary.callTouchEligibleAt;
  if (typeof eligibleAt !== "string" || !eligibleAt.trim()) return null;
  const eligibleMs = new Date(eligibleAt).getTime();
  if (Number.isNaN(eligibleMs)) return null;
  const delayMs = Math.max(1, delayMinutes) * 60_000;
  return eligibleMs + delayMs;
}

export function isVoiceCallDueNow(
  summary: Record<string, unknown>,
  delayMinutes: number,
): boolean {
  const dueMs = voiceCallDueAtMs(summary, delayMinutes);
  return dueMs != null && Date.now() >= dueMs;
}

export function nurtureComposeFromJobSummary(
  summary: Record<string, unknown>,
  fallbackRationale?: string | null,
): NurtureOutboundCopy {
  const brief =
    (typeof summary.brief === "string" && summary.brief.trim()) ||
    (typeof summary.nurtureBrief === "string" && summary.nurtureBrief.trim()) ||
    (fallbackRationale?.trim()
      ? `Lead nurture follow-up. ${fallbackRationale.trim()}`
      : null);
  return {
    brief,
    campaignName:
      typeof summary.campaignName === "string"
        ? summary.campaignName
        : typeof summary.nurtureCampaignName === "string"
          ? summary.nurtureCampaignName
          : null,
    goal:
      typeof summary.goal === "string"
        ? summary.goal
        : typeof summary.nurtureGoal === "string"
          ? summary.nurtureGoal
          : null,
    voiceInstruction:
      typeof summary.voiceInstruction === "string"
        ? summary.voiceInstruction
        : null,
    subject:
      typeof summary.subject === "string" ? summary.subject : null,
    body: typeof summary.body === "string" ? summary.body : null,
  };
}

function voiceDelayComposePatch(
  compose: NurtureOutboundCopy,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (compose.brief?.trim()) patch.brief = compose.brief.trim();
  if (compose.campaignName?.trim()) patch.campaignName = compose.campaignName.trim();
  if (compose.goal?.trim()) patch.goal = compose.goal.trim();
  if (compose.voiceInstruction?.trim()) {
    patch.voiceInstruction = compose.voiceInstruction.trim();
  }
  if (compose.subject?.trim()) patch.subject = compose.subject.trim();
  if (compose.body?.trim()) patch.body = compose.body.trim();
  return patch;
}

/** Org wants voice nurture for leads with a phone (Configuration toggle). */
function voiceNurtureEnabled(settings: OrgNurtureSettingsView): boolean {
  return settings.nurtureCallEnabled;
}

/** First autonomous voice touch for a new unowned lead with a phone on file. */
export function isInitialVoiceNurtureEligible(input: {
  nurtureCallEnabled: boolean;
  phone: string | null | undefined;
  secondaryPhones?: string[];
  leadStatus: string | null | undefined;
  contactType: string | null | undefined;
  marketingOptOut: boolean;
  lastSentAt: Date | null | undefined;
  ownerUserId?: string | null;
}): boolean {
  if (!input.nurtureCallEnabled) return false;
  if (!resolveNurturePhone(input.phone, input.secondaryPhones)) return false;
  if (input.lastSentAt) return false;
  if (input.marketingOptOut) return false;
  if (input.ownerUserId?.trim()) return false;
  if (input.contactType && input.contactType !== "lead") return false;
  const status = (input.leadStatus ?? "").trim().toLowerCase();
  if (status === "converted" || status === "disqualified") return false;
  return status === "new";
}

/** This touch will attempt cc-core auto-bot-call (env + phone). */
function voicePrimary(
  settings: OrgNurtureSettingsView,
  ctx: NurtureTouchContext,
): boolean {
  return (
    voiceNurtureEnabled(settings) &&
    isCcCoreVoiceConfigured() &&
    Boolean(resolveNurturePhone(ctx.phone, ctx.secondaryPhones))
  );
}

async function tryVoiceSend(
  ctx: NurtureTouchContext,
  copy: NurtureOutboundCopy,
): Promise<
  | { ok: true; sessionId: string; channel?: string | null; cli?: string | null }
  | { ok: false; error: string }
> {
  const number = resolveNurturePhone(ctx.phone, ctx.secondaryPhones);
  if (!number) {
    return { ok: false, error: "no_phone" };
  }
  const digits = number.replace(/\D/g, "");
  if (digits.length < 7) {
    return { ok: false, error: "invalid_phone" };
  }

  const { data, instruction } = buildAutoBotCallPayload(ctx, copy);
  if (!instruction.trim()) {
    return { ok: false, error: "missing_voice_instruction" };
  }

  const result = await triggerAutoBotCall({
    organizationId: ctx.organizationId,
    number: digits,
    data,
    instruction,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    sessionId: result.sessionId,
    channel: result.channel,
    cli: result.cli,
  };
}

export type NurtureTouchPlan =
  | {
      action: "wait";
      nextRetryAt: Date;
      rationale: string;
      resultSummaryPatch: Record<string, unknown>;
    }
  | {
      action: "skip";
      rationale: string;
      reason: string;
      resultSummaryPatch: Record<string, unknown>;
    }
  | {
      action: "sent";
      outbound: Extract<NurtureOutboundResult, { ok: true }>;
      resultSummaryPatch: Record<string, unknown>;
    }
  | {
      action: "failed";
      error: string;
      reason: string;
      resultSummaryPatch: Record<string, unknown>;
    };

export async function executeNurtureOutboundTouch(input: {
  ctx: NurtureTouchContext;
  compose: NurtureOutboundCopy;
  settings: OrgNurtureSettingsView;
  job?: NurtureJobRow | null;
  score: number;
  rationale: string;
  fallbackBody?: string | null;
}): Promise<NurtureTouchPlan> {
  const { ctx, compose, settings, job, score, rationale, fallbackBody } = input;
  const summary = parseResultSummary(job?.resultSummary ?? null);
  // This is the final guard immediately before any voice, Campaign, or CRM
  // mailbox transport. It closes the race where a conversation opens while
  // the nurture LLM is deciding/composing.
  const conversationGate = await evaluateConversationNurtureGate({
    organizationId: ctx.organizationId,
    contactId: ctx.contactId,
    resultSummary: job?.resultSummary ?? null,
  });
  if (conversationGate.action !== "allow") {
    const gateRationale = conversationGateRationale(conversationGate);
    return {
      action: "wait",
      nextRetryAt: conversationGate.nextRetryAt,
      rationale: gateRationale,
      resultSummaryPatch: {
        ...conversationGateSummaryPatch(summary, conversationGate),
        score,
        rationale: gateRationale,
      },
    };
  }

  const scored = await findScoringJobByOrgContact(
    ctx.organizationId,
    ctx.contactId,
  ).catch(() => null);
  if (
    scored?.status === "scored" &&
    scored.score != null &&
    scored.score >= SALES_READY_SCORE
  ) {
    const salesReadyRationale =
      "Lead score is sales-ready, so nurture will not send.";
    return {
      action: "skip",
      rationale: salesReadyRationale,
      reason: "score_sales_ready",
      resultSummaryPatch: {
        ...summary,
        score: scored.score,
        rationale: salesReadyRationale,
        reason: "score_sales_ready",
      },
    };
  }
  const signalActivities = toSignalActivities(ctx.activitiesForIntent);

  if (voicePrimary(settings, ctx)) {
    const intent = assessNurtureVoiceIntent(signalActivities);
    if (intent.blocked) {
      return {
        action: "skip",
        rationale: `Lead showed buying intent (${intent.reason}) — nurture voice call skipped.`,
        reason: "lead_showed_intent",
        resultSummaryPatch: {
          ...summary,
          score,
          rationale,
          reason: "lead_showed_intent",
          intentBlock: intent.reason,
          callTouchEligibleAt: null,
        },
      };
    }

    const delayMs = Math.max(1, settings.nurtureCallDelayMinutes) * 60_000;
    const now = Date.now();
    let eligibleAtIso =
      typeof summary.callTouchEligibleAt === "string"
        ? summary.callTouchEligibleAt
        : null;

    if (!eligibleAtIso) {
      eligibleAtIso = new Date(now).toISOString();
      const callDueAt = new Date(now + delayMs);
      if (now < callDueAt.getTime()) {
        return {
          action: "wait",
          nextRetryAt: callDueAt,
          rationale: `Nurture voice call scheduled in ${settings.nurtureCallDelayMinutes} minutes.`,
          resultSummaryPatch: {
            ...summary,
            score,
            rationale,
            callTouchEligibleAt: eligibleAtIso,
            callDelayMinutes: settings.nurtureCallDelayMinutes,
            ...voiceDelayComposePatch(compose),
          },
        };
      }
    } else {
      const eligibleMs = new Date(eligibleAtIso).getTime();
      const callDueAt = new Date(eligibleMs + delayMs);
      if (now < callDueAt.getTime()) {
        return {
          action: "wait",
          nextRetryAt: callDueAt,
          rationale: `Nurture voice call scheduled in ${settings.nurtureCallDelayMinutes} minutes.`,
          resultSummaryPatch: {
            ...summary,
            score,
            rationale,
            callTouchEligibleAt: eligibleAtIso,
            callDelayMinutes: settings.nurtureCallDelayMinutes,
            ...voiceDelayComposePatch(compose),
          },
        };
      }
    }

    const voice = await tryVoiceSend(ctx, compose);
    if (voice.ok) {
      const triggeredAt = new Date().toISOString();
      const outbound: Extract<NurtureOutboundResult, { ok: true }> = {
        ok: true,
        transport: "voice_auto_bot",
        sessionId: voice.sessionId,
        channel: voice.channel ?? null,
        cli: voice.cli ?? null,
      };
      await recordNurtureOutboundSent({
        ctx,
        score,
        rationale,
        fallbackBody,
        outbound,
      });
      return {
        action: "wait",
        nextRetryAt: new Date(Date.now() + VOICE_OUTCOME_POLL_MS),
        rationale:
          "Nurture voice call placed; email follows if the customer does not answer.",
        resultSummaryPatch: {
          ...summary,
          score,
          rationale,
          callTouchEligibleAt: null,
          sessionId: voice.sessionId,
          transport: "voice_auto_bot",
          voiceOutcomePending: {
            sessionId: voice.sessionId,
            triggeredAt,
          },
          ...voiceDelayComposePatch(compose),
        },
      };
    }

    const outbound = await sendNurtureOutbound(ctx, compose);
    if (!outbound.ok) {
      return {
        action: "failed",
        error: `voice: ${voice.error}; ${outbound.error}`,
        reason: outbound.reason,
        resultSummaryPatch: {
          ...summary,
          score,
          rationale,
          voiceError: voice.error,
          callTouchEligibleAt: null,
        },
      };
    }
    await recordNurtureOutboundSent({
      ctx,
      score,
      rationale,
      fallbackBody,
      outbound,
    });
    return {
      action: "sent",
      outbound,
      resultSummaryPatch: {
        ...summary,
        score,
        rationale,
        voiceFallback: voice.error,
        callTouchEligibleAt: null,
        transport: outbound.transport,
      },
    };
  }

  const outbound = await sendNurtureOutbound(ctx, compose);
  if (!outbound.ok) {
    return {
      action: "failed",
      error: outbound.error,
      reason: outbound.reason,
      resultSummaryPatch: { ...summary, score, rationale },
    };
  }
  await recordNurtureOutboundSent({
    ctx,
    score,
    rationale,
    fallbackBody,
    outbound,
  });
  return {
    action: "sent",
    outbound,
    resultSummaryPatch: { ...summary, score, rationale, transport: outbound.transport },
  };
}

export function nurtureReachableForSend(input: {
  ctx: NurtureTouchContext;
  settings: OrgNurtureSettingsView;
}): boolean {
  const email = resolveNurtureEmail(input.ctx.email, input.ctx.secondaryEmails);
  const phone = resolveNurturePhone(input.ctx.phone, input.ctx.secondaryPhones);
  if (voiceNurtureEnabled(input.settings)) {
    return Boolean(phone || email);
  }
  return Boolean(email);
}

export function nurtureTransportAvailableForOrg(
  ctx: NurtureSendContext,
  settings: OrgNurtureSettingsView,
  secondaryPhones?: string[],
): boolean {
  if (
    settings.nurtureCallEnabled &&
    isCcCoreVoiceConfigured() &&
    resolveNurturePhone(ctx.phone, secondaryPhones)
  ) {
    return true;
  }
  return isCampaignApiConfigured() || ctx.hasCrmBotMailbox;
}

export function nurtureComposeReadyForTouch(
  compose: NurtureOutboundCopy,
  settings: OrgNurtureSettingsView,
  ctx: NurtureTouchContext,
): boolean {
  const brief = compose.brief?.trim();
  if (brief) return true;
  if (
    voicePrimary(settings, ctx) &&
    isCcCoreVoiceConfigured()
  ) {
    return false;
  }
  if (isCampaignApiConfigured()) {
    return false;
  }
  return Boolean(compose.subject?.trim() && compose.body?.trim());
}
