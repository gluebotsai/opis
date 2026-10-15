import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDashboardFeatures } from "./dashboardFeatures.js";
import {
  applyOrgSiteTypeToWebsites,
  normalizeBusinessType,
  siteTypeFromBusinessType,
} from "./organizationBusinessType.js";

describe("organization business type", () => {
  it("maps B2C and B2B", () => {
    assert.equal(normalizeBusinessType("b2c"), "B2C");
    assert.equal(normalizeBusinessType("B2B"), "B2B");
    assert.equal(normalizeBusinessType("other"), null);
  });

  it("maps to profile site type", () => {
    assert.equal(siteTypeFromBusinessType("B2C"), "ecommerce");
    assert.equal(siteTypeFromBusinessType("B2B"), "b2b");
  });

  it("enables product analytics only for ecommerce/B2C", () => {
    assert.equal(resolveDashboardFeatures("ecommerce").product_analytics, true);
    assert.equal(resolveDashboardFeatures("b2c").product_analytics, true);
    assert.equal(resolveDashboardFeatures("b2b").product_analytics, false);
    assert.equal(resolveDashboardFeatures("blog").product_analytics, false);
  });

  it("disables Forms module for B2B site type", () => {
    assert.equal(resolveDashboardFeatures("b2b").forms, false);
    assert.equal(resolveDashboardFeatures("ecommerce").forms, true);
  });

  it("overlays website site_type when org type is known", () => {
    const rows = applyOrgSiteTypeToWebsites(
      [{ website_id: 1, site_type: "blog" }],
      "ecommerce",
    );
    assert.equal(rows[0].site_type, "ecommerce");
  });
});
