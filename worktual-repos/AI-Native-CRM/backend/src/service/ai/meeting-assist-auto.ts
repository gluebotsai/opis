/**
 * Schedule KB assist only for customer-attributed transcript
 * (never Chrome-mic / sales-rep speech).
 */

import {
  isWeakAssistFragment,
  scoreQueryCandidate,
} from "@/lib/meeting-assist-questions";
import { shouldAutoAssistFromChunk } from "@/lib/meeting-assist-speakers";
import { getActiveMeetingAssistViewerIds } from "@/service/meeting-assist/active-viewers";
import { isCustomerMeetingAssistSession } from "@/service/meeting-assist/customer-session-gate";
import { groupViewerIdsByPersona } from "@/service/meeting-assist/persona";
import { appendLatencyMark } from "@/lib/meeting-assist-latency";
import { publishMeetingAssistEvent } from "@/service/ai/meeting-assist-events";
import { runMeetingAssist } from "@/service/ai/meeting-assist";
import {
  stashLiveLatencyTrace,
  takeLiveLatencyTrace,
} from "@/service/ai/meeting-assist-live-timing-store";
import { prisma } from "@/dao/db/prisma";
import type { AssistResult } from "@/service/ai/meeting-assist";

type Pending = {
  timer: ReturnType<typeof setTimeout> | null;
  /** Latest customer line waiting out the short coalesce window. */
  pendingText: string;
  lastAssistAt: number;
  lastQueryHash: string;
  lastQueryScore: number;
  mode: "sales" | "service" | "auto";
};

type PendingReplay = {
  query: string;
  mode: "sales" | "service" | "auto";
  hash: string;
  at: number;
};

const pending = new Map<string, Pending>();
const pendingReplay = new Map<string, PendingReplay>();

const REPLAY_MAX_AGE_MS = Number(process.env.LIVE_ASSIST_REPLAY_MAX_MS || 120_000);
/** Hold briefly so a speech-to-text revision of the same sentence is one turn. */
const LINE_COALESCE_MS = 400;

function queryHash(q: string): string {
  return q.trim().toLowerCase().slice(0, 160);
}

function getPending(sessionId: string): Pending {
  let p = pending.get(sessionId);
  if (!p) {
    p = {
      timer: null,
      pendingText: "",
      lastAssistAt: 0,
      lastQueryHash: "",
      lastQueryScore: 0,
      mode: "auto",
    };
    pending.set(sessionId, p);
  }
  return p;
}

async function runAssistTurn(
  sessionId: string,
  query: string,
  mode: "sales" | "service" | "auto",
  publishTargets: string[] | null,
): Promise<void> {
  const targets = publishTargets?.filter((id) => id.trim()) ?? [];
  if (targets.length === 0) {
    await runMeetingAssist({
      sessionId,
      query,
      mode,
      publishTargets: [],
    });
    return;
  }
  const groups = await groupViewerIdsByPersona(targets);
  if (groups.size === 0) {
    // Panel is open but CRM role has no persona (or Google email mapped
    // oddly) — still coach so Ask / live captions are not silently dropped.
    await runMeetingAssist({
      sessionId,
      query,
      mode,
      persona: "sales",
      publishTargets: targets,
    });
    return;
  }
  await Promise.all(
    [...groups.entries()].map(([persona, personaTargets]) =>
      runMeetingAssist({
        sessionId,
        query,
        mode,
        persona,
        publishTargets: personaTargets,
      }),
    ),
  );
}

/**
 * Every distinct customer line reaches the agent.
 * The same wording is skipped so a repeated draft does not call twice.
 */
export function shouldSkipAssistQuery(input: {
  query: string;
  score: number;
  hash: string;
  lastQueryHash: string;
  lastQueryScore: number;
  lastAssistAt: number;
  now: number;
  reason: "query" | "rolling";
}): boolean {
  const cleaned = input.query.trim();
  if (!cleaned || isWeakAssistFragment(cleaned)) return true;
  if (input.hash && input.hash === input.lastQueryHash) return true;
  return false;
}

async function fireAssistForActiveViewers(
  sessionId: string,
  query: string,
  mode: "sales" | "service" | "auto",
  reason: "query" | "rolling",
) {
  const p = getPending(sessionId);
  const cleaned = query.trim();
  if (!cleaned || isWeakAssistFragment(cleaned)) return;

  if (!(await isCustomerMeetingAssistSession(sessionId))) return;

  const score = scoreQueryCandidate(cleaned);
  const hash = queryHash(cleaned);
  const now = Date.now();

  if (
    shouldSkipAssistQuery({
      query: cleaned,
      score,
      hash,
      lastQueryHash: p.lastQueryHash,
      lastQueryScore: p.lastQueryScore,
      lastAssistAt: p.lastAssistAt,
      now,
      reason,
    })
  ) {
    return;
  }

  p.lastQueryHash = hash;
  p.lastQueryScore = score;
  p.lastAssistAt = now;

  const scheduleStarted = new Date().toISOString();
  let trace = takeLiveLatencyTrace(sessionId);
  if (trace) {
    trace = appendLatencyMark(trace, {
      stage: "assist_schedule",
      startedAt: scheduleStarted,
      endedAt: new Date().toISOString(),
    });
    stashLiveLatencyTrace(sessionId, trace);
  }

  const viewerIds = getActiveMeetingAssistViewerIds(sessionId);
  if (viewerIds.length === 0) {
    pendingReplay.set(sessionId, {
      query: cleaned,
      mode,
      hash,
      at: Date.now(),
    });
    try {
      await runAssistTurn(sessionId, cleaned, mode, []);
    } catch (err) {
      console.error("auto meeting assist (precompute) failed", err);
    }
    return;
  }

  try {
    await runAssistTurn(sessionId, cleaned, mode, viewerIds);
    pendingReplay.delete(sessionId);
  } catch (err) {
    console.error("auto meeting assist failed", err);
  }
}

/** When the Meet panel SSE connects, push coach immediately (no wait for next Vexa poll). */
export async function replayPendingAssistForSession(
  sessionId: string,
  viewerUserId: string,
): Promise<void> {
  const sid = sessionId.trim();
  const uid = viewerUserId.trim();
  if (!sid || !uid) return;

  const session = await prisma.meetingAssistSession.findUnique({
    where: { id: sid },
    select: { lastAssistAt: true, lastSuggestions: true },
  });

  const pr = pendingReplay.get(sid);
  if (pr && Date.now() - pr.at < REPLAY_MAX_AGE_MS) {
    pendingReplay.delete(sid);
    const precomputed =
      session?.lastAssistAt &&
      session.lastAssistAt.getTime() >= pr.at - 2_000 &&
      session.lastSuggestions;
    if (precomputed) {
      const result = session.lastSuggestions as AssistResult & {
        query?: string | null;
      };
      const replayEvent = {
        type: "assist" as const,
        result: { ...result, ok: result.ok ?? true },
      };
      publishMeetingAssistEvent(sid, replayEvent);
      return;
    }
    try {
      await runAssistTurn(sid, pr.query, pr.mode, [uid]);
    } catch (err) {
      console.error("assist replay (pending) failed", err);
    }
    return;
  }

  if (!session?.lastAssistAt || !session.lastSuggestions) return;
  const age = Date.now() - session.lastAssistAt.getTime();
  if (age > REPLAY_MAX_AGE_MS) return;

  const result = session.lastSuggestions as AssistResult & { query?: string | null };
  const hasCoaching =
    Boolean((result.talkTrack || "").trim()) ||
    (result.suggestions || []).some((s) => (s.text || "").trim()) ||
    (result.nextQuestions || []).some((q) => (q || "").trim());
  if (!hasCoaching) return;

  const replayEvent = {
    type: "assist" as const,
    result: { ...result, ok: result.ok ?? true },
  };
  publishMeetingAssistEvent(sid, replayEvent);
}

export function scheduleAutoMeetingAssist(input: {
  sessionId: string;
  text: string;
  speaker?: string | null;
  source?: string | null;
  /** Channel/turn lock from classifyAttendeeTurn — the only identity
   * signal Assist trusts. See shouldAutoAssistFromChunk. */
  attendeeRole?: "host" | "customer" | "other" | "unknown" | null;
  channelResolution?: "employee" | "pending" | "ambiguous" | "ready-unbound" | null;
  mode?: "sales" | "service" | "auto";
  force?: boolean;
}): void {
  const text = input.text.trim();
  if (!text) return;

  const isCustomer = shouldAutoAssistFromChunk({
    source: input.source,
    attendeeRole: input.attendeeRole,
    channelResolution: input.channelResolution,
  });
  if (!isCustomer) return;

  const p = getPending(input.sessionId);
  if (input.mode) p.mode = input.mode;
  else p.mode = "auto";

  const words = text.split(/\s+/).filter(Boolean);
  const liveCustomerLine =
    /live_pcm|vexa_live/.test(input.source || "") &&
    (words.length >= 2 || text.length >= 8);
  if (!input.force && isWeakAssistFragment(text) && !liveCustomerLine) return;

  // Each customer line is its own turn. A short wait keeps a speech-to-text
  // revision of the same sentence as one call, then the latest wording is sent.
  p.pendingText = text;
  if (p.timer) clearTimeout(p.timer);
  p.timer = setTimeout(() => {
    p.timer = null;
    const spoken = (p.pendingText || text).trim();
    p.pendingText = "";
    if (!spoken) return;
    void fireAssistForActiveViewers(input.sessionId, spoken, p.mode, "query");
  }, LINE_COALESCE_MS);
}

export function clearAutoMeetingAssist(sessionId: string): void {
  const p = pending.get(sessionId);
  if (p?.timer) clearTimeout(p.timer);
  pending.delete(sessionId);
  pendingReplay.delete(sessionId);
}
