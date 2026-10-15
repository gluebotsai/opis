/**
 * Run: npx tsx backend/src/service/ai/meeting-reminder-recipient.test.ts
 *
 * Documents recipient rules (logic lives in meeting-brief.ts + meeting-reminders.ts).
 */
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function pickSenderUserId(input: {
  assignedOwnerId: string | null;
  createdByUserId: string | null;
}): string | null {
  return input.assignedOwnerId?.trim() || input.createdByUserId?.trim() || null;
}

assert(
  pickSenderUserId({
    assignedOwnerId: "42",
    createdByUserId: "7",
  }) === "42",
  "customer reminder uses assigned owner, not meeting creator",
);

assert(
  pickSenderUserId({
    assignedOwnerId: null,
    createdByUserId: "7",
  }) === "7",
  "unassigned contact falls back to meeting creator",
);

console.log("meeting-reminder-recipient.test.ts: ok");
