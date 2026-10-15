import assert from "node:assert/strict";
import test from "node:test";

import { EmailProcessLog } from "./email-process-log.js";

test("EmailProcessLog records sequential steps with org, from, to, and mail preview", () => {
  const lines: Array<{ msg: string; payload: Record<string, unknown> }> = [];
  const logger = {
    child: () => logger,
    info: (payload: Record<string, unknown>, msg: string) => {
      lines.push({ msg, payload });
    },
    error: (payload: Record<string, unknown>, msg: string) => {
      lines.push({ msg, payload });
    },
  };

  const log = new EmailProcessLog(
    {
      organizationId: "ce4ff326-4c0e-43f2-a978-e6b494cd0775",
      from: "customer@example.com",
      to: "support@company.com",
      mail: "Please help with my billing question.",
      subject: "Billing help",
      messageId: "msg-123",
    },
    logger as never,
  );

  log.step("ingest_started");
  log.step("message_stored", { conversationId: "conv-1" });
  log.complete({ status: "queued" });

  assert.equal(lines[0]?.msg, "email received");
  assert.equal(lines[0]?.payload.organizationId, "ce4ff326-4c0e-43f2-a978-e6b494cd0775");
  assert.equal(lines[0]?.payload.from, "customer@example.com");
  assert.equal(lines[0]?.payload.to, "support@company.com");
  assert.equal(lines[1]?.payload.step, 1);
  assert.equal(lines[1]?.payload.stepName, "ingest_started");
  assert.equal(lines[2]?.payload.step, 2);
  assert.equal(lines[3]?.msg, "email processing complete");
});
