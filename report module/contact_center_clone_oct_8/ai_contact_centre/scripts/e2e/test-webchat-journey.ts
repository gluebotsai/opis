import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  assertConversationStatus,
  CcCoreClient,
  createTestRunIds,
  loadE2eConfig,
  NlpClient,
  runPreflight,
} from "@ai-contact-center/test-harness";

export async function runWebchatJourney(options: { smoke?: boolean } = {}) {
  const preflight = await runPreflight();
  if (!preflight.ok || !preflight.organizationId || !preflight.webchatId) {
    throw new Error(`Preflight failed: ${preflight.errors.join("; ")}`);
  }

  const config = loadE2eConfig();
  const ccCore = new CcCoreClient(config);
  const nlp = new NlpClient(config);
  const ids = createTestRunIds("webchat");

  const started = await ccCore.startWebchatConversation(preflight.organizationId, {
    webchatId: preflight.webchatId,
    visitorId: ids.visitorId,
    prechatAnswers: { email: ids.email },
  });
  const conversationId = started.conversation.id;

  const turn = await nlp.webchatTurn({
    organizationId: preflight.organizationId,
    conversationId,
    message: "What are your support hours?",
  });
  assert.ok(turn.reply?.length);

  if (options.smoke) {
    console.log("PASS webchat journey (smoke)");
    return { conversationId, organizationId: preflight.organizationId };
  }

  const session = await ccCore.loginAgent();
  await ccCore.updatePresence(session, "ready");

  await ccCore.handoff(preflight.organizationId, conversationId, "e2e_webchat_handoff");
  await assertConversationStatus(
    ccCore,
    preflight.organizationId,
    conversationId,
    ["queued", "assigned"],
  );

  const memory = await ccCore.getMemory(preflight.organizationId, conversationId);
  assert.ok(memory.memory?.rollingSummary || turn.reply);

  const context = await ccCore.getConversationContext(session, conversationId);
  assert.ok(context.context);

  console.log("PASS webchat journey");
  return { conversationId, organizationId: preflight.organizationId, session };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const smoke = process.argv.includes("--smoke");
  runWebchatJourney({ smoke }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
