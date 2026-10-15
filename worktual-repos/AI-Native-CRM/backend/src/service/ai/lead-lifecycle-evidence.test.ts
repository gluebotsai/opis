/**
 * Lightweight unit checks (run: npx tsx src/service/ai/lead-lifecycle-evidence.test.ts)
 */
import {
  checkEvidenceBar,
  enforceEvidenceBar,
} from "./lead-lifecycle-evidence";
import {
  decideLifecycleHeuristic,
  enforceCommercialWinFromDb,
  lifecycleAdvanceDetail,
  withLifecycleReason,
} from "./lead-lifecycle-decide";
import {
  humanOwnsLifecycleLadder,
  isRedundantFlagForReview,
  lifecycleReviewFingerprint,
} from "./lead-lifecycle-apply";
import type { LifecycleContext } from "./lead-lifecycle-context";
import type { LifecycleDecision } from "./lead-lifecycle-decide";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function baseCtx(overrides: Partial<LifecycleContext> = {}): LifecycleContext {
  return {
    organizationId: "1000",
    contactId: "c1",
    displayName: "Test",
    email: "t@example.com",
    ownerUserId: null,
    businessType: "b2b",
    contactType: "lead",
    leadStatus: "new",
    contactStatus: "active",
    companyId: null,
    companyName: null,
    country: null,
    city: null,
    convertedDealId: null,
    bant: {
      budget: false,
      authority: false,
      need: false,
      timeline: false,
      budgetDetail: null,
      authorityDetail: null,
      needDetail: null,
      timelineDetail: null,
    },
    score: null,
    salesReady: false,
    omniChannelSummary: null,
    touchpoints: [],
    activityCount: 0,
    outboundTouches: 0,
    inboundReplies: 0,
    meetings: 0,
    daysSinceLastActivity: null,
    signals: {
      inboundReply: false,
      meetingBooked: false,
      meetingHeld: false,
      discoveryDone: false,
      budget: false,
      authority: false,
      need: false,
      timeline: false,
      pricingInterest: false,
      quoteRequested: false,
      negotiating: false,
      accepted: false,
      paymentConfirmed: false,
      declined: false,
      lost: false,
      evidence: [],
      signalAt: {},
    },
    deal: null,
    missingMeetingCapture: false,
    meetingAnalysis: null,
    lifecycleLastAction: null,
    lifecycleLastReason: null,
    lifecycleLastRunAt: null,
    ...overrides,
  };
}

// contacted requires outbound OR inbound+meeting engagement
{
  const r = checkEvidenceBar(baseCtx(), {
    kind: "lead_status",
    to: "contacted",
  });
  assert(!r.ok, "contacted without outreach/engagement should fail");
  const ok = checkEvidenceBar(baseCtx({ outboundTouches: 1 }), {
    kind: "lead_status",
    to: "contacted",
  });
  assert(ok.ok, "contacted with outbound should pass");
  const engaged = checkEvidenceBar(
    baseCtx({
      signals: {
        ...baseCtx().signals,
        inboundReply: true,
        meetingBooked: true,
      },
    }),
    { kind: "lead_status", to: "contacted" },
  );
  assert(engaged.ok, "contacted with inbound+meetingBooked should pass");
}

// qualifying needs reply/meeting
{
  const r = checkEvidenceBar(baseCtx(), {
    kind: "lead_status",
    to: "qualifying",
  });
  assert(!r.ok, "qualifying empty should fail");
  const ok = checkEvidenceBar(
    baseCtx({
      signals: {
        ...baseCtx().signals,
        inboundReply: true,
        evidence: ["reply"],
      },
    }),
    { kind: "lead_status", to: "qualifying" },
  );
  assert(ok.ok, "qualifying with reply should pass");
}

// qualified needs score ≥ 40, intent, inbound+meeting, or 3 BANT + meeting
{
  const r = checkEvidenceBar(
    baseCtx({ score: 39 }),
    { kind: "lead_status", to: "qualified" },
  );
  assert(!r.ok, "qualified with score 39 and no engagement should fail");
  const byScore = checkEvidenceBar(
    baseCtx({ score: 40 }),
    { kind: "lead_status", to: "qualified" },
  );
  assert(byScore.ok, "qualified score ≥ 40 should pass");
  const replyOnly = checkEvidenceBar(
    baseCtx({
      score: 10,
      signals: { ...baseCtx().signals, inboundReply: true },
    }),
    { kind: "lead_status", to: "qualified" },
  );
  assert(!replyOnly.ok, "qualified with inbound reply alone should fail");
  const byEngagement = checkEvidenceBar(
    baseCtx({
      score: 10,
      signals: {
        ...baseCtx().signals,
        inboundReply: true,
        meetingBooked: true,
      },
    }),
    { kind: "lead_status", to: "qualified" },
  );
  assert(byEngagement.ok, "qualified with inbound reply + meeting should pass");
  const byDemoAsk = checkEvidenceBar(
    baseCtx({
      score: 10,
      signals: {
        ...baseCtx().signals,
        inboundReply: true,
        demoRequested: true,
      },
    }),
    { kind: "lead_status", to: "qualified" },
  );
  assert(byDemoAsk.ok, "qualified with inbound reply + demo request should pass");
  const byBantAndMeeting = checkEvidenceBar(
    baseCtx({
      score: 10,
      bant: {
        ...baseCtx().bant,
        budget: true,
        need: true,
        timeline: true,
      },
      signals: {
        ...baseCtx().signals,
        meetingBooked: true,
      },
    }),
    { kind: "lead_status", to: "qualified" },
  );
  assert(
    byBantAndMeeting.ok,
    "qualified with 3 confirmed BANT fields and a meeting should pass",
  );
  const bantWithoutMeeting = checkEvidenceBar(
    baseCtx({
      score: 10,
      bant: {
        ...baseCtx().bant,
        budget: true,
        need: true,
        timeline: true,
      },
    }),
    { kind: "lead_status", to: "qualified" },
  );
  assert(
    !bantWithoutMeeting.ok,
    "3 confirmed BANT fields without a meeting should not qualify",
  );
}

// flag_for_review always ok
{
  const r = checkEvidenceBar(baseCtx(), {
    kind: "flag_for_review",
    reason: "test",
  });
  assert(r.ok, "flag_for_review always ok");
}

// enforce → flag when evidence missing but signals present
{
  const decision: LifecycleDecision = {
    action: { kind: "deal_stage", to: "propose" },
    ladder: "pipeline",
    from: "discover",
    to: "propose",
    reason: "try elevate",
  };
  const gated = enforceEvidenceBar(
    baseCtx({
      score: 20,
      inboundReplies: 1,
      signals: {
        ...baseCtx().signals,
        inboundReply: true,
        pricingInterest: false,
        quoteRequested: false,
        evidence: ["got a reply"],
      },
      deal: {
        id: "d1",
        title: "Deal",
        stage: "discover",
        amount: null,
        companyId: null,
        ownerUserId: null,
        closed: false,
        quotes: [],
      },
    }),
    decision,
  );
  assert(
    gated.action.kind === "flag_for_review",
    "incomplete evidence with signals → flag_for_review",
  );
}

// ambiguous meeting → flag on discover only when meetingHeld is missing
{
  const decision: LifecycleDecision = {
    action: { kind: "deal_stage", to: "discover" },
    ladder: "pipeline",
    from: "qualification",
    to: "discover",
    reason: "advance",
  };
  const gated = enforceEvidenceBar(
    baseCtx({
      meetingAnalysis: {
        outcome: "neutral",
        confidence: 0.4,
        bantBudget: null,
        bantAuthority: null,
        bantNeed: null,
        nextStepAgreed: null,
      },
      deal: {
        id: "d1",
        title: "Deal",
        stage: "qualification",
        amount: null,
        companyId: null,
        ownerUserId: null,
        closed: false,
        quotes: [],
      },
    }),
    decision,
  );
  assert(
    gated.action.kind === "flag_for_review",
    "neutral without meetingHeld still blocks discover",
  );
}

// transcript-held meeting: neutral analysis must NOT block Qualify → Discover
{
  const decision: LifecycleDecision = {
    action: { kind: "deal_stage", to: "discover" },
    ladder: "pipeline",
    from: "qualification",
    to: "discover",
    reason: "Discovery conversation happened",
  };
  const gated = enforceEvidenceBar(
    baseCtx({
      meetings: 1,
      signals: {
        ...baseCtx().signals,
        meetingHeld: true,
        evidence: ["meeting transcript (meeting)"],
      },
      meetingAnalysis: {
        outcome: "neutral",
        confidence: 0.4,
        bantBudget: null,
        bantAuthority: null,
        bantNeed: null,
        nextStepAgreed: null,
      },
      deal: {
        id: "d1",
        title: "Deal",
        stage: "qualification",
        amount: null,
        companyId: null,
        ownerUserId: null,
        closed: false,
        quotes: [],
      },
    }),
    decision,
  );
  assert(
    gated.action.kind === "deal_stage" &&
      (gated.action as { to?: string }).to === "discover",
    "neutral + meetingHeld must allow qualification → discover",
  );
}

// objection still blocks discover even with transcript
{
  const decision: LifecycleDecision = {
    action: { kind: "deal_stage", to: "discover" },
    ladder: "pipeline",
    from: "qualification",
    to: "discover",
    reason: "advance",
  };
  const gated = enforceEvidenceBar(
    baseCtx({
      signals: {
        ...baseCtx().signals,
        meetingHeld: true,
        evidence: ["meeting"],
      },
      meetingAnalysis: {
        outcome: "objection",
        confidence: 0.8,
        bantBudget: null,
        bantAuthority: null,
        bantNeed: null,
        nextStepAgreed: null,
      },
      deal: {
        id: "d1",
        title: "Deal",
        stage: "qualification",
        amount: null,
        companyId: null,
        ownerUserId: null,
        closed: false,
        quotes: [],
      },
    }),
    decision,
  );
  assert(
    gated.action.kind === "flag_for_review",
    "objection must still block discover",
  );
}

// later pipeline (propose) still blocked by neutral analysis
{
  const decision: LifecycleDecision = {
    action: { kind: "deal_stage", to: "propose" },
    ladder: "pipeline",
    from: "discover",
    to: "propose",
    reason: "pricing",
  };
  const gated = enforceEvidenceBar(
    baseCtx({
      signals: {
        ...baseCtx().signals,
        pricingInterest: true,
        meetingHeld: true,
      },
      meetingAnalysis: {
        outcome: "neutral",
        confidence: 0.4,
        bantBudget: null,
        bantAuthority: null,
        bantNeed: null,
        nextStepAgreed: null,
      },
      deal: {
        id: "d1",
        title: "Deal",
        stage: "discover",
        amount: null,
        companyId: null,
        ownerUserId: null,
        closed: false,
        quotes: [],
      },
    }),
    decision,
  );
  assert(
    gated.action.kind === "flag_for_review",
    "neutral still blocks later pipeline (propose)",
  );
}

// decide: qualification + meetingHeld → discover
{
  const d = decideLifecycleHeuristic(
    baseCtx({
      leadStatus: "converted",
      contactType: "prospect",
      meetings: 1,
      signals: {
        ...baseCtx().signals,
        meetingHeld: true,
        evidence: ["meeting transcript"],
      },
      deal: {
        id: "d1",
        title: "Deal",
        stage: "qualification",
        amount: null,
        companyId: null,
        ownerUserId: null,
        closed: false,
        quotes: [],
      },
    }),
  );
  assert(
    d.action.kind === "deal_stage" &&
      (d.action as { to?: string }).to === "discover",
    "qualification + meetingHeld should advance to discover",
  );
}

// neutral meeting analysis must NOT block lead_status / convert
{
  const leadDecision: LifecycleDecision = {
    action: { kind: "lead_status", to: "qualifying" },
    ladder: "lead_status",
    from: "new",
    to: "qualifying",
    reason: "demo held",
  };
  const leadCtx = baseCtx({
    outboundTouches: 0,
    inboundReplies: 1,
    signals: {
      ...baseCtx().signals,
      inboundReply: true,
      meetingHeld: true,
      evidence: ["inbound", "meeting"],
    },
    meetingAnalysis: {
      outcome: "neutral",
      confidence: 0.3,
      bantBudget: null,
      bantAuthority: null,
      bantNeed: null,
      nextStepAgreed: null,
    },
  });
  const leadGated = enforceEvidenceBar(leadCtx, leadDecision);
  assert(
    leadGated.action.kind === "lead_status",
    "neutral meeting analysis must not rewrite lead_status",
  );

  const convertDecision: LifecycleDecision = {
    action: { kind: "convert" },
    ladder: "lifecycle",
    from: "lead",
    to: "prospect",
    reason: "qualified",
  };
  const convertGated = enforceEvidenceBar(
    baseCtx({
      leadStatus: "qualified",
      score: 50,
      meetingAnalysis: {
        outcome: "neutral",
        confidence: 0.2,
        bantBudget: null,
        bantAuthority: null,
        bantNeed: null,
        nextStepAgreed: null,
      },
    }),
    convertDecision,
  );
  assert(
    convertGated.action.kind === "convert",
    "neutral meeting analysis must not rewrite convert",
  );
}

// decide: inbound + meetingHeld from new → qualifying
{
  const d = decideLifecycleHeuristic(
    baseCtx({
      leadStatus: "new",
      inboundReplies: 1,
      signals: {
        ...baseCtx().signals,
        inboundReply: true,
        meetingHeld: true,
        evidence: ["customer asked for demo", "meeting transcript"],
      },
    }),
  );
  assert(
    d.action.kind === "lead_status" &&
      d.action.kind === "lead_status" &&
      (d.action as { to?: string }).to === "qualifying",
    "inbound+meetingHeld from new should target qualifying",
  );
}

// decide: outbound-only from new → contacted
{
  const d = decideLifecycleHeuristic(
    baseCtx({
      leadStatus: "new",
      outboundTouches: 1,
      signals: {
        ...baseCtx().signals,
        evidence: ["outbound email"],
      },
    }),
  );
  assert(
    d.action.kind === "lead_status" &&
      (d.action as { to?: string }).to === "contacted",
    "outbound-only from new should target contacted",
  );
}

// hybrid: newer manual_edit owns the ladder
{
  assert(
    humanOwnsLifecycleLadder(
      baseCtx({
        lifecycleLastAction: "manual_edit",
        lifecycleLastRunAt: "2026-08-07T12:00:00.000Z",
      }),
      new Date("2026-08-07T11:00:00.000Z"),
    ),
    "manual_edit after last apply should own ladder",
  );
  assert(
    !humanOwnsLifecycleLadder(
      baseCtx({
        lifecycleLastAction: "manual_edit",
        lifecycleLastRunAt: "2026-08-07T10:00:00.000Z",
      }),
      new Date("2026-08-07T11:00:00.000Z"),
    ),
    "older manual_edit should not own ladder",
  );
  assert(
    !humanOwnsLifecycleLadder(
      baseCtx({
        lifecycleLastAction: "lead_status",
        lifecycleLastRunAt: "2026-08-07T12:00:00.000Z",
      }),
      new Date("2026-08-07T11:00:00.000Z"),
    ),
    "non-manual action should not own ladder",
  );
}

// flag_for_review: ignore LLM rephrases / repeat cron when evidence unchanged
{
  const flagDecision = {
    ladder: "pipeline" as const,
    from: "propose",
    to: "negotiate",
    reason: "needs review",
    action: {
      kind: "flag_for_review" as const,
      reason: "Quote drafts only — hold at propose",
    },
  };
  const dealPropose = {
    id: "d1",
    title: "Deal",
    stage: "propose",
    amount: null,
    companyId: null,
    ownerUserId: null,
    closed: false,
    quotes: [{ id: "q1", number: "Q-1", status: "draft", total: 0, sentAt: null }],
  };
  assert(
    !isRedundantFlagForReview(baseCtx({ deal: dealPropose }), flagDecision),
    "first flag should not be redundant",
  );
  assert(
    isRedundantFlagForReview(
      baseCtx({
        deal: dealPropose,
        lifecycleLastAction: "flag_for_review",
        lifecycleLastReason: "older free-text wording",
      }),
      {
        ...flagDecision,
        action: {
          kind: "flag_for_review",
          reason: "Different LLM wording, same situation",
        },
      },
    ),
    "legacy free-text flag should stay silent on rephrase",
  );
  const fpCtx = baseCtx({
    deal: dealPropose,
    lifecycleLastAction: "flag_for_review",
    signals: {
      ...baseCtx().signals,
      quoteRequested: true,
    },
  });
  const fp = lifecycleReviewFingerprint(fpCtx, flagDecision);
  assert(
    isRedundantFlagForReview(
      {
        ...fpCtx,
        lifecycleLastReason: `fp:${fp}`,
      },
      {
        ...flagDecision,
        action: {
          kind: "flag_for_review",
          reason: "Yet another wording",
        },
      },
    ),
    "matching fingerprint should be redundant",
  );
  assert(
    !isRedundantFlagForReview(
      {
        ...fpCtx,
        lifecycleLastReason: `fp:${fp}`,
        deal: {
          ...dealPropose,
          quotes: [
            {
              id: "q1",
              number: "Q-1",
              status: "sent",
              total: 0,
              sentAt: "2026-08-11T12:00:00.000Z",
            },
          ],
        },
      },
      flagDecision,
    ),
    "quote status change should allow a new flag note",
  );
}

// open deal must not block pipeline close_won when quote already accepted
{
  const decision = decideLifecycleHeuristic(
    baseCtx({
      leadStatus: "qualified",
      contactType: "lead",
      deal: {
        id: "d1",
        title: "Deal",
        stage: "negotiate",
        amount: 15000,
        companyId: null,
        ownerUserId: "1006",
        closed: false,
        hasPaidInvoice: false,
        quotes: [
          {
            id: "q1",
            number: "Q-00001",
            status: "accepted",
            total: 15000,
            sentAt: "2026-08-21T13:42:22.453Z",
          },
        ],
      },
    }),
  );
  assert(
    decision.action.kind === "close_won",
    "accepted quote on open deal should close won, not convert skip",
  );
}

// paid invoice in CRM overrides LLM wait
{
  const waitDecision: LifecycleDecision = {
    action: { kind: "wait", waitHours: 24 },
    ladder: "none",
    from: null,
    to: null,
    reason: "Negotiating — waiting for acceptance or loss.",
  };
  const upgraded = enforceCommercialWinFromDb(
    baseCtx({
      deal: {
        id: "d1",
        title: "Deal",
        stage: "negotiate",
        amount: 15000,
        companyId: null,
        ownerUserId: "1006",
        closed: false,
        hasPaidInvoice: true,
        quotes: [],
      },
    }),
    waitDecision,
  );
  assert(
    upgraded.action.kind === "close_won",
    "paid invoice should override wait to close_won",
  );
}

{
  const detail = lifecycleAdvanceDetail({
    action: { kind: "lead_status", to: "contacted" },
    ladder: "lead_status",
    from: "new",
    to: "contacted",
    reason: "First outreach logged (1 outbound touch).",
  });
  assert(
    detail ===
      "Lead status new → contacted: First outreach logged (1 outbound touch).",
    `expected explanation in notify body, got ${detail}`,
  );
}

{
  const missing = withLifecycleReason({
    action: { kind: "lead_status", to: "contacted" },
    ladder: "lead_status",
    from: "new",
    to: "contacted",
    reason: undefined as unknown as string,
  });
  const detail = lifecycleAdvanceDetail(missing);
  assert(
    !detail.includes("undefined"),
    `notify body must not stringify missing reason: ${detail}`,
  );
  assert(
    detail === "Lead status new → contacted",
    `expected transition without colon suffix, got ${detail}`,
  );
}

{
  const fromAction = lifecycleAdvanceDetail(
    withLifecycleReason({
      action: { kind: "flag_for_review", reason: "Meeting analysis ambiguous" },
      ladder: "none",
      from: "contacted",
      to: "qualifying",
      reason: undefined as unknown as string,
    }),
  );
  assert(
    fromAction ===
      "Lifecycle contacted → qualifying: Meeting analysis ambiguous",
    `expected action.reason fallback, got ${fromAction}`,
  );
}

console.log("lead-lifecycle-evidence.test.ts: ok");
