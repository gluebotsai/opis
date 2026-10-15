import { describe, expect, it } from "vitest";
import { enforceContactCompanyForBusinessType } from "./contact-company-motion";

describe("enforceContactCompanyForBusinessType", () => {
  it("allows b2b without company", () => {
    const r = enforceContactCompanyForBusinessType("b2b", {
      companyId: null,
      companyName: null,
      locationId: null,
    });
    expect(r.ok).toBe(true);
  });

  it("allows b2b with companyId", () => {
    const r = enforceContactCompanyForBusinessType("b2b", {
      companyId: "co_1",
      companyName: null,
      locationId: null,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects company on b2c", () => {
    const r = enforceContactCompanyForBusinessType("b2c", {
      companyId: "co_1",
      companyName: null,
      locationId: null,
    });
    expect(r.ok).toBe(false);
  });

  it("allows b2b2c without company", () => {
    const r = enforceContactCompanyForBusinessType("b2b2c", {
      companyId: null,
      companyName: null,
      locationId: null,
    });
    expect(r.ok).toBe(true);
  });
});
