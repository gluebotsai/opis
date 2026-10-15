import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/index.js";
import { splitSuggestion, WorktualDeskAssistElement } from "../src/desk-assist-element.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(): WorktualDeskAssistElement {
  const el = document.createElement("worktual-desk-assist") as WorktualDeskAssistElement;
  el.setAttribute("recommend-url", "http://127.0.0.1:4200/recommend");
  el.setAttribute("ticket", "ACM-1001");
  el.setAttribute("issue", "VPN drops after the laptop wakes");
  el.setAttribute("save-url", "/tickets/ACM-1001/notes");
  el.setAttribute("keep-url", "/tickets/ACM-1001/suggestion");
  el.setAttribute("csrf", "csrf-1");
  document.body.appendChild(el);
  return el;
}

function suggestionResponse(): Response {
  return new Response(
    JSON.stringify({
      guidance: "Check the VPN profile.",
      reply: "Please restart the VPN client.",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("splitSuggestion", () => {
  it("keeps guidance separate from the customer reply", () => {
    const parts = splitSuggestion("GUIDANCE: Check the VPN profile.\nREPLY: Please restart the VPN client.");
    expect(parts.guidance).toBe("Check the VPN profile.");
    expect(parts.reply).toBe("Please restart the VPN client.");
  });
});

describe("worktual-desk-assist", () => {
  it("asks the recommendation service with the desk ticket text", async () => {
    const fetchMock = vi.fn(async () => suggestionResponse());
    vi.stubGlobal("fetch", fetchMock);
    const el = mount();
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector(".dialog")?.hasAttribute("hidden")).toBe(false);
    });
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:4200/recommend");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.issue).toContain("VPN drops after the laptop wakes");
    expect(body.message).toBeUndefined();
    expect(el.shadowRoot?.querySelector(".guidance")?.textContent).toBe("Check the VPN profile.");
    expect(el.shadowRoot?.querySelector(".reply")).toHaveProperty("value", "Please restart the VPN client.");
  });

  it("saves the edited text on the desk and keeps the suggestion", async () => {
    const fetchMock = vi.fn(async () => suggestionResponse());
    vi.stubGlobal("fetch", fetchMock);
    const submitted: HTMLFormElement[] = [];
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function submit(this: HTMLFormElement) {
      submitted.push(this);
    });
    const el = mount();
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector(".reply")).toHaveProperty("value", "Please restart the VPN client.");
    });
    const box = el.shadowRoot?.querySelector(".reply");
    if (!(box instanceof HTMLTextAreaElement)) throw new Error("missing reply");
    box.value = "Edited reply for the customer.";
    el.shadowRoot?.querySelector(".save")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].action).toContain("/tickets/ACM-1001/notes");
    expect(submitted[0].querySelector("input[name='body']")).toHaveProperty("value", "Edited reply for the customer.");
    const keep = fetchMock.mock.calls[1];
    expect(String(keep[0])).toBe("/tickets/ACM-1001/suggestion");
    expect(String(keep[1].body)).toContain("Edited+reply+for+the+customer.");
  });

  it("keeps the suggestion beside notes when the agent closes the popup", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(suggestionResponse())
      .mockResolvedValueOnce(new Response("", { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const slot = document.createElement("section");
    slot.dataset.suggestionSlot = "";
    slot.hidden = true;
    const guidance = document.createElement("p");
    guidance.dataset.suggestionGuidance = "";
    const reply = document.createElement("p");
    reply.dataset.suggestionReply = "";
    slot.append(guidance, reply);
    const note = document.createElement("textarea");
    note.name = "body";
    document.body.append(slot, note);
    const el = mount();
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector(".dialog")?.hasAttribute("hidden")).toBe(false);
    });
    el.shadowRoot?.querySelector(".own")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector(".dialog")?.hasAttribute("hidden")).toBe(true);
    });
    expect(slot.hidden).toBe(false);
    expect(reply.textContent).toBe("Please restart the VPN client.");
    expect(guidance.textContent).toBe("Check the VPN profile.");
    expect(document.activeElement).toBe(note);
  });
});