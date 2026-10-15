import { describe, expect, it } from "vitest";
import {
  applySectionUpdates,
  applyTemplateEditPatches,
  extractBlueprintVisibleText,
} from "@/lib/template-edit-patch";

describe("template-edit-patch", () => {
  it("extracts plain text from blueprint html", () => {
    const text = extractBlueprintVisibleText({
      version: 1,
      html: '<div><span class="pdf-text">Acme Corp</span></div>',
      css: "",
      mode: "page-clone",
    });
    expect(text).toContain("Acme Corp");
  });

  it("applies section and text replacements on page-clone", () => {
    const result = applyTemplateEditPatches({
      sections: [
        {
          id: "s1",
          key: "introduction",
          title: "Intro",
          body: "Hello {{customerName}}",
        },
      ],
      blueprint: {
        version: 1,
        html: '<div class="bp-page-clone">Old Vendor Name</div>',
        css: "",
        mode: "page-clone",
      },
      assets: [
        {
          id: "page-1",
          kind: "page-meta",
          mime: "text/html",
          dataBase64: "",
          pageHtml: '<span class="pdf-text">Old Vendor Name</span>',
        },
      ],
      edits: {
        sectionUpdates: [{ key: "introduction", body: "Hi {{customerName}}" }],
        textReplacements: [{ find: "Old Vendor Name", replace: "New Vendor Name" }],
      },
    });
    expect(result.sections[0]?.body).toBe("Hi {{customerName}}");
    expect(result.blueprint?.html).toContain("New Vendor Name");
    expect(
      (result.assets[0] as { pageHtml?: string }).pageHtml,
    ).toContain("New Vendor Name");
    expect(result.applied.length).toBeGreaterThan(0);
  });

  it("updates section title by key", () => {
    const { sections, applied } = applySectionUpdates(
      [{ id: "s1", key: "footer", title: "Footer", body: "Thanks" }],
      [{ key: "footer", title: "Closing" }],
    );
    expect(sections[0]?.title).toBe("Closing");
    expect(applied).toEqual(["footer"]);
  });
});
