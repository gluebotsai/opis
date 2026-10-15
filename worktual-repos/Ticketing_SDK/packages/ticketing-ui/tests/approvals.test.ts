import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/index.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("worktual-approvals");
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  document.body.appendChild(el);
  return el;
}

describe("worktual-approvals", () => {
  it("lists a confirm card and a recommendation, then sends the edited reply", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const feature = new Headers(init?.headers).get("X-Worktual-Sdk-Feature");
      if (feature === "ai.proposals.confirm") {
        return Response.json({ id: "approval:12", ok: true, status: "applied" });
      }
      return Response.json({
        items: [
          {
            id: "approval:12",
            kind: "approval",
            status: "confirmation_required",
            agentId: "crda",
            ticketNumber: "#128",
            summary: "Send this reply",
            draft: "Hola",
          },
          {
            id: "recommendation:4",
            kind: "recommendation",
            status: "recommendation",
            agentId: "rkaa",
            ticketNumber: "#128",
            summary: "Try the VPN article",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = mount({
      endpoint: "http://127.0.0.1:3001",
      token: "jwt",
      locale: "es",
      ticket: "#128",
      "theme-primary-color": "#112233",
    });
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelectorAll(".card").length).toBe(2);
    });
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("Aprobaciones");
    expect(el.style.getPropertyValue("--wt-primary")).toBe("#112233");
    expect(String(fetchMock.mock.calls[0][0])).toContain("ticketNumber=%23128");
    const box = el.shadowRoot?.querySelector("textarea");
    if (!(box instanceof HTMLTextAreaElement)) throw new Error("missing draft");
    box.value = "Hola, listo";
    el.shadowRoot?.querySelector("button.primary")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelectorAll(".card").length).toBe(1);
    });
    const sent = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(sent).toEqual({ decision: "confirm", edits: { text: "Hola, listo" } });
    expect(el.shadowRoot?.querySelector(".card h3")?.textContent).toContain("VPN");
  });

  it("does not fetch without a session token and uses Arabic", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const el = mount({ locale: "ar", endpoint: "http://127.0.0.1:3001" });
    expect(el.getAttribute("dir")).toBe("rtl");
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("الموافقات");
    expect(el.shadowRoot?.querySelector(".empty")?.textContent).toContain("رمز الجلسة");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
