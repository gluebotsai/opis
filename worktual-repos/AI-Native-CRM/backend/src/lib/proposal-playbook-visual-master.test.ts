import { describe, expect, it } from "vitest";
import {
  parseVisualMasterFromAgentResponse,
  playbookHasRasterOnlyVisualMaster,
  playbookHasVisualMaster,
} from "@/lib/proposal-playbook-visual-master";

describe("parseVisualMasterFromAgentResponse", () => {
  it("accepts page-clone even when agent ok flag is false", () => {
    const parsed = parseVisualMasterFromAgentResponse({
      ok: false,
      status: "failed",
      reason: "llm_not_configured",
      blueprint: {
        version: 1,
        mode: "page-clone",
        html: '<div class="bp-page-clone-root"><div class="bp-page-clone"></div></div>',
        css: "",
      },
      assets: [
        {
          id: "page-1",
          kind: "image",
          mime: "image/jpeg",
          dataBase64: "abc",
        },
      ],
    });
    expect("master" in parsed).toBe(true);
    if ("master" in parsed) {
      expect(parsed.master.blueprint.mode).toBe("page-clone");
    }
  });

  it("returns failure when blueprint is missing", () => {
    const parsed = parseVisualMasterFromAgentResponse({
      ok: false,
      status: "failed",
      reason: "clone_failed",
    });
    expect("reason" in parsed).toBe(true);
    if ("reason" in parsed) {
      expect(parsed.reason).toBe("clone_failed");
    }
  });
});

describe("playbookHasVisualMaster", () => {
  it("requires page-clone blueprint and assets", () => {
    expect(
      playbookHasVisualMaster({
        blueprint: { version: 1, mode: "playbook-layout", html: "", css: "" },
        assets: [{ id: "page-1", kind: "image", mime: "image/jpeg", dataBase64: "x" }],
      }),
    ).toBe(false);
    expect(
      playbookHasVisualMaster({
        blueprint: {
          version: 1,
          mode: "page-clone",
          html: '<div class="bp-page-clone"></div>',
          css: "",
        },
        assets: [
          {
            id: "page-1",
            kind: "page-meta",
            mime: "text/html",
            dataBase64: "",
            pageHtml: "<div>page</div>",
          },
        ],
      }),
    ).toBe(true);
  });

  it("detects raster-only visual masters", () => {
    const raster = {
      blueprint: {
        version: 1,
        mode: "page-clone",
        html: '<div class="bp-page-clone-root"><div class="bp-page-clone"></div></div>',
        css: "",
      },
      assets: [
        {
          id: "page-1",
          kind: "page-meta",
          mime: "image/jpeg",
          dataBase64: "abc",
        },
      ],
    };
    expect(playbookHasVisualMaster(raster)).toBe(true);
    expect(playbookHasRasterOnlyVisualMaster(raster)).toBe(true);
  });
});
