/**
 * E2E: missed-contact reason lookup + backfill invariants.
 *
 * Does not change routing lifecycle codes. Requires a migrated local DB.
 *
 * Usage: npx tsx scripts/e2e/test-missed-contact-reasons.ts
 */
import "@ai-contact-center/config/load-root-env";
import assert from "node:assert/strict";

import { ccPrisma } from "@ai-contact-center/db-cc";

const ALLOWED = ["no_agent_available", "offer_timeout"] as const;

export async function runMissedContactReasons(): Promise<void> {
  const reasons = await ccPrisma.$queryRaw<Array<{ code: string; name: string }>>`
    SELECT code, name
    FROM ccass.missed_contact_reasons
    ORDER BY sort_order, id
  `;

  assert.deepEqual(
    reasons.map((row) => row.code),
    [...ALLOWED],
    "missed_contact_reasons must contain exactly the two product codes",
  );
  assert.equal(reasons[0]?.name, "No agents available");
  assert.equal(reasons[1]?.name, "Not picked up");

  const leftover = await ccPrisma.$queryRaw<Array<{ reason: string; n: number }>>`
    SELECT reason, COUNT(*)::int AS n
    FROM ccass.agent_missed_contacts
    WHERE reason NOT IN ('no_agent_available', 'offer_timeout')
    GROUP BY reason
  `;
  assert.deepEqual(leftover, [], "agent_missed_contacts.reason must be backfilled to the two codes");

  const fk = await ccPrisma.$queryRaw<Array<{ conname: string }>>`
    SELECT conname
    FROM pg_constraint
    WHERE conname = 'agent_missed_contacts_reason_fkey'
  `;
  assert.equal(fk.length, 1, "reason must FK to missed_contact_reasons");

  console.log("missed-contact reasons lookup + backfill e2e passed");
}

const isDirectRun = process.argv[1]?.includes("test-missed-contact-reasons");
if (isDirectRun) {
  runMissedContactReasons()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await ccPrisma.$disconnect();
    });
}
