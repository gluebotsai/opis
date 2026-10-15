/**
 * Live E2E for worktual1 contact-center email (channel credentials only).
 *
 * Exercises: credential store → cc-core ingest → NLP → bot decision → delivery claim.
 * Does not send real Gmail; delivery is claimed and left pending/failed-safe.
 *
 * Usage:
 *   npx tsx apps/chat-service/scripts/e2e-worktual1-email.ts
 */
import "@ai-contact-center/config/load-root-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pino from "pino";

import { loadConfig } from "../src/config.js";
import { GmailCredentialStore } from "../src/email/credential-store.js";
import { EmailOrchestrator } from "../src/email/email-orchestrator.js";
import type { GmailMessageMetadata } from "../src/email/gmail-client.js";
import {
  claimEmailDeliveries,
  ingestInboundEmailConversation,
} from "../src/services/cc-core-email-client.js";
import { getConversation } from "../src/services/cc-core-client.js";

const ORG_ID = "ce4ff326-4c0e-43f2-a978-e6b494cd0775";
const CHANNEL_ID = "0d720f7e-3f00-44b6-954a-31fe175dfc68";
const MAILBOX = "sample151102@gmail.com";
const QUEUE_ID = "81019f3d-826b-498f-8273-18abe4df6dba";

const config = loadConfig();
const logger = pino({ level: "warn" });
const store = new GmailCredentialStore(config);
const orchestrator = new EmailOrchestrator(logger);

function step(name: string): void {
  console.log(`\n▶ ${name}`);
}

async function main() {
  const results: Record<string, unknown> = {};

  step("1. Resolve channel credentials (no app_connections fallback)");
  const credentials = await store.getByAccountEmail(MAILBOX);
  assert.ok(credentials, `No channel credentials for ${MAILBOX}`);
  assert.equal(credentials!.organizationId, ORG_ID);
  assert.equal(credentials!.connectionId, CHANNEL_ID);
  assert.equal(credentials!.accountEmail, MAILBOX);
  results.credentials = {
    organizationId: credentials!.organizationId,
    channelConfigId: credentials!.connectionId,
    oauthConnectionId: credentials!.oauthConnectionId,
    ccaasHandler: credentials!.ccaasHandler,
  };
  console.log("  PASS");

  step("2. Ingest inbound email via cc-core internal API");
  const externalMessageId = `e2e-${randomUUID()}`;
  const externalThreadId = `e2e-thread-${randomUUID()}`;
  const customerEmail = `e2e-customer-${randomUUID().slice(0, 8)}@example.test`;
  const subject = `E2E worktual1 ${new Date().toISOString()}`;
  const body = "Hello, I need help with my billing account. What are your business hours?";

  const ingest = await ingestInboundEmailConversation({
    organizationId: ORG_ID,
    externalThreadId,
    externalMessageId,
    customerEmail,
    customerName: "E2E Customer",
    subject,
    body,
    occurredAt: new Date().toISOString(),
    mailboxConnectionId: CHANNEL_ID,
    mailboxEmail: MAILBOX,
    rfcMessageId: `<${externalMessageId}@example.test>`,
  });
  assert.ok(ingest, "cc-core ingest returned null — check CC_CORE_URL and INTERNAL_SERVICE_KEY");
  assert.equal(ingest!.created, true);
  assert.equal(ingest!.duplicate, false);
  assert.equal(ingest!.conversation.botActive, true);
  assert.ok(ingest!.automation.policy, "mailbox policy missing");
  assert.equal(ingest!.automation.policy!.connectionId, CHANNEL_ID);
  assert.equal(ingest!.automation.policy!.botEnabled, true);
  assert.equal(ingest!.automation.policy!.autoSendEnabled, true);
  assert.equal(ingest!.automation.policy!.defaultQueueId, QUEUE_ID);
  assert.ok(
    ingest!.automation.queueProfiles.some((p) => p.queueId === QUEUE_ID),
    "email queue profile missing for pre sales",
  );
  results.ingest = {
    conversationId: ingest!.conversationId,
    messageId: ingest!.messageId,
    status: ingest!.conversation.status,
    policySource: ingest!.automation.policy!.policyVersion,
  };
  console.log("  PASS");

  step("3. Duplicate ingest is idempotent");
  const duplicate = await ingestInboundEmailConversation({
    organizationId: ORG_ID,
    externalThreadId,
    externalMessageId,
    customerEmail,
    subject,
    body,
    occurredAt: new Date().toISOString(),
    mailboxConnectionId: CHANNEL_ID,
    mailboxEmail: MAILBOX,
    rfcMessageId: `<${externalMessageId}@example.test>`,
  });
  assert.ok(duplicate);
  assert.equal(duplicate!.duplicate, true);
  assert.equal(duplicate!.messageId, ingest!.messageId);
  console.log("  PASS");

  step("4. Orchestrator: NLP + bot decision (live auto-send path)");
  const metadata: GmailMessageMetadata = {
    messageId: externalMessageId,
    threadId: externalThreadId,
    senderEmail: customerEmail,
    replyTo: customerEmail,
    from: "E2E Customer",
    subject,
    body,
    dateHeader: new Date().toUTCString(),
    messageHeaderId: `<${externalMessageId}@example.test>`,
    inReplyTo: null,
    references: null,
    labelIds: ["INBOX", "UNREAD"],
    headers: {},
    attachments: [],
  };

  await orchestrator.handleInbound({
    credentials: credentials!,
    metadata,
    ingest: ingest!,
  });

  const snapshot = await getConversation(ORG_ID, ingest!.conversationId);
  assert.ok(snapshot, "conversation not found after orchestrator");
  const { conversation, messages } = snapshot!;
  const botMessages = messages.filter((m) => m.senderType === "bot");
  const hasBotOrHandoff =
    botMessages.length > 0 ||
    ["queued", "assigned", "handoff"].includes(conversation.status);
  assert.ok(hasBotOrHandoff, "expected bot reply or handoff after orchestrator");
  results.orchestrator = {
    conversationStatus: conversation.status,
    botActive: conversation.botActive,
    botMessageCount: botMessages.length,
    messageCount: messages.length,
  };
  console.log("  PASS");

  step("5. Delivery outbox claim (no Gmail send in e2e)");
  const deliveries = await claimEmailDeliveries(5);
  const ours = deliveries.filter((d) => d.organizationId === ORG_ID);
  results.delivery = {
    claimedForOrg: ours.length,
    sample: ours[0]
      ? { id: ours[0].id, recipient: ours[0].recipientEmail, subject: ours[0].subject }
      : null,
  };
  console.log(`  PASS (claimed ${ours.length} delivery row(s) for org)`);

  console.log("\n✅ E2E PASS worktual1 email\n");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error("\n❌ E2E FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
