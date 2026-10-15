import { describe, expect, it } from "vitest";
import {
  buildDeterministicCloneReplacements,
  buildOutOfScopeProductReplacements,
  buildRasterHybridProposalBlueprint,
  extractClonePageUnits,
  inferClonePageRole,
  inferSampleCompanyNames,
  inferTemplateProductBulletBlock,
  isPageCloneBlueprint,
} from "@/service/sales/document-clone-personalize";

describe("document-clone-personalize", () => {
  it("detects page-clone blueprints", () => {
    expect(
      isPageCloneBlueprint({ version: 1, html: "", css: "", mode: "page-clone" }),
    ).toBe(true);
    expect(
      isPageCloneBlueprint({
        version: 1,
        html: '<div class="bp-page-clone"></div>',
        css: "",
      }),
    ).toBe(true);
    expect(
      isPageCloneBlueprint({ version: 1, html: "<div></div>", css: "" }),
    ).toBe(false);
  });

  it("infers sample customer names from cover lines", () => {
    const names = inferSampleCompanyNames(
      "Proposal Submitted to POTHYS for (AI Contact Centre + AI Chat Bot) dated 10-Oct-2025",
    );
    expect(names).toContain("POTHYS");
    expect(names.some((n) => n.includes("for (AI"))).toBe(false);
  });

  it("builds deterministic replacements for the deal company", () => {
    const visibleText =
      "Proposal Submitted to POTHYS (Enterprise Ticketing Platform) 10-Oct-2025";
    const rows = buildDeterministicCloneReplacements(visibleText, {
      kind: "proposal",
      organizationId: "org-1",
      companyName: "accenture",
      customerName: "accenture",
      dealTitle: "Amazon ticketing",
      vendorName: "Worktual",
      productScope: "Enterprise Ticketing Platform",
      date: "22 Aug 2026",
    });
    const pothys = rows.find((r) => r.find === "POTHYS");
    expect(pothys?.replace).toBe("Accenture");
    expect(rows.some((r) => r.find === "10-Oct-2025" && r.replace === "22 Aug 2026")).toBe(
      true,
    );
  });

  it("extracts one unit per vector page with roles", () => {
    const units = extractClonePageUnits(
      {
        version: 1,
        html: "",
        css: "",
        mode: "page-clone",
      },
      [
        {
          id: "page-2",
          kind: "page-meta",
          mime: "text/html",
          dataBase64: "",
          pageHtml:
            '<span class="pdf-text">Scope of work and deliverables for the platform.</span>',
        },
        {
          id: "page-1",
          kind: "page-meta",
          mime: "text/html",
          dataBase64: "",
          pageHtml:
            '<span class="pdf-text">Proposal Submitted to POTHYS (Ticketing)</span>',
        },
      ],
      "proposal",
    );
    expect(units).toHaveLength(2);
    expect(units[0]?.id).toBe("page-1");
    expect(units[0]?.role).toBe("cover");
    expect(units[1]?.role).toBe("scope");
  });

  it("infers commercials role for pricing pages", () => {
    expect(
      inferClonePageRole({
        pageIndex: 3,
        pageCount: 4,
        visibleText: "Pricing investment subtotal grand total",
        kind: "quote",
      }),
    ).toBe("commercials");
  });

  it("detects template multi-product bullet blocks", () => {
    const sample =
      "Proactive Contact Centre • Intelligent CRM with Website Visitor Tracking • Strategic Customer Value Management • Cognitive Customer Data Platform";
    expect(inferTemplateProductBulletBlock(sample)).toContain(
      "Proactive Contact Centre",
    );
  });

  it("replaces template catalog dump with meeting product scope", () => {
    const visibleText =
      "Commercial Proposal Prepared for Purity Harvest Proactive Contact Centre • Intelligent CRM with Website Visitor Tracking • Strategic Customer Value Management • Cognitive Customer Data Platform • AI native Ticketing System";
    const rows = buildDeterministicCloneReplacements(visibleText, {
      kind: "proposal",
      organizationId: "org-1",
      companyName: "Purity Harvest",
      customerName: "Purity Harvest",
      dealTitle: "Purity Harvest CCaaS + CRM",
      vendorName: "Worktual",
      productScope:
        "Proactive Contact Centre • Intelligent CRM with Website Visitor Tracking & Campaign Management",
      date: "20 August 2026",
    });
    expect(
      rows.some(
        (r) =>
          r.find.includes("Strategic Customer Value Management") &&
          r.replace.includes("Proactive Contact Centre"),
      ),
    ).toBe(true);
  });

  it("strips out-of-scope catalog names from split pdf-text spans", () => {
    const pageHtml =
      '<span class="pdf-text" style="left:10%">Proactive Contact Centre</span>' +
      '<span class="pdf-text" style="left:10%"> • Intelligent CRM with Website Visitor Tracking</span>' +
      '<span class="pdf-text" style="left:10%"> • Strategic Customer Value Management</span>' +
      '<span class="pdf-text" style="left:10%"> • Cognitive Customer Data Platform</span>';
    const visibleText =
      "Proactive Contact Centre • Intelligent CRM with Website Visitor Tracking • Strategic Customer Value Management • Cognitive Customer Data Platform";
    const rows = buildOutOfScopeProductReplacements(
      pageHtml,
      visibleText,
      "Proactive Contact Centre • Intelligent CRM with Website Visitor Tracking & Campaign Management",
    );
    expect(
      rows.some((r) =>
        r.find.includes("Strategic Customer Value Management"),
      ),
    ).toBe(true);
    expect(
      rows.some((r) => r.find.includes("Cognitive Customer Data Platform")),
    ).toBe(true);
  });

  it("builds raster hybrid with PDF cover and section slots", () => {
    const hybrid = buildRasterHybridProposalBlueprint({
      pageAssets: [
        {
          id: "page-1",
          kind: "page-meta",
          mime: "image/jpeg",
          dataBase64: "abc123",
        },
        {
          id: "page-2",
          kind: "page-meta",
          mime: "image/jpeg",
          dataBase64: "def456",
        },
      ],
      sections: [
        { key: "overview", title: "Overview" },
        { key: "scope", title: "Scope" },
      ],
      layoutStyle: null,
    });
    expect(hybrid).not.toBeNull();
    expect(hybrid!.blueprint.html).toContain("bp-page-clone");
    expect(hybrid!.blueprint.html).toContain('data-slot="overview"');
    expect(hybrid!.assets).toHaveLength(1);
    expect(hybrid!.assets[0]?.id).toBe("page-1");
  });
});
