import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBED_AUTH_MESSAGE, helpFrameUrl, mountHelpFrame, mountWorktualFrame, ticketingFrameUrl } from "../src/embed.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("iframe embed", () => {
  it("loads the app with embed=1 and posts the session token", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const frame = mountWorktualFrame({
      container,
      appUrl: "https://tickets.example",
      token: "session.jwt",
      path: "/dashboard",
    });
    expect(frame.iframe.src).toBe(ticketingFrameUrl("https://tickets.example", "/dashboard"));
    expect(frame.iframe.src).toContain("embed=1");
    const post = vi.fn();
    Object.defineProperty(frame.iframe, "contentWindow", { value: { postMessage: post } });
    frame.iframe.dispatchEvent(new Event("load"));
    expect(post).toHaveBeenCalledWith(
      { type: EMBED_AUTH_MESSAGE, token: "session.jwt" },
      "https://tickets.example"
    );
    frame.unmount();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("points the help frame at the public widget id", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const frame = mountHelpFrame({
      container,
      appUrl: "https://tickets.example/",
      widgetId: "wgt_abc",
    });
    expect(frame.iframe.src).toBe(helpFrameUrl("https://tickets.example", "wgt_abc"));
    expect(frame.iframe.src).toContain("id=wgt_abc");
    expect(frame.iframe.src).not.toContain("wt_live_");
  });
});