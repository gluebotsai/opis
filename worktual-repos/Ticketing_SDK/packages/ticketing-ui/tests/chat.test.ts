import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/index.js";
import { WorktualChatElement } from "../src/chat-element.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sse(events: Array<{ event: string; data: unknown }>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const item of events) {
        controller.enqueue(
          encoder.encode(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`)
        );
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

function mount(attrs: Record<string, string> = {}): WorktualChatElement {
  const el = document.createElement("worktual-chat") as WorktualChatElement;
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  document.body.appendChild(el);
  return el;
}

function inputOf(el: WorktualChatElement): HTMLInputElement {
  const input = el.shadowRoot?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) throw new Error("missing input");
  return input;
}

describe("worktual-chat", () => {
  it("uses shadow DOM and theme tokens", () => {
    const el = mount({
      endpoint: "http://127.0.0.1:3001",
      token: "jwt",
      "theme-primary-color": "#112233",
      "theme-border-radius": "12px",
      mode: "sidebar",
    });
    expect(el.shadowRoot).toBeTruthy();
    expect(el.style.getPropertyValue("--wt-primary")).toBe("#112233");
    expect(el.style.getPropertyValue("--wt-radius")).toBe("12px");
    expect(el.classList.contains("sidebar")).toBe(true);
    expect(el.shadowRoot?.querySelector(".shell")).toBeTruthy();
  });

  it("sets RTL and translated chrome for Arabic", () => {
    const el = mount({ locale: "ar", endpoint: "http://127.0.0.1:3001", token: "jwt" });
    expect(el.getAttribute("dir")).toBe("rtl");
    expect(inputOf(el).placeholder).toBe("اسأل المساعد…");
  });

  it("streams a reply and escapes user text", async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        { event: "progress", data: { step: "super" } },
        {
          event: "result",
          data: {
            assistantText: "Listo",
            reply: "Listo",
            agent: "general",
            session_id: "chat-9",
            ui_actions: [],
            toolProposals: [],
          },
        },
        { event: "done", data: {} },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const el = mount({
      endpoint: "http://127.0.0.1:3001",
      token: "session.jwt",
      locale: "es",
      "focused-ticket": "#128",
    });
    const seen: string[] = [];
    el.addEventListener("worktual-action", ((event: CustomEvent) => {
      seen.push(event.detail.feature);
    }) as EventListener);

    inputOf(el).value = "Hola <b>";
    el.shadowRoot?.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.textContent).toContain("Listo");
    });

    expect(el.shadowRoot?.textContent).toContain("Hola <b>");
    expect(el.shadowRoot?.querySelector("b")).toBeNull();
    expect(el.getAttribute("session-id")).toBe("chat-9");
    expect(seen).toEqual(["ai.stream"]);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/coworker/agent-turn/stream");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer session.jwt");
    expect(headers.get("X-Worktual-Sdk-Surface")).toBe("ui");
    expect(headers.get("X-Worktual-Sdk-Component")).toBe("worktual-chat");
    expect(JSON.parse(String(init.body))).toMatchObject({
      message: "Hola <b>",
      locale: "es",
      entity_id: "#128",
    });
  });

  it("pins ticket.create when mode is create", async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        {
          event: "result",
          data: {
            assistantText: "Ready to file",
            agent: "ticket_creation_executor",
            toolProposals: [],
          },
        },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);
    const el = mount({
      endpoint: "http://127.0.0.1:3001",
      token: "session.jwt",
      mode: "create",
    });
    const seen: string[] = [];
    el.addEventListener("worktual-action", ((event: CustomEvent) => {
      seen.push(event.detail.feature);
    }) as EventListener);
    inputOf(el).value = "VPN is down";
    el.shadowRoot?.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.textContent).toContain("Ready to file");
    });
    expect(seen).toEqual(["ai.tasks.createTicket"]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.sdk_task).toBe("ticket.create");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Worktual-Sdk-Feature")).toBe(
      "ai.tasks.createTicket"
    );
  });

  it("shows a confirm card and posts confirm or reject", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/stream")) {
        return sse([
          {
            event: "result",
            data: {
              assistantText: "Puedo escalar el ticket.",
              reply: "Puedo escalar el ticket.",
              agent: "general",
              session_id: "chat-1",
              toolProposals: [
                { name: "escalate_ticket", args: { ticket: "#128" }, risk: "high", auto: false },
              ],
            },
          },
        ]);
      }
      return Response.json({
        assistantText: "Hecho",
        reply: "Hecho",
        agent: "general",
        session_id: "chat-1",
        toolProposals: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const el = mount({
      endpoint: "http://127.0.0.1:3001",
      token: "jwt",
      locale: "es",
      "session-id": "chat-1",
    });
    inputOf(el).value = "Escala";
    el.shadowRoot?.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector("button.primary")).toBeTruthy();
    });
    expect(el.shadowRoot?.textContent).toContain("Confirma esta acción");
    expect(el.shadowRoot?.textContent).toContain("escalate ticket");

    el.shadowRoot?.querySelector("button.primary")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.textContent).toContain("Hecho");
    });
    const confirmCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(String(confirmCall[0])).toContain("/api/coworker/agent-turn");
    expect(String(confirmCall[0])).not.toContain("/stream");
    expect(new Headers(confirmCall[1].headers).get("X-Worktual-Sdk-Feature")).toBe("ai.confirm");
    expect(JSON.parse(String(confirmCall[1].body)).confirm_tool).toEqual({
      name: "escalate_ticket",
      args: { ticket: "#128" },
    });
  });

  it("ends the session and tells the host", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const el = mount({
      endpoint: "http://127.0.0.1:3001",
      token: "session.jwt",
      "session-id": "chat-1",
    });
    const ended: string[] = [];
    el.addEventListener("worktual-session-end", ((event: CustomEvent) => {
      ended.push(event.detail.feature);
    }) as EventListener);
    await el.endSession();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/sdk/sessions/end");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Worktual-Sdk-Component")).toBe(
      "worktual-chat"
    );
    expect(ended).toEqual(["auth.session_end"]);
  });

  it("does not call the API without a token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const el = mount({ endpoint: "http://127.0.0.1:3001", locale: "en" });
    inputOf(el).value = "Hello";
    el.shadowRoot?.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.textContent).toContain("session token");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives list hints to the host and applies them when lists are showing", async () => {
    const payload = {
      assistantText: "Opened #128.",
      reply: "Opened #128.",
      agent: "general",
      ui_actions: [
        { type: "refresh_list", tickets: [{ ticketNumber: "#128", subject: "VPN" }, { ticketNumber: "#129", subject: "Mail" }] },
        { type: "open_ticket", ticketNumber: "#128" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => sse([{ event: "result", data: payload }])));
    const host: Array<Record<string, unknown>> = [];
    const plain = mount({ endpoint: "http://127.0.0.1:3001", token: "jwt" });
    plain.addEventListener("worktual-action", ((event: CustomEvent) => {
      host.push(...(event.detail.uiActions || []));
    }) as EventListener);
    inputOf(plain).value = "Show the queue";
    plain.shadowRoot?.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(host.map((action) => action.type)).toEqual(["refresh_list", "open_ticket"]);
    });
    expect(plain.shadowRoot?.querySelector("table.tickets")?.hidden).toBe(true);

    document.body.innerHTML = "";
    const listed = mount({ endpoint: "http://127.0.0.1:3001", token: "jwt", lists: "" });
    inputOf(listed).value = "Show the queue";
    listed.shadowRoot?.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(listed.shadowRoot?.querySelectorAll("table.tickets tr")).toHaveLength(2);
    });
    expect(listed.getAttribute("focused-ticket")).toBe("#128");
    expect(listed.shadowRoot?.querySelector("tr.selected")?.textContent).toContain("#128");
    listed.shadowRoot?.querySelector('tr[data-ticket="#129"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(listed.getAttribute("focused-ticket")).toBe("#129");
  });
});
