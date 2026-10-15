import { describe, expect, it } from "vitest";
import { applyScoreGuardrails } from "@/service/ai/lead-score-guardrails";
import type { LeadScoreContext } from "@/service/ai/lead-scoring-job";
import type { LeadScoreResult } from "@/service/ai/lead-score";

function baseCtx(over: Partial<LeadScoreContext> = {}): LeadScoreContext {
  return {
    contactId: "c1",
    organizationId: "1000",
    displayName: "Test Lead",
    contactType: "lead",
    leadStatus: "qualified",
    leadSource: "cdp_ingest",
    title: "CEO",
    companyName: "Rockstar",
    industry: null,
    city: null,
    country: null,
    employeeCount: null,
    email: "lead@example.com",
    seniorityTier: "c_level",
    emailDomainType: "corporate",
    bantBudget: false,
    bantAuthority: true,
    bantNeed: false,
    bantTimeline: false,
    hasEmail: true,
    hasPhone: true,
    recentActivityCount: 4,
    inboundEmailCount: 2,
    callOrMeetingCount: 0,
    pricingPageVisits: 0,
    demoOrQuoteRequests: 1,
    emailOpens: 0,
    emailClicks: 0,
    contentDownloads: 0,
    webinarAttended: false,
    websiteVisits7d: 4,
    daysSinceLastActivity: 0,
    convertedOutcome: false,
    icp: null,
    intentDecayPenalty: 0,
    ownerUserId: "42",
    schedulingReplies: 1,
    recentActivitySnippet: "Re: demo: Today 10.45 am works for me",
    omniChannelSummary: null,
    ...over,
  };
}

function baseResult(over: Partial<LeadScoreResult> = {}): LeadScoreResult {
  return {
    score: 35,
    fitScore: 10,
    intentScore: 25,
    grade: "D",
    band: "cold",
    salesReady: false,
    rationale: "Fit 10/50 · Intent 25/50 · Total 35/100 (cold).",
    scoreBreakdown: {},
    pillars: { demographics: 5, firmographics: 5, behavioural: 25 },
    positiveReasons: [],
    negativeReasons: ["Missing ICP match"],
    behaviouralPositiveReasons: [],
    behaviouralNegativeReasons: [],
    behaviouralReasons: [],
    factors: [],
    nextBestAction: "Continue nurture with educational content until score crosses 40.",
    source: "ai",
    ...over,
  };
}

describe("applyScoreGuardrails", () => {
  it("holds score when demo scheduling interest would drop below previous", () => {
    const result = applyScoreGuardrails(baseCtx(), baseResult(), 52);
    expect(result.score).toBe(52);
  });

  it("detects demo intent from omniChannelSummary when SQL counters are zero", () => {
    const result = applyScoreGuardrails(
      baseCtx({
        demoOrQuoteRequests: 0,
        schedulingReplies: 0,
        recentActivitySnippet: null,
        omniChannelSummary: "Customer asked to book a product demo this week.",
      }),
      baseResult(),
      52,
    );
    expect(result.score).toBe(52);
  });

  it("detects scheduling from snippet when SQL counters are zero", () => {
    const result = applyScoreGuardrails(
      baseCtx({
        demoOrQuoteRequests: 0,
        schedulingReplies: 0,
        recentActivitySnippet: "Re: demo: Today 10.45 am works for me",
      }),
      baseResult(),
      52,
    );
    expect(result.score).toBe(52);
    expect(result.rationale).toMatch(/Guardrails/i);
  });

  it("raises owned engaged leads with demo snippet to sales-ready floor", () => {
    const result = applyScoreGuardrails(
      baseCtx({
        demoOrQuoteRequests: 0,
        schedulingReplies: 0,
        recentActivitySnippet: "Re: Product demo: yes, schedule a call",
        daysSinceLastActivity: 0,
      }),
      baseResult({ fitScore: 12, intentScore: 10, score: 22 }),
      null,
    );
    expect(result.score).toBeGreaterThanOrEqual(40);
  });

  it("raises intent floor for scheduling replies", () => {
    const result = applyScoreGuardrails(
      baseCtx({ ownerUserId: null }),
      baseResult({ intentScore: 12, score: 22, fitScore: 10 }),
      null,
    );
    expect(result.intentScore).toBeGreaterThanOrEqual(28);
  });

  it("uses score next action when guardrails adjust score only", () => {
    const result = applyScoreGuardrails(
      baseCtx({ schedulingReplies: 0, demoOrQuoteRequests: 0 }),
      baseResult({
        score: 45,
        salesReady: true,
        band: "warm",
        grade: "C",
        nextBestAction: "Assigned rep should follow up within one business day.",
      }),
      40,
    );
    expect(result.nextBestAction).toMatch(/Assigned rep should follow up/i);
  });
});
