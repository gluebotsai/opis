import assert from "node:assert/strict";
import {
  corpusUploadExceedsOrgCap,
  proposalCorpusMaxDocsPerOrg,
} from "../src/lib/proposal-corpus-limits";
import { requirementThemesChanged } from "../src/lib/proposal-theme-match";

assert.equal(proposalCorpusMaxDocsPerOrg(), 50);
assert.equal(
  corpusUploadExceedsOrgCap({ existingCount: 48, incomingCount: 2, cap: 50 }),
  false,
);
assert.equal(
  corpusUploadExceedsOrgCap({ existingCount: 49, incomingCount: 2, cap: 50 }),
  true,
);
assert.equal(requirementThemesChanged([], ["Pricing"]), false);
assert.equal(
  requirementThemesChanged(["crm", "Pricing"], ["pricing", "CRM"]),
  false,
);
assert.equal(requirementThemesChanged(["crm"], ["campaign"]), true);
assert.equal(requirementThemesChanged(["crm"], ["crm", "campaign"]), true);
console.log("limits-and-themes ok");
