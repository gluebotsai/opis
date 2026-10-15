/**
 * run: npx tsx --tsconfig tsconfig.json src/service/ai/meeting-attendee-lock.test.ts
 */
import assert from "node:assert/strict";
import { applyMeetBindingDecisionToLock } from "./meeting-attendee-lock.js";
import { shouldAutoAssistFromChunk } from "@/lib/meeting-assist-speakers";

const hostPath = {
  id: "meet:s:ch-0",
  role: "host" as const,
  name: "Yaswanth M G",
  email: "yaswanth@worktual.io",
};
const unknownPath = {
  id: "meet:s:ch-1",
  role: "unknown" as const,
  name: "lucifer",
  email: null,
};

{
  const mapped = applyMeetBindingDecisionToLock({
    sessionId: "s",
    channel: "ch-1",
    displayName: "lucifer",
    hostPath: unknownPath,
    decisionRole: "unknown",
    decisionEmail: null,
  });
  assert.equal(mapped.next.role, "customer");
  assert.equal(mapped.channelResolution, "ready-unbound");
  assert.equal(
    shouldAutoAssistFromChunk({
      source: "live_pcm",
      attendeeRole: mapped.next.role,
      channelBindingsEnabled: true,
      channelResolution: mapped.channelResolution,
    }),
    true,
  );
}

{
  const mapped = applyMeetBindingDecisionToLock({
    sessionId: "s",
    channel: "unkeyed",
    displayName: "lucifer",
    hostPath: unknownPath,
    decisionRole: "unknown",
    decisionEmail: null,
  });
  assert.equal(mapped.next.role, "customer");
}

{
  const mapped = applyMeetBindingDecisionToLock({
    sessionId: "s",
    channel: "ch-0",
    displayName: "Yaswanth M G",
    hostPath,
    decisionRole: "unknown",
    decisionEmail: null,
  });
  assert.equal(mapped.next.role, "host");
  assert.equal(mapped.channelResolution, "employee");
}

{
  const mapped = applyMeetBindingDecisionToLock({
    sessionId: "s",
    channel: "ch-bot",
    displayName: "Worktual Notetaker",
    hostPath: unknownPath,
    decisionRole: "unknown",
    decisionEmail: null,
  });
  assert.equal(mapped.next.role, "unknown");
  assert.equal(
    shouldAutoAssistFromChunk({
      source: "live_pcm",
      attendeeRole: mapped.next.role,
      channelBindingsEnabled: true,
      channelResolution: mapped.channelResolution,
    }),
    false,
  );
}

console.log("meeting-attendee-lock.test.ts ok");
