/**
 * run: npx tsx --tsconfig tsconfig.json src/service/webhooks/google-push-multiplex.test.ts
 */
import {
  detectGooglePushKind,
  isGmailPubSubPushBody,
  isGoogleCalendarPushHeaders,
  verifyGooglePushAuth,
} from "./google-push-multiplex";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  isGoogleCalendarPushHeaders({ "x-goog-channel-id": "abc" }),
  "calendar headers detected",
);
assert(!isGoogleCalendarPushHeaders({}), "empty headers not calendar");

const pubsubBody = {
  message: { data: Buffer.from("{}").toString("base64"), messageId: "1" },
};
assert(isGmailPubSubPushBody(pubsubBody), "pubsub body detected");
assert(!isGmailPubSubPushBody({ message: {} }), "pubsub without data");

assert(
  detectGooglePushKind({ "x-goog-channel-id": "x" }, {}) === "calendar",
  "calendar wins when channel header present",
);
assert(
  detectGooglePushKind({}, pubsubBody) === "gmail_pubsub",
  "pubsub when no calendar headers",
);
assert(
  detectGooglePushKind({}, {}) === "ignored",
  "unknown payload ignored",
);

const prevCal = process.env.CALENDAR_PUSH_VERIFICATION_TOKEN;
const prevGmail = process.env.GMAIL_PUBSUB_VERIFICATION_TOKEN;
process.env.CALENDAR_PUSH_VERIFICATION_TOKEN = "cal-secret";
process.env.GMAIL_PUBSUB_VERIFICATION_TOKEN = "gmail-secret";

assert(
  verifyGooglePushAuth({
    kind: "calendar",
    query: { token: "cal-secret" },
    headers: {},
  }).authorized,
  "calendar token ok",
);
assert(
  !verifyGooglePushAuth({
    kind: "calendar",
    query: { token: "wrong" },
    headers: {},
  }).authorized,
  "calendar token reject",
);
assert(
  verifyGooglePushAuth({
    kind: "gmail_pubsub",
    query: { token: "gmail-secret" },
    headers: {},
  }).authorized,
  "gmail token ok",
);

if (prevCal) process.env.CALENDAR_PUSH_VERIFICATION_TOKEN = prevCal;
else delete process.env.CALENDAR_PUSH_VERIFICATION_TOKEN;
if (prevGmail) process.env.GMAIL_PUBSUB_VERIFICATION_TOKEN = prevGmail;
else delete process.env.GMAIL_PUBSUB_VERIFICATION_TOKEN;

console.log("google-push-multiplex.test.ts ok");
