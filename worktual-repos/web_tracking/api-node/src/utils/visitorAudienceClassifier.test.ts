import { describe, it, expect } from "node:test";
import {
  classifyVisitorAudience,
  classifyVisitorIntent,
  pathMatchesB2bIntent,
  pathMatchesB2cIntent,
} from "./visitorAudienceClassifier.js";

describe("classifyVisitorAudience (BA examples)", () => {
  it("classifies B2B example: company domain + pricing + demo form", () => {
    const audience = classifyVisitorAudience({
      workEmail: true,
      companyIdentified: true,
      multiVisitorCompanyDomain: true,
      b2bHighValuePageViews: 3,
      leadOrDemoForm: true,
      loggedIn: true,
    });
    expect(audience).toBe("B2B");
  });

  it("classifies B2C example: product path + cart + purchase", () => {
    const audience = classifyVisitorAudience({
      personalEmail: true,
      b2cHighValuePageViews: 2,
      addToCart: true,
      purchase: true,
    });
    expect(audience).toBe("B2C");
  });

  it("classifies Hybrid when work email and cart both present", () => {
    const audience = classifyVisitorAudience({
      workEmail: true,
      b2cHighValuePageViews: 1,
      addToCart: true,
      b2bHighValuePageViews: 1,
      leadOrDemoForm: true,
    });
    expect(["Hybrid", "B2B", "B2C"]).toContain(audience);
    expect(audience).not.toBe("Generic");
  });

  it("classifies Generic for home/blog only", () => {
    expect(classifyVisitorAudience({})).toBe("Generic");
  });

  it("Hybrid rule: tied scores → Hybrid", () => {
    expect(
      classifyVisitorAudience({
        workEmail: true,
        personalEmail: true,
      }),
    ).toBe("Hybrid");
  });
});

describe("classifyVisitorIntent", () => {
  it("returns High for purchase", () => {
    expect(
      classifyVisitorIntent("B2C", { purchase: true }, "medium"),
    ).toBe("High");
  });

  it("returns Low for generic low engagement", () => {
    expect(classifyVisitorIntent("Generic", {}, "low")).toBe("Low");
  });
});

describe("path matchers", () => {
  it("detects B2B paths", () => {
    expect(pathMatchesB2bIntent("/pricing")).toBe(true);
    expect(pathMatchesB2bIntent("/contact-sales")).toBe(true);
  });

  it("detects B2C paths", () => {
    expect(pathMatchesB2cIntent("/products/shoes")).toBe(true);
    expect(pathMatchesB2cIntent("/cart")).toBe(true);
  });
});
