/**
 * run: npx tsx src/lib/outbound-email-guard.test.ts
 */
import { validateOutboundEmailContent } from "./outbound-email-guard";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertBlocked(subject: string, body: string) {
  const result = validateOutboundEmailContent({ subject, body });
  assert(!result.ok, `expected block for subject=${subject} body=${body}`);
}

function assertAllowed(subject: string, body: string) {
  const result = validateOutboundEmailContent({ subject, body });
  assert(result.ok, `expected allow for subject=${subject} body=${body}: ${!result.ok ? result.error : ""}`);
}

assertBlocked("Introduction", "This is the body content.");
assertBlocked("Hello", "This is the body content.");
assertBlocked("Re: follow-up", "body content");
assertBlocked("Test", "test email");
assertBlocked("Hi", "(No message body)");
assertBlocked("Quote", "Lorem ipsum dolor sit amet");

assertAllowed(
  "Introduction from Yaswanth MG",
  "Hi Hansa,\n\nI am reaching out to introduce myself as your new point of contact at Worktual.",
);
assertAllowed(
  "Introduction",
  "Hi Hansa,\n\nThanks for connecting. I wanted to introduce myself and learn more about your team's goals this quarter.",
);
assertAllowed(
  "Re: pricing",
  "<p>Thanks for the note — attaching the updated quote as discussed.</p>",
);

console.log("outbound-email-guard.test.ts: ok");
