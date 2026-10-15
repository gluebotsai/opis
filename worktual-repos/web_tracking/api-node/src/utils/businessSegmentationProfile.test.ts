import { describe, it, expect } from "node:test";
import {
  getSegmentationProfile,
  validateSegmentationAgainstOrgProfile,
} from "./businessSegmentationProfile.js";

describe("getSegmentationProfile", () => {
  it("maps B2B org to b2b site profile", () => {
    const p = getSegmentationProfile("B2B");
    expect(p.site_profile).toBe("b2b");
    expect(p.account_behaviour_labels.logged_out).toMatch(/Identified/i);
    expect(p.include_form_metrics).toBe(false);
  });

  it("maps B2C org to b2c site profile", () => {
    const p = getSegmentationProfile("B2C");
    expect(p.site_profile).toBe("b2c");
  });

  it("uses default when business type missing", () => {
    expect(getSegmentationProfile(null).site_profile).toBe("default");
  });
});

describe("validateSegmentationAgainstOrgProfile", () => {
  it("warns when B2B org is mostly generic", () => {
    const issues = validateSegmentationAgainstOrgProfile("B2B", {
      B2B: 5,
      B2C: 2,
      Hybrid: 3,
      Generic: 90,
    });
    expect(issues.some((i) => i.code === "b2b_org_mostly_generic")).toBe(true);
  });

  it("info when business_type unset", () => {
    const issues = validateSegmentationAgainstOrgProfile(null, { Generic: 10 });
    expect(issues.some((i) => i.code === "missing_org_business_type")).toBe(true);
  });
});
