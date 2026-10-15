import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/index.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("worktual-inbox", () => {
  it("uses German chrome when the list is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    const el = document.createElement("worktual-inbox");
    el.setAttribute("endpoint", "http://127.0.0.1:3001");
    el.setAttribute("token", "jwt");
    el.setAttribute("locale", "de");
    document.body.appendChild(el);
    await vi.waitFor(() => {
      expect(el.shadowRoot?.textContent).toContain("Keine Benachrichtigungen.");
    });
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("Benachrichtigungen");
  });

  it("lists notifications and marks one read", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return Response.json({ ok: true });
      return Response.json([
        { id: "n1", title: "Assigned", message: "You own this ticket", ticketId: "#128", read: false },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = document.createElement("worktual-inbox");
    el.setAttribute("endpoint", "http://127.0.0.1:3001");
    el.setAttribute("token", "jwt");
    el.setAttribute("locale", "es");
    document.body.appendChild(el);
    await vi.waitFor(() => {
      expect(el.shadowRoot?.textContent).toContain("Assigned");
    });
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("Avisos");
    expect(el.shadowRoot?.textContent).toContain("#128");
    const seen: string[] = [];
    el.addEventListener("worktual-action", ((event: CustomEvent) => {
      if (event.detail.feature === "inbox.read") seen.push(event.detail.id);
    }) as EventListener);
    el.shadowRoot?.querySelector("[data-id]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(seen).toEqual(["n1"]);
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain("/api/notifications/n1/read");
    expect(el.shadowRoot?.querySelector(".item")?.classList.contains("read")).toBe(true);
  });
});