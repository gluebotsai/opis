/**
 * Revoke auth sessions for Playwright test agents (clears single-session login conflicts).
 *
 * Usage: npx tsx apps/cc-core/scripts/revoke-e2e-agent-sessions.ts --live
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { revokeAuthSessionsForEmail } from "../src/services/auth-sessions.js";

const AGENT_EMAILS = [
  process.env.PLAYWRIGHT_AGENT_A_EMAIL ?? "agent.test@worktual.local",
  process.env.PLAYWRIGHT_AGENT_B_EMAIL ?? "agent2.test@worktual.local",
  process.env.PLAYWRIGHT_AGENT_EMAIL ?? "agent.test@worktual.local",
].map((email) => email.trim().toLowerCase());

async function main() {
  const live = process.argv.includes("--live");
  const unique = [...new Set(AGENT_EMAILS)];
  const results: Array<{ email: string; revoked: number }> = [];

  for (const email of unique) {
    if (!live) {
      results.push({ email, revoked: 0 });
      continue;
    }
    const revoked = await revokeAuthSessionsForEmail(ccPrisma, email);
    results.push({ email, revoked });
  }

  console.log(JSON.stringify({ live, results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
