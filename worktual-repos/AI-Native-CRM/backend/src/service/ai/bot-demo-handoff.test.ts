/**
 * Run: npx tsx src/service/ai/bot-demo-handoff.test.ts
 */
import {
  BOT_DEMO_HANDOFF_CATEGORY,
  detectDemoIntentOnInbound,
  isBotMailboxContext,
} from "./bot-demo-handoff";
import {
  normalizeEmailSubject,
} from "@/dao/inbox/email-thread-canonical";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(isBotMailboxContext(null), "null mailbox is bot");
assert(isBotMailboxContext(""), "empty mailbox is bot");
assert(!isBotMailboxContext("1001"), "rep mailbox is not bot");

assert(
  detectDemoIntentOnInbound({
    subject: "Re: Following up",
    latestInboundBody: "Can we schedule a meeting?",
  }),
  "meeting request is demo intent",
);

assert(
  detectDemoIntentOnInbound({
    subject: "Re: Following up",
    latestInboundBody: "today 6 pm",
    timezone: "Asia/Kolkata",
  }),
  "concrete time is demo intent",
);

assert(
  !detectDemoIntentOnInbound({
    subject: "Re: Following up",
    latestInboundBody: "Thanks for the info.",
  }),
  "courtesy is not demo intent",
);

assert(
  normalizeEmailSubject("Re: Following up | Titan") ===
    normalizeEmailSubject("Following up | Titan"),
  "subject stem matches across Re:",
);

console.log("bot-demo-handoff.test.ts ok", BOT_DEMO_HANDOFF_CATEGORY);
