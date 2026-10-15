import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { ccPrisma } from "@ai-contact-center/db-cc";

import { commitEmailBotDecision } from "../src/services/email-bot-decisions.js";
import { ingestInboundEmailConversation } from "../src/services/email-conversations.js";
import { upsertEmailMailboxPolicy } from "../src/services/email-policies.js";
import { endConversation, initiateHandoff } from "../src/services/conversations.js";

class RollbackIntegrationTest extends Error {}

async function getConversationPriority(
  db: Parameters<typeof ingestInboundEmailConversation>[0],
  organizationId: string,
  conversationId: string,
) {
  const rows = await db.$queryRaw<Array<{ priority: number }>>`
    SELECT priority
    FROM ccass.conversations
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${conversationId}::bigint
    LIMIT 1
  `;
  return rows[0]?.priority ?? null;
}

const fixtures = await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  return db.$queryRaw<
    Array<{
      organization_id: string;
      queue_id: string;
    }>
  >`
    SELECT
      queue.organization_id,
      queue.id AS queue_id
    FROM ccass.queues queue
    WHERE queue.status = 'active'
      AND EXISTS (
        SELECT 1 FROM ccass.queue_members member
        WHERE member.queue_id = queue.id
          AND member.handles_email = TRUE
      )
    ORDER BY queue.updated_at DESC
    LIMIT 1
  `;
});

const fixture = fixtures[0]
  ? {
      organization_id: String(fixtures[0].organization_id),
      queue_id: String(fixtures[0].queue_id),
    }
  : undefined;
if (!fixture) {
  console.log("SKIP enterprise email integration: no email-enabled runtime queue");
  await ccPrisma.$disconnect();
  process.exit(0);
}

const testConnectionId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let tokenSeq = 0;
function shortToken(prefix: string) {
  tokenSeq += 1;
  return `${prefix}${tokenSeq}${Date.now().toString(36)}`;
}
const testAccountEmail = `${shortToken("box")}@e.test`;

try {
  await ccPrisma.$transaction(
    async (db) => {
      await db.$executeRaw`
        SELECT set_config('app.organization_id', ${fixture.organization_id}, true)
      `;
      await upsertEmailMailboxPolicy(db, fixture.organization_id, {
        connectionId: testConnectionId,
        accountEmail: testAccountEmail,
        botEnabled: false,
        liveAgentEnabled: true,
        shadowMode: true,
        autoSendEnabled: false,
        confidenceThreshold: 0.85,
        defaultQueueId: fixture.queue_id,
        allowedQueueIds: [fixture.queue_id],
        approvedServiceMessage: null,
      });
      const directExternalId = shortToken("d");
      const direct = await ingestInboundEmailConversation(db, {
        organizationId: fixture.organization_id,
        externalThreadId: shortToken("dt"),
        externalMessageId: directExternalId,
        customerEmail: `${shortToken("dc")}@e.test`,
        customerName: "Direct Routing Test",
        subject: "Direct live-agent regression",
        body: "Route this email directly while the bot is disabled.",
        occurredAt: new Date().toISOString(),
        mailboxConnectionId: testConnectionId,
        mailboxEmail: testAccountEmail,
        rfcMessageId: `<${directExternalId}@example.com>`,
      });
      assert.equal(direct.conversation.botActive, false);
      assert.ok(["queued", "assigned"].includes(direct.conversation.status));

      await upsertEmailMailboxPolicy(db, fixture.organization_id, {
        connectionId: testConnectionId,
        accountEmail: testAccountEmail,
        botEnabled: true,
        liveAgentEnabled: true,
        shadowMode: false,
        autoSendEnabled: true,
        confidenceThreshold: 0.85,
        defaultQueueId: fixture.queue_id,
        allowedQueueIds: [fixture.queue_id],
        approvedServiceMessage: null,
      });

      const externalMessageId = shortToken("m");
      const payload = {
        organizationId: fixture.organization_id,
        externalThreadId: shortToken("th"),
        externalMessageId,
        customerEmail: `${shortToken("cu")}@e.test`,
        customerName: "Enterprise Test",
        subject: "Billing integration test",
        body: "Please explain the approved billing policy.",
        occurredAt: new Date().toISOString(),
        mailboxConnectionId: testConnectionId,
        mailboxEmail: testAccountEmail,
        rfcMessageId: `<${externalMessageId}@example.com>`,
        providerHeaders: { "message-id": `<${externalMessageId}@example.com>` },
      };
      const ingest = await ingestInboundEmailConversation(db, payload);
      assert.equal(ingest.created, true);
      assert.equal(ingest.duplicate, false);
      assert.equal(ingest.conversation.channel, "email");
      assert.equal(ingest.conversation.botActive, true);
      assert.equal(ingest.assignment, null);

      const duplicate = await ingestInboundEmailConversation(db, payload);
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.message.id, ingest.message.id);

      const sameCustomerEmail = `${shortToken("sh")}@e.test`;
      const firstThreadId = shortToken("ta");
      const secondThreadId = shortToken("tb");
      const firstInboundId = shortToken("fa");
      const secondInboundId = shortToken("fb");
      const firstInbound = await ingestInboundEmailConversation(db, {
        ...payload,
        externalThreadId: firstThreadId,
        externalMessageId: firstInboundId,
        customerEmail: sameCustomerEmail,
        subject: "First separate thread",
        body: "First email from the same customer.",
        occurredAt: new Date().toISOString(),
        rfcMessageId: `<${firstInboundId}@example.com>`,
      });
      const secondInbound = await ingestInboundEmailConversation(db, {
        ...payload,
        externalThreadId: secondThreadId,
        externalMessageId: secondInboundId,
        customerEmail: sameCustomerEmail,
        subject: "Second separate thread",
        body: "Second email from the same customer before end.",
        occurredAt: new Date().toISOString(),
        rfcMessageId: `<${secondInboundId}@example.com>`,
      });
      assert.equal(firstInbound.created, true);
      assert.equal(secondInbound.created, true);
      assert.notEqual(secondInbound.conversation.id, firstInbound.conversation.id);
      assert.equal(firstInbound.conversation.providerThreadId, firstThreadId);
      assert.equal(secondInbound.conversation.providerThreadId, secondThreadId);

      const sameThreadReplyId = shortToken("rp");
      const sameThreadReply = await ingestInboundEmailConversation(db, {
        ...payload,
        externalThreadId: firstThreadId,
        externalMessageId: sameThreadReplyId,
        customerEmail: sameCustomerEmail,
        subject: "Re: First separate thread",
        body: "Reply on the first Gmail thread.",
        occurredAt: new Date().toISOString(),
        rfcMessageId: `<${sameThreadReplyId}@example.com>`,
      });
      assert.equal(sameThreadReply.created, false);
      assert.equal(sameThreadReply.conversation.id, firstInbound.conversation.id);
      assert.equal(sameThreadReply.conversation.providerThreadId, firstThreadId);

      const committed = await commitEmailBotDecision(
        db,
        fixture.organization_id,
        ingest.conversation.id,
        {
          customerMessageId: ingest.message.id,
          customerText: payload.body,
          reply: "Approved grounded billing answer.",
          confidence: 0.99,
          grounded: true,
          intent: "billing",
          selectedQueueKey: fixture.queue_id,
          candidateSkills: [],
          summary: "Customer asked about billing.",
          sentiment: "neutral",
          importantFacts: ["Billing policy requested"],
          knowledgeUsed: ["companyName"],
          handoffRecommended: false,
          handoffReason: null,
          guardPassed: true,
          guardReasons: [],
          urgency: "critical",
          traceId: randomUUID(),
          modelName: "integration-fixture",
          latencyMs: 5,
          queueProfileVersion: "v1",
          delivery: {
            connectionId: testConnectionId,
            recipientEmail: payload.customerEmail,
            subject: payload.subject,
            providerThreadId: payload.externalThreadId,
            inReplyTo: payload.rfcMessageId,
            references: payload.rfcMessageId,
          },
        },
      );
      assert.equal(committed.acceptedForDelivery, true);
      assert.ok(committed.deliveryId);
      assert.equal(
        await getConversationPriority(db, fixture.organization_id, ingest.conversation.id),
        2,
      );

      const handoff = await initiateHandoff(
        db,
        fixture.organization_id,
        ingest.conversation.id,
        {
          reason: "integration_human_request",
          queueId: fixture.queue_id,
          candidateSkills: [],
        },
      );
      assert.equal(handoff.conversation.botActive, false);
      assert.ok(["queued", "assigned"].includes(handoff.conversation.status));

      const ended = await endConversation(
        db,
        fixture.organization_id,
        null,
        ingest.conversation.id,
        {
          actor: "system",
          reason: "integration_closed",
        },
      );
      assert.equal(ended.conversation.status, "closed");
      assert.equal(ended.conversation.providerThreadId, payload.externalThreadId);

      const followUpMessageId = shortToken("fu");
      const followUp = await ingestInboundEmailConversation(db, {
        ...payload,
        externalMessageId: followUpMessageId,
        body: "Follow-up after the case was closed.",
        occurredAt: new Date().toISOString(),
        rfcMessageId: `<${followUpMessageId}@example.com>`,
      });
      assert.equal(followUp.created, true);
      assert.notEqual(followUp.conversation.id, ingest.conversation.id);
      assert.equal(followUp.conversation.providerThreadId, payload.externalThreadId);
      assert.equal(followUp.conversation.previousConversationId, ingest.conversation.id);
      assert.equal(followUp.conversation.status, "bot_active");

      const inactivityRows = await db.$queryRaw<Array<{ inactivity_close_hours: number }>>`
        SELECT COALESCE(policy.inactivity_close_hours, 48) AS inactivity_close_hours
        FROM ccass.email_mailbox_policies policy
        WHERE policy.organization_id = ${fixture.organization_id}::bigint
          AND policy.connection_id = ${testConnectionId}::bigint
        LIMIT 1
      `;
      assert.ok((inactivityRows[0]?.inactivity_close_hours ?? 48) >= 1);

      const reopenedOriginal = await db.$queryRaw<Array<{ status: string }>>`
        SELECT status
        FROM ccass.conversations
        WHERE organization_id = ${fixture.organization_id}::bigint
          AND id = ${ingest.conversation.id}::bigint
        LIMIT 1
      `;
      assert.equal(reopenedOriginal[0]?.status, "closed");

      throw new RollbackIntegrationTest("rollback");
    },
    { timeout: 180_000, maxWait: 15_000 },
  );
} catch (error) {
  if (!(error instanceof RollbackIntegrationTest)) throw error;
}

console.log("PASS enterprise email integration (transaction rolled back)");
await ccPrisma.$disconnect();
