/**
 * run: npx tsx --tsconfig tsconfig.json src/lib/contact-lifecycle.test.ts
 */
import {
  becameLead,
  effectiveContactType,
  hasReachableChannel,
  resolveContactTypeForChannels,
} from "./contact-lifecycle";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(!hasReachableChannel({}), "empty is not reachable");
assert(!hasReachableChannel({ email: "  ", phone: "" }), "whitespace is not reachable");
assert(hasReachableChannel({ email: "a@b.co" }), "email counts");
assert(hasReachableChannel({ phone: "+1 415 555 0100" }), "phone counts");
assert(
  hasReachableChannel({ secondaryEmails: [" ", "cc@d.co"] }),
  "secondary email counts",
);
assert(hasReachableChannel({ secondaryPhones: ["555"] }), "secondary phone counts");

assert(effectiveContactType(null) === "contact", "null → contact");
assert(effectiveContactType("") === "contact", "empty → contact");
assert(effectiveContactType("mql") === "contact", "unknown → contact");
assert(effectiveContactType("lead") === "lead", "lead stays lead");

assert(
  resolveContactTypeForChannels({ existing: "contact" }) === "contact",
  "no channel stays contact",
);
assert(
  resolveContactTypeForChannels({
    existing: "contact",
    email: "a@b.co",
  }) === "lead",
  "email auto-promotes contact → lead",
);
assert(
  resolveContactTypeForChannels({
    requested: "lead",
    existing: "contact",
  }) === "contact",
  "cannot mark lead without a channel",
);
assert(
  resolveContactTypeForChannels({
    existing: "lead",
  }) === "lead",
  "existing lead is not demoted",
);
assert(
  resolveContactTypeForChannels({
    existing: "prospect",
    email: "a@b.co",
  }) === "prospect",
  "prospect is not rewritten to lead",
);
assert(
  resolveContactTypeForChannels({
    requested: "customer",
    existing: "contact",
    email: "a@b.co",
  }) === "customer",
  "explicit later stage wins",
);

assert(becameLead("contact", "lead"), "contact → lead is a promotion");
assert(!becameLead("lead", "lead"), "already lead is not a promotion");
assert(!becameLead("prospect", "lead"), "later stage is not a promotion path");
assert(!becameLead(null, "contact"), "null → contact is not a promotion");

console.log("contact-lifecycle.test.ts: ok");
