import "@ai-contact-center/config/load-root-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { ccPrisma } from "@ai-contact-center/db-cc";
import { CcCoreClient, createTestRunIds, loadE2eConfig, NlpClient } from "@ai-contact-center/test-harness";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const orgId = "1000";
  const cc = new CcCoreClient(loadE2eConfig());
  const nlp = new NlpClient(loadE2eConfig());
  const agent = await cc.loginAgent("agent.test@worktual.local", "Worktual@123");
  await cc.updatePresence(agent, "ready");

  const channelConfigId = "1004";
  const phoneNumberId = "1140103312524386";
  const customerPhone = createTestRunIds("fast").phone.replace(/\D/g, "");

  const ingest = await cc.ingestSocial(orgId, {
    organizationId: orgId,
    channelConfigId,
    channelType: "whatsapp",
    externalThreadId: customerPhone,
    externalMessageId: `wamid-${randomUUID()}`,
    customerRef: customerPhone,
    body: "Please connect me to a live agent",
    occurredAt: new Date().toISOString(),
    phoneNumberId,
  });
  const conversationId = ingest.conversation.id;
  const turn = await nlp.whatsappTurn({ organizationId: orgId, conversationId, message: "Please connect me to a live agent" });
  await cc.recordNlpTurn(orgId, conversationId, {
    customerText: "Please connect me to a live agent",
    botReply: turn.reply,
    handoffRecommended: true,
  });
  await cc.handoff(orgId, conversationId, "explicit_request");

  for (let i = 0; i < 40; i += 1) {
    const { conversation } = await cc.getConversation(orgId, conversationId);
    console.log(i, conversation.status, conversation.assignedAgentId);
    if (conversation.status === "assigned") {
      try {
        const result = await cc.acceptOffer(agent, conversationId);
        console.log("accepted", result);
        break;
      } catch (error) {
        console.log("accept err", error instanceof Error ? error.message : error);
      }
    }
    if (conversation.status === "active") break;
    await sleep(200);
  }
}

main().finally(() => ccPrisma.$disconnect());
