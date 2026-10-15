import { describe, expect, it } from "vitest";
import { retrieveTopPlaybooks } from "./proposal-playbook-retrieve";

describe("retrieveTopPlaybooks", () => {
  it("does not boost raster visual masters over Format+Content playbooks", () => {
    const profile = { themes: ["ccaas"], products: ["crm"], summary: "CCaaS and CRM" };
    const cards = retrieveTopPlaybooks(profile, [
      {
        id: "raster",
        name: "Old clone",
        tagsJson: { tags: ["ccaas"] },
        sections: [{ key: "introduction" }],
        sourceBatchId: "b1",
        blueprint: { mode: "page-clone" },
        assets: [{ id: "page-1" }],
      },
      {
        id: "format",
        name: "Consultative CCaaS",
        tagsJson: {
          tags: ["ccaas", "crm"],
          content: { matchTags: ["ccaas", "crm"] },
          layoutStyle: { source: "minimax_design" },
        },
        sections: [{ key: "introduction" }, { key: "scope" }],
        sourceBatchId: "b2",
      },
    ]);
    expect(cards[0]?.id).toBe("format");
  });
});
