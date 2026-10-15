import type { Prisma } from "@prisma/client";
import { findScoringJobByOrgContact } from "@/dao/ai/lead-scoring-store";
import {
  loadOmniChannelSummary,
  omniChannelHash,
} from "@/service/ai/lead-summary-agent";
import {
  lookupLiveConversations,
  type LiveConversationsResult,
} from "@/service/integrations/cc-core-live-conversations";

export const CONVERSATION_GATE_RETRY_MS = 30_000;
/** Wait this long before asking for the post-chat score again. */
export const RESCORE_RETRY_MS = 90_000;
/**
 * Release nurture when the live-conversation lookup stays down, or the chat
 * has ended and no new omnichannel summary arrives.
 */
export const GATE_RELEASE_MS = 15 * 60_000;
export const POST_CONVERSATION_SCORE_TRIGGER =
  "conversation_closed_omni_summary";

export type ConversationGateState = {
  phase:
    | "api_unavailable"
    | "awaiting_conversation"
    | "live_conversation"
    | "awaiting_summary"
    | "awaiting_rescore";
  observedLiveAt?: string;
  /** When an api_unavailable hold started. A later check keeps this value. */
  holdStartedAt?: string;
  baselineOmniHash?: string | null;
  summaryHash?: string;
  rescoreRequestedAt?: string;
  lastCheckedAt: string;
  channels?: string[];
  conversationIds?: string[];
  error?: string;
};

export type ConversationGateDecision =
  | { action: "allow" }
  | {
      action: "wait";
      reason:
        | "live_conversation"
        | "live_conversation_api_unavailable"
        | "awaiting_live_conversation"
        | "awaiting_omni_summary"
        | "awaiting_post_conversation_score";
      state: ConversationGateState;
      nextRetryAt: Date;
    }
  | {
      action: "rescore";
      reason: "omni_summary_ready";
      state: ConversationGateState;
      nextRetryAt: Date;
    };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function conversationGateFromSummary(
  summary: Prisma.JsonValue | Record<string, unknown> | null | undefined,
): ConversationGateState | null {
  const raw = record(record(summary)?.conversationGate);
  if (!raw) return null;
  const phase = raw.phase;
  const lastCheckedAt = raw.lastCheckedAt;
  if (
    (phase !== "api_unavailable" &&
      phase !== "awaiting_conversation" &&
      phase !== "live_conversation" &&
      phase !== "awaiting_summary" &&
      phase !== "awaiting_rescore") ||
    typeof lastCheckedAt !== "string"
  ) {
    return null;
  }
  return raw as ConversationGateState;
}

export function decideConversationNurtureGate(input: {
  lookup: LiveConversationsResult;
  currentOmniHash: string | null;
  prior: ConversationGateState | null;
  postConversationScoreReady: boolean;
  /**
   * True while a post-chat score is already running or queued for a future
   * retry. The gate then waits instead of enqueueing another run.
   */
  rescoreInFlight?: boolean;
  now: Date;
}): ConversationGateDecision {
  const {
    lookup,
    currentOmniHash,
    prior,
    postConversationScoreReady,
    rescoreInFlight = false,
    now,
  } = input;
  const nowIso = now.toISOString();
  const nextRetryAt = new Date(now.getTime() + CONVERSATION_GATE_RETRY_MS);

  if (!lookup.ok) {
    const continuing = prior?.phase === "api_unavailable";
    const holdStartedAt =
      continuing && prior.holdStartedAt ? prior.holdStartedAt : nowIso;
    if (continuing && holdExpired(holdStartedAt, now)) {
      return { action: "allow" };
    }
    return {
      action: "wait",
      reason: "live_conversation_api_unavailable",
      nextRetryAt,
      state: {
        ...prior,
        phase: "api_unavailable",
        holdStartedAt,
        lastCheckedAt: nowIso,
        error: lookup.error,
      },
    };
  }

  if (lookup.live) {
    const firstObservation = !prior?.observedLiveAt;
    return {
      action: "wait",
      reason: "live_conversation",
      nextRetryAt,
      state: {
        phase: "live_conversation",
        observedLiveAt: firstObservation ? nowIso : prior.observedLiveAt,
        // Track the latest summary seen while the chat is still open, so the
        // summary written after it ends is the one that can release nurture.
        baselineOmniHash: currentOmniHash ?? prior?.baselineOmniHash ?? null,
        lastCheckedAt: nowIso,
        channels: lookup.channels,
        conversationIds: lookup.conversations.map(
          (conversation) => conversation.conversationId,
        ),
      },
    };
  }

  // No channel is live. A conversation that was never seen does not block
  // nurture. Wait for the interaction summary only after a live conversation
  // has been observed and has now ended.
  if (!prior?.observedLiveAt) {
    return { action: "allow" };
  }

  if (prior.phase === "awaiting_rescore") {
    // Ready means the latest completed score was written against the current
    // omnichannel summary. The numeric score may be unchanged.
    if (postConversationScoreReady) return { action: "allow" };
    if (!currentOmniHash) {
      if (summaryHoldExpired(prior, now)) return { action: "allow" };
      return {
        action: "wait",
        reason: "awaiting_omni_summary",
        nextRetryAt,
        state: {
          ...prior,
          phase: "awaiting_summary",
          lastCheckedAt: nowIso,
        },
      };
    }
    const requestedAt = prior.rescoreRequestedAt
      ? new Date(prior.rescoreRequestedAt).getTime()
      : Number.NaN;
    const sinceRequestMs = Number.isFinite(requestedAt)
      ? now.getTime() - requestedAt
      : Number.POSITIVE_INFINITY;
    if (!rescoreInFlight && sinceRequestMs >= RESCORE_RETRY_MS) {
      return {
        action: "rescore",
        reason: "omni_summary_ready",
        nextRetryAt,
        state: {
          ...prior,
          phase: "awaiting_rescore",
          summaryHash: currentOmniHash,
          rescoreRequestedAt: nowIso,
          lastCheckedAt: nowIso,
        },
      };
    }
    return {
      action: "wait",
      reason: "awaiting_post_conversation_score",
      nextRetryAt,
      state: {
        ...prior,
        phase: "awaiting_rescore",
        lastCheckedAt: nowIso,
      },
    };
  }

  if (
    currentOmniHash &&
    currentOmniHash !== (prior.baselineOmniHash ?? null)
  ) {
    return {
      action: "rescore",
      reason: "omni_summary_ready",
      nextRetryAt,
      state: {
        ...prior,
        phase: "awaiting_rescore",
        summaryHash: currentOmniHash,
        rescoreRequestedAt: nowIso,
        lastCheckedAt: nowIso,
      },
    };
  }

  if (summaryHoldExpired(prior, now)) return { action: "allow" };

  return {
    action: "wait",
    reason: "awaiting_omni_summary",
    nextRetryAt,
    state: {
      ...prior,
      phase: "awaiting_summary",
      lastCheckedAt: nowIso,
    },
  };
}

function holdExpired(startedAt: string, now: Date): boolean {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return false;
  return now.getTime() - started >= GATE_RELEASE_MS;
}

function summaryHoldExpired(prior: ConversationGateState, now: Date): boolean {
  return Boolean(prior.observedLiveAt && holdExpired(prior.observedLiveAt, now));
}

export async function evaluateConversationNurtureGate(input: {
  organizationId: string;
  contactId: string;
  resultSummary?: Prisma.JsonValue | Record<string, unknown> | null;
}): Promise<ConversationGateDecision> {
  const prior = conversationGateFromSummary(input.resultSummary);
  try {
    const [lookup, summary, scoringJob] = await Promise.all([
      lookupLiveConversations({
        organizationId: input.organizationId,
        identifier: input.contactId,
      }),
      loadOmniChannelSummary(input.contactId),
      prior?.phase === "awaiting_rescore"
        ? findScoringJobByOrgContact(input.organizationId, input.contactId)
        : Promise.resolve(null),
    ]);

    const now = new Date();
    const requestedAt = prior?.rescoreRequestedAt
      ? new Date(prior.rescoreRequestedAt).getTime()
      : Number.NaN;
    const scoreSummary = record(scoringJob?.resultSummary);
    const scoreFingerprint =
      typeof scoreSummary?.signalFingerprint === "string"
        ? scoreSummary.signalFingerprint
        : null;
    const currentOmniHash = omniChannelHash(summary);
    const postConversationScoreReady =
      prior?.phase === "awaiting_rescore" &&
      scoringJob?.status === "scored" &&
      Number.isFinite(requestedAt) &&
      scoringJob.updatedAt.getTime() >= requestedAt &&
      Boolean(
        currentOmniHash &&
          scoreFingerprint?.startsWith(`${currentOmniHash}|`),
      );
    const rescoreInFlight =
      scoringJob?.status === "scoring" ||
      (scoringJob?.status === "pending" &&
        scoringJob.nextRetryAt != null &&
        scoringJob.nextRetryAt.getTime() > now.getTime());

    return decideConversationNurtureGate({
      lookup,
      currentOmniHash,
      prior,
      postConversationScoreReady,
      rescoreInFlight,
      now,
    });
  } catch (error) {
    return decideConversationNurtureGate({
      lookup: {
        ok: false,
        error:
          error instanceof Error
            ? `live_conversation_guard_failed: ${error.message}`
            : "live_conversation_guard_failed",
      },
      currentOmniHash: null,
      prior,
      postConversationScoreReady: false,
      now: new Date(),
    });
  }
}

export function conversationGateRationale(
  decision: Exclude<ConversationGateDecision, { action: "allow" }>,
): string {
  if (
    decision.action === "rescore" ||
    decision.reason === "awaiting_post_conversation_score"
  ) {
    return "Customer conversation ended; waiting for a fresh score from the completed omnichannel summary.";
  }
  if (decision.reason === "live_conversation") {
    return "Customer is in an active Contact Center conversation; nurture is paused.";
  }
  if (decision.reason === "awaiting_live_conversation") {
    return "Nurture waits until the customer conversation ends and the interaction summary is updated.";
  }
  if (decision.reason === "awaiting_omni_summary") {
    return "Customer conversation ended; waiting for the omnichannel summary.";
  }
  return "Live-conversation safety check is unavailable; nurture is paused.";
}

export function conversationGateSummaryPatch(
  summary: Prisma.JsonValue | Record<string, unknown> | null | undefined,
  decision: Exclude<ConversationGateDecision, { action: "allow" }>,
): Prisma.InputJsonObject {
  return {
    ...(record(summary) ?? {}),
    reason: decision.reason,
    rationale: conversationGateRationale(decision),
    conversationGate: decision.state,
  } as Prisma.InputJsonObject;
}
