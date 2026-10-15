import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/index.js";
import { WorktualReplyDraftElement, WorktualSummaryElement } from "../src/task-element.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function json(body: unknown): Response {
  return Response.json(body);
}

function mount(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  document.body.appendChild(el);
  return el;
}

describe("named task chips", () => {
  it("renders a themed summary chip in Spanish", () => {
    const el = mount("worktual-summary", {
      endpoint: "http://127.0.0.1:3001",
      token: "jwt",
      locale: "es",
      "theme-primary-color": "#112233",
    }) as WorktualSummaryElement;
    expect(el.shadowRoot).toBeTruthy();
    expect(el.task).toBe("ticket.summarize");
    expect(el.style.getPropertyValue("--wt-primary")).toBe("#112233");
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("Resumen");
  });

  it("asks for a summary of the focused ticket", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        assistantText: "VPN is down.",
        agent: "investigation_summary_executor",
        session_id: "task-1",
        toolProposals: [],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const el = mount("worktual-summary", {
      endpoint: "http://127.0.0.1:3001",
      token: "jwt",
      ticket: "#128",
      locale: "es",
    });
    el.shadowRoot?.querySelector("button.run")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector(".body")?.textContent).toBe("VPN is down.");
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.sdk_task).toBe("ticket.summarize");
    expect(body.entity_id).toBe("#128");
    expect(body.locale).toBe("es");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Worktual-Sdk-Feature")).toBe(
      "ai.tasks.summarize"
    );
    expect(el.shadowRoot?.querySelector("button.primary")).toBeNull();
  });

  it("shows an editable reply and sends it as a public note", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const feature = new Headers(init?.headers).get("X-Worktual-Sdk-Feature");
      if (feature === "ai.confirm") {
        return json({ assistantText: "Enviado", agent: "customer_reply_drafting_executor", toolProposals: [] });
      }
      return json({
        assistantText: "Hola, ya lo revisamos.",
        agent: "customer_reply_drafting_executor",
        toolProposals: [{ name: "add_ticket_note", auto: false, risk: "high", args: { ticket_number: "#128" } }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = mount("worktual-reply-draft", {
      endpoint: "http://127.0.0.1:3001",
      token: "jwt",
      ticket: "#128",
      locale: "es",
    }) as WorktualReplyDraftElement;
    el.shadowRoot?.querySelector("button.run")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector("button.primary")?.textContent).toBe("Enviar");
    });
    const box = el.shadowRoot?.querySelector("textarea");
    if (!(box instanceof HTMLTextAreaElement)) throw new Error("missing draft");
    expect(box.value).toBe("Hola, ya lo revisamos.");
    box.value = "Hola, queda resuelto.";
    el.shadowRoot?.querySelector("button.primary")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector(".body")?.textContent).toBe("Enviado");
    });
    const sent = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(sent.confirm_tool).toMatchObject({
      name: "add_ticket_note",
      args: { ticket_number: "#128", text: "Hola, queda resuelto.", visibility: "public" },
    });
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("X-Worktual-Sdk-Feature")).toBe(
      "ai.confirm"
    );
  });

  it("lists similar tickets without a write button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          assistantText: "One earlier VPN ticket.",
          agent: "similar_ticket_detection_executor",
          data: { tickets: [{ ticketNumber: "#90", subject: "VPN" }] },
          toolProposals: [{ name: "update_ticket", auto: false, risk: "high" }],
        })
      )
    );
    const el = mount("worktual-similar-tickets", {
      endpoint: "http://127.0.0.1:3001",
      token: "jwt",
      ticket: "#128",
    });
    el.shadowRoot?.querySelector("button.run")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector(".list")?.textContent).toContain("#90");
    });
    expect(el.shadowRoot?.querySelector("button.primary")).toBeNull();
  });

  it("deflects from the issue text and stays RTL in Arabic", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        assistantText: "أعد تعيين VPN من الإعدادات.",
        agent: "dssa",
        data: { dssa_deflected: true, articles: [{ title: "Reset VPN" }] },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const el = mount("worktual-deflection", {
      endpoint: "http://127.0.0.1:3001",
      token: "jwt",
      locale: "ar",
      issue: "كيف أعيد تعيين VPN؟",
    });
    expect(el.getAttribute("dir")).toBe("rtl");
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("قبل إنشاء تذكرة");
    el.shadowRoot?.querySelector("button.run")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector(".list")?.textContent).toContain("Reset VPN");
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.sdk_task).toBe("intake.deflect");
    expect(body.message).toBe("كيف أعيد تعيين VPN؟");
    expect(el.shadowRoot?.querySelector("button.primary")).toBeNull();
  });

  it("confirms an assignment and keeps workload as advice", async () => {
    const fetchMock = vi.fn(async () =>
      json({
        assistantText: "Assign to Alex.",
        agent: "intelligent_assignment_executor",
        toolProposals: [{ name: "assign_ticket", auto: false, risk: "high", args: { assignee: "Alex" } }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const assign = mount("worktual-assign-card", {
      endpoint: "http://127.0.0.1:3001",
      token: "jwt",
      ticket: "#128",
      locale: "es",
    });
    expect(assign.shadowRoot?.querySelector(".title")?.textContent).toBe("Asignar");
    assign.shadowRoot?.querySelector("button.run")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(assign.shadowRoot?.querySelector("button.primary")?.textContent).toBe("Confirmar");
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).sdk_task).toBe("ticket.assign");

    const workload = mount("worktual-workload", {
      endpoint: "http://127.0.0.1:3001",
      token: "jwt",
    });
    workload.shadowRoot?.querySelector("button.run")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(workload.shadowRoot?.querySelector(".body")?.textContent).toBe("Assign to Alex.");
    });
    expect(workload.shadowRoot?.querySelector("button.primary")).toBeNull();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).sdk_task).toBe("ticket.workload");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).entity_id).toBeUndefined();
  });
});
