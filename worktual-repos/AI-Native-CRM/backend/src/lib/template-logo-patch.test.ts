import { describe, expect, it } from "vitest";
import {
  extractHeaderLogoAssetIds,
  mergeLogoIntoRawAssets,
  patchBlueprintLogoHtml,
  patchTemplateLogo,
  propagateHeaderLogoAcrossPages,
} from "@/lib/template-logo-patch";

describe("template-logo-patch", () => {
  it("replaces asset:logo and all header logo img src on standard templates", () => {
    const blueprint = patchBlueprintLogoHtml(
      {
        version: 1,
        html: '<img class="pdf-image" src="asset:logo" alt=""/>',
        css: "",
      },
      { mime: "image/png", dataBase64: "abc123" },
    );
    expect(blueprint.html).toContain("data:image/png;base64,abc123");
    expect(blueprint.html).not.toContain("asset:logo");
  });

  it("updates every header pimg asset on page-clone templates", () => {
    const html =
      '<div class="bp-page-clone">' +
      '<img class="pdf-image" src="asset:pimg-1-0" style="left:1%;top:2%;width:20%;height:8%;" alt=""/>' +
      "</div>" +
      '<div class="bp-page-clone">' +
      '<img class="pdf-image" src="asset:pimg-2-0" style="left:1%;top:2%;width:20%;height:8%;" alt=""/>' +
      "</div>";
    const rawAssets = [
      {
        id: "pimg-1-0",
        kind: "image",
        mime: "image/png",
        dataBase64: "old1",
      },
      {
        id: "pimg-2-0",
        kind: "image",
        mime: "image/png",
        dataBase64: "old2",
      },
    ];
    const patched = patchTemplateLogo(
      { version: 1, html, css: "", mode: "page-clone" },
      rawAssets,
      { mime: "image/jpeg", dataBase64: "newlogo" },
    );
    expect(extractHeaderLogoAssetIds(html)).toEqual(["pimg-1-0", "pimg-2-0"]);
    const p1 = (patched.assets as { id: string; dataBase64?: string }[]).find(
      (a) => a.id === "pimg-1-0",
    );
    const p2 = (patched.assets as { id: string; dataBase64?: string }[]).find(
      (a) => a.id === "pimg-2-0",
    );
    expect(p1?.dataBase64).toBe("newlogo");
    expect(p2?.dataBase64).toBe("newlogo");
    expect(patched.blueprint.html).toContain("asset:pimg-1-0");
    expect(patched.blueprint.html).not.toContain("data:image/jpeg;base64,newlogo");
  });

  it("propagates page-1 header logo to other pages", () => {
    const html =
      '<img class="pdf-image" src="asset:pimg-1-0" style="top:2%;height:8%;"/>' +
      '<img class="pdf-image" src="asset:pimg-2-0" style="top:2%;height:8%;"/>';
    const rawAssets = [
      { id: "pimg-1-0", kind: "image", mime: "image/png", dataBase64: "fresh" },
      { id: "pimg-2-0", kind: "image", mime: "image/png", dataBase64: "stale" },
    ];
    const propagated = propagateHeaderLogoAcrossPages(
      { version: 1, html, css: "" },
      rawAssets,
    );
    expect(propagated).not.toBeNull();
    const p2 = (propagated!.assets as { id: string; dataBase64?: string }[]).find(
      (a) => a.id === "pimg-2-0",
    );
    expect(p2?.dataBase64).toBe("fresh");
  });

  it("preserves pageHtml on other raw assets when merging logo", () => {
    const raw = [
      {
        id: "page-1",
        kind: "image",
        mime: "image/jpeg",
        dataBase64: "page",
        pageHtml: "<div>page</div>",
      },
      {
        id: "logo",
        kind: "logo",
        mime: "image/png",
        dataBase64: "old",
      },
    ];
    const next = mergeLogoIntoRawAssets(raw, {
      mime: "image/jpeg",
      dataBase64: "newlogo",
    });
    expect(next).toHaveLength(2);
    const page = next.find((a) => (a as { id?: string }).id === "page-1") as {
      pageHtml?: string;
    };
    expect(page.pageHtml).toBe("<div>page</div>");
    const logo = next.find((a) => (a as { id?: string }).id === "logo") as {
      dataBase64?: string;
    };
    expect(logo.dataBase64).toBe("newlogo");
  });
});
