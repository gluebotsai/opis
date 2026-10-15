/**
 * Run: npx tsx backend/src/service/ai/lead-score-enrichment-context.test.ts
 */
import { applyEnrichmentSnapshotToScoreFields } from "./lead-scoring-job";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const base = {
  companyName: null as string | null,
  industry: null as string | null,
  employeeCount: null as number | null,
  city: null as string | null,
  country: null as string | null,
  snapshot: {
    company_name: "Zoho Corporation",
    industry: "Software",
    company_size: "10000",
    geography: "Chennai",
    seniority_tier: "director",
    email_domain_type: "corporate",
  },
};

const merged = applyEnrichmentSnapshotToScoreFields(base);
assert(merged.companyName === "Zoho Corporation", "company from snapshot");
assert(merged.industry === "Software", "industry from snapshot");
assert(merged.employeeCount === 10000, "employee count parsed from snapshot");
assert(merged.city === "Chennai", "city from snapshot geography");

const keepsCrm = applyEnrichmentSnapshotToScoreFields({
  ...base,
  companyName: "CRM Co",
  industry: "Retail",
  employeeCount: 250,
  city: "Mumbai",
});
assert(keepsCrm.companyName === "CRM Co", "keep CRM company");
assert(keepsCrm.industry === "Retail", "keep CRM industry");
assert(keepsCrm.employeeCount === 250, "keep CRM employee count");
assert(keepsCrm.city === "Mumbai", "keep CRM city");

const tier = applyEnrichmentSnapshotToScoreFields({
  ...base,
  snapshot: { ...base.snapshot, company_size: "51-200" },
});
assert(tier.employeeCount === 125, "size tier midpoint");

console.log("lead-score-enrichment-context.test.ts: ok");
