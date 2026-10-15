import "@ai-contact-center/config/load-root-env";
import { ingestInboundSocialConversation } from "../apps/social-service/src/services/cc-core-social-client.js";

async function main() {
  const result = await ingestInboundSocialConversation({
    organizationId: 1000 as unknown as string,
    channelConfigId: 1004 as unknown as string,
    channelType: "whatsapp",
    externalThreadId: "919150911820",
    externalMessageId: `wamid-test-fix-${Date.now()}`,
    customerRef: "919150911820",
    body: "test after fix",
    occurredAt: new Date().toISOString(),
    phoneNumberId: "1140103312524386",
  });
  console.log(JSON.stringify(result, null, 2));
}

main();
