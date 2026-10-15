/**
 * One-time: case studies from existing pairs (confidence ≥ 0.65), then synthesize
 * if an org crosses 3 studies. Does not re-freeze visual playbooks.
 *
 * Run: npx tsx scripts/backfill-proposal-case-studies.ts [organizationId]
 */
import { backfillProposalCorpusCaseStudies } from "../src/service/ai/proposal-corpus-backfill.ts";

async function main() {
  const organizationId =
    process.argv[2]?.trim() || process.env.ORGANIZATION_ID?.trim() || undefined;
  const result = await backfillProposalCorpusCaseStudies({ organizationId });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
