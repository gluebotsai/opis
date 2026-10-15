import { describe, expect, it } from "vitest";
import {
  buildPageCloneBlock,
  renderBlueprintHtml,
  syncPageCloneBlueprintFromAssets,
  type BlueprintAsset,
} from "@/lib/document-blueprint";

describe("syncPageCloneBlueprintFromAssets", () => {
  const pageOne: BlueprintAsset = {
    id: "page-1",
    kind: "page-meta",
    mime: "text/html",
    dataBase64: "",
    pageWidth: 595,
    pageHeight: 842,
    pageHtml:
      '<span class="pdf-text" style="left:10%;top:20%;">Proposal Submitted to Accenture</span>',
  };

  it("rebuilds blueprint.html from patched pageHtml assets", () => {
    const staleHtml =
      '<div class="bp-page-clone-root">' +
      '<div class="bp-page-clone bp-page-clone-vector" style="padding-top:141.5126%;">' +
      '<div class="pdf-page-abs">' +
      '<span class="pdf-text">Proposal Submitted to ZIFO</span>' +
      "</div></div></div>";

    const { blueprint, changed } = syncPageCloneBlueprintFromAssets(
      { version: 1, html: staleHtml, css: "", mode: "page-clone" },
      [pageOne],
    );

    expect(changed).toBe(true);
    expect(blueprint.html).toContain("Accenture");
    expect(blueprint.html).not.toContain("ZIFO");
    expect(blueprint.html).toContain("pdf-page-abs");
  });

  it("builds vector blocks with aspect ratio padding", () => {
    const block = buildPageCloneBlock(pageOne);
    expect(block).toContain("bp-page-clone-vector");
    expect(block).toContain("padding-top:141.5126%");
    expect(block).toContain("Proposal Submitted to Accenture");
    expect(block).not.toContain("height:1.");
  });
});

describe("quote blueprint cover", () => {
  it("uses Quotation title and left-aligns frozen proposal-doc cover", () => {
    const html = renderBlueprintHtml({
      blueprint: {
        version: 1,
        html: `<article class="proposal-doc"><div class="cover-block bp-playbook-cover"><p class="cover-brand">Worktual</p><h1 class="cover-title">Commercial Proposal</h1><p class="cover-prepared">Prepared for GRT Jewellers</p></div><section class="sec" data-slot="introduction"><h2 class="sec-h">Introduction</h2><div data-slot-body></div></section></article>`,
        css: `.proposal-doc .cover-brand{text-align:center}.proposal-doc .cover-title{text-align:left}`,
        slots: [{ key: "introduction", label: "Introduction" }],
      },
      sections: [
        {
          key: "introduction",
          title: "Introduction",
          body: "Dear customer,\n\nPlease find our quote below.",
        },
      ],
      tokens: {
        customerName: "GRT Jewellers",
        companyName: "GRT Jewellers",
        vendorName: "Worktual",
        date: "Sep 15, 2026",
        quoteNumber: "Q-00004",
        documentTitle: "Quotation",
      },
    });

    expect(html).toContain(">Quotation</h1>");
    expect(html).not.toMatch(/<h1[^>]*>\s*Commercial Proposal\s*<\/h1>/i);
    expect(html).toContain(".cover-brand");
    expect(html).toContain("text-align:left");
  });
});
