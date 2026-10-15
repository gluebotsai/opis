/**
 * Lead score is activity engagement only (0–100). Fit stays 0.
 * Industry, ICP, and geography do not change the number.
 * Production scoring runs in Python `score-lead` agent (LLM primary).
 * `scoreLeadHeuristic` here is for scripts/tests only — not a runtime fallback.
 * Assignment gate: total ≥ 40.
 */

export type LeadGrade = "A" | "B" | "C" | "D";
export type LeadScoreBand = "cold" | "warm" | "hot";

export type LeadScoreBreakdown = Record<string, number>;

/** @deprecated Prefer fitScore / intentScore; kept for legacy UI consumers. */
export type LeadScorePillars = {
  demographics: number;
  firmographics: number;
  behavioural: number;
};

export const PILLAR_MAX = {
  demographics: 25,
  firmographics: 25,
  behavioural: 50,
} as const;

export type LeadIcpConfig = {
  targetIndustries?: string[];
  adjacentIndustries?: string[];
  /** Preferred employee-count tiers, e.g. ["51-200","201-1000"] */
  sizeTiers?: string[];
  serviceableGeos?: string[];
};

export type LeadScoreResult = {
  score: number;
  fitScore: number;
  intentScore: number;
  band: LeadScoreBand;
  grade: LeadGrade;
  salesReady: boolean;
  rationale: string;
  scoreBreakdown: LeadScoreBreakdown;
  pillars: LeadScorePillars;
  positiveReasons: string[];
  negativeReasons: string[];
  behaviouralPositiveReasons: string[];
  behaviouralNegativeReasons: string[];
  behaviouralReasons: string[];
  factors: string[];
  nextBestAction: string;
  /** ai = Python LLM path; heuristic = offline fallback */
  source?: "ai" | "heuristic";
};

export const SALES_READY_SCORE = 40;

export function gradeFromScore(score: number): LeadGrade {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

export function bandFromScore(score: number): LeadScoreBand {
  if (score >= 70) return "hot";
  if (score >= SALES_READY_SCORE) return "warm";
  return "cold";
}

export function isSalesReadyScore(score: number): boolean {
  return score >= SALES_READY_SCORE;
}

const SENIOR_C_LEVEL =
  /\b(ceo|cto|cfo|coo|cmo|founder|co-?founder|owner|president|chief|managing\s+director)\b/i;
const SENIOR_VP = /\b(vp|vice[\s-]?president)\b/i;
const SENIOR_DIR = /\b(director|head\s+of)\b/i;
const SENIOR_MGR = /\b(manager|lead)\b/i;

const HIGH_INTENT_SOURCES = new Set([
  "website",
  "web_form",
  "form",
  "landing_page",
  "campaign",
  "marketing",
  "chatbot",
  "chat",
  "referral",
  "inbound",
  "demo_request",
  "contact_us",
]);

const FREE_MAIL =
  /^(gmail|googlemail|yahoo|hotmail|outlook|live|msn|icloud|me|aol|proton|protonmail|zoho|yandex|mail)\./i;

export type SeniorityTier =
  | "c_level"
  | "vp"
  | "director"
  | "manager"
  | "individual_contributor"
  | "unknown";

export function classifySeniorityTier(title: string | null | undefined): SeniorityTier {
  const t = title?.trim() || "";
  if (!t) return "unknown";
  if (SENIOR_C_LEVEL.test(t)) return "c_level";
  if (SENIOR_VP.test(t)) return "vp";
  if (SENIOR_DIR.test(t)) return "director";
  if (SENIOR_MGR.test(t)) return "manager";
  return "individual_contributor";
}

export function emailDomainType(
  email: string | null | undefined,
): "corporate" | "personal" {
  const domain = email?.split("@")[1]?.toLowerCase()?.trim() || "";
  if (!domain) return "personal";
  if (FREE_MAIL.test(domain) || FREE_MAIL.test(domain + ".")) return "personal";
  const root = domain.split(".").slice(0, -1).join(".") || domain;
  if (FREE_MAIL.test(root + ".")) return "personal";
  return "corporate";
}

function sizeTierFromEmployees(n: number | null | undefined): string | null {
  if (n == null || n <= 0) return null;
  if (n <= 10) return "1-10";
  if (n <= 50) return "11-50";
  if (n <= 200) return "51-200";
  if (n <= 1000) return "201-1000";
  return "1000+";
}

const SIZE_ORDER = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;

function normalizeSource(source: string | null | undefined): string {
  return (source ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(n)));
}

function nextActionFor(input: {
  grade: LeadGrade;
  band: LeadScoreBand;
  salesReady: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  hasTitle: boolean;
  hasCompany: boolean;
  recentActivityCount: number;
  bantHits: number;
  leadStatus: string | null;
}): string {
  if (input.leadStatus === "disqualified") {
    return "Do not outreach — leave archived unless new intent appears.";
  }
  if (input.salesReady || input.band === "hot") {
    return input.hasEmail
      ? "Book a discovery call today."
      : "Add a verified email, then book discovery.";
  }
  if (!input.hasEmail) return "Capture a verified email before any outreach.";
  if (!input.hasTitle) return "Add job title, then send a short check-in email.";
  if (!input.hasCompany) {
    return "Link or confirm company, then qualify need in one call.";
  }
  if (input.recentActivityCount === 0) {
    return "Send a short nurture touch and log the reply.";
  }
  return "Continue nurture with educational content until score crosses 40.";
}

/**
 * Fit (0–50) + Intent (0–50) = Total (0–100).
 */
export function scoreLeadHeuristic(input: {
  contactType: string | null;
  leadStatus: string | null;
  leadSource?: string | null;
  title?: string | null;
  companyName?: string | null;
  industry?: string | null;
  city?: string | null;
  country?: string | null;
  employeeCount?: number | null;
  email?: string | null;
  seniorityTier?: SeniorityTier | null;
  emailDomainType?: "corporate" | "personal" | null;
  bantBudget?: boolean | null;
  bantAuthority?: boolean | null;
  bantNeed?: boolean | null;
  bantTimeline?: boolean | null;
  recentActivityCount: number;
  inboundEmailCount?: number;
  callOrMeetingCount?: number;
  pricingPageVisits?: number;
  demoOrQuoteRequests?: number;
  emailOpens?: number;
  emailClicks?: number;
  contentDownloads?: number;
  webinarAttended?: boolean;
  websiteVisits7d?: number;
  daysSinceLastActivity?: number | null;
  hasEmail: boolean;
  hasPhone: boolean;
  convertedOutcome?: boolean;
  icp?: LeadIcpConfig | null;
  /** Applied by nightly decay job (subtracted from intent before clamp). */
  intentDecayPenalty?: number;
}): LeadScoreResult {
  const breakdown: LeadScoreBreakdown = {};
  const fitPos: string[] = [];
  const fitNeg: string[] = [];
  const intentPos: string[] = [];
  const intentNeg: string[] = [];

  const fit = 0;

  // Intent — emails, calls, meetings, replies, and recency.
  let intent = 0;
  const inbound = input.inboundEmailCount ?? 0;
  const callsMeetings = input.callOrMeetingCount ?? 0;
  const source = normalizeSource(input.leadSource);

  if (input.pricingPageVisits && input.pricingPageVisits > 0) {
    intent += 10;
    breakdown.pricing_page = 10;
    intentPos.push("Visited pricing page");
  }
  const demos =
    (input.demoOrQuoteRequests ?? 0) +
    (source.includes("demo") || source.includes("quote") ? 1 : 0);
  if (demos > 0) {
    intent += 20;
    breakdown.demo_quote = 20;
    intentPos.push("Requested demo/quote");
  }
  if (inbound > 0) {
    intent += 15;
    breakdown.replied = 15;
    intentPos.push("Replied to email/message");
  }
  const opens = Math.min(input.emailOpens ?? 0, 3);
  if (opens > 0) {
    const pts = opens * 2;
    intent += pts;
    breakdown.email_opens = pts;
    intentPos.push(`Email opens (+${pts})`);
  }
  const clicks = Math.min(input.emailClicks ?? 0, 2);
  if (clicks > 0) {
    const pts = Math.min(clicks * 5, 10);
    intent += pts;
    breakdown.email_clicks = pts;
  }
  const downloads = Math.min(input.contentDownloads ?? 0, 2);
  if (downloads > 0) {
    const pts = Math.min(downloads * 5, 10);
    intent += pts;
    breakdown.content_downloads = pts;
  }
  if (input.webinarAttended || callsMeetings > 0) {
    const pts = input.webinarAttended ? 12 : Math.min(8, callsMeetings * 4);
    intent += pts;
    breakdown.meeting_webinar = pts;
    intentPos.push(input.webinarAttended ? "Attended webinar/demo" : "Call/meeting logged");
  }
  if ((input.websiteVisits7d ?? 0) >= 3 || input.recentActivityCount >= 3) {
    intent += 8;
    breakdown.repeat_visits = 8;
    intentPos.push("Multiple engagements in recent window");
  }

  if (
    source &&
    (HIGH_INTENT_SOURCES.has(source) ||
      source.includes("form") ||
      source.includes("demo"))
  ) {
    if (!breakdown.demo_quote) {
      intent += 8;
      breakdown.high_intent_source = 8;
      intentPos.push(`High-intent source (${input.leadSource})`);
    }
  }

  const bant = [
    input.bantBudget,
    input.bantAuthority,
    input.bantNeed,
    input.bantTimeline,
  ];
  let bantHits = 0;
  for (const ok of bant) {
    if (ok) {
      intent += 4;
      bantHits += 1;
    }
  }
  if (bantHits) {
    breakdown.bant = bantHits * 4;
    intentPos.push(`BANT signals: ${bantHits}`);
  }

  if (input.convertedOutcome) {
    intent += 10;
    breakdown.converted = 10;
  }

  const decay = Math.max(0, input.intentDecayPenalty ?? 0);
  const days = input.daysSinceLastActivity;
  if (decay > 0) {
    intent -= decay;
    breakdown.decay_penalty = -decay;
    intentNeg.push(`Recency decay −${decay}`);
  } else if (days != null) {
    if (days >= 30) {
      intent -= 20;
      breakdown.decay_30d = -20;
      intentNeg.push("No activity in 30 days (−20)");
    } else if (days >= 14) {
      intent -= 10;
      breakdown.decay_14d = -10;
      intentNeg.push("No activity in 14 days (−10)");
    }
  } else if (input.recentActivityCount === 0) {
    intent -= 5;
    breakdown.no_recent_activity = -5;
    intentNeg.push("No recent activity");
  }

  intent = clamp(intent, 100);
  const score = intent;
  const band = bandFromScore(score);
  const grade = gradeFromScore(score);
  const salesReady = isSalesReadyScore(score);

  const rationale = [
    `Activity score ${score}/100 (${band}).`,
    intentPos[0] || intentNeg[0] || "No engagement activity yet.",
  ].join(" ");

  // Legacy pillar mapping for older UI
  const pillars: LeadScorePillars = {
    demographics: clamp(Math.round(fit * 0.5), 25),
    firmographics: clamp(Math.round(fit * 0.5), 25),
    behavioural: intent,
  };

  return {
    score,
    fitScore: fit,
    intentScore: intent,
    band,
    grade,
    salesReady,
    rationale,
    scoreBreakdown: breakdown,
    pillars,
    positiveReasons: fitPos.slice(0, 3),
    negativeReasons: fitNeg.slice(0, 3),
    behaviouralPositiveReasons: intentPos.slice(0, 3),
    behaviouralNegativeReasons: intentNeg.slice(0, 3),
    behaviouralReasons: [...intentPos, ...intentNeg].slice(0, 5),
    factors: [
      ...fitPos,
      ...fitNeg,
      ...intentPos,
      ...intentNeg,
    ].slice(0, 12),
    nextBestAction: nextActionFor({
      grade,
      band,
      salesReady,
      hasEmail: input.hasEmail,
      hasPhone: input.hasPhone,
      hasTitle: Boolean(input.title?.trim()),
      hasCompany: Boolean(input.companyName?.trim()),
      recentActivityCount: input.recentActivityCount,
      bantHits,
      leadStatus: input.leadStatus,
    }),
  };
}
