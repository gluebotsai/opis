import { describe, expect, it } from "vitest";
import { moduleIdsForNav } from "./modules";

describe("moduleIdsForNav reports marketing exception", () => {
  it("hides reports from admin nav while keeping dashboard", () => {
    const ids = moduleIdsForNav("b2b", "admin");
    expect(ids).toContain("dashboard");
    expect(ids).not.toContain("reports");
  });

  it("keeps reports in marketing nav", () => {
    const ids = moduleIdsForNav("b2b", "marketing");
    expect(ids).toContain("reports");
    expect(ids).toContain("dashboard");
  });

  it("removes reports from sales_rep nav", () => {
    const ids = moduleIdsForNav("b2b", "sales_rep");
    expect(ids).not.toContain("reports");
  });
});
