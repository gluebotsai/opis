import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/index.js";
import { WorktualNoteRecommendElement } from "../src/note-recommend-element.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(): { el: WorktualNoteRecommendElement; box: HTMLTextAreaElement } {
  const form = document.createElement("form");
  const box = document.createElement("textarea");
  box.name = "body";
  const el = document.createElement("worktual-note-recommend") as WorktualNoteRecommendElement;
  el.setAttribute("recommend-url", "http://127.0.0.1:4200/recommend");
  el.setAttribute("issue", "VPN drops after the laptop wakes");
  el.setAttribute("ticket", "ACM-1001");
  form.append(box, el);
  document.body.append(form);
  return { el, box };
}

describe("worktual-note-recommend", () => {
  it("waits for a click before asking for a recommendation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fills the note box with the suggested reply", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      guidance: "Check the VPN profile.",
      reply: "Please restart the VPN client.",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { el, box } = mount();
    el.shadowRoot?.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(box.value).toBe("Please restart the VPN client.");
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.issue).toContain("VPN drops after the laptop wakes");
    expect(body.grounded).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:4200/recommend");
  });

  it("sends a saved passage to the model and shows the rephrased reply", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/search")) {
        return new Response(JSON.stringify({
          found: true,
          guidance: "This came from loading-bay-key.txt.",
          reply: "The spare key hangs on hook 7.",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        guidance: "The reply follows the saved knowledge.",
        reply: "The spare key for that locker is on hook 7.",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { el, box } = mount();
    el.setAttribute("rag-url", "http://127.0.0.1:4300/search");
    el.shadowRoot?.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(box.value).toBe("The spare key for that locker is on hook 7.");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:4300/search");
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:4200/recommend");
    const body = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(body.knowledge).toBe("The spare key hangs on hook 7.");
    expect(body.grounded).toBe(true);
  });
});
