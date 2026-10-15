/**
 * Revoke Contact Center auth sessions for one email.
 * CRM and Ticketing rows for that email are left in place.
 *
 * Usage: npx tsx apps/cc-core/scripts/revoke-auth-sessions-by-email.ts user@example.com
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { revokeAuthSessionsForEmail } from "../src/services/auth-sessions.js";

async function main() {
  const email = process.argv[2]?.trim();
  if (!email) {
    console.error("Usage: npx tsx apps/cc-core/scripts/revoke-auth-sessions-by-email.ts <email>");
    process.exitCode = 1;
    return;
  }
  const revoked = await revokeAuthSessionsForEmail(ccPrisma, email);
  console.log(JSON.stringify({ email, revoked }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
