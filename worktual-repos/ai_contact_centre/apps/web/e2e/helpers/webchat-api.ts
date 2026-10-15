import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";

/** Expire the ringing offer immediately and trigger reroute (skips wall-clock timeout wait). */
export function forceOfferExpiry(conversationId: string): void {
  execSync(
    `npx tsx apps/cc-core/scripts/force-offer-expiry.ts --conversation-id ${conversationId} --live`,
    {
      cwd: repoRoot,
      stdio: "pipe",
      env: { ...process.env, ORGANIZATION_ID: ORG_ID },
    },
  );
}

export async function readCustomerConversationId(page: import("@playwright/test").Page): Promise<string> {
  const conversationId = await page.evaluate(() => {
    const webchat = (window as unknown as { __webchat?: { conversationId?: string | null } }).__webchat;
    return webchat?.conversationId ?? null;
  });
  if (!conversationId) {
    throw new Error("Customer webchat session has no conversationId");
  }
  return conversationId;
}
