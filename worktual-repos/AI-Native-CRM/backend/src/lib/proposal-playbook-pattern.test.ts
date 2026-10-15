import { describe, expect, it } from "vitest";
import {
  buildPlaybookTagsJson,
  gateProposalSectionsAgainstAllowedProducts,
  heuristicClusterProposals,
  normalizeClusters,
  playbookPatternForAgent,
  splitPlaybookPattern,
  isUsableLearnedLayout,
  displayPlaybookSectionTitle,
} from "./proposal-playbook-pattern";

describe("splitPlaybookPattern", () => {
  it("reads legacy layoutStyle + sectionsJson as format and content", () => {
    const split = splitPlaybookPattern({
      tagsJson: {
        tags: ["ccaas", "crm"],
        pricingShape: "line_items",
        overallTone: "formal",
        layoutStyle: {
          headingColor: "#0f2942",
          coverStyle: "left",
          fontFamily: "Calibri, Arial, Helvetica, sans-serif",
        },
      },
      sectionsJson: [
        {
          key: "introduction",
          title: "Introduction",
          contentPattern:
            "Open with customer context then the requested vs recommended framing.",
          body: "Old PDF paragraph that must not leak",
        },
      ],
    });
    expect(split.format.coverStyle).toBe("left");
    expect(split.format.headingColor).toBe("#0f2942");
    expect(split.content.pricingShape).toBe("line_items");
    expect(split.content.sections[0]?.key).toBe("introduction");
    expect(split.content.sections[0]?.contentPattern).toMatch(/requested/);
    expect(split.content.sections[0]).not.toHaveProperty("body");
    expect(split.visualMasterMode).toBe("none");
  });

  it("prefers explicit format + content namespaces", () => {
    const split = splitPlaybookPattern({
      tagsJson: {
        format: { coverStyle: "centered", headingColor: "#123456" },
        content: {
          overallTone: "consultative",
          pricingShape: "tiered",
          matchTags: ["consultative", "ccaas"],
          sectionOrder: ["introduction", "commercials"],
        },
        visualMasterMode: "reference",
      },
      sectionsJson: [{ key: "introduction", title: "Intro" }],
    });
    expect(split.format.coverStyle).toBe("centered");
    expect(split.content.matchTags).toEqual(["consultative", "ccaas"]);
    expect(split.visualMasterMode).toBe("reference");
  });

  it("preserves featureSchema on content", () => {
    const split = splitPlaybookPattern({
      tagsJson: {
        format: { coverStyle: "left", headingColor: "#123456" },
        content: {
          featureSchema: {
            tables: [{ key: "comparison", columns: ["Capability", "Requested"] }],
            requestedFeatures: ["omnichannel"],
          },
        },
      },
      sectionsJson: [{ key: "comparison", title: "Comparison" }],
    });
    expect(split.content.featureSchema).toBeTruthy();
    expect(
      (split.content.featureSchema as { requestedFeatures?: string[] })
        .requestedFeatures,
    ).toContain("omnichannel");
  });
});

describe("playbookPatternForAgent", () => {
  it("returns format and content and strips historical prose", () => {
    const pattern = playbookPatternForAgent({
      id: "pb1",
      name: "Telco pattern",
      tags: ["telecom"],
      tagsJson: {},
      layoutStyle: null,
      sections: [
        {
          key: "introduction",
          title: "Introduction",
          intent: "Open with customer context",
          contentPattern: "Vendor greeting then customer pain",
          body: "Old PDF paragraph that must not leak",
          sampleText: "Acme Corp needs CRM",
        },
      ],
      sourceBatchId: "batch-1",
    });
    expect(pattern.format).toBeTruthy();
    expect(pattern.content.sections[0]?.contentPattern).toBeTruthy();
    expect(pattern.content.sections[0]).not.toHaveProperty("body");
    expect(pattern.content.sections[0]).not.toHaveProperty("sampleText");
  });
});

describe("heuristicClusterProposals", () => {
  it("keeps similar PDFs in one cluster", () => {
    const clusters = heuristicClusterProposals([
      {
        itemId: "a",
        coverStyle: "left",
        pricingShape: "line_items",
      },
      {
        itemId: "b",
        coverStyle: "left",
        pricingShape: "line_items",
      },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.proposalItemIds).toEqual(["a", "b"]);
  });

  it("splits mixed styles into two clusters", () => {
    const clusters = heuristicClusterProposals([
      {
        itemId: "purity",
        coverStyle: "left",
        pricingShape: "line_items",
      },
      {
        itemId: "orange",
        coverStyle: "banner",
        pricingShape: "tiered",
      },
    ]);
    expect(clusters).toHaveLength(2);
  });
});

describe("normalizeClusters", () => {
  it("assigns leftover ids to the first cluster", () => {
    const out = normalizeClusters(
      [{ name: "A", tags: ["left"], proposalItemIds: ["a"] }],
      ["a", "b"],
    );
    expect(out[0]?.proposalItemIds.sort()).toEqual(["a", "b"]);
  });
});

describe("gateProposalSectionsAgainstAllowedProducts", () => {
  it("strips CDP and CVM when only CCaaS and CRM are allowed", () => {
    const gated = gateProposalSectionsAgainstAllowedProducts({
      sections: [
        {
          key: "scope",
          body: "We recommend CCaaS plus the Cognitive Customer Data Platform and CVM for telecom ARPU.",
        },
      ],
      allowedProducts: ["Worktual CCaaS", "AI Native CRM"],
      catalogNames: ["Cognitive Customer Data Platform", "AI Native CRM"],
    });
    expect(gated.sections[0]?.body).not.toMatch(/Customer Data Platform/i);
    expect(gated.sections[0]?.body).not.toMatch(/\bCVM\b/i);
    expect(gated.stripped.length).toBeGreaterThan(0);
  });

  it("gates product names in table cells", () => {
    const gated = gateProposalSectionsAgainstAllowedProducts({
      sections: [
        {
          key: "commercials",
          body: "Pricing for CCaaS.",
          tableRows: [{ cells: ["CVM", "Worktual CCaaS"] }],
        },
      ],
      allowedProducts: ["Worktual CCaaS"],
    });
    const cells = (
      gated.sections[0] as { tableRows?: Array<{ cells: string[] }> }
    ).tableRows?.[0]?.cells;
    expect(cells?.[0]).not.toMatch(/\bCVM\b/i);
    expect(cells?.[1]).toMatch(/CCaaS/i);
  });
});

describe("buildPlaybookTagsJson", () => {
  it("stores format and content without a visual master", () => {
    const split = splitPlaybookPattern({
      tagsJson: { layoutStyle: { coverStyle: "left" } },
      sectionsJson: [{ key: "scope", title: "Scope", contentPattern: "x".repeat(50) }],
    });
    const tags = buildPlaybookTagsJson({
      tags: ["ccaas"],
      format: split.format,
      content: split.content,
    });
    expect(tags.visualMasterMode).toBe("none");
    expect(tags.format).toBeTruthy();
    expect((tags.content as { matchTags?: string[] }).matchTags).toContain("ccaas");
  });
});

describe("isUsableLearnedLayout", () => {
  it("accepts Gemini design output including hint merge", () => {
    expect(
      isUsableLearnedLayout({
        source: "gemini_design+hint",
        fontFamily: "Calibri, Arial, sans-serif",
        headingColor: "#0f2942",
        coverStyle: "centered",
      }),
    ).toBe(true);
  });

  it("rejects heuristic and geometry fallbacks", () => {
    expect(
      isUsableLearnedLayout({
        source: "geometry_hint_fallback",
        fontFamily: "Arial",
        headingColor: "#0f2942",
        coverStyle: "left",
      }),
    ).toBe(false);
    expect(isUsableLearnedLayout(null)).toBe(false);
  });
});

describe("displayPlaybookSectionTitle", () => {
  it("strips regex heading patterns", () => {
    expect(displayPlaybookSectionTitle("^Overview$")).toBe("Overview");
    expect(
      displayPlaybookSectionTitle(
        "^Requested Solution — As specified by the.*",
      ),
    ).toBe("Requested Solution");
  });
});
