import { randomUUID } from "node:crypto";

export type TestRunIds = {
  runId: string;
  visitorId: string;
  email: string;
  phone: string;
  externalMessageId: string;
};

export function createTestRunIds(prefix = "e2e"): TestRunIds {
  const runId = `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  return {
    runId,
    visitorId: `v_${runId}`,
    email: `${runId}@example.test`,
    phone: `1555${String(Date.now()).slice(-7)}`,
    externalMessageId: `msg-${runId}`,
  };
}
