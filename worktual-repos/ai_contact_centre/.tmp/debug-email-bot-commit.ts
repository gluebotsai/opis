import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";
import { commitEmailBotDecision } from "../apps/cc-core/src/services/email-bot-decisions.js";

const ORG_ID = "1000";
const CONVERSATION_ID = "1056";
const CUSTOMER_MESSAGE_ID = "1109";
const CONNECTION_ID = "1008";

await ccPrisma.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
await ccPrisma.$executeRaw`SELECT set_config('app.organization_id', ${ORG_ID}, true)`;

await ccPrisma.$executeRaw`
  DELETE FROM ccass.nlp_turns
  WHERE organization_id = ${ORG_ID}::bigint
    AND conversation_id = ${CONVERSATION_ID}::bigint
    AND customer_message_id = ${CUSTOMER_MESSAGE_ID}::bigint
`;

try {
  const result = await commitEmailBotDecision(ccPrisma, ORG_ID, CONVERSATION_ID, {
    customerMessageId: CUSTOMER_MESSAGE_ID,
    customerText: "test body from debug script",
    reply: "Thanks for reaching out. Here is our automated reply.",
    confidence: 0.9,
    grounded: true,
    intent: "general_inquiry",
    selectedQueueKey: "1000",
    candidateSkills: [],
    summary: null,
    sentiment: null,
    importantFacts: [],
    knowledgeUsed: [],
    handoffRecommended: false,
    handoffReason: null,
    guardPassed: true,
    guardReasons: [],
    urgency: "normal",
    traceId: null,
    modelName: "debug",
    latencyMs: 100,
    queueProfileVersion: null,
    delivery: {
      connectionId: CONNECTION_ID,
      recipientEmail: "messages-noreply@linkedin.com",
      subject: "Test subject",
      providerThreadId: "19ff5e507c99a36b",
      inReplyTo: null,
      references: null,
    },
  });
  console.log("result", JSON.stringify(result));
} catch (error) {
  console.error("commit failed:");
  console.error(error);
  process.exit(1);
}

await ccPrisma.$disconnect();
