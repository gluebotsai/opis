import "@ai-contact-center/config/load-root-env";
import { CcCoreClient, loadE2eConfig } from "@ai-contact-center/test-harness";

async function main() {
  const cc = new CcCoreClient(loadE2eConfig());
  const agent = await cc.loginAgent("agent.test@worktual.local", "Worktual@123");
  const orgId = "1000";
  const conversationId = process.argv[2] ?? "1030";
  const { conversation } = await cc.getConversation(orgId, conversationId);
  console.log("conversation", conversation);
  try {
    const result = await cc.acceptOffer(agent, conversationId);
    console.log("accept ok", result);
  } catch (error) {
    console.error("accept failed", error);
  }
}

main();
