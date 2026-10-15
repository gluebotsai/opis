import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { ccPrisma } from "@ai-contact-center/db-cc";
import { runRollbackIntegration } from "@ai-contact-center/test-harness";

import { initiateHandoff, startConversation } from "../src/services/conversations.js";
import { getConversationMemory, upsertConversationMemory } from "../src/services/conversation-memory.js";
import { recordNlpTurn } from "../src/services/nlp-conversations.js";

const fixtures = await ccPrisma.$transaction(async (db) => {
  await db.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
  return db.$queryRaw<Array<{ organization_id: string; webchat_id: string }>>`
    SELECT channel.organization_id, config.webchat_id
    FROM accounts.setup_webchat_configs config
    INNER JOIN accounts.setup_channel_configs channel ON channel.id = config.channel_config_id
    WHERE channel.status = 'active'
    LIMIT 1
  `;
});

const fixture = fixtures[0];
if (!fixture) {
  console.log("SKIP webchat memory integration: no active webchat config");
  await ccPrisma.$disconnect();
  process.exit(0);
}

await runRollbackIntegration(async (db) => {
  const visitorId = `mem-${randomUUID().slice(0, 8)}`;
  const started = await startConversation(db, fixture.organization_id, {
    webchatId: fixture.webchat_id,
    visitorId,
    prechatAnswers: { email: `${visitorId}@example.com` },
  });

  const conversationId = started.conversation.id;
  await recordNlpTurn(db, fixture.organization_id, conversationId, {
    customerText: "What are your business hours?",
    botReply: "We are open Monday through Friday, 9am to 5pm.",
    confidence: 0.92,
    summary: "Customer asked about business hours.",
    importantFacts: ["Asked about hours"],
    runtimeType: "webchat_bot",
  });
  await recordNlpTurn(db, fixture.organization_id, conversationId, {
    customerText: "Can I talk to an agent?",
    botReply: "I'll connect you with a team member.",
    confidence: 0.4,
    handoffRecommended: true,
    handoffReason: "customer_requested_agent",
    summary: "Customer requested live agent.",
    runtimeType: "webchat_bot",
  });

  await upsertConversationMemory(db, fixture.organization_id, conversationId, {
    rollingSummary: "Customer asked about hours then requested an agent.",
    extractedFacts: ["Asked about business hours", "Requested agent"],
    modelName: "integration-fixture",
  });

  await initiateHandoff(db, fixture.organization_id, conversationId, {
    reason: "bot_handoff",
    queueId: null,
  });

  const memory = await getConversationMemory(db, fixture.organization_id, conversationId);
  assert.ok(memory?.rollingSummary?.includes("agent"));
  assert.ok((memory?.extractedFacts.length ?? 0) >= 1);

  console.log("PASS webchat memory integration");
});

await ccPrisma.$disconnect();
