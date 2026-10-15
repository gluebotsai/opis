/**
 * run: npx tsx --tsconfig tsconfig.json src/service/ai/commercial-acceptance.test.ts
 */
import {
  classifyCommercialDecision,
  dealHasBothCommercialDrafts,
  extractRfcMessageIdsFromEmailText,
  mergeCommercialDocReferences,
  parseCommercialDocReferences,
  parseCommercialRefsFromSubjects,
  resolveMatchedProposal,
  resolveMatchedQuote,
} from "./commercial-acceptance";
import { isCustomerVoiceActivity } from "./lead-lifecycle-signals";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  parseCommercialDocReferences("Re: PROP-0006 and QUOTE-0012").proposalNumbers[0] ===
    "PROP-0006",
  "prop ref",
);
assert(
  parseCommercialDocReferences("Please review QUOTE-0042").quoteNumbers[0] ===
    "QUOTE-0042",
  "quote ref",
);

const merged = mergeCommercialDocReferences(
  parseCommercialDocReferences("PROP-0001"),
  parseCommercialDocReferences("QUOTE-0002"),
);
assert(merged.proposalNumbers[0] === "PROP-0001", "merge prop");
assert(merged.quoteNumbers[0] === "QUOTE-0002", "merge quote");

assert(
  parseCommercialRefsFromSubjects([
    "Proposal PROP-0003 — Acme",
    "Re: Quote QUOTE-0007",
  ]).quoteNumbers[0] === "QUOTE-0007",
  "subject thread parse",
);

assert(
  extractRfcMessageIdsFromEmailText(
    "In-Reply-To: <proposal-msg@mail.example>\nReferences: <proposal-msg@mail.example>",
  )[0] === "proposal-msg@mail.example",
  "rfc extract",
);

assert(
  classifyCommercialDecision("We accept proposal PROP-0003 and want to proceed") ===
    "accept",
  "accept class",
);
assert(
  classifyCommercialDecision("We decline the quote QUOTE-0009 — not acceptable") ===
    "decline",
  "decline class",
);

assert(
  isCustomerVoiceActivity({
    type: "email",
    subject: "Re: quote",
    body: "We accept",
    emailDirection: "inbound",
    createdAt: new Date().toISOString(),
  }),
  "inbound is customer voice",
);
assert(
  !isCustomerVoiceActivity({
    type: "email",
    subject: "Quote sent",
    body: "Here is the quote",
    emailDirection: "outbound",
    createdAt: new Date().toISOString(),
  }),
  "outbound is not customer voice",
);

const proposals = [
  {
    id: "p1",
    number: "PROP-0001",
    status: "shared",
    sharedAt: new Date("2026-08-01"),
    title: "A",
  },
  {
    id: "p2",
    number: "PROP-0002",
    status: "shared",
    sharedAt: new Date("2026-08-10"),
    title: "B",
  },
] as const;

assert(
  resolveMatchedProposal([...proposals], ["PROP-0001"])?.id === "p1",
  "prop number match",
);
assert(
  resolveMatchedProposal([...proposals], [])?.id === "p2",
  "latest shared proposal fallback",
);

const quotes = [
  {
    id: "q1",
    number: "QUOTE-0001",
    status: "sent",
    sentAt: new Date("2026-08-05"),
  },
  {
    id: "q2",
    number: "QUOTE-0002",
    status: "sent",
    sentAt: new Date("2026-08-12"),
  },
] as const;

assert(
  resolveMatchedQuote([...quotes], ["QUOTE-0002"])?.id === "q2",
  "quote number match",
);
assert(
  resolveMatchedQuote([...quotes], [])?.id === "q2",
  "latest sent quote fallback",
);

assert(
  dealHasBothCommercialDrafts({
    proposals: [{ id: "p", number: "PROP-1", status: "draft", sharedAt: null, title: "" }],
    quotes: [{ id: "q", number: "QUOTE-1", status: "draft", sentAt: null }],
  }),
  "both on deal",
);

console.log("commercial-acceptance ok");
