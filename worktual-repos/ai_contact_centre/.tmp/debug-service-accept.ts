import "@ai-contact-center/config/load-root-env";
import { randomUUID } from "node:crypto";

import { ccPrisma } from "@ai-contact-center/db-cc";
import { withOrganizationContext } from "../apps/cc-core/src/lib/rls.js";
import { acceptConversationOffer, getConversation } from "../apps/cc-core/src/services/conversations.js";
import { CcCoreClient, createTestRunIds, loadE2eConfig, NlpClient } from "@ai-contact-center/test-harness";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const orgId = "1000";
  const userId = "1003";
  const cc = new CcCoreClient(loadE2eConfig());
  const nlp = new NlpClient(loadE2eConfig());
  await cc.updatePresence(await cc.loginAgent("agent.test@worktual.local", "Worktual@123"), "ready");

  const customerPhone = createTestRunIds("svc").phone.replace(/\D/g, "");
  const ingest = await cc.ingestSocial(orgId, {
    organizationId: orgId,
    channelConfigId: "1004",
    channelType: "whatsapp",
    externalThreadId: customerPhone,
    externalMessageId: `wamid-${randomUUID()}`,
    customerRef: customerPhone,
    body: "Please connect me to a live agent",
    occurredAt: new Date().toISOString(),
    phoneNumberId: "1140103312524386",
  });
  const conversationId = ingest.conversation.id;
  const turn = await nlp.whatsappTurn({
    organizationId: orgId,
    conversationId,
    message: "Please connect me to a live agent",
  });
  await cc.recordNlpTurn(orgId, conversationId, {
    customerText: "Please connect me to a live agent",
    botReply: turn.reply,
    handoffRecommended: true,
  });
  await cc.handoff(orgId, conversationId, "explicit_request");
  await sleep(500);

  await withOrganizationContext(ccPrisma, orgId, async (db) => {
    const conversation = await getConversation(db, orgId, conversationId);
    console.log("service getConversation", conversation?.status, conversation?.assignedAgentId);
    try {
      const accepted = await acceptConversationOffer(db, orgId, userId, conversationId);
      console.log("service accept ok", accepted.status);
    } catch (error) {
      console.error("service accept failed", error);
    }
  });
}

main().finally(() => ccPrisma.$disconnect());
