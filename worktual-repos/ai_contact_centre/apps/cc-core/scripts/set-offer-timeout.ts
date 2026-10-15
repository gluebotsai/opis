/**
 * Set offer_timeout_seconds for all routing policies (E2E helper).
 * Usage: npx tsx apps/cc-core/scripts/set-offer-timeout.ts --seconds 30 --live
 */
import "@ai-contact-center/config/load-root-env";
import { ccPrisma } from "@ai-contact-center/db-cc";

const ORG_ID = process.env.ORGANIZATION_ID ?? "1000";
const secondsArg = process.argv.findIndex((arg) => arg === "--seconds");
const seconds = secondsArg >= 0 ? Number(process.argv[secondsArg + 1]) : 20;
const live = process.argv.includes("--live");

async function main() {
  if (!Number.isFinite(seconds) || seconds < 1) {
    throw new Error("Provide --seconds with a positive integer");
  }

  const rows = await ccPrisma.$queryRaw<Array<{ queue_id: string; offer_timeout_seconds: number }>>`
    SELECT queue_id, offer_timeout_seconds
    FROM ccass.routing_policies
    WHERE organization_id = ${ORG_ID}::bigint
  `;

  console.log(
    JSON.stringify(
      { organizationId: ORG_ID, live, seconds, policies: rows },
      (_, value) => (typeof value === "bigint" ? String(value) : value),
      2,
    ),
  );

  if (!live) {
    console.log("Dry run only. Re-run with --live to apply.");
    return;
  }

  await ccPrisma.$executeRaw`
    UPDATE ccass.routing_policies
    SET offer_timeout_seconds = ${seconds}
    WHERE organization_id = ${ORG_ID}::bigint
  `;

  console.log(`Updated offer_timeout_seconds to ${seconds} for org ${ORG_ID}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ccPrisma.$disconnect();
  });
