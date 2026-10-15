/**
 * run: npx tsx --tsconfig tsconfig.json src/service/ai/agent-event-bus.test.ts
 */
import {
  closeAgentEventBus,
  publishAgentEvent,
  replayAgentEvents,
} from "./agent-event-bus";

delete process.env.REDIS_URL;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const first = await publishAgentEvent({
  organizationId: "tenant-a",
  runId: "run-1",
  traceId: "0123456789abcdef0123456789abcdef",
  type: "progress",
  data: { stage: "accepted" },
});
const second = await publishAgentEvent({
  organizationId: "tenant-a",
  runId: "run-1",
  traceId: "0123456789abcdef0123456789abcdef",
  type: "final",
  data: { ok: true },
});
const replayedSecond = await publishAgentEvent({
  organizationId: "tenant-a",
  runId: "run-1",
  traceId: "0123456789abcdef0123456789abcdef",
  type: "final",
  data: { ok: true },
});
assert(replayedSecond.id === second.id, "identical events have stable ids");
await publishAgentEvent({
  organizationId: "tenant-b",
  runId: "run-1",
  traceId: "fedcba9876543210fedcba9876543210",
  type: "error",
  data: { code: "private" },
});

const tenantA = await replayAgentEvents("tenant-a", "run-1");
assert(tenantA.length === 2, "events are tenant isolated");
assert(tenantA.every((event) => event.organizationId === "tenant-a"), "tenant id");
assert(tenantA[0]?.version === "1.0", "versioned event schema");

const resumed = await replayAgentEvents("tenant-a", "run-1", first.id);
assert(resumed.length === 1 && resumed[0]?.id === second.id, "cursor resumes after id");

await closeAgentEventBus();
console.log("agent event bus contract ok");
