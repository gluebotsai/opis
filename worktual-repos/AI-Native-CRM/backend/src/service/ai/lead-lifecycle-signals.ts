/**
 * Signal extraction for the Lead Lifecycle Agent.
 *
 * Phase A treats activity bodies (call notes, email text, meeting notes) as the
 * transcript surface. When a provider or manual upload fills
 * `contact_activities.transcript_text`, the same extractor runs over the richer
 * text and caches the result in `transcript_insights` — the decision layer only
 * ever reads the resulting `LifecycleSignals`, so ingest can land later without
 * touching the rules.
 */

import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";

export type LifecycleSignals = {
  declined: boolean;
  lost: boolean;
  inboundReply: boolean;
  meetingHeld: boolean;
  meetingBooked: boolean;
  demoRequested: boolean;
  discoveryDone: boolean;
  pricingInterest: boolean;
  quoteRequested: boolean;
  negotiating: boolean;
  accepted: boolean;
  paymentConfirmed: boolean;
  budget: boolean;
  authority: boolean;
  need: boolean;
  timeline: boolean;
  /** Free-text evidence for the audit note, newest first. */
  evidence: string[];
  /** ISO timestamp of the newest activity that raised each signal. */
  signalAt: Partial<Record<SignalKey, string>>;
};

export type SignalKey = Exclude<keyof LifecycleSignals, "evidence" | "signalAt">;

export type SignalActivity = {
  type: string;
  subject: string;
  body: string | null;
  emailDirection: string | null;
  createdAt: string;
  dueAt?: string | null;
  transcriptText?: string | null;
  transcriptSource?: string | null;
  transcriptInsights?: unknown;
};

export function emptySignals(): LifecycleSignals {
  return {
    declined: false,
    lost: false,
    inboundReply: false,
    meetingHeld: false,
    meetingBooked: false,
    demoRequested: false,
    discoveryDone: false,
    pricingInterest: false,
    quoteRequested: false,
    negotiating: false,
    accepted: false,
    paymentConfirmed: false,
    budget: false,
    authority: false,
    need: false,
    timeline: false,
    evidence: [],
    signalAt: {},
  };
}

const PATTERNS: Array<{
  key: SignalKey;
  re: RegExp;
  label: string;
}> = [
  {
    key: "declined",
    re: /\b(not interested|no longer interested|do not contact|stop emailing|please remove me|take me off|wrong person|no thanks|not the right (time|fit))\b/,
    label: "declined outreach",
  },
  {
    key: "lost",
    re: /\b(going with another|chose a competitor|selected another vendor|not moving forward|decided against|budget was cut|project (is )?cancell?ed)\b/,
    label: "loss signal",
  },
  {
    key: "meetingBooked",
    re: /\b(booked a (demo|call|meeting)|scheduled (a )?(demo|call|meeting)|calendar invite|invite sent|see you on|looking forward to (our|the) (call|demo|meeting))\b/,
    label: "meeting booked",
  },
  {
    key: "demoRequested",
    re: /\b(schedule (?:a )?(?:call|meeting|demo)|book (?:a )?(?:demo|call|meeting)|can we (?:meet|schedule)|product demo|walk ?through|show me (?:the )?product)\b/i,
    label: "demo requested",
  },
  {
    key: "discoveryDone",
    re: /\b(discovery|requirements|current setup|pain points|use case|walkthrough|scoping)\b/,
    label: "discovery covered",
  },
  {
    key: "pricingInterest",
    re: /\b(pricing|price list|how much|cost|rate card|budget range|per seat|licen[cs]e cost)\b/,
    label: "pricing interest",
  },
  {
    key: "quoteRequested",
    re: /\b(send (me )?(a |the )?(quote|quotation|proposal)|share (a |the )?(quote|proposal)|formal (quote|proposal)|can we get a quote)\b/,
    label: "quote requested",
  },
  {
    key: "negotiating",
    re: /\b(discount|counter[- ]?offer|revised (pricing|quote)|payment terms|net 30|negotiat|redlines?|legal review)\b/,
    label: "negotiating terms",
  },
  {
    key: "accepted",
    re: /\b(we accept|accepted the (quote|proposal)|approved the (quote|proposal)|happy to proceed|let'?s proceed|go ahead with the (quote|proposal|order)|(counter[- ]?)?signed the (contract|quote|agreement)|purchase order|po number|send (us )?the (invoice|contract))\b/,
    label: "acceptance",
  },
  {
    key: "paymentConfirmed",
    re: /\b(payment (sent|made|processed|released)|paid the invoice|invoice (is )?paid|wire (sent|transferred)|funds transferred)\b/,
    label: "payment confirmed",
  },
  {
    key: "budget",
    re: /\b(budget (approved|allocated|available)|we have budget|budget of|allocated funds)\b/,
    label: "budget confirmed",
  },
  {
    key: "authority",
    re: /\b(decision maker|i(') ?ll (approve|sign)|my approval|i own the (budget|decision)|final say|procurement)\b/,
    label: "authority confirmed",
  },
  {
    key: "need",
    re: /\b(we need|we'?re looking for|struggling with|problem is|pain point|must have|requirement)\b/,
    label: "need expressed",
  },
  {
    key: "timeline",
    re: /\b(this quarter|next quarter|by (january|february|march|april|may|june|july|august|september|october|november|december)|within \d+ (days|weeks|months)|go[- ]?live|deadline|asap|kick ?off)\b/,
    label: "timeline stated",
  },
];

/**
 * Signals that commit money or kill a lead must come from the customer, never
 * from our own outbound copy — otherwise a sales email that says "let me know
 * if you accept" would close the deal.
 *
 * Soft engagement / discovery / pricing cues on email must also be inbound —
 * otherwise Meeting Miss / demo-escalation mail and our own outbound copy
 * elevate lifecycle without real buyer intent.
 */
const CUSTOMER_VOICE_ONLY: ReadonlySet<SignalKey> = new Set([
  "declined",
  "lost",
  "quoteRequested",
  "accepted",
  "paymentConfirmed",
  "meetingBooked",
  "discoveryDone",
  "pricingInterest",
  "negotiating",
  "need",
  "timeline",
  "budget",
  "authority",
]);

/** Internal / system timeline noise — never treat as customer engagement. */
const INTERNAL_NOISE_RE =
  /\b(meeting miss|escalation required|outcome capture required|no capture evidence|lifecycle agent:|nurture agent|lead enrichment|auto-?reply|\[high\])\b/i;

export function isInternalNoiseActivity(activity: {
  type: string;
  subject?: string | null;
  body?: string | null;
}): boolean {
  const blob = `${activity.subject ?? ""}\n${activity.body ?? ""}`;
  if (INTERNAL_NOISE_RE.test(blob)) return true;
  if (
    activity.type === "note" &&
    /\b(lifecycle agent|nurture agent|lead scoring|assignment agent)\b/i.test(
      activity.subject ?? "",
    )
  ) {
    return true;
  }
  return false;
}

function isCustomerVoice(activity: SignalActivity): boolean {
  if (activity.type === "email") return activity.emailDirection === "inbound";
  // Calls, meetings, transcripts and notes record what the customer said.
  // Agent-written system notes are filtered via isInternalNoiseActivity.
  return true;
}

/** Exported for commercial acceptance — inbound email must be customer-voice. */
export function isCustomerVoiceActivity(activity: SignalActivity): boolean {
  if (isInternalNoiseActivity(activity)) return false;
  return isCustomerVoice(activity);
}

/**
 * Everything after a footer marker is boilerplate — the unsubscribe block of a
 * newsletter must never read as "this lead declined".
 */
const FOOTER_MARKER =
  /(unsubscribe|view (this email )?in (your )?browser|manage (your )?preferences|email preferences|privacy policy|all rights reserved|©|&copy;|sent to you because)/i;

const MAX_SCAN_CHARS = 4000;

function plainText(input: string | null | undefined): string {
  if (!input) return "";
  const stripped = input
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const footer = stripped.search(FOOTER_MARKER);
  const body = footer > 0 ? stripped.slice(0, footer) : stripped;
  return body.slice(0, MAX_SCAN_CHARS).trim();
}

function raise(
  signals: LifecycleSignals,
  key: SignalKey,
  at: string,
): void {
  signals[key] = true;
  if (!signals.signalAt[key]) signals.signalAt[key] = at;
}

function mergeInsightFlags(
  signals: LifecycleSignals,
  insights: unknown,
  customerVoice: boolean,
  at: string,
): void {
  if (!insights || typeof insights !== "object" || Array.isArray(insights)) {
    return;
  }
  const record = insights as Record<string, unknown>;
  for (const { key } of PATTERNS) {
    if (record[key] !== true) continue;
    if (!customerVoice && CUSTOMER_VOICE_ONLY.has(key)) continue;
    raise(signals, key, at);
  }
  const evidence = record.evidence;
  if (Array.isArray(evidence)) {
    for (const item of evidence) {
      if (typeof item === "string" && item.trim()) {
        signals.evidence.push(item.trim().slice(0, 160));
      }
    }
  }
}

/**
 * Keyword pass over every text surface on the timeline. Deterministic and
 * always runs, so the agent behaves identically with or without an AI provider.
 */
export function extractSignals(
  activities: SignalActivity[],
  extraText?: string | null,
): LifecycleSignals {
  const signals = emptySignals();

  for (const activity of activities) {
    if (isInternalNoiseActivity(activity)) continue;

    if (
      activity.type === "email" &&
      activity.emailDirection === "inbound"
    ) {
      signals.inboundReply = true;
    }
    if (activity.type === "meeting" || activity.type === "call") {
      // Production: "meeting held" for auto-advance requires conversation text.
      // Calendar due time alone must not elevate the lead.
      const when = activity.dueAt
        ? new Date(activity.dueAt).getTime()
        : new Date(activity.createdAt).getTime();
      const happened = when <= Date.now();
      // Prefer structured insights / meeting analysis over raw transcript text.
      const hasStructured =
        activity.transcriptInsights != null ||
        Boolean(activity.transcriptText?.trim());
      if (happened && hasStructured) {
        signals.meetingHeld = true;
        signals.evidence.push(
          activity.transcriptInsights
            ? `meeting analysis (${activity.type})`
            : `meeting transcript (${activity.type})`,
        );
      }
    }

    const customerVoice = isCustomerVoice(activity);
    mergeInsightFlags(
      signals,
      activity.transcriptInsights,
      customerVoice,
      activity.createdAt,
    );

    // When structured insights exist, do not re-scan raw transcript for
    // lifecycle evidence (Meeting Analysis owns that contract).
    const text = [
      plainText(activity.subject),
      plainText(activity.body),
      activity.transcriptInsights
        ? ""
        : plainText(activity.transcriptText),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!text) continue;

    for (const { key, re, label } of PATTERNS) {
      if (signals[key]) continue;
      if (!customerVoice && CUSTOMER_VOICE_ONLY.has(key)) continue;
      if (re.test(text)) {
        raise(signals, key, activity.createdAt);
        signals.evidence.push(`${label} (${activity.type})`);
      }
    }
  }

  const tail = plainText(extraText).toLowerCase();
  if (tail) {
    for (const { key, re, label } of PATTERNS) {
      if (signals[key]) continue;
      if (re.test(tail)) {
        signals[key] = true;
        signals.evidence.push(`${label} (notes)`);
      }
    }
  }

  return signals;
}

/**
 * Optional LLM pass that upgrades the keyword read of a transcript into
 * structured insights. Runs on the Python ai-service (own-server LLM).
 * Returns null when unavailable — callers keep the deterministic result.
 */
export async function analyzeTranscript(
  transcript: string,
): Promise<Record<string, unknown> | null> {
  const text = plainText(transcript).slice(0, 6000);
  if (text.length < 12) return null;

  const py = await callAiServiceAgent<{
    ok?: boolean;
    insights?: Record<string, unknown> | null;
  }>("analyze-transcript", { transcript: text }, { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS });

  if (py?.ok && py.insights && typeof py.insights === "object") {
    return py.insights;
  }
  return null;
}
