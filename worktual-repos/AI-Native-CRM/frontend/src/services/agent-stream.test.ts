/**
 * run: npx tsx src/services/agent-stream.test.ts
 */
import { parseAgentStreamEvent } from "./agent-stream";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const valid = parseAgentStreamEvent(
  JSON.stringify({
    version: "1.0",
    id: "event-1",
    type: "final",
    organizationId: "tenant-1",
    runId: "run-1",
    traceId: "0123456789abcdef0123456789abcdef",
    occurredAt: "2026-08-18T00:00:00.000Z",
    data: {
      analytics: {
        findings: { summary: "Pipeline increased", rows: [] },
        chart: { type: "bar", x: "stage", y: "amount" },
      },
    },
  }),
);
assert(valid?.type === "final", "accepts versioned structured analytics");

const unsafe = parseAgentStreamEvent(
  JSON.stringify({
    ...valid,
    data: { analytics: { sql: "select * from contacts" } },
  }),
);
assert(unsafe === null, "rejects SQL-bearing analytics payloads");

console.log("agent stream frontend contract ok");
