import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNurtureApiLog } from "./nurture-api-log.ts";

const directory = mkdtempSync(join(tmpdir(), "nurture-api-log-"));
const originalDirectory = process.env.NURTURE_API_LOG_DIR;

try {
  process.env.NURTURE_API_LOG_DIR = directory;
  writeNurtureApiLog({
    nurtureKind: "voicebot",
    service: "cc-core",
    operation: "auto-bot-call",
    method: "POST",
    url: "https://example.test/call?token=never-log-this",
    request: {
      organizationId: "1003",
      number: "918883369379",
      internalServiceKey: "never-log-this",
      nested: { authorization: "Bearer never-log-this" },
    },
    response: {
      sessionId: "session-1",
      refreshToken: "never-log-this",
    },
    status: 202,
    ok: true,
    organizationId: "1003",
    contactId: "contact-1",
  });
  writeNurtureApiLog({
    nurtureKind: "email",
    service: "campaign",
    operation: "personalised-crm-automation",
    method: "POST",
    url: "https://campaign.example/automation",
    request: { to: "lead@example.com", subject: "Check in" },
    response: { runId: "run-1" },
    status: 202,
    ok: true,
    organizationId: "1003",
    contactId: "contact-1",
  });

  const day = new Date().toISOString().slice(0, 10);
  const text = readFileSync(
    join(directory, `nurture-api-${day}.log`),
    "utf8",
  );

  assert.match(text, /========== NURTURE VOICEBOT \| POST auto-bot-call \| OK status=202/);
  assert.match(text, /========== NURTURE EMAIL \| POST personalised-crm-automation \| OK status=202/);
  assert.match(text, /--- request payload ---/);
  assert.match(text, /--- response ---/);
  assert.match(text, /"sessionId": "session-1"/);
  assert.match(text, /"runId": "run-1"/);
  assert.match(text, /internalServiceKey": "\[REDACTED\]"/);
  assert.doesNotMatch(text, /never-log-this/);
} finally {
  if (originalDirectory == null) {
    delete process.env.NURTURE_API_LOG_DIR;
  } else {
    process.env.NURTURE_API_LOG_DIR = originalDirectory;
  }
  rmSync(directory, { recursive: true, force: true });
}

console.log("nurture-api-log.test.ts ok");
