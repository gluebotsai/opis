/**
 * Force-expire the current offered assignment and run reroute logic (E2E helper).
 * Usage: npx tsx apps/cc-core/scripts/force-offer-expiry.ts --conversation-id <id> --live
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

import { withOrganizationContext } from "../src/lib/rls.js";
import { expireConversationOffer } from "../src/services/conversations.js";

const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";
const live = process.argv.includes("--live");
const idArg = process.argv.findIndex((arg) => arg === "--conversation-id");
const conversationId = idArg >= 0 ? process.argv[idArg + 1] : undefined;

async function main() {
  if (!conversationId) {
    throw new Error("Provide --conversation-id");
  }

  const offered = await ccPrisma.$queryRaw<Array<{ state: string; agent_id: string }>>`
    SELECT state, agent_id::text AS agent_id
    FROM ccass.conversation_assignments
    WHERE organization_id = ${ORG_ID}::bigint
      AND conversation_id = ${conversationId}::bigint
    ORDER BY offered_at DESC NULLS LAST
    LIMIT 1
  `;

  console.log(
    JSON.stringify(
      { organizationId: ORG_ID, conversationId, live, latestAssignment: offered[0] ?? null },
      null,
      2,
    ),
  );

  if (!live) {
    console.log("Dry run only. Re-run with --live to expire the offer.");
    return;
  }

  if (offered[0]?.state !== "offered") {
    throw new Error(`No offered assignment to expire (state=${offered[0]?.state ?? "none"})`);
  }

  const result = await withOrganizationContext(ccPrisma, ORG_ID, (db) =>
    expireConversationOffer(db, ORG_ID, conversationId),
  );

  console.log(
    JSON.stringify(
      {
        expired: Boolean(result),
        rerouted: result?.rerouted ?? false,
        nextUserId: result?.nextUserId ?? null,
        timedOutPresence: result?.timedOutPresence?.presenceState ?? null,
        conversationStatus: result?.conversation.status ?? null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
