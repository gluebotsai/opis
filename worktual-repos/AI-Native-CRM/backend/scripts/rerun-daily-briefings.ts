/**
 * Force-regenerate today's daily briefing scripts via the Python agent.
 * run: env -u DATABASE_URL -u ACCOUNT_DATABASE_URL npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/rerun-daily-briefings.ts
 */
import { prisma } from "../src/dao/db/prisma.js";
import { rerunTodaysDailyBriefings } from "../src/service/home/daily-briefing-commands.js";

async function main() {
  const results = await rerunTodaysDailyBriefings();
  for (const row of results) {
    console.log("--- user", row.userId);
    console.log(row.script ?? "(no script)");
  }
  console.log("reran", results.length, "briefing(s)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
