import { describe, expect, it } from "vitest";
import {
  corpusUploadExceedsOrgCap,
  proposalCorpusMaxDocsPerOrg,
} from "./proposal-corpus-limits";
import { requirementThemesChanged } from "./proposal-theme-match";

describe("proposal corpus org cap", () => {
  it("defaults to 50", () => {
    expect(proposalCorpusMaxDocsPerOrg()).toBe(50);
  });

  it("rejects uploads that would pass the cap", () => {
    expect(
      corpusUploadExceedsOrgCap({
        existingCount: 48,
        incomingCount: 2,
        cap: 50,
      }),
    ).toBe(false);
    expect(
      corpusUploadExceedsOrgCap({
        existingCount: 49,
        incomingCount: 2,
        cap: 50,
      }),
    ).toBe(true);
  });
});

describe("requirement theme rematch", () => {
  it("keeps the pin when themes are unchanged or unset", () => {
    expect(requirementThemesChanged([], ["Pricing"])).toBe(false);
    expect(requirementThemesChanged(["crm", "Pricing"], ["pricing", "CRM"])).toBe(
      false,
    );
  });

  it("rematches when themes differ", () => {
    expect(requirementThemesChanged(["crm"], ["campaign"])).toBe(true);
    expect(requirementThemesChanged(["crm"], ["crm", "campaign"])).toBe(true);
  });
});
