/**
 * Lightweight unit checks (run: npx tsx src/service/ai/email-auto-reply-classify.test.ts)
 */
import {
  heuristicClassify,
  latestInboundPlain,
  recoverSkippedDemoDecision,
  unwrapPersistResult,
  type AutoReplyContext,
} from "./email-auto-reply-job";
import { parsePreferredDateTime, formatSlotOption } from "./demo-booking";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const SIVAJI =
  "which specific tool you provide to help my company in the sense of increase company growth";

const quoted = `${SIVAJI}

On Sat, 8 Aug 2026 at 15:23, Yaswanth wrote:
> Happy to share how our tools streamline processes. Could we book a
> 15-minute chat? Our list price is on the pricing page.`;

function ctx(body: string, subject = "Re: Quick follow-up - Zendesk"): AutoReplyContext {
  return {
    organizationId: "org",
    activityId: "act_1",
    contactId: "c1",
    contactName: "Sivaji R",
    contactEmail: "sivaji@example.com",
    contactTitle: "Product Manager",
    companyName: "Zendesk",
    companyIndustry: null,
    contactType: null,
    leadStatus: null,
    ownerUserId: null,
    mailboxUserId: "u1",
    mailboxEmail: "me@example.com",
    senderOrganizationName: "Worktual",
    mailProvider: "google",
    threadId: "t1",
    subject,
    body,
    receivedAt: new Date().toISOString(),
    thread: [],
    alreadyHandled: false,
    humanRepliedAfter: false,
    demoState: null,
    timezone: "Asia/Kolkata",
    engagement: {
      tier: "new",
      meetingCount: 0,
      bookedDemoCount: 0,
      autoRescheduleCount: 0,
      inboundEmailCount: 1,
      outboundEmailCount: 1,
      threadHadBookedDemo: false,
      hasUpcomingMeeting: false,
    },
  };
}

assert(latestInboundPlain(quoted) === SIVAJI, "strip gmail quote");

const help = heuristicClassify(ctx(quoted));
assert(help.category !== "pricing", "quoted outbound price must not escalate as pricing");
assert(help.decision === "safe_auto_reply", "product/help stays auto-reply");
assert(help.category === "general", "product/help is general, not demo/offline escalate");
assert(!help.replyBody, "general classify does not invent reply body — LLM compose only");

const demoSubject = heuristicClassify(
  ctx("Thanks for the update.", "Re: Product demo walkthrough"),
);
assert(demoSubject.decision === "safe_auto_reply", "Re: demo subject is not a demo ask");
assert(demoSubject.category === "general", "courtesy under a demo subject stays general");

const quote = heuristicClassify(
  ctx("Please send me a quote for 50 seats.", "Quote"),
);
assert(quote.decision === "sensitive_escalate", "explicit quote escalates");
assert(quote.category === "pricing", "explicit quote is pricing");

const interested = heuristicClassify(
  ctx(
    `Yes, I am interested.

On Sat, 08 Aug 2026, 17:11, You wrote:
> Worktual automatically captures customer data, scores leads.`,
    "Re: Quick follow-up - Zendesk",
  ),
);
assert(interested.decision === "safe_auto_reply", "interest is safe");
assert(interested.category === "general", "interest is not demo/confidential");

const botDemo = heuristicClassify({
  ...ctx("Can we schedule a meeting?", "Re: Following up | Titan"),
  mailboxUserId: null,
  mailboxEmail: null,
});
assert(botDemo.category === "bot_demo_handoff", "bot mail demo routes to handoff");
assert(botDemo.decision === "safe_auto_reply", "bot demo handoff is safe reply");

const morning = new Date("2026-08-08T02:30:00.000Z"); // 08:00 IST
assert(
  parsePreferredDateTime("today 6.5", morning, "Asia/Kolkata") != null,
  "parses today 6.5",
);
assert(
  parsePreferredDateTime("can i schedule demo for 6.18 today", morning, "Asia/Kolkata") !=
    null,
  "parses dotted 6.18",
);
assert(
  formatSlotOption(
    parsePreferredDateTime("4.45 pm tomorrow", morning, "Asia/Kolkata")!,
    "Asia/Kolkata",
  ).includes("4:45 PM"),
  "4.45 pm must not parse as 45 pm / 9 pm",
);

const confirmCtx = ctx("Yes, it's fine.");
confirmCtx.thread = [
  {
    id: "out1",
    direction: "outbound",
    subject: "Re: Quick follow-up - Zendesk",
    body: "Can I schedule a demo for tomorrow 6.18?",
    createdAt: new Date("2026-08-08T12:47:00.000Z").toISOString(),
  },
];
const confirmed = heuristicClassify(confirmCtx);
assert(confirmed.category === "demo_confirm_slot", "yes it's fine confirms proposed demo");
assert(Boolean(confirmed.chosenSlotIso), "confirm carries chosen slot");

const slotCtx = ctx("tomorrow 6.5");
slotCtx.thread = confirmCtx.thread;
const slotAsk = heuristicClassify(slotCtx);
assert(slotAsk.category === "demo_check_slot", "tomorrow 6.5 after demo offer is a slot");

const raghuramHtml = `From: Sample <sample151102@gmail.com>
To: yaswanthmg345 <yaswanthmg345@gmail.com>
Cc: —

<div dir="ltr">today 8 pm<div><br></div></div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Fri, Aug 21, 2026 at 5:33 PM yaswanthmg345 wrote:</div>`;
assert(
  latestInboundPlain(raghuramHtml) === "today 8 pm",
  "strip sync headers + gmail html quote",
);
const raghuramCtx = ctx(raghuramHtml);
raghuramCtx.demoState = {
  phase: "ask_slot",
  mailboxUserId: "1000",
  timezone: "Asia/Kolkata",
  proposedSlots: [],
};
raghuramCtx.thread = [
  {
    id: "out-demo",
    direction: "outbound",
    subject: "Re: Proposal and Quotation",
    body: "Thanks for your interest — we'd be happy to schedule a product demo. Could you share your preferred date and time?",
    createdAt: new Date().toISOString(),
  },
];
const raghuramSlot = heuristicClassify(raghuramCtx);
assert(
  raghuramSlot.category === "demo_check_slot",
  "today 8 pm on open demo thread is demo_check_slot",
);
assert(Boolean(raghuramSlot.requestedStartIso), "raghuram slot carries requestedStartIso");

const skipRecovery = recoverSkippedDemoDecision(raghuramCtx, {
  decision: "skip",
  sensitivity: "unknown",
  category: "empty_input",
  reason: "The input provided is empty or contains no content to classify.",
});
assert(skipRecovery?.category === "demo_check_slot", "recover LLM skip on demo thread");
assert(Boolean(skipRecovery?.requestedStartIso), "recovered slot carries requestedStartIso");

const proposalAcceptCtx = ctx("I accept the proposal.");
proposalAcceptCtx.demoState = {
  phase: "ask_slot",
  mailboxUserId: "1000",
  timezone: "Asia/Kolkata",
  proposedSlots: [],
  threadId: "other-thread",
};
proposalAcceptCtx.thread = [
  {
    id: "out-prop",
    direction: "outbound",
    subject: "Re: Proposal PROP-0007",
    body: "Please find proposal PROP-0007 attached.",
    createdAt: new Date().toISOString(),
  },
];
const proposalAccept = heuristicClassify(proposalAcceptCtx);
assert(
  proposalAccept.category === "general",
  "proposal accept on unrelated thread must not re-ask for demo slot",
);

assert(
  unwrapPersistResult({
    persistResult: {
      status: "replied",
      decision: "safe_auto_reply",
      sensitivity: "safe",
      category: "general",
      reason: "ok",
      replyActivityId: "a1",
      escalatedToUserId: null,
      lastError: null,
      nextRetryAt: null,
      statusCode: 200,
    },
  })?.status === "replied",
  "unwrap sendSuccess persist envelope",
);
assert(
  unwrapPersistResult({ persistResult: { status: "OK" } as never }) === null,
  "unwrap ignores message-only status",
);

const repDatetime = heuristicClassify({
  ...ctx("tomorrow 3 pm works for me.", "Re: Follow-up"),
  thread: [
    {
      id: "o1",
      direction: "outbound",
      subject: "Re: Follow-up",
      body: "When works for you?",
      createdAt: new Date().toISOString(),
    },
  ],
});
assert(
  repDatetime.category === "demo_check_slot",
  "rep mailbox datetime on active thread books demo",
);

console.log("email-auto-reply-classify.test.ts ok");
