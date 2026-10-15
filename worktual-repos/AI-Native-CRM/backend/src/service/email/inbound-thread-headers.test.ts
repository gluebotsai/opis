/**
 * run: npx tsx src/service/email/inbound-thread-headers.test.ts
 */
import { resolveGmailThreadIdFromActivities } from "./inbound-thread-headers";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const rows = [
  {
    gmail_thread_id: "bot_thread",
    email_direction: "inbound",
    created_by_user_id: null,
  },
  {
    gmail_thread_id: "owner_thread",
    email_direction: "outbound",
    created_by_user_id: "42",
  },
  {
    gmail_thread_id: "owner_thread",
    email_direction: "inbound",
    created_by_user_id: "42",
  },
];

assert(
  resolveGmailThreadIdFromActivities(rows) === "bot_thread",
  "default prefers any inbound thread",
);
assert(
  resolveGmailThreadIdFromActivities(rows, { mailboxUserId: "42" }) ===
    "owner_thread",
  "rep mailbox prefers owner gmail thread over nurture bot thread",
);

console.log("inbound-thread-headers.test.ts: ok");
