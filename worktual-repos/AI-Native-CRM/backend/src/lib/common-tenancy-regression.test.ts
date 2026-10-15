import { describe, expect, it } from "vitest";
import {
  contactFieldsForVertical,
  getVerticalPack,
  mapIndustryTypeToVertical,
  sanitizeCustomAttributes,
} from "./vertical-packs";
import { enforceContactCompanyForBusinessType } from "./contact-company-motion";

describe("vertical packs", () => {
  it("returns ecommerce contact fields", () => {
    const fields = contactFieldsForVertical("ecommerce");
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((f) => f.entity === "contact")).toBe(true);
  });

  it("sanitizes only known pack keys", () => {
    const cleaned = sanitizeCustomAttributes("healthcare", {
      patient_ref: "MRN-1",
      consent_marketing: true,
      hacker_field: "nope",
    });
    expect(cleaned).toEqual({
      patient_ref: "MRN-1",
      consent_marketing: true,
    });
  });

  it("falls back to general pack", () => {
    expect(getVerticalPack("not-a-real-vertical").id).toBe("general");
    expect(contactFieldsForVertical("general")).toEqual([]);
  });

  it("maps accounts.industry_type onto packs", () => {
    expect(mapIndustryTypeToVertical("ecommerce")).toBe("ecommerce");
    expect(mapIndustryTypeToVertical("E-Commerce")).toBe("ecommerce");
    expect(mapIndustryTypeToVertical("Retail")).toBe("ecommerce");
    expect(mapIndustryTypeToVertical("Healthcare")).toBe("healthcare");
    expect(mapIndustryTypeToVertical("Banking")).toBe("finance");
    expect(mapIndustryTypeToVertical("Telecom")).toBe("telecom");
    expect(mapIndustryTypeToVertical("Software")).toBe("general");
    expect(mapIndustryTypeToVertical(null)).toBe("general");
    expect(mapIndustryTypeToVertical("")).toBe("general");
  });
});

describe("motion matrix regression", () => {
  it("keeps B2B requiring company (existing flow invariant)", () => {
    const r = enforceContactCompanyForBusinessType("b2b", {
      companyId: "co_existing",
      companyName: null,
    });
    expect(r.ok).toBe(true);
  });

  it("allows optional company for B2B and B2B2C", () => {
    expect(
      enforceContactCompanyForBusinessType("b2b2c", {
        companyId: null,
        companyName: null,
      }).ok,
    ).toBe(true);
    expect(
      enforceContactCompanyForBusinessType("b2b", {
        companyId: null,
        companyName: null,
      }).ok,
    ).toBe(true);
  });
});
