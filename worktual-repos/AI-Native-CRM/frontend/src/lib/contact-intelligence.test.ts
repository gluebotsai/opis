/**
 * Lightweight unit checks (run: npx tsx src/lib/contact-intelligence.test.ts)
 */
import {
  buildChannelSections,
  cleanSummaryText,
  eventSummaryBrief,
  intelligenceOverview,
  parseChannelSummary,
  splitOmniByChannel,
} from "./contact-intelligence";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const plain = splitOmniByChannel("Asked for a demo on WhatsApp.");
assert(plain.length === 1 && plain[0]?.id === "ccaas", "single CCaaS block");
assert(plain[0]?.body === "Asked for a demo on WhatsApp.", "plain body kept");

const labeled = splitOmniByChannel(
  "Email: Asked for pricing.\nWhatsApp: Confirmed they received the deck.",
);
assert(
  labeled.map((chunk) => chunk.id).join(",") === "email,whatsapp",
  "splits labeled channels",
);
assert(
  labeled[1]?.body.includes("Confirmed they received the deck") === true,
  "whatsapp body kept",
);

const sections = buildChannelSections({
  summary: {
    summary: "Named contact at B.",
    headline: null,
    intent: "New lead",
    citations: [
      {
        text: "Named contact at Brands.",
        sourceKind: "activity",
        sourceId: "a1",
        activityType: "email",
        conversationId: null,
      },
    ],
    omniChannelSummary: "Call: Left a voicemail about next week's demo.",
    source: "ai",
    updatedAt: "2026-10-05T00:00:00.000Z",
  },
  activities: [],
});
assert(
  sections.map((section) => section.id).join(",") === "email,call",
  "groups citations and omni detail by channel",
);

const overview = intelligenceOverview({
  summary: "Asked for quote approval after the offer email.",
  headline:
    "Ashika A, Manager at Amazon. Email: a@worktual.com Phone: +91 90000 Location: Bangalore, India",
  intent: null,
  citations: [],
  omniChannelSummary: null,
  source: "ai",
  updatedAt: "2026-10-05T00:00:00.000Z",
});
assert(!overview.includes("Email:"), "does not repeat the contact card");
assert(
  overview.includes("Asked for quote approval"),
  "uses the model summary when the headline is contact-card copy",
);
assert(
  intelligenceOverview({
    summary: "Not enough information to summarize this contact yet.",
    headline: null,
    intent: null,
    citations: [],
    omniChannelSummary: null,
    source: "ai",
    updatedAt: "2026-10-05T00:00:00.000Z",
  }) === "",
  "does not use the empty-summary copy",
);

const engagement = intelligenceOverview({
  summary: "Opened the offer and replied once.",
  headline:
    "Opened the exclusive offer and replied asking for quote approval.\nHas not answered the follow-up sent the next day.",
  intent: "Quote approval",
  citations: [],
  omniChannelSummary: null,
  source: "ai",
  updatedAt: "2026-10-05T00:00:00.000Z",
});
assert(engagement.startsWith("Opened the exclusive offer"), "prefers the engagement overview");

const ccaas = `The customer made multiple calls on 2026-10-08 demanding immediate cancellation of a charge. WhatsApp shows only an automated greeting from 2026-08-18 with no customer query.
Channel summaries:
call: Repeated demands to cancel a charge; cancellation remains pending.
whatsapp: Automated greeting only on 2026-08-18, no customer request.
Key notes:
- Issue: Charge cancellation request
- Cancellation: pending, no action taken
- Channel: call, whatsapp`;
const brief = parseChannelSummary(
  ccaas.replace(
    "no customer query.",
    'no customer query. <a href="https://example.com/c/111">details</a> conversationId 8841 CDP-webchat-org1003-visitor_abc',
  ),
);
assert(brief != null, "parses the CCaaS brief");
assert(
  brief?.narrative.startsWith("The customer made multiple calls") === true,
  "narrative stays the opening paragraph",
);
assert(brief?.channels.length === 2, "keeps call and whatsapp lines");
assert(brief?.channels[0]?.label === "call", "channel label is the source label");
assert(brief?.notes.length === 3, "keeps the three key notes");
assert(!brief?.narrative.includes("<"), "narrative has no html tags");
assert(!brief?.narrative.toLowerCase().includes("http"), "narrative has no links");
assert(!JSON.stringify(brief).includes("8841"), "conversation id is removed");
assert(!JSON.stringify(brief).includes("CDP-"), "cdp id is removed");
assert(
  cleanSummaryText("A conversation about pricing stays.").includes("conversation about pricing"),
  "does not treat the word conversation as an id",
);
const withoutRun = cleanSummaryText(
  "A personalized nurture email was queued and sent via Campaign automation (Run id: 1777) to maintain engagement.",
);
assert(!withoutRun.toLowerCase().includes("1777"), "run id is removed");
assert(!withoutRun.toLowerCase().includes("run id"), "run id label is removed");
assert(withoutRun.includes("Campaign automation"), "campaign name stays");
assert(!withoutRun.includes("()"), "empty parentheses are removed");

const pasted = eventSummaryBrief({
  summary: [
    "Ashika requested a product demo by email and was assigned for scheduling.",
    "<!DOCTYPE html><html><head><title>Exclusive</title></head><body>From: bot.worktual@gmail.com To: ashika@gmail.com Exclusive: 20% off</body></html>",
    "Initial demo was scheduled. Join https://meet.google.com/abc-defg-hij https://www.google.com/calendar/event?eid=abc123",
  ].join("\n\n"),
  headline:
    "Ashika requested a product demo by email and was assigned for scheduling. She later confirmed the solution.",
  intent: null,
  citations: [
    {
      text: "Ashika requested a product demo by email and was assigned for scheduling.",
      sourceKind: "activity",
      sourceId: "email-1",
      activityType: "email",
      conversationId: null,
    },
    {
      text: "<!DOCTYPE html><html>From: bot.worktual@gmail.com Exclusive offer body</html>",
      sourceKind: "activity",
      sourceId: "email-2",
      activityType: "email",
      conversationId: null,
    },
    {
      text: "A demo meeting was booked for Saturday, 10 October.",
      sourceKind: "activity",
      sourceId: "meet-1",
      activityType: "meeting",
      conversationId: null,
    },
    {
      text: "Join with Google Meet https://meet.google.com/abc-defg-hij eid=abc123",
      sourceKind: "activity",
      sourceId: "meet-2",
      activityType: "meeting",
      conversationId: null,
    },
  ],
  omniChannelSummary: null,
  source: "ai",
  updatedAt: "2026-10-08T00:00:00.000Z",
});
assert(pasted != null, "event brief is present");
assert(
  pasted?.narrative.includes("requested a product demo") === true,
  "narrative is the event summary",
);
assert(!JSON.stringify(pasted).includes("<"), "summary has no html tags");
assert(!JSON.stringify(pasted).toLowerCase().includes("http"), "summary has no links");
assert(!JSON.stringify(pasted).includes("@"), "summary has no email addresses");
assert(!JSON.stringify(pasted).includes("eid="), "summary has no calendar ids");
assert(
  pasted?.channels.some((line) => line.label === "Meeting" && line.text.includes("booked")) ===
    true,
  "keeps the meeting event sentence",
);
assert(
  pasted?.channels.every((line) => !line.text.toLowerCase().includes("exclusive")) === true,
  "drops the pasted offer email",
);

console.log("contact-intelligence.test.ts ok");
